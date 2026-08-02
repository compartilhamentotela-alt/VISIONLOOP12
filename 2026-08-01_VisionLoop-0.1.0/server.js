const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require("@aws-sdk/client-s3");

// ---------- Armazenamento de mídia (Cloudflare R2, opcional) ----------
// Por padrão os vídeos/imagens ficam no disco local do Render — que é
// EFÊMERO (some a cada deploy/reinício) e cuja banda de saída é muito curta
// no plano gratuito (5GB/mês no total, e uma única TV tocando o dia todo já
// estoura isso). Configurando as 5 variáveis de ambiente abaixo, o servidor
// passa a enviar cada vídeo/imagem pronto para um bucket R2 (compatível com
// S3) e as TVs passam a buscar o arquivo direto de lá — o Render deixa de
// carregar peso de vídeo, e o conteúdo sobrevive a deploys. Sem essas
// variáveis, tudo continua exatamente como antes (disco local).
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL; // ex: https://videos.seudominio.com (sem barra no final)
const R2_ENABLED = !!(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && R2_PUBLIC_BASE_URL);

// Trava de segurança contra cobrança surpresa: a Cloudflare NÃO tem um limite
// rígido de uso pra R2 (só um "budget alert" que manda e-mail depois que você
// já passou do grátis, sem impedir a cobrança em si). Então quem impede o
// upload de estourar os 10GB grátis é o próprio VisionLoop, se essa variável
// opcional estiver configurada. Sem ela, não existe teto (sobe à vontade).
const R2_MAX_STORAGE_GB = process.env.R2_MAX_STORAGE_GB ? parseFloat(process.env.R2_MAX_STORAGE_GB) : null;
const R2_MAX_STORAGE_BYTES = Number.isFinite(R2_MAX_STORAGE_GB) ? R2_MAX_STORAGE_GB * 1024 * 1024 * 1024 : null;

const s3Client = R2_ENABLED
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

function mimeForName(name) {
  const ext = path.extname(name).toLowerCase();
  const map = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

function uploadToR2(localPath, key) {
  return s3Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: fs.createReadStream(localPath),
    ContentType: mimeForName(key),
    CacheControl: "public, max-age=3600",
  }));
}

function deleteFromR2(key) {
  return s3Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
}

function listR2Media() {
  return s3Client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME }))
    .then((data) => (data.Contents || [])
      .map((o) => o.Key)
      .filter((k) => k && !k.startsWith(".") && MEDIA_EXT_REGEX.test(k)));
}

// Soma o tamanho de tudo que já está no bucket, paginando (a API só devolve
// até 1000 itens por página). Só é chamada quando R2_MAX_STORAGE_GB está
// configurado — sem isso, não vale a pena o custo extra de uma listagem a
// mais a cada upload.
async function getR2TotalBytes() {
  let total = 0;
  let ContinuationToken;
  do {
    const data = await s3Client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, ContinuationToken }));
    total += (data.Contents || []).reduce((sum, o) => sum + (o.Size || 0), 0);
    ContinuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return total;
}

// Confere se subir mais `incomingBytes` estouraria o teto configurado.
// `incomingBytes` é uma ESTIMATIVA (tamanho do arquivo original, antes da
// transcodificação) — o vídeo final normalmente fica do mesmo tamanho ou
// menor (a conversão comprime e limita a resolução), então checar antes de
// gastar CPU convertendo é uma margem de segurança razoável, não uma conta exata.
async function wouldExceedStorageCap(incomingBytes) {
  if (!R2_ENABLED || R2_MAX_STORAGE_BYTES == null) return false;
  const current = await getR2TotalBytes();
  return (current + (incomingBytes || 0)) > R2_MAX_STORAGE_BYTES;
}

function r2ObjectExists(key) {
  return s3Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }))
    .then(() => true)
    .catch((err) => {
      const status = err && err.$metadata && err.$metadata.httpStatusCode;
      if (status === 404 || err.name === "NotFound") return false;
      throw err; // erro de rede/credencial: não confundir com "nome livre"
    });
}

// Termina uma requisição de upload com sucesso. Quando o R2 está ligado,
// sobe o arquivo pronto pro bucket e só then apaga a cópia local (o disco do
// Render é só uma escala de passagem, não o destino final); se o envio falhar,
// avisa o controlador para tentar de novo em vez de fingir sucesso com um
// arquivo que vai sumir no próximo deploy.
function respondUploadSuccess(res, localPath, key, extraFields) {
  const payload = Object.assign({ success: true, filename: key }, extraFields || {});
  if (R2_ENABLED) {
    uploadToR2(localPath, key)
      .then(() => {
        fs.unlink(localPath, () => {});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      })
      .catch((err) => {
        console.error("Falha ao enviar para o R2:", err);
        fs.unlink(localPath, () => {});
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Arquivo processado, mas falhou o envio para o armazenamento (R2). Tente enviar de novo." }));
      });
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

// Rede de segurança contra crash do processo inteiro. Uma exceção não
// capturada em QUALQUER upload/mensagem derrubava o servidor todo — TVs e
// controladores de todo mundo caem juntos e o Render reinicia o app (a
// próxima requisição em voo vê a conexão cair, aparecendo como 502/erro de
// rede). Isso NÃO protege contra o processo ser morto por estourar o limite
// de memória do plano (SIGKILL do sistema operacional não passa pelo Node,
// nada em JS pega isso) — só evita que um bug de código (exceção síncrona ou
// promise sem .catch) tire o servidor do ar por causa de uma requisição só.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException (processo seguiu no ar):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection (processo seguiu no ar):", err);
});

const PORT = process.env.PORT || 3000;
// Formatos aceitos: apenas os de uso comum. Vídeo em .mp4 (universal), .mov
// (padrão do iPhone) e .webm; imagem em .jpg/.jpeg, .png e .webp.
const VIDEO_EXT_REGEX = /\.(mp4|mov|webm)$/i;
const IMAGE_EXT_REGEX = /\.(jpg|jpeg|png|webp)$/i;
const MEDIA_EXT_REGEX = /\.(mp4|mov|webm|jpg|jpeg|png|webp)$/i;
const PLAYLISTS_FILE = path.join(__dirname, "playlists.json");

// Tempo de exibição das imagens na playlist, em segundos (vídeos tocam até o
// fim e ficam com 0). Os mesmos limites existem no controlador; aqui eles são
// aplicados de novo porque o servidor não confia no que chega pela rede.
const IMAGE_DURATION_DEFAULT = 10;
const IMAGE_DURATION_MIN = 1;
const IMAGE_DURATION_MAX = 300;

// ---------- Transcodificação de vídeo para HD ----------
// Muitas Smart TVs travam ao reproduzir vídeo por causa de:
//  1) Resolução/bitrate maiores do que o decodificador de hardware aguenta
//     (1080p/4K com bitrate alto sobrecarrega TVs de entrada);
//  2) Perfis/containers que o navegador embarcado da TV não decodifica bem
//     (High Profile, .mov/.webm, HEVC, 10-bit, etc.) — muitas TVs só
//     suportam de forma confiável H.264 Baseline/Main + AAC dentro de .mp4;
//  3) Arquivo .mp4 sem "faststart" (índice/moov no final do arquivo), que
//     impede o navegador de começar a bufferizar/pré-carregar sem baixar o
//     arquivo inteiro primeiro.
// Por isso, todo vídeo enviado é reconvertido no servidor para um .mp4 H.264
// Main Profile + AAC, redimensionado para no máximo 1280x720 (HD) sem
// upscaling, com "faststart" habilitado — isso resolve compatibilidade,
// travamentos de decodificação e permite pré-carregamento de verdade.
const HD_MAX_WIDTH = 1280;
const HD_MAX_HEIGHT = 720;
// Teto de bitrate em kbps. Suficiente para 720p30 com boa qualidade e dentro
// do que decodificadores de TVs de entrada acompanham sem engasgar.
const MAX_BITRATE_KBPS = 3000;

function transcodeVideoToHD(inputPath, tmpOutputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      // Reduz para HD mantendo a proporção original e NUNCA aumenta vídeos
      // que já são menores (force_original_aspect_ratio=decrease + min()).
      .videoFilters(
        `scale='min(${HD_MAX_WIDTH},iw)':'min(${HD_MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
      )
      .videoCodec("libx264")
      .outputOptions([
        "-profile:v main", // suportado pela grande maioria dos decodificadores de TV
        // Nível 3.1 é o exato necessário para 720p30. O 4.0 usado antes
        // sinaliza exigências de 1080p, e decodificadores antigos que checam
        // esse campo podem recusar o arquivo antes mesmo de tentar decodificar.
        "-level 3.1",
        "-preset veryfast",
        "-crf 23", // qualidade nítida com arquivo bem menor que o original
        // Teto de bitrate: cenas com muito movimento gerariam picos de vários
        // Mbps que o decodificador de uma TV de entrada não acompanha — e
        // picos travam mais TVs do que bitrate médio alto. O crf continua
        // mandando na qualidade; maxrate/bufsize só aparam os extremos.
        `-maxrate ${MAX_BITRATE_KBPS}k`,
        `-bufsize ${MAX_BITRATE_KBPS * 2}k`,
        "-g 60", // keyframe a cada 2s: recuperação mais rápida depois de um engasgo
        "-pix_fmt yuv420p", // formato de cor universal (evita 10-bit/4:2:2 incompatível)
        "-r 30", // normaliza a taxa de quadros, evita VFR problemático em algumas TVs
        "-movflags +faststart", // move o índice pro início: permite iniciar/pré-carregar sem baixar tudo
        "-max_muxing_queue_size 1024",
        // Corte de memória de pico do encode: no plano gratuito do Render
        // (512MB de RAM, processo do ffmpeg rodando dentro do mesmo container
        // do servidor) o libx264 com múltiplas threads chegava a estourar o
        // limite de memória e o Render matava o app no meio do upload — o
        // controlador só via a conexão cair (502 Bad Gateway), em QUALQUER
        // vídeo, mesmo pequeno, porque o estouro é por overhead de processo
        // (buffers de lookahead/threads), não pelo tamanho do arquivo em si.
        // "-threads 1" evita os buffers extras de codificação paralela, e
        // reduzir o lookahead/referências do x264 corta ainda mais o pico —
        // com perda de eficiência de compressão desprezível para o uso aqui
        // (propaganda/cardápio em loop, não streaming de cinema).
        "-threads 1",
        "-x264-params rc-lookahead=20:ref=2",
      ])
      .audioCodec("aac")
      .audioBitrate("128k")
      .audioChannels(2)
      .on("error", (err) => reject(err))
      .on("end", () => resolve(tmpOutputPath))
      .save(tmpOutputPath);
  });
}

// ---------- Utilitários ----------

// Acha um nome livre pra esse arquivo. Com o R2 ligado, "livre" é checado no
// BUCKET (via HEAD), não no disco local — o disco do Render é efêmero e some
// a cada deploy, então checar só nele deixaria passar batido um nome que já
// existe no R2 (sobrescrevendo silenciosamente o vídeo/imagem antigo).
async function getUniqueFilename(dir, filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = filename;
  let n = 1;
  const taken = R2_ENABLED
    ? (name) => r2ObjectExists(name)
    : (name) => Promise.resolve(fs.existsSync(path.join(dir, name)));
  while (await taken(candidate)) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  return candidate;
}

function loadPlaylists() {
  if (!fs.existsSync(PLAYLISTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, "utf8")); }
  catch { return {}; }
}

function savePlaylists(data) {
  fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ---------- Servidor HTTP ----------

const server = http.createServer((req, res) => {
  const rawPath = req.url.split("?")[0];
  let decodedPath;
  try { decodedPath = decodeURIComponent(rawPath); }
  catch { decodedPath = rawPath; }
  const urlPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };

  // Com o R2 ligado, o vídeo/imagem em si não mora mais no Render — o
  // servidor só devolve um redirecionamento pra URL pública do bucket. Isso
  // mantém TODO o resto (controller.html, tv.html, double buffer, preload,
  // watchdog) funcionando sem nenhuma mudança: pra eles, `/videos/<nome>`
  // continua sendo a URL do arquivo, só que agora ela responde com um 302 em
  // vez do arquivo. Só os poucos bytes do redirecionamento passam pela banda
  // do Render — o vídeo em si (o que pesava) vem direto do R2.
  if (R2_ENABLED && urlPath.startsWith("/videos/")) {
    const safeName = path.basename(urlPath);
    if (!safeName) { res.writeHead(400); res.end("Nome inválido"); return; }
    res.writeHead(302, {
      Location: `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${encodeURIComponent(safeName)}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (urlPath.startsWith("/videos/") || urlPath.startsWith("/assets/")) {
    const mediaPath = path.join(__dirname, urlPath);
    const safeRoot = path.resolve(__dirname) + path.sep;
    if (!path.resolve(mediaPath).startsWith(safeRoot)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    if (!fs.existsSync(mediaPath)) {
      res.writeHead(404); res.end("Not found"); return;
    }

    const stat = fs.statSync(mediaPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Se for imagem, não precisa de streaming de range complexo na maioria dos
    // casos, mas mantemos por compatibilidade.
    // O `|| ""` evita quebrar caso sobre na pasta algum arquivo com extensão
    // fora da tabela `mime` (ex: um .mkv antigo, de antes da limpeza de
    // formatos) — sem ele, um acesso a esse arquivo derrubaria o servidor.
    if (range && !(mime[ext] || "").startsWith("image/")) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
        return res.end();
      }

      const chunkSize = end - start + 1;
      const file = fs.createReadStream(mediaPath, { start, end, highWaterMark: 64 * 1024 });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mime[ext] || "video/mp4",
        "Cache-Control": "public, max-age=3600",
      });

      // TÓPICO 4: Tratamento de erro no streaming para evitar que o servidor ou a TV travem em conexões instáveis
      file.on('error', (err) => {
        console.error("Streaming error (206):", err);
        if (!res.writableEnded) res.destroy();
      });

      // Se o cliente fechar a conexão abruptamente, encerramos a leitura do arquivo
      res.on('close', () => {
        file.destroy();
      });

      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": mime[ext] || (IMAGE_EXT_REGEX.test(ext) ? "image/jpeg" : "video/mp4"),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      });

      const file = fs.createReadStream(mediaPath, { highWaterMark: 64 * 1024 });

      file.on('error', (err) => {
        console.error("Streaming error (200):", err);
        if (!res.writableEnded) res.destroy();
      });

      res.on('close', () => {
        file.destroy();
      });

      file.pipe(res);
    }
    return;
  }

  // O navegador pede /favicon.ico sozinho; sem esta rota ele registrava um
  // erro 404 no console em toda visita. Reaproveitamos o ícone do app.
  if (urlPath === "/favicon.ico") {
    const iconPath = path.join(__dirname, "assets", "icon.png");
    if (fs.existsSync(iconPath)) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      });
      fs.createReadStream(iconPath).pipe(res);
    } else {
      res.writeHead(204).end();
    }
    return;
  }

  if (urlPath === "/videos-list") {
    if (R2_ENABLED) {
      listR2Media()
        .then((files) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(files));
        })
        .catch((err) => {
          console.error("Erro ao listar mídia no R2:", err);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Erro ao listar mídia no armazenamento (R2)." }));
        });
      return;
    }
    const dir = path.join(__dirname, "videos");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    const allFiles = fs.readdirSync(dir);
    // Filtra tanto vídeos quanto imagens, ignorando arquivos ocultos — em
    // especial os temporários ".transcoding_*.mp4" criados durante a conversão,
    // que apareciam na grade do controlador com nome estranho enquanto o
    // vídeo ainda estava sendo processado.
    const files = allFiles.filter((f) => !f.startsWith(".") && MEDIA_EXT_REGEX.test(f));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(files));
    return;
  }

  // ---------- PLAYLISTS API ----------

  if (urlPath === "/playlists" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadPlaylists()));
    return;
  }

  if (urlPath === "/playlists" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const playlist = JSON.parse(body);
        if (!playlist.name || !playlist.name.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Nome da playlist é obrigatório." }));
          return;
        }
        if (!Array.isArray(playlist.videos) || playlist.videos.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "A playlist deve ter ao menos 1 item." }));
          return;
        }
        const playlists = loadPlaylists();
        const id = playlist.id || Date.now().toString();
        // Normaliza os itens: aceita o formato antigo (array de strings) e o
        // novo (array de objetos), e sempre grava um tempo válido. O servidor
        // é o último ponto antes do disco, então não confia no que chega —
        // um tempo ausente, negativo ou absurdo deixaria a imagem presa na
        // tela para sempre.
        const videos = playlist.videos.map(item => {
          const name = typeof item === 'string' ? item : (item && item.name);
          if (!name || typeof name !== 'string') return null;
          const isImage = IMAGE_EXT_REGEX.test(name);
          let duration = 0;
          if (isImage) {
            const raw = typeof item === 'object' ? parseInt(item.duration, 10) : NaN;
            duration = Number.isFinite(raw)
              ? Math.min(IMAGE_DURATION_MAX, Math.max(IMAGE_DURATION_MIN, raw))
              : IMAGE_DURATION_DEFAULT;
          }
          return { name: path.basename(name), duration, isImage };
        }).filter(Boolean);

        if (!videos.length) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Nenhum item válido na playlist." }));
          return;
        }
        playlists[id] = {
          id,
          name: playlist.name.trim(),
          videos: videos,
          updatedAt: new Date().toISOString(),
        };
        savePlaylists(playlists);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(playlists[id]));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "JSON inválido." }));
      }
    });
    return;
  }

  if (urlPath.startsWith("/playlists/") && req.method === "DELETE") {
    const id = urlPath.replace("/playlists/", "");
    const playlists = loadPlaylists();
    delete playlists[id];
    savePlaylists(playlists);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "DELETE" && urlPath.startsWith("/delete-video")) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const rawName = reqUrl.searchParams.get("name") || "";
    const safeName = path.basename(rawName);

    if (!safeName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Nome de arquivo inválido." }));
      return;
    }

    if (R2_ENABLED) {
      deleteFromR2(safeName)
        .then(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch((err) => {
          console.error("Erro ao excluir do R2:", err);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Erro ao excluir do armazenamento (R2)." }));
        });
      return;
    }

    const dir = path.join(__dirname, "videos");
    const targetPath = path.join(dir, safeName);
    const safeRoot = path.resolve(dir) + path.sep;

    if (!path.resolve(targetPath).startsWith(safeRoot)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Nome de arquivo inválido." }));
      return;
    }
    if (!fs.existsSync(targetPath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Arquivo não encontrado." }));
      return;
    }
    fs.unlink(targetPath, (err) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Erro ao excluir o arquivo." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/upload-video")) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const rawName = reqUrl.searchParams.get("name") || "media";
    const safeName = path.basename(rawName).replace(/[\\/:*?"<>|]/g, "_").trim();
    if (!safeName || !MEDIA_EXT_REGEX.test(safeName)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Formato não suportado." }));
      req.destroy();
      return;
    }
    const dir = path.join(__dirname, "videos");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);

    // Trava do teto de armazenamento (R2_MAX_STORAGE_GB), se configurada:
    // recusa ANTES de gravar qualquer coisa em disco ou gastar CPU
    // transcodificando, usando o Content-Length que o navegador manda.
    const incomingBytes = parseInt(req.headers["content-length"], 10) || 0;
    wouldExceedStorageCap(incomingBytes).then((overCap) => {
      if (overCap) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: `Armazenamento no limite configurado (${R2_MAX_STORAGE_GB}GB). Apague vídeos antigos ou aumente o limite (R2_MAX_STORAGE_GB) antes de enviar mais.`,
        }));
        req.destroy();
        return;
      }
      startUploadReceive();
    }).catch((err) => {
      console.error("Erro ao checar teto de armazenamento no R2:", err);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Erro ao checar o armazenamento (R2) antes do upload. Tente de novo." }));
      req.destroy();
    });

    function startUploadReceive() {
    // O nome final depende de checar se já existe (no R2 ou localmente), e
    // isso agora é assíncrono — então só começamos a receber o corpo da
    // requisição (o arquivo) depois de decidir o nome.
    getUniqueFilename(dir, safeName).then((finalName) => {
      const destPath = path.join(dir, finalName);
      const writeStream = fs.createWriteStream(destPath);
      let failed = false;
      req.on("aborted", () => {
        failed = true; writeStream.destroy(); fs.unlink(destPath, () => {});
      });
      writeStream.on("error", () => {
        failed = true;
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Erro ao salvar o arquivo no disco." }));
        }
        fs.unlink(destPath, () => {});
      });
      writeStream.on("finish", () => {
        if (failed) return;

        // Imagens não passam pelo ffmpeg — seguem o fluxo antigo (só muda o
        // destino final: R2 ou disco, dentro de respondUploadSuccess).
        if (!VIDEO_EXT_REGEX.test(finalName)) {
          respondUploadSuccess(res, destPath, finalName);
          return;
        }

        // Vídeos são reconvertidos para HD/H.264/AAC/faststart antes de ficarem
        // disponíveis, garantindo compatibilidade e evitando travamentos na TV.
        const tmpOutputPath = path.join(dir, `.transcoding_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

        transcodeVideoToHD(destPath, tmpOutputPath)
          .then(() => {
            // O arquivo final sempre vira .mp4 (padroniza .mov/.webm também).
            const desiredMp4Name = finalName.replace(
              new RegExp(path.extname(finalName).replace(".", "\\.") + "$", "i"),
              ".mp4"
            );

            // IMPORTANTE: quando o upload já era .mp4, o nome desejado é o mesmo
            // do arquivo original — que ainda está no disco/R2 neste momento.
            // Checar de novo aqui faria o arquivo virar "Nome (1).mp4" em TODO
            // upload .mp4, mesmo sem nenhum conflito real. Nesse caso
            // sobrescrevemos o próprio original (o rename substitui o arquivo).
            // Só procuramos um nome livre quando a extensão mudou (.mov -> .mp4),
            // onde pode haver colisão de verdade com outro arquivo.
            const mp4NamePromise = desiredMp4Name === finalName
              ? Promise.resolve(finalName)
              : getUniqueFilename(dir, desiredMp4Name);

            mp4NamePromise.then((mp4Name) => {
              const mp4Path = path.join(dir, mp4Name);

              fs.rename(tmpOutputPath, mp4Path, (renameErr) => {
                // Remove o upload original caso o nome/extensão tenha mudado (ex: .mov -> .mp4)
                if (path.resolve(mp4Path) !== path.resolve(destPath)) {
                  fs.unlink(destPath, () => {});
                }
                if (renameErr) {
                  console.error("Erro ao finalizar vídeo transcodificado:", renameErr);
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "Falha ao salvar o vídeo processado." }));
                  return;
                }
                respondUploadSuccess(res, mp4Path, mp4Name);
              });
            }).catch((err) => {
              console.error("Erro ao checar nome único no armazenamento:", err);
              fs.unlink(tmpOutputPath, () => {});
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Erro ao verificar o armazenamento (R2). Tente de novo." }));
            });
          })
          .catch((err) => {
            console.error("Falha ao transcodificar vídeo, mantendo o arquivo original:", err);
            fs.unlink(tmpOutputPath, () => {});
            // Não perde o upload: mantém o arquivo original sem otimização caso o ffmpeg falhe.
            respondUploadSuccess(res, destPath, finalName, {
              warning: "Não foi possível otimizar este vídeo para TV. Ele será reproduzido no formato original.",
            });
          });
      });
      req.pipe(writeStream);
    }).catch((err) => {
      console.error("Erro ao checar nome único no armazenamento:", err);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Erro ao verificar o armazenamento (R2) antes do upload. Tente de novo." }));
      req.destroy();
    });
    } // fim de startUploadReceive()

    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
  fs.createReadStream(filePath).pipe(res);
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ server });
const tvs = new Map();
const controllers = new Set();

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Código de pareamento de 5 dígitos, único entre os controladores ativos no momento
function generateRoomCode() {
  const activeCodes = new Set(Array.from(controllers).map((c) => c._roomCode));
  let code;
  do {
    code = String(Math.floor(10000 + Math.random() * 90000));
  } while (activeCodes.has(code));
  return code;
}

function roomHasController(roomCode) {
  if (!roomCode) return false;
  return Array.from(controllers).some((c) => c._roomCode === roomCode && c.readyState === 1);
}

// Avisa as TVs de uma sala que o controlador dela entrou ou saiu do ar. Sem
// isso a TV não tem como distinguir "sem controlador" de "controlador com
// outro código", que era justamente o que deixava o pareamento num beco sem
// saída depois que o controlador era recarregado.
function notifyRoomTvs(roomCode, online) {
  if (!roomCode) return;
  tvs.forEach((tv) => {
    if (tv.roomCode === roomCode && tv.ws.readyState === 1) {
      tv.ws.send(JSON.stringify({ type: "controller_status", online }));
    }
  });
}

function sendTvListToController(ws) {
  if (ws.readyState !== 1) return;
  const list = Array.from(tvs.entries())
    .filter(([, t]) => t.roomCode === ws._roomCode)
    .map(([code, t]) => ({
      code,
      name: t.name,
      video: t.video,
      playlist: t.playlist || null,
      paused: t.paused,
      connected: t.ws.readyState === 1,
    }));
  ws.send(JSON.stringify({ type: "tv_list", tvs: list }));
}

// Reenvia a lista (filtrada por sala) para todos os controladores conectados
function broadcastTvList() {
  controllers.forEach((ws) => sendTvListToController(ws));
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "controller_connect") {
      // O controlador manda o código que já usava antes (guardado no navegador
      // dele). Se ninguém mais estiver com esse código, ele o mantém — assim
      // recarregar a página do controlador NÃO desconecta as TVs já pareadas.
      // Antes um código novo era sorteado a cada conexão, e toda TV pareada
      // ficava órfã sem nenhum aviso.
      const proposto = typeof msg.roomCode === "string" && /^\d{5}$/.test(msg.roomCode)
        ? msg.roomCode
        : null;
      const emUso = new Set(Array.from(controllers).map((c) => c._roomCode));
      const manteve = !!proposto && !emUso.has(proposto);
      ws._roomCode = manteve ? proposto : generateRoomCode();
      controllers.add(ws);
      ws.send(JSON.stringify({
        type: "your_room_code",
        code: ws._roomCode,
        // Avisa o controlador quando o código pedido não pôde ser mantido
        // (outro controlador está com ele), porque nesse caso as TVs
        // realmente precisam ser pareadas de novo.
        reaproveitado: manteve || !proposto ? true : false,
      }));
      sendTvListToController(ws);
      notifyRoomTvs(ws._roomCode, true);
    }

    if (msg.type === "tv_connect") {
      const code = generateCode();
      const roomCode = msg.roomCode || null;
      tvs.set(code, {
        ws,
        name: msg.name || `TV ${tvs.size + 1}`,
        video: null,
        playlist: null,
        paused: false,
        roomCode,
      });
      ws._tvCode = code;
      ws.send(JSON.stringify({ type: "your_code", code }));
      // Diz de cara se existe um controlador com esse código no ar, para a TV
      // poder mostrar "aguardando controlador" em vez de ficar muda.
      ws.send(JSON.stringify({ type: "controller_status", online: roomHasController(roomCode) }));
      broadcastTvList();
    }

    if (msg.type === "tv_set_name") {
      const tv = tvs.get(ws._tvCode);
      if (tv) { tv.name = msg.name; broadcastTvList(); }
    }

    if (msg.type === "play") {
      const tv = tvs.get(msg.code);
      if (tv && tv.roomCode === ws._roomCode && tv.ws.readyState === 1) {
        tv.video = msg.video;
        tv.playlist = null;
        tv.paused = false;
        tv.ws.send(JSON.stringify({ type: "play", video: msg.video }));
        broadcastTvList();
      }
    }

    if (msg.type === "play_playlist") {
      const tv = tvs.get(msg.code);
      if (tv && tv.roomCode === ws._roomCode && tv.ws.readyState === 1) {
        tv.playlist = msg.playlist;
        tv.video = msg.playlist.videos[0] || null;
        tv.paused = false;
        tv.ws.send(JSON.stringify({ type: "play_playlist", playlist: msg.playlist }));
        broadcastTvList();
      }
    }

    if (msg.type === "pause") {
      const tv = tvs.get(msg.code);
      if (tv && tv.roomCode === ws._roomCode && tv.ws.readyState === 1) {
        tv.paused = true;
        tv.ws.send(JSON.stringify({ type: "pause" }));
        broadcastTvList();
      }
    }

    if (msg.type === "resume") {
      const tv = tvs.get(msg.code);
      if (tv && tv.roomCode === ws._roomCode && tv.ws.readyState === 1) {
        tv.paused = false;
        tv.ws.send(JSON.stringify({ type: "resume" }));
        broadcastTvList();
      }
    }

    if (msg.type === "stop") {
      const tv = tvs.get(msg.code);
      if (tv && tv.roomCode === ws._roomCode && tv.ws.readyState === 1) {
        tv.video = null;
        tv.playlist = null;
        tv.paused = false;
        tv.ws.send(JSON.stringify({ type: "stop" }));
        broadcastTvList();
      }
    }

    if (msg.type === "enter_fullscreen") {
      const tv = tvs.get(msg.code);
      if (tv && tv.roomCode === ws._roomCode && tv.ws.readyState === 1) tv.ws.send(JSON.stringify({ type: "enter_fullscreen" }));
    }

    if (msg.type === "exit_fullscreen") {
      const tv = tvs.get(msg.code);
      if (tv && tv.roomCode === ws._roomCode && tv.ws.readyState === 1) tv.ws.send(JSON.stringify({ type: "exit_fullscreen" }));
    }

    if (msg.type === "broadcast") {
      tvs.forEach((tv) => {
        if (tv.roomCode === ws._roomCode && tv.ws.readyState === 1) {
          tv.video = msg.video;
          tv.playlist = null;
          tv.paused = false;
          tv.ws.send(JSON.stringify({ type: "play", video: msg.video }));
        }
      });
      broadcastTvList();
    }
  });

  ws.on("close", () => {
    const eraControlador = controllers.delete(ws);
    if (eraControlador && !roomHasController(ws._roomCode)) {
      // Último controlador daquela sala saiu: as TVs continuam exibindo o
      // conteúdo, mas passam a mostrar que estão sem controlador.
      notifyRoomTvs(ws._roomCode, false);
    }
    if (ws._tvCode) { tvs.delete(ws._tvCode); broadcastTvList(); }
  });
});

const videosDir = path.join(__dirname, "videos");
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

// Limpa sobras de conversões interrompidas (queda/reinício do servidor no meio
// de um upload), que de outra forma ficariam ocupando espaço para sempre.
try {
  fs.readdirSync(videosDir)
    .filter((f) => f.startsWith(".transcoding_"))
    .forEach((f) => fs.unlink(path.join(videosDir, f), () => {}));
} catch {}

server.requestTimeout = 0;

// A porta é sempre definida pelo ambiente de hospedagem (Render define PORT
// automaticamente). O valor fixo abaixo é apenas o padrão quando a variável
// não existe.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`📺 Controlador: /controller.html`);
  console.log(`📺 TV receiver: /tv.html`);
  if (R2_ENABLED) {
    console.log(`☁️  Armazenamento de mídia: Cloudflare R2 (bucket "${R2_BUCKET_NAME}", URL pública ${R2_PUBLIC_BASE_URL})`);
  } else {
    console.log(`💾 Armazenamento de mídia: disco local (${videosDir})`);
    console.log(`   Defina R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME e R2_PUBLIC_BASE_URL para usar o Cloudflare R2.`);
  }
});
