const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PREFERRED_PORT = process.env.PORT || 3000;
// Regex atualizada para incluir imagens
const MEDIA_EXT_REGEX = /\.(mp4|webm|mkv|mov|avi|jpg|jpeg|png|gif|webp)$/i;
const PLAYLISTS_FILE = path.join(__dirname, "playlists.json");

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
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": mime[ext] || (ext.match(/\.(jpg|jpeg|png|gif|webp)$/) ? "image/jpeg" : "video/mp4"),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      });
      fs.createReadStream(mediaPath, { highWaterMark: 64 * 1024 }).pipe(res);
    }
    return;
  }

  if (urlPath === "/get-ip") {
    const os = require("os");
    const interfaces = os.networkInterfaces();
    let localIp = "127.0.0.1";
    let fallbackIp = null;
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family !== "IPv4" || iface.internal) continue;
        const ip = iface.address;
        if (ip.startsWith("192.168.") || ip.startsWith("10.")) {
          localIp = ip; break;
        }
        if (!fallbackIp) fallbackIp = ip;
      }
      if (localIp !== "127.0.0.1") break;
    }
    if (localIp === "127.0.0.1" && fallbackIp) localIp = fallbackIp;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ip: localIp }));
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, filename: finalName }));
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

function isPortInUse(port) {
  return new Promise((resolve) => {
    const net = require("net");
    const tester = net.createServer()
      .once("error", () => resolve(true))
      .once("listening", () => tester.close(() => resolve(false)))
      .listen(port, "0.0.0.0");
  });
}

async function findAvailablePort(startPort) {
  let port = startPort;
  while (await isPortInUse(port)) {
    console.log(`⚠️  Porta ${port} já está em uso, tentando ${port + 1}...`);
    port++;
  }
  return port;
}

server.requestTimeout = 0;

async function start() {
  // Em produção (Render etc.) a porta já vem definida e livre pelo ambiente,
  // então pulamos a varredura de porta e usamos direto.
  const PORT = process.env.PORT ? PREFERRED_PORT : await findAvailablePort(PREFERRED_PORT);

  if (PORT !== PREFERRED_PORT) {
    console.log(`\n⚠️  Porta padrão (${PREFERRED_PORT}) estava ocupada.`);
    console.log(`✅ VisionLoop iniciado na porta alternativa: ${PORT}\n`);
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`📺 Controlador: /controller.html`);
    console.log(`📺 TV receiver: /tv.html`);
    console.log(`\n📁 Pasta de vídeos: ${videosDir}\n`);
  });
}

start();
