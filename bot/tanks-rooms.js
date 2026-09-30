import { WebSocketServer } from "ws";

// Комнаты для сетевой игры «Танкодром» на двоих.
// Сервер только связывает двух игроков: хозяин комнаты считает игру,
// гость присылает нажатия кнопок, а хозяин рассылает картинку мира.
//
// Протокол (JSON-текст):
//   клиент → сервер  { t: "create" }            → { t: "room", code }
//   клиент → сервер  { t: "join", code }        → гостю { t: "joined" }, хозяину { t: "peer" }
//   остальные сообщения пересылаются второму игроку как есть;
//   если один ушёл, второй получает { t: "left" }; ошибки — { t: "error", msg }.

const PATH = "/ws/tanks";
const MAX_MESSAGE = 64 * 1024;

export function attachTanksRooms(server, { allowedOrigins = ["*"], maxRooms = 500 } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const rooms = new Map(); // code -> { host, guest }

  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "");
    if (path !== PATH) return; // другие пути не наши
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes("*") && !allowedOrigins.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const send = (ws, msg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  };

  const newCode = () => {
    for (let i = 0; i < 100; i++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (!rooms.has(code)) return code;
    }
    return null;
  };

  const leave = (ws) => {
    const code = ws.room;
    if (!code) return;
    ws.room = null;
    const room = rooms.get(code);
    if (!room) return;
    const other = room.host === ws ? room.guest : room.host;
    rooms.delete(code);
    if (other) {
      other.room = null;
      send(other, { t: "left" });
    }
  };

  wss.on("connection", (ws) => {
    ws.room = null;
    ws.alive = true;
    ws.on("pong", () => { ws.alive = true; });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      const room = ws.room && rooms.get(ws.room);
      if (room) {
        // Пересылка без разбора: так быстрее, и серверу не нужно знать правила игры.
        send(room.host === ws ? room.guest : room.host, text);
        return;
      }
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.t === "create") {
        if (rooms.size >= maxRooms) return send(ws, { t: "error", msg: "Сервер занят, попробуйте позже" });
        const code = newCode();
        if (!code) return send(ws, { t: "error", msg: "Не удалось создать комнату" });
        rooms.set(code, { host: ws, guest: null });
        ws.room = code;
        send(ws, { t: "room", code });
      } else if (msg.t === "join") {
        const code = String(msg.code || "").trim();
        const target = rooms.get(code);
        if (!target) return send(ws, { t: "error", msg: "Комната не найдена" });
        if (target.guest) return send(ws, { t: "error", msg: "В комнате уже двое" });
        target.guest = ws;
        ws.room = code;
        send(ws, { t: "joined", code });
        send(target.host, { t: "peer" });
      }
    });

    ws.on("close", () => leave(ws));
    ws.on("error", () => leave(ws));
  });

  // Пинг держит соединение через туннель и убирает отвалившихся игроков.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 25_000);
  timer.unref();
  server.on("close", () => clearInterval(timer));

  return { wss, rooms };
}
