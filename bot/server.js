import { createServer } from "node:http";
import { verifyInitData } from "./auth.js";
import { ACHIEVEMENTS, publicList } from "./achievements.js";

// Один HTTP-сервер на все игры. Маршруты игры «Прыг-Скок» живут под /api/mario/.
// Сетевые игры (например, танки) подключаются к этому же серверу через событие
// "upgrade" (WebSocket), см. README, раздел «Сервер для других игр».

const LIMITS = { score: 500000, coins: 2000, level: 3, timeLeft: 400, deaths: 99, levels: 4 };

const int = (v, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 10_000) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createApiServer({ store, botToken, allowedOrigins, onAchievements, commit = "unknown", startedAt = Date.now() }) {
  const userFrom = (req) => {
    const h = req.headers.authorization || "";
    return h.startsWith("tma ") ? verifyInitData(h.slice(4), botToken) : null;
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
      store.addLevel(user.id, e);
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
      const before = store.getPlayer(user.id).best_score;
      store.addRun(user.id, e);
      const won = newAchievements(user.id, e);
      return [200, { ...meBody(user.id), newRecord: e.score > before, newAchievements: won }];
    },
  };

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
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
    try {
      const body = req.method === "POST" ? await readJson(req) : null;
      const [status, out] = handler(body, userFrom(req));
      send(res, status, out);
    } catch (err) {
      if (err instanceof SyntaxError || err.message === "too large") return send(res, 400, { error: "bad request" });
      console.error("Ошибка API:", err);
      send(res, 500, { error: "server error" });
    }
  });

  return server;
}
