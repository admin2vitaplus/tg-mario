import { WebSocketServer } from "ws";
import { randomBytes, randomInt } from "node:crypto";
import { verifyInitData } from "./auth.js";

// Комнаты для сетевой игры «Танкодром» на двоих.
// Сервер только связывает двух игроков: хозяин комнаты считает игру,
// гость присылает нажатия кнопок, а хозяин рассылает картинку мира.
//
// Протокол (JSON-текст):
//   клиент → сервер  { t: "create" }               → { t: "room", code, token }
//   клиент → сервер  { t: "join", code }           → гостю { t: "joined", code, token }, хозяину { t: "peer" }
//   клиент → сервер  { t: "rejoin", code, token }  → { t: "rejoined", code, role, peer }, второму { t: "back" }
//     (peer — есть ли сейчас на связи второй игрок)
//   клиент → сервер  {"t":"ping"}                  — держит соединение, никуда не пересылается
//   остальные сообщения пересылаются второму игроку как есть.
//   Игрок сам закрыл соединение — комната закрывается, второй получает { t: "left" }.
//   Если связь оборвалась, второй получает { t: "wait" }; не вернулся за 20 с — { t: "left" }.
//   Хозяин без гостя может отлучиться (позвать друга) на 2 минуты; гость, вошедший
//   в это время, получает { t: "joined" } и сразу { t: "wait" }.
//   Ошибки — { t: "error", msg }.
//
// Подключение: wss://<сервер>/ws/tanks?auth=<initData> (initData необязателен,
// с ним лимит соединений считается на игрока Telegram, без него — на адрес).

const PATH = "/ws/tanks";
const PING = '{"t":"ping"}';

export const LIMITS = {
  maxMessage: 16 * 1024, // байт в одном сообщении
  perUser: 3, // соединений на одного игрока Telegram
  perIp: 8, // соединений с одного адреса
  idleMs: 90_000, // нет ни одного сообщения — соединение закрывается (клиент шлёт ping раз в 20 с)
  waitMs: 10 * 60_000, // столько комната ждёт второго игрока
  rejoinMs: 20_000, // столько ждём игрока, у которого оборвалась связь
  hostAwayMs: 120_000, // хозяин ушёл звать друга, а гостя ещё нет: столько держим комнату
  roomsPerIp: 3, // открытых комнат с одного адреса
  joinTries: 10, // неудачных попыток войти с одного адреса за минуту
  maxRooms: 500,
  sweepMs: 5_000, // как часто убирать просроченное
  pingMs: 25_000, // как часто проверять, живо ли соединение
};

export function attachTanksRooms(server, { allowedOrigins = ["*"], botToken = "", limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const wss = new WebSocketServer({ noServer: true, maxPayload: L.maxMessage });
  const rooms = new Map(); // code -> { code, seats: [{ ws, token }, { ws, token } | null], created, gone }
  const conns = new Map(); // ключ (игрок или адрес) -> число соединений
  const tries = new Map(); // адрес -> { n, until }

  const clientIp = (req) =>
    String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
      .split(",")[0]
      .trim();

  const reject = (socket, status, text) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.replace(/\/+$/, "") !== PATH) return; // другие пути не наши
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes("*") && !allowedOrigins.includes(origin)) return reject(socket, 403, "Forbidden");
    const ip = clientIp(req);
    const user = botToken ? verifyInitData(url.searchParams.get("auth") || "", botToken) : null;
    const keys = ["ip:" + ip];
    if (user) keys.push("u:" + user.id);
    if ((conns.get(keys[0]) || 0) >= L.perIp || (user && (conns.get(keys[1]) || 0) >= L.perUser)) {
      return reject(socket, 429, "Too Many Requests");
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.keys = keys;
      ws.ip = ip;
      for (const k of keys) conns.set(k, (conns.get(k) || 0) + 1);
      wss.emit("connection", ws, req);
    });
  });

  const send = (ws, msg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  };

  const newCode = () => {
    for (let i = 0; i < 100; i++) {
      const code = String(randomInt(100000, 1000000));
      if (!rooms.has(code)) return code;
    }
    return null;
  };
  const newToken = () => randomBytes(12).toString("hex");

  const closeRoom = (room, notify) => {
    rooms.delete(room.code);
    for (const seat of room.seats) {
      if (!seat || !seat.ws) continue;
      seat.ws.room = null;
      if (notify) send(seat.ws, notify);
    }
  };

  // Игрок пропал: пока идёт игра, место держится rejoinMs, второй видит «ждём».
  // Если же игрок сам закрыл соединение (вышел из комнаты), комната закрывается сразу.
  const drop = (ws, leaving) => {
    const room = ws.room && rooms.get(ws.room);
    ws.room = null;
    if (!room) return;
    const i = room.seats.findIndex((s) => s && s.ws === ws);
    if (i < 0) return;
    if (leaving) return closeRoom(room, { t: "left" });
    room.seats[i].ws = null;
    room.seats[i].gone = Date.now();
    if (room.seats[1 - i]) send(room.seats[1 - i].ws, { t: "wait" });
  };

  const failedTry = (ws) => {
    const now = Date.now();
    const t = tries.get(ws.ip);
    if (!t || t.until < now) tries.set(ws.ip, { n: 1, until: now + 60_000 });
    else t.n++;
  };
  const tooManyTries = (ws) => {
    const t = tries.get(ws.ip);
    return !!t && t.until >= Date.now() && t.n >= L.joinTries;
  };

  wss.on("connection", (ws) => {
    ws.room = null;
    ws.alive = true;
    ws.last = Date.now();
    ws.on("pong", () => { ws.alive = true; });

    ws.on("message", (data, isBinary) => {
      ws.last = Date.now();
      if (isBinary) return;
      const text = data.toString();
      if (text === PING) return;
      const room = ws.room && rooms.get(ws.room);
      if (room) {
        // Пересылка без разбора: так быстрее, и серверу не нужно знать правила игры.
        const other = room.seats[0].ws === ws ? room.seats[1] : room.seats[0];
        if (other) send(other.ws, text);
        return;
      }
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (!msg || typeof msg !== "object") return;

      if (msg.t === "create") {
        if (rooms.size >= L.maxRooms) return send(ws, { t: "error", msg: "Сервер занят, попробуйте позже" });
        let mine = 0;
        for (const room of rooms.values()) if (room.ip === ws.ip) mine++;
        if (mine >= L.roomsPerIp) return send(ws, { t: "error", msg: "Слишком много комнат, подождите пару минут" });
        const code = newCode();
        if (!code) return send(ws, { t: "error", msg: "Не удалось создать комнату" });
        const token = newToken();
        rooms.set(code, { code, ip: ws.ip, seats: [{ ws, token, gone: 0 }, null], created: Date.now() });
        ws.room = code;
        send(ws, { t: "room", code, token });
      } else if (msg.t === "join" || msg.t === "rejoin") {
        if (tooManyTries(ws)) return send(ws, { t: "error", msg: "Слишком много попыток, подождите минуту" });
        const code = String(msg.code || "").trim();
        const room = rooms.get(code);
        if (!room) {
          failedTry(ws);
          return send(ws, { t: "error", msg: "Комната не найдена" });
        }
        if (msg.t === "rejoin") {
          const i = room.seats.findIndex((s) => s && s.token === String(msg.token || ""));
          if (i < 0) {
            failedTry(ws);
            return send(ws, { t: "error", msg: "Комната не найдена" });
          }
          const seat = room.seats[i];
          if (seat.ws && seat.ws !== ws) { seat.ws.room = null; seat.ws.terminate(); }
          seat.ws = ws;
          seat.gone = 0;
          ws.room = code;
          const other = room.seats[1 - i];
          send(ws, { t: "rejoined", code, role: i === 0 ? "host" : "guest", peer: !!(other && other.ws) });
          if (other && other.ws) { room.met = true; send(other.ws, { t: "back" }); }
          return;
        }
        if (room.seats[1]) return send(ws, { t: "error", msg: "В комнате уже двое" });
        const token = newToken();
        room.seats[1] = { ws, token, gone: 0 };
        ws.room = code;
        send(ws, { t: "joined", code, token });
        if (room.seats[0].ws) { room.met = true; send(room.seats[0].ws, { t: "peer" }); }
        else send(ws, { t: "wait" });
      }
    });

    let counted = true;
    const gone = (code) => {
      if (counted) {
        counted = false;
        for (const k of ws.keys || []) {
          const n = (conns.get(k) || 1) - 1;
          if (n > 0) conns.set(k, n); else conns.delete(k);
        }
      }
      // 1000 и 1005 — клиент закрыл сам; обрыв связи даёт 1006, уход со страницы 1001.
      drop(ws, code === 1000 || code === 1005);
    };
    ws.on("close", gone);
    ws.on("error", () => gone(1006));
  });

  // Уборка: молчащие соединения, комнаты без второго игрока, не вернувшиеся игроки, счётчики попыток.
  const sweep = () => {
    const now = Date.now();
    for (const ws of wss.clients) if (now - ws.last > L.idleMs) ws.terminate();
    for (const room of [...rooms.values()]) {
      const host = room.seats[0];
      if (!room.seats[1]) {
        if (now - room.created > L.waitMs || (!host.ws && now - host.gone > L.hostAwayMs)) {
          closeRoom(room, { t: "error", msg: "Никто не пришёл, комната закрыта" });
        }
        continue;
      }
      // Ждём гостя, пока хозяин отлучился, дольше обычного: он мог уйти звать друга.
      const away = (s, i) => !s.ws && now - s.gone > (i === 0 && !room.met ? L.hostAwayMs : L.rejoinMs);
      if (room.seats.some(away) || room.seats.every((s) => !s.ws)) closeRoom(room, { t: "left" });
    }
    for (const [ip, t] of tries) if (t.until < now) tries.delete(ip);
  };
  const sweepTimer = setInterval(sweep, L.sweepMs);
  sweepTimer.unref();

  // Пинг держит соединение через туннель и убирает отвалившихся игроков.
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, L.pingMs);
  pingTimer.unref();

  const close = () => {
    clearInterval(sweepTimer);
    clearInterval(pingTimer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
  server.on("close", close);

  return { wss, rooms, conns, tries, close, sweep };
}
