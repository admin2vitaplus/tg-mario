import { createServer } from "node:http";
import { verifyInitData } from "./auth.js";
import { ACHIEVEMENTS, publicList } from "./achievements.js";
import { createRateLimiter } from "./ratelimit.js";
import { checkLevel, checkRun, currentGame, LAST_LEVEL, PER_WORLD, SEQUENCE_TTL_MS, WORLD_TIMES } from "./plausibility.js";
import { CLIENT_EVENTS, GAMES } from "./stats.js";
import { publicRules } from "./economy.js";

// Один HTTP-сервер на все игры. Маршруты игры «Прыг-Скок» живут под /api/mario/.
// Сетевые игры (например, танки) подключаются к этому же серверу через событие
// "upgrade" (WebSocket), см. README, раздел «Сервер для других игр».

const LIMITS = { score: 500000, coins: 2000, level: PER_WORLD - 1, world: WORLD_TIMES.length, timeLeft: 400, deaths: 99, levels: LAST_LEVEL + 1 };

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

// Запись игры «Танкодрома» (tanks-replay.js) длиннее обычного запроса.
export const MAX_REPLAY_BODY = 512 * 1024;

async function readJson(req, limit = MAX_BODY) {
  if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, "too large");
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, "too large");
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
  store, botToken, allowedOrigins, onAchievements, tracker = null, economy = null,
  tanks = null, createInvoice = null,
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

  // Отчёты об уровнях текущей игры: после последнего итога игры (plausibility.js, currentGame).
  const sequence = (id) => currentGame(store.levelsSince(id, Math.max(store.lastRunAt(id), now() - SEQUENCE_TTL_MS)));

  const newAchievements = (playerId, event, grants = []) => {
    const player = store.getPlayer(playerId);
    const won = [];
    for (const a of ACHIEVEMENTS) {
      if (a.check(event, player) && store.earn(playerId, a.code)) won.push(a);
    }
    const out = won.map(({ code, icon, title, text }) => ({ code, icon, title, text }));
    if (out.length && onAchievements) onAchievements(playerId, out);
    if (out.length && economy) economy.achievements(playerId, out, grants);
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

  // Жетоны, начисленные за этот запрос, и баланс после них (без economy — ничего).
  const walletBody = (id, grants) => (economy ? { wallet: { grants, balance: economy.me(id).balance } } : {});

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

    // Итог пройденного уровня: { world, level, score, timeLeft, deaths }; world 1…4 (старая игра — без него),
    // level — уровень в мире 0…3. Дальше level — сквозной номер (plausibility.js).
    "POST /api/mario/level": (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const world = body.world === undefined ? 1 : int(body.world, LIMITS.world);
      const inWorld = int(body.level, LIMITS.level);
      const e = {
        type: "level",
        level: world && inWorld !== null ? (world - 1) * PER_WORLD + inWorld : null,
        score: int(body.score, LIMITS.score),
        timeLeft: int(body.timeLeft, LIMITS.timeLeft),
        deaths: int(body.deaths, LIMITS.deaths),
      };
      if (Object.values(e).includes(null)) return [400, { error: "bad data" }];
      store.touchPlayer(user);
      const verdict = checkLevel(e, sequence(user.id), now());
      if (!verdict.ok) {
        console.warn(`Отклонён отчёт об уровне: ${verdict.why}`);
        economy?.rejected(user.id);
        return [422, { error: "implausible" }];
      }
      store.addLevel(user.id, e, now());
      const grants = [];
      return [200, { newAchievements: newAchievements(user.id, e, grants), ...walletBody(user.id, grants) }];
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
      store.touchPlayer(user);
      const verdict = checkRun(e, sequence(user.id));
      if (!verdict.ok) {
        console.warn(`Отклонён итог игры: ${verdict.why}`);
        economy?.rejected(user.id);
        return [422, { error: "implausible" }];
      }
      const before = store.getPlayer(user.id).best_score;
      store.addRun(user.id, e, now());
      const grants = [];
      const won = newAchievements(user.id, e, grants);
      const newRecord = e.score > before;
      economy?.setLang(user.id, user.language_code);
      economy?.run(user.id, { newRecord }, grants);
      tracker?.event(user.id, "game_finish", "mario");
      return [200, { ...meBody(user.id), newRecord, newAchievements: won, ...walletBody(user.id, grants) }];
    },
  };

  // Жетоны (ТЗ P1-7). Начисления идут только сервером внутри маршрутов выше; клиент может
  // лишь посмотреть баланс и потратить жетоны в магазине.
  if (economy) {
    routes["GET /api/wallet/info"] = () => [200, publicRules(economy.cfg)];
    routes["GET /api/wallet/me"] = (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      economy.setLang(user.id, user.language_code);
      return [200, economy.me(user.id)];
    };
    // { item } → { ok, balance }; повторная покупка того же товара ничего не списывает.
    routes["POST /api/wallet/buy"] = (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      if (typeof body.item !== "string") return [400, { error: "bad data" }];
      store.touchPlayer(user);
      const r = economy.buy(user.id, body.item);
      if (!r.ok) return [r.error === "unknown item" ? 404 : 409, r];
      return [200, { ...r, owned: economy.me(user.id).owned }];
    };
  }

  // Покупка за Telegram Stars: сервер создаёт счёт, игра открывает его (Telegram.WebApp.openInvoice),
  // а товар выдаёт бот, когда Telegram сообщит об оплате (successful_payment, wallet-bot.js).
  if (economy && createInvoice) {
    routes["POST /api/wallet/invoice"] = async (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      if (typeof body.item !== "string") return [400, { error: "bad data" }];
      const check = economy.starsCheck(user.id, body.item);
      if (!check.ok) return [check.error === "unknown item" ? 404 : 409, { error: check.error }];
      store.touchPlayer(user);
      economy.setLang(user.id, user.language_code);
      const link = await createInvoice(check.item, user);
      return [200, { link }];
    };
  }

  // «Танкодром»: билет (зерно игры от сервера) и итог игры с записью нажатий (tanks-results.js).
  if (tanks) {
    routes["POST /api/tanks/ticket"] = (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      const t = tanks.ticket(user.id);
      return t.error ? [429, t] : [200, t];
    };
    routes["POST /api/tanks/run"] = (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const seed = Number(body.seed);
      const players = Number(body.players);
      const room = body.room == null ? null : String(body.room);
      if (typeof body.log !== "string" || (room && !/^\d{4,8}$/.test(room))) return [400, { error: "bad data" }];
      store.touchPlayer(user);
      const r = tanks.submit(user.id, { seed, players, log: body.log, room });
      if (r.status !== 200) {
        if (r.status === 422) {
          console.warn(`Отклонена игра «Танкодрома»: ${r.why}`);
          economy?.rejected(user.id);
        }
        return [r.status, { error: r.error }];
      }
      const grants = [];
      let mine = null;
      for (const res of r.results) {
        const out = res.playerId === user.id ? grants : [];
        economy?.run(res.playerId, { newRecord: res.newRecord, game: "tanks" }, out);
        tracker?.event(res.playerId, "game_finish", "tanks");
        if (res.playerId === user.id) mine = res;
      }
      economy?.setLang(user.id, user.language_code);
      return [200, { score: mine?.score ?? 0, best: mine?.best ?? tanks.best(user.id), newRecord: !!mine?.newRecord,
        ...walletBody(user.id, grants) }];
    };
  }

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
      const body = req.method === "POST" ? await readJson(req, path === "/api/tanks/run" ? MAX_REPLAY_BODY : MAX_BODY) : null;
      const user = userFrom(req);
      if (req.method === "POST" && user && !byUser.take(user.id)) {
        res.setHeader("Retry-After", String(byUser.retryAfter(user.id)));
        return send(res, 429, { error: "too many requests" });
      }
      const [status, out] = await handler(body, user);
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
