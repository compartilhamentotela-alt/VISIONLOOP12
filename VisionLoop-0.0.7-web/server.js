const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

const PORT = process.env.PORT || 3000;
// Regex atualizada para incluir imagens
const MEDIA_EXT_REGEX = /\.(mp4|webm|mkv|mov|avi|jpg|jpeg|png|gif|webp)$/i;
const VIDEO_EXT_REGEX = /\.(mp4|webm|mkv|mov|avi)$/i;
const PLAYLISTS_FILE = path.join(__dirname, "playlists.json");

// ---------- Transcodificação de vídeo para HD ----------
// Muitas Smart TVs travam ao reproduzir vídeo por causa de:
//  1) Resolução/bitrate maiores do que o decodificador de hardware aguenta
//     (1080p/4K com bitrate alto sobrecarrega TVs de entrada);
//  2) Perfis/containers que o navegador embarcado da TV não decodifica bem
//     (High Profile, .mkv/.avi/.mov, HEVC, 10-bit, etc.) — muitas TVs só
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
        "-level 4.0",
        "-preset veryfast",
        "-crf 23", // qualidade nítida com arquivo bem menor que o original
        "-pix_fmt yuv420p", // formato de cor universal (evita 10-bit/4:2:2 incompatível)
        "-r 30", // normaliza a taxa de quadros, evita VFR problemático em algumas TVs
        "-movflags +faststart", // move o índice pro início: permite iniciar/pré-carregar sem baixar tudo
        "-max_muxing_queue_size 1024",
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

function getUniqueFilename(dir, filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = filename;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
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
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };

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

    // Se for imagem, não precisa de streaming de range complexo na maioria dos casos, mas mantemos por compatibilidade
    if (range && !mime[ext].startsWith("image/")) {
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
        "Content-Type": mime[ext] || (ext.match(/\.(jpg|jpeg|png|gif|webp)$/) ? "image/jpeg" : "video/mp4"),
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

  if (urlPath === "/videos-list") {
    const dir = path.join(__dirname, "videos");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    const allFiles = fs.readdirSync(dir);
    // Filtra tanto vídeos quanto imagens
    const files = allFiles.filter((f) => MEDIA_EXT_REGEX.test(f));
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
        // Suportar ambos os formatos: array de strings (antigo) e array de objetos (novo)
        const videos = playlist.videos.map(item => {
          if (typeof item === 'string') {
            return { name: item, duration: 0, isImage: /\.(jpg|jpeg|png|gif|webp)$/i.test(item) };
          }
          return item;
        });
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
    const dir = path.join(__dirname, "videos");
    const targetPath = path.join(dir, safeName);
    const safeRoot = path.resolve(dir) + path.sep;

    if (!safeName || !path.resolve(targetPath).startsWith(safeRoot)) {
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
    const finalName = getUniqueFilename(dir, safeName);
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

      // Imagens não passam pelo ffmpeg — seguem o fluxo antigo.
      if (!VIDEO_EXT_REGEX.test(finalName)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, filename: finalName }));
        return;
      }

      // Vídeos são reconvertidos para HD/H.264/AAC/faststart antes de ficarem
      // disponíveis, garantindo compatibilidade e evitando travamentos na TV.
      const tmpOutputPath = path.join(dir, `.transcoding_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

      transcodeVideoToHD(destPath, tmpOutputPath)
        .then(() => {
          // O arquivo final sempre vira .mp4 (padroniza .mkv/.avi/.mov/.webm também).
          const mp4Name = getUniqueFilename(
            dir,
            finalName.replace(new RegExp(path.extname(finalName).replace(".", "\\.") + "$", "i"), ".mp4")
          );
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
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, filename: mp4Name }));
          });
        })
        .catch((err) => {
          console.error("Falha ao transcodificar vídeo, mantendo o arquivo original:", err);
          fs.unlink(tmpOutputPath, () => {});
          // Não perde o upload: mantém o arquivo original sem otimização caso o ffmpeg falhe.
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            filename: finalName,
            warning: "Não foi possível otimizar este vídeo para TV. Ele será reproduzido no formato original.",
          }));
        });
    });
    req.pipe(writeStream);
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
      ws._roomCode = generateRoomCode();
      controllers.add(ws);
      ws.send(JSON.stringify({ type: "your_room_code", code: ws._roomCode }));
      sendTvListToController(ws);
    }

    if (msg.type === "tv_connect") {
      const code = generateCode();
      tvs.set(code, {
        ws,
        name: msg.name || `TV ${tvs.size + 1}`,
        video: null,
        playlist: null,
        paused: false,
        roomCode: msg.roomCode || null,
      });
      ws._tvCode = code;
      ws.send(JSON.stringify({ type: "your_code", code }));
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
    controllers.delete(ws);
    if (ws._tvCode) { tvs.delete(ws._tvCode); broadcastTvList(); }
  });
});

const videosDir = path.join(__dirname, "videos");
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

server.requestTimeout = 0;

// A porta é sempre definida pelo ambiente de hospedagem (Render define PORT
// automaticamente). O valor fixo abaixo é apenas o padrão quando a variável
// não existe.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`📺 Controlador: /controller.html`);
  console.log(`📺 TV receiver: /tv.html`);
  console.log(`\n📁 Pasta de vídeos: ${videosDir}\n`);
});
