import { createServer } from "node:http";
import { verifyInitData } from "./auth.js";
import { ACHIEVEMENTS, publicList } from "./achievements.js";
import { createRateLimiter } from "./ratelimit.js";
import { checkLevel, checkRun, SEQUENCE_TTL_MS } from "./plausibility.js";
import { CLIENT_EVENTS, GAMES } from "./stats.js";

// Один HTTP-сервер на все игры. Маршруты игры «Прыг-Скок» живут под /api/mario/.
// Сетевые игры (например, танки) подключаются к этому же серверу через событие
// "upgrade" (WebSocket), см. README, раздел «Сервер для других игр».

const LIMITS = { score: 500000, coins: 2000, level: 3, timeLeft: 400, deaths: 99, levels: 4 };

const int = (v, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

function send(res, status, body) {
  if (body == null) return res.writeHead(status).end();
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export const MAX_BODY = 4096;

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function readJson(req) {
  if (Number(req.headers["content-length"]) > MAX_BODY) throw new HttpError(413, "too large");
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "too large");
    chunks.push(c);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body;
  } catch {
    throw new HttpError(400, "bad request");
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Настоящий IP игрока. Через туннель Cloudflare все запросы приходят с этого же компьютера,
// а адрес игрока лежит в CF-Connecting-IP; верим заголовку только для локальных соединений.
function clientIp(req) {
  const remote = req.socket.remoteAddress || "";
  const cf = req.headers["cf-connecting-ip"];
  if (LOOPBACK.has(remote) && typeof cf === "string" && cf.length < 64) return cf;
  return remote;
}

export const DEFAULT_LIMITS = { ipPerMinute: 120, userWritesPerMinute: 30 };

export function createApiServer({
  store, botToken, allowedOrigins, onAchievements, tracker = null,
  commit = "unknown", startedAt = Date.now(), now = Date.now, limits = DEFAULT_LIMITS,
}) {
  const userFrom = (req) => {
    const h = req.headers.authorization || "";
    if (!h.startsWith("tma ")) return null;
    const user = verifyInitData(h.slice(4), botToken, now());
    // start_param — метка из ссылки t.me/<бот>/<app>?startapp=..., подписана вместе с initData.
    if (user) user.startParam = new URLSearchParams(h.slice(4)).get("start_param") || "";
    return user;
  };
  const byIp = createRateLimiter({ limit: limits.ipPerMinute, now });
  const byUser = createRateLimiter({ limit: limits.userWritesPerMinute, now });
  const originAllowed = (o) => allowedOrigins.includes("*") || allowedOrigins.includes(o);

  // Отчёты об уровнях текущей игры: после последнего итога игры, начиная с последнего уровня 0.
  const sequence = (id) => {
    const rows = store.levelsSince(id, Math.max(store.lastRunAt(id), now() - SEQUENCE_TTL_MS));
    let start = -1;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].level === 0) { start = i; break; }
    return start < 0 ? [] : rows.slice(start);
  };

  const newAchievements = (playerId, event) => {
    const player = store.getPlayer(playerId);
    const won = [];
    for (const a of ACHIEVEMENTS) {
      if (a.check(event, player) && store.earn(playerId, a.code)) won.push(a);
    }
    const out = won.map(({ code, icon, title, text }) => ({ code, icon, title, text }));
    if (out.length && onAchievements) onAchievements(playerId, out);
    return out;
  };

  const meBody = (id) => {
    const player = store.getPlayer(id);
    return {
      best: player?.best_score ?? 0,
      games: player?.games ?? 0,
      rank: store.rank(player),
      achievements: store.earned(id),
    };
  };

  const routes = {
    // Для мониторинга с сервера: какой коммит запущен и сколько секунд работает.
    "GET /api/health": () => [200, { ok: true, commit, uptime: Math.floor((Date.now() - startedAt) / 1000) }],

    "GET /api/mario/achievements": () => [200, publicList()],

    "GET /api/mario/top": () => [200, store.top(20).map((p, i) => ({
      place: i + 1, name: p.name, username: p.username, score: p.best_score, id: p.id,
    }))],

    "GET /api/mario/me": (_body, user) => {
      if (!user) return [401, { error: "Откройте игру через бота в Telegram" }];
      store.touchPlayer(user);
      return [200, meBody(user.id)];
    },

    // Итог пройденного уровня: { level, score, timeLeft, deaths }
    "POST /api/mario/level": (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const e = {
        type: "level",
        level: int(body.level, LIMITS.level),
        score: int(body.score, LIMITS.score),
        timeLeft: int(body.timeLeft, LIMITS.timeLeft),
        deaths: int(body.deaths, LIMITS.deaths),
      };
      if (Object.values(e).includes(null)) return [400, { error: "bad data" }];
      store.touchPlayer(user);
      const verdict = checkLevel(e, e.level === 0 ? [] : sequence(user.id), now());
      if (!verdict.ok) {
        console.warn(`Отклонён отчёт об уровне: ${verdict.why}`);
        return [422, { error: "implausible" }];
      }
      store.addLevel(user.id, e, now());
      return [200, { newAchievements: newAchievements(user.id, e) }];
    },

    // Итог всей игры: { score, coins, levels, deaths, completed, bossFire }
    "POST /api/mario/run": (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const e = {
        type: "run",
        score: int(body.score, LIMITS.score),
        coins: int(body.coins, LIMITS.coins),
        levels: int(body.levels, LIMITS.levels),
        deaths: int(body.deaths, LIMITS.deaths),
        completed: body.completed === true,
        bossFire: body.bossFire === true,
      };
      if ([e.score, e.coins, e.levels, e.deaths].includes(null)) return [400, { error: "bad data" }];
      if (e.completed && e.levels < LIMITS.levels) return [400, { error: "bad data" }];
      store.touchPlayer(user);
      const verdict = checkRun(e, sequence(user.id));
      if (!verdict.ok) {
        console.warn(`Отклонён итог игры: ${verdict.why}`);
        return [422, { error: "implausible" }];
      }
      const before = store.getPlayer(user.id).best_score;
      store.addRun(user.id, e, now());
      const won = newAchievements(user.id, e);
      tracker?.event(user.id, "game_finish", "mario");
      return [200, { ...meBody(user.id), newRecord: e.score > before, newAchievements: won }];
    },
  };

  // Статистика (ТЗ P0-5): { type, game, ref? }. Ответ всегда 204 — игре не нужно ничего с ним делать.
  routes["POST /api/events"] = (body, user) => {
    if (!user) return [401, { error: "unauthorized" }];
    if (!tracker) return [204, null];
    const ref = typeof body.ref === "string" || typeof body.ref === "number" ? String(body.ref) : null;
    if (!CLIENT_EVENTS.has(body.type) || !GAMES.includes(body.game) || (ref && !/^\w{1,16}$/.test(ref))) {
      return [400, { error: "bad data" }];
    }
    tracker.arrive(user.id, user.startParam);
    tracker.event(user.id, body.type, body.game, ref);
    return [204, null];
  };

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    // CORS только для сайта игры; запросы со страниц чужих сайтов отклоняются целиком.
    if (origin && !originAllowed(origin)) return send(res, 403, { error: "forbidden origin" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "");
    const handler = routes[`${req.method} ${path}`];
    if (!handler) return send(res, 404, { error: "not found" });

    const ip = clientIp(req);
    if (path !== "/api/health" && !byIp.take(ip)) {
      res.setHeader("Retry-After", String(byIp.retryAfter(ip)));
      return send(res, 429, { error: "too many requests" });
    }
    try {
      const body = req.method === "POST" ? await readJson(req) : null;
      const user = userFrom(req);
      if (req.method === "POST" && user && !byUser.take(user.id)) {
        res.setHeader("Retry-After", String(byUser.retryAfter(user.id)));
        return send(res, 429, { error: "too many requests" });
      }
      const [status, out] = handler(body, user);
      send(res, status, out);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status === 413) res.setHeader("Connection", "close");
        return send(res, err.status, { error: err.message });
      }
      console.error("Ошибка API:", err);
      send(res, 500, { error: "server error" });
    }
  });

  return server;
}
