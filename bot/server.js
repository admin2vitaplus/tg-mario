import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { verifyInitData } from "./auth.js";
import { BY_GAME, GAME_OF, byCode, publicList, publicOf } from "./achievements.js";
import { createRateLimiter } from "./ratelimit.js";
import { checkLevel, checkRun, currentGame, fromFirstLevel, LAST_LEVEL, openLevels, PER_WORLD, SEQUENCE_TTL_MS, WORLD_TIMES } from "./plausibility.js";
import { CLIENT_EVENTS, GAMES } from "./stats.js";
import { publicRules, seasonOf, seasonStart } from "./economy.js";
import { adminPage, isAdminPath } from "./admin.js";

// Один HTTP-сервер на все игры. Маршруты игры «Прыг-Скок» живут под /api/mario/.
// Сетевые игры (например, танки) подключаются к этому же серверу через событие
// "upgrade" (WebSocket), см. README, раздел «Сервер для других игр».

const LIMITS = { score: 500000, coins: 2000, level: PER_WORLD - 1, world: WORLD_TIMES.length, timeLeft: 400, deaths: 99, levels: LAST_LEVEL + 1 };

const int = (v, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

function send(res, status, body, gzip = false) {
  if (body == null) return res.writeHead(status).end();
  const json = JSON.stringify(body);
  // Ответы больше 1 КБ через туннель уходят сжатыми: панель (сводка, списки) и игры — панель жетонов
  // с заданиями (~15 КБ) и топ-100 (~7 КБ) сжимаются в 5–7 раз.
  if (gzip && json.length > 1024) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    return res.end(gzipSync(json));
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

export const MAX_BODY = 4096;
// Уведомление из панели: заголовок и текст на двух языках (кириллица — 2 байта на букву).
export const MAX_NOTICE_BODY = 24 * 1024;

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

// Запись игры «Танкодрома», «Бомбодрома» и «Тира» (tanks-replay.js, bombs-replay.js, range-replay.js) длиннее обычного запроса.
export const MAX_REPLAY_BODY = 1536 * 1024; // запись до трёх часов «Танкодрома»

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
  tanks = null, bombs = null, range = null, createInvoice = null, word = null, admin = null, notices = null, challenge = null,
  commit = "unknown", startedAt = Date.now(), now = Date.now, limits = DEFAULT_LIMITS,
}) {
  const userFrom = (req) => {
    const h = req.headers.authorization || "";
    if (!h.startsWith("tma ")) return null;
    const user = verifyInitData(h.slice(4), botToken, now());
    // start_param — метка из ссылки t.me/<бот>/<app>?startapp=..., подписана вместе с initData.
    if (user) {
      const params = new URLSearchParams(h.slice(4));
      user.startParam = params.get("start_param") || "";
      // chat_instance — чат, из которого открыта игра (для таблиц чата); тоже подписан.
      const chat = params.get("chat_instance") || "";
      user.chat = /^-?\d{1,25}$/.test(chat) ? chat : null;
    }
    return user;
  };
  const byIp = createRateLimiter({ limit: limits.ipPerMinute, now });
  const byUser = createRateLimiter({ limit: limits.userWritesPerMinute, now });
  const originAllowed = (o) => allowedOrigins.includes("*") || allowedOrigins.includes(o);

  // Отчёты об уровнях текущей игры: после последнего итога игры (plausibility.js, currentGame).
  const sequence = (id) => currentGame(store.levelsSince(id, Math.max(store.lastRunAt(id), now() - SEQUENCE_TTL_MS)));

  // Новые достижения игры (game — mario, tanks, bombs, range) по проверенному итогу event; totals —
  // статистика игрока за все игры (у «Прыг-Скока» — его строка players).
  const newAchievements = (playerId, event, grants = [], game = "mario", totals = null) => {
    const stats = totals ?? store.getPlayer(playerId);
    const won = [];
    if (!store.getPlayer(playerId)) return won; // достижения хранятся у известных игроков (players)
    for (const a of BY_GAME[game] || []) {
      if (a.check(event, stats) && store.earn(playerId, a.code)) won.push(a);
    }
    const out = won.map(publicOf);
    if (out.length && onAchievements) onAchievements(playerId, out);
    if (out.length && economy) economy.achievements(playerId, out, grants, game);
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

    // Пройденные уровни игрока во всех играх (выбор уровня, web/lib/progress.js): номера с 0.
    // «Прыг-Скок» — сквозные номера уровней (plausibility.js), остальные — этапы по порядку.
    "GET /api/progress": (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const upTo = (n) => Array.from({ length: n }, (_, i) => i);
      return [200, {
        mario: store.passedLevels(user.id),
        tanks: upTo(tanks ? tanks.passed(user.id) : 0),
        bombs: upTo(bombs ? bombs.passed(user.id) : 0),
        range: upTo(range ? range.passed(user.id) : 0),
      }];
    },

    // Итог пройденного уровня: { world, level, score, timeLeft, deaths, start }; world 1…4 (старая игра — без него),
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
      // Первый уровень игры, начатой с выбранного уровня (или с 1-1): с него начинается новая игра.
      e.start = body.start === true;
      store.touchPlayer(user);
      const verdict = checkLevel(e, sequence(user.id), now(), openLevels(store.passedLevels(user.id)));
      // Уровень ещё не открыт на сервере (телефон отметил его, а отчёт не дошёл): игра не
      // засчитывается, но это не обман — без пометки игрока.
      if (verdict.why === "level not open") return [409, { error: "level not open" }];
      if (!verdict.ok) {
        console.warn(`Отклонён отчёт об уровне: ${verdict.why}`);
        economy?.rejected(user.id);
        return [422, { error: "implausible" }];
      }
      store.addLevel(user.id, e, now());
      const grants = [];
      economy?.task(user.id, "mario", "level", grants);
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
      const seq = sequence(user.id);
      const verdict = checkRun(e, seq);
      if (!verdict.ok) {
        console.warn(`Отклонён итог игры: ${verdict.why}`);
        economy?.rejected(user.id);
        return [422, { error: "implausible" }];
      }
      // Все миры пройдены засчитывается только игре, начатой с 1-1 (не с выбранного уровня).
      e.completed = e.completed && fromFirstLevel(seq);
      const before = store.getPlayer(user.id).best_score;
      store.addRun(user.id, e, now());
      const grants = [];
      const won = newAchievements(user.id, e, grants);
      const newRecord = e.score > before;
      economy?.setLang(user.id, user.language_code);
      economy?.run(user.id, { newRecord, game: "mario", levels: e.levels }, grants);
      // Испытание дня (challenge.js): засчитывается игра, начатая с 1-1.
      const day = challenge?.record(user.id, "mario", e.score, { fromStart: fromFirstLevel(seq) }, grants);
      tracker?.event(user.id, "game_finish", "mario");
      return [200, { ...meBody(user.id), newRecord, newAchievements: won, ...walletBody(user.id, grants), ...(day ? { challenge: day } : {}) }];
    },
  };

  // Жетоны (ТЗ P1-7). Начисления идут только сервером внутри маршрутов выше; клиент может
  // лишь посмотреть баланс и потратить жетоны в магазине.
  if (economy) {
    routes["GET /api/wallet/info"] = () => [200, publicRules(economy.cfg)];
    const walletMe = (id) => {
      const me = economy.me(id);
      // Достижения каждой игры — её разовые задания. Выполнено — то, что игрок получил
      // (таблица achievements), даже если жетоны за него ещё не начислены.
      const got = new Set(store.earned(id).map((a) => a.code));
      for (const game of Object.keys(BY_GAME)) {
        me.tasks[game]?.push(...publicList(game).map((a) => ({
          id: `ach:${a.code}`, period: "once", amount: economy.cfg.achievement, done: got.has(a.code), ...a,
        })));
      }
      return me;
    };
    // Достижения, полученные без жетонов (раньше их съедал дневной потолок), начисляются теперь.
    const payEarned = (id, grants) => {
      const paid = economy.achievementsDone(id);
      const owed = {};
      for (const { code } of store.earned(id)) {
        const game = GAME_OF.get(code);
        if (game && !paid.has(code)) (owed[game] ??= []).push(byCode.get(code));
      }
      for (const [game, list] of Object.entries(owed)) economy.achievements(id, list, grants, game);
      return grants;
    };
    routes["GET /api/wallet/me"] = (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      economy.setLang(user.id, user.language_code);
      // Вход за день страница отправляет раз в день, а недоплаченное достижение (например, после
      // снятия пометки) должно дойти сразу, как только игрок откроет панель.
      payEarned(user.id, []);
      return [200, walletMe(user.id)];
    };
    // Вход в сборник за день: общее задание главной (раз в день по UTC, с серией дней).
    routes["POST /api/wallet/checkin"] = (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      economy.setLang(user.id, user.language_code);
      const grants = economy.checkin(user.id);
      // Открытие сборника — тоже активность за день (статистика), даже если игрок ни во что не сыграл.
      tracker?.visit(user.id, user.startParam);
      economy.inviteCheck(user.id, grants);
      payEarned(user.id, grants);
      // Вместе с начислением — всё, что показывает панель жетонов: странице не нужен второй запрос /me.
      const me = walletMe(user.id);
      return [200, { grants, balance: me.balance, me }];
    };
    // Таблицы: ?board=overall|mario|tanks&period=week|all — топ-100 и место игрока.
    routes["GET /api/wallet/top"] = (_body, user, url) => {
      const board = url.searchParams.get("board") || "overall";
      const period = url.searchParams.get("period") || "week";
      if (!["overall", "mario", "tanks", "bombs", "range", "word"].includes(board) || !["week", "all"].includes(period)) {
        return [400, { error: "bad data" }];
      }
      return [200, economy.top(board, period, user?.id ?? null)];
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
    // «Прыг-Скок», жизни кончились: { offer, level } → { ok, balance }; повтор с тем же offer не списывает.
    routes["POST /api/wallet/life"] = (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      const r = economy.buyLife(user.id, body.offer, body.level);
      if (!r.ok) return [r.error === "bad offer" ? 400 : 409, r];
      return [200, r];
    };
  }

  // Покупка за Telegram Stars: сервер создаёт счёт, игра открывает его (Telegram.WebApp.openInvoice),
  // а товар выдаёт бот, когда Telegram сообщит об оплате (successful_payment, wallet-bot.js).
  if (economy && createInvoice) {
    // Telegram может отказать в счёте (сеть, лимиты, неверные данные): причина — в журнал бота,
    // игре — понятный ответ 502 вместо безымянной «ошибки сервера».
    const invoiceLink = async (item, user) => {
      // Каждый запрос счёта — строка в журнале: по ней видно, дошла ли покупка до сервера.
      console.log(`Звёзды: запрос счёта ${item.id}`);
      try {
        return [200, { link: await createInvoice(item, user) }];
      } catch (err) {
        console.error(`Счёт в звёздах не создан (${item.id}): ${err.description || err.message}`);
        return [502, { error: "invoice failed" }];
      }
    };
    routes["POST /api/wallet/invoice"] = async (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      if (typeof body.item !== "string") return [400, { error: "bad data" }];
      const check = economy.starsCheck(user.id, body.item);
      if (!check.ok) return [check.error === "unknown item" ? 404 : 409, { error: check.error }];
      store.touchPlayer(user);
      economy.setLang(user.id, user.language_code);
      return invoiceLink(check.item, user);
    };
    routes["POST /api/wallet/life-invoice"] = async (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const check = economy.lifeCheck(user.id, body.offer, body.level);
      if (!check.ok) return [check.error === "bad offer" ? 400 : 409, { error: check.error }];
      store.touchPlayer(user);
      economy.setLang(user.id, user.language_code);
      return invoiceLink(check.item, user);
    };
  }

  // «Танкодром», «Бомбодром» и «Тир»: билет (зерно игры от сервера) и итог игры с записью нажатий
  // (tanks-results.js; повтор — tanks-replay.js, bombs-replay.js и range-replay.js).
  const replayGames = [["tanks", tanks, "Танкодрома"], ["bombs", bombs, "Бомбодрома"], ["range", range, "Тира"]];
  for (const [game, results, name] of replayGames) {
    if (!results) continue;
    routes[`POST /api/${game}/ticket`] = (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      const t = results.ticket(user.id);
      return t.error ? [429, t] : [200, t];
    };
    routes[`POST /api/${game}/run`] = (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const seed = Number(body.seed);
      const players = Number(body.players);
      const room = body.room == null ? null : String(body.room);
      // start — этап, с которого начата игра (выбор пройденных уровней, progress.js); без него — первый.
      const start = body.start == null ? 0 : Number(body.start);
      if (typeof body.log !== "string" || (room && !/^\d{4,8}$/.test(room))) return [400, { error: "bad data" }];
      if (!Number.isSafeInteger(start) || start < 0) return [400, { error: "bad data" }];
      store.touchPlayer(user);
      const r = results.submit(user.id, { seed, players, log: body.log, room, start });
      if (r.status !== 200) {
        if (r.status === 422) {
          console.warn(`Отклонена игра «${name}»: ${r.why}`);
          economy?.rejected(user.id);
        }
        return [r.status, { error: r.error }];
      }
      const grants = [];
      let mine = null;
      let won = [];
      let day = null;
      for (const res of r.results) {
        const out = res.playerId === user.id ? grants : [];
        economy?.run(res.playerId, { newRecord: res.newRecord, game, levels: res.stages }, out);
        // Вся игра пройдена — только если она начата с первого этапа.
        const e = { type: "run", ...res.stats, ...r.replay, won: r.replay.won && !start, score: res.score, stages: res.stages };
        const got = newAchievements(res.playerId, e, out, game, results.totals(res.playerId));
        tracker?.event(res.playerId, "game_finish", game);
        if (res.playerId === user.id) {
          mine = res;
          won = got;
          // Испытание дня: одиночная игра, начатая с первого этапа.
          day = challenge?.record(res.playerId, game, res.score, { fromStart: !start, solo: r.replay.players === 1 }, out) ?? null;
        }
      }
      economy?.setLang(user.id, user.language_code);
      return [200, { score: mine?.score ?? 0, best: mine?.best ?? results.best(user.id), newRecord: !!mine?.newRecord,
        newAchievements: won, ...walletBody(user.id, grants), ...(day ? { challenge: day } : {}) }];
    };
  }

  // «Слово дня» (word.js): состояние дня, попытка и таблица чата. Слово знает только сервер.
  if (word) {
    const langOf = (v) => (v === "en" ? "en" : v === "ru" ? "ru" : null);
    routes["GET /api/word/today"] = (_body, user, url) => {
      if (!user) return [401, { error: "unauthorized" }];
      const lang = langOf(url.searchParams.get("lang"));
      if (!lang) return [400, { error: "bad data" }];
      store.touchPlayer(user);
      return [200, word.state(user.id, lang, { chat: user.chat })];
    };
    // { lang, word, day } → состояние после попытки; в конце игры — жетоны (wallet).
    routes["POST /api/word/guess"] = (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const lang = langOf(body.lang);
      const day = body.day == null ? null : Number(body.day);
      if (!lang || typeof body.word !== "string" || body.word.length > 20 || (day !== null && !Number.isSafeInteger(day))) {
        return [400, { error: "bad data" }];
      }
      store.touchPlayer(user);
      economy?.setLang(user.id, user.language_code);
      const r = word.guess(user.id, lang, body.word, { day, chat: user.chat });
      if (r.status !== 200) return [r.status, r.body];
      const { grants, ...out } = r.body;
      return [200, { ...out, ...(out.state !== "play" ? walletBody(user.id, grants) : {}) }];
    };
    routes["GET /api/word/chat"] = (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      const weekFrom = economy ? seasonStart(seasonOf(now())) : now() - 7 * 86_400_000;
      return [200, word.chat(user.id, user.chat, weekFrom)];
    };
  }

  // Испытание дня (challenge.js): игра дня, награда, серия и таблицы (все, этот чат, друзья).
  if (challenge) {
    routes["GET /api/challenge"] = (_body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      store.touchPlayer(user);
      return [200, challenge.state(user.id, { chat: user.chat })];
    };
  }

  // Уведомления в меню (notices.js): список с числом непрочитанных и отметка «прочитано до».
  if (notices) {
    routes["GET /api/notices"] = (_body, user, url) => {
      if (!user) return [401, { error: "unauthorized" }];
      const lang = url.searchParams.get("lang") === "en" ? "en" : "ru";
      return [200, notices.list(user.id, lang)];
    };
    routes["POST /api/notices/read"] = (body, user) => {
      if (!user) return [401, { error: "unauthorized" }];
      const upTo = Number(body.upTo);
      if (!Number.isSafeInteger(upTo) || upTo < 0) return [400, { error: "bad data" }];
      return [200, notices.read(user.id, upTo)];
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

  // Панель владельца (admin.js): страница и маршруты /api/admin/*.
  if (admin) Object.assign(routes, admin.routes);

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/\/+$/, "");
    // Панель открывается с самого сервера, поэтому её запросы приходят со своего адреса (он меняется
    // вместе с туннелем). Ей CORS не нужен: чужой сайт не получит заголовков и не пройдёт предзапрос.
    const own = admin && isAdminPath(path);
    // CORS только для сайта игры; запросы со страниц чужих сайтов отклоняются целиком.
    if (origin && !own && !originAllowed(origin)) return send(res, 403, { error: "forbidden origin" });
    if (origin && !own) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    const page = own && req.method === "GET" ? adminPage(path, req) : null;
    if (page) {
      res.writeHead(page.status, page.headers);
      return res.end(page.body ?? undefined);
    }
    const handler = routes[`${req.method} ${path}`];
    if (!handler) return send(res, 404, { error: "not found" });

    const ip = clientIp(req);
    if (path !== "/api/health" && !byIp.take(ip)) {
      res.setHeader("Retry-After", String(byIp.retryAfter(ip)));
      return send(res, 429, { error: "too many requests" });
    }
    try {
      const limit = path === "/api/tanks/run" || path === "/api/bombs/run" || path === "/api/range/run" ? MAX_REPLAY_BODY
        : path === "/api/admin/notice" ? MAX_NOTICE_BODY : MAX_BODY;
      const body = req.method === "POST" ? await readJson(req, limit) : null;
      const user = userFrom(req);
      if (req.method === "POST" && user && !byUser.take(user.id)) {
        res.setHeader("Retry-After", String(byUser.retryAfter(user.id)));
        return send(res, 429, { error: "too many requests" });
      }
      const [status, out] = await handler(body, user, url, { req, ip });
      send(res, status, out, /\bgzip\b/.test(req.headers["accept-encoding"] || ""));
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
