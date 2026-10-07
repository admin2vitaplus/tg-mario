import { readFileSync } from "node:fs";
import { ACHIEVEMENTS_TOTAL } from "./achievements.js";

// Жетоны (ТЗ P1-7): игровая валюта, которую начисляет только сервер и только за результаты,
// которые он сам проверил (P0-4): уровни и итоги «Прыг-Скока» (проверка правдоподобия), игры
// «Танкодрома» (повтор записанных нажатий) и «Слово дня» (попытки проверяет сам сервер).
//
// Учёт:
//  • журнал ledger — только добавление; баланс = сумма журнала, wallets.balance — кэш,
//    который обновляется в той же транзакции, что и запись;
//  • одно событие начисляет один раз: UNIQUE (игрок, причина, событие), повтор запроса
//    или перезапуск ничего не добавляют;
//  • все суммы — целые; значения — в economy.json, меняются только через PR;
//  • сезон = неделя с понедельника 00:00 UTC; закрытие идёт по шагам (снимок → призы →
//    сообщения → готово), каждый шаг — своя транзакция, поэтому перезапуск посередине
//    продолжает с того же места и ничего не начисляет дважды.

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
// 5 января 1970 года — понедельник.
const MONDAY0 = 4 * DAY_MS;

export const dayUtc = (ms) => Math.floor(ms / DAY_MS);
export const seasonOf = (ms) => Math.floor((ms - MONDAY0) / WEEK_MS);
export const seasonStart = (season) => MONDAY0 + season * WEEK_MS;
// «28.09–04.10» — дни сезона по UTC.
export function seasonLabel(season) {
  const d = (ms) => new Date(ms).toISOString().slice(5, 10).split("-").reverse().join(".");
  return `${d(seasonStart(season))}–${d(seasonStart(season + 1) - 1)}`;
}

// daily — вход в сборник за день (с серией дней), task — ежедневное задание в игре,
// admin — ручное начисление или списание владельцем из панели (admin.js).
export const REASONS = ["achievement", "record", "daily", "task", "invite", "prize", "shop", "annul", "admin"];
// Начисления с дневным потолком на игрока. Призы недели ограничены своим фондом, достижения —
// своим числом (каждое один раз навсегда), поэтому потолок их не режет и не занимает: раньше
// пачка достижений за день выбирала потолок, и задания других игр в тот день не засчитывались.
const CAPPED = ["record", "daily", "task", "invite"];
// Помеченному игроку не начисляется ничего из этого.
const EARNED = ["achievement", ...CAPPED];
// Отмечаются выполненными и после потолка (приглашение — нет: его жетоны дойдут в другой день).
const MARKED = ["record", "daily", "task"];
// Игры с жетонами и их ежедневные задания (сбрасываются в 00:00 UTC).
export const GAMES = ["mario", "tanks", "bombs", "word"];
export const DAILY_TASKS = ["play", "level", "record"];
const CAPPED_SQL = CAPPED.map((r) => `'${r}'`).join(", ");
// Таблицы недели: рекорды игр за неделю и общий зачёт (жетоны за неделю без призов и покупок).
export const BOARDS = ["mario", "tanks", "bombs", "word", "overall"];
// Таблица принятых игр для каждой игры: у «Прыг-Скока» runs, у «Танкодрома» tanks_runs, у «Бомбодрома» bombs_runs.
const RUN_TABLES = { mario: "runs", tanks: "tanks_runs", bombs: "bombs_runs" };
// Сколько живёт посчитанная таблица, если в неё ничего не записали (имена игроков и т. п.).
const TOP_TTL_MS = 60_000;
// У «Слова дня» (word.js) в таблице не лучший счёт, а сумма очков по дням: за день берётся
// лучший из результатов на двух языках; при равенстве выше тот, кто набрал сумму раньше.
const wordSums = (from, to) => `SELECT player_id AS id, SUM(best) AS value, MAX(at) AS tie FROM (
    SELECT player_id, day, MAX(score) AS best, MIN(finished_at) AS at FROM word_plays
    WHERE state != 'play' AND finished_at >= ${Number(from)} AND finished_at < ${Number(to)} GROUP BY player_id, day)
  GROUP BY player_id HAVING value > 0`;

const isInt = (v) => Number.isSafeInteger(v) && v >= 0;

export function validateEconomy(cfg) {
  const errors = [];
  const need = (ok, what) => { if (!ok) errors.push(what); };
  need(isInt(cfg.dailyCap) && cfg.dailyCap > 0, "dailyCap");
  need(isInt(cfg.achievement), "achievement");
  need(isInt(cfg.record), "record");
  for (const k of ["base", "perStreakDay", "max"]) need(isInt(cfg.daily?.[k]), `daily.${k}`);
  for (const k of ["play", "level"]) need(isInt(cfg.tasks?.[k]), `tasks.${k}`);
  for (const k of ["inviter", "newcomer", "gamesNeeded", "perWeek"]) need(isInt(cfg.invite?.[k]), `invite.${k}`);
  need(cfg.invite?.gamesNeeded >= 1, "invite.gamesNeeded >= 1");
  need(isInt(cfg.suspicious?.rejectedPerDay) && cfg.suspicious.rejectedPerDay > 0, "suspicious.rejectedPerDay");
  need(isInt(cfg.season?.pool), "season.pool");
  need(typeof cfg.season?.notify === "boolean", "season.notify");
  let sum = 0;
  for (const b of BOARDS) {
    const list = cfg.season?.boards?.[b];
    need(Array.isArray(list) && list.every(isInt), `season.boards.${b}`);
    if (Array.isArray(list)) sum += list.reduce((a, n) => a + n, 0);
  }
  need(sum === cfg.season?.pool, `сумма призов по местам (${sum}) должна равняться season.pool`);
  const ids = new Set();
  for (const it of cfg.shop || []) {
    need(/^[a-z0-9-]{1,32}$/.test(it.id || ""), `shop id ${it.id}`);
    need(!ids.has(it.id), `shop: повтор ${it.id}`);
    ids.add(it.id);
    need(isInt(it.price) && it.price > 0, `shop ${it.id}: price`);
    need(isInt(it.stars) && it.stars > 0, `shop ${it.id}: stars`);
    need(GAMES.includes(it.game), `shop ${it.id}: game`);
    need(typeof it.ru === "string" && typeof it.en === "string", `shop ${it.id}: ru/en`);
  }
  need(ids.size >= 1, "shop пуст");
  const life = cfg.life;
  need(GAMES.includes(life?.game), "life.game");
  for (const k of ["price", "stars"]) {
    need(Array.isArray(life?.[k]) && life[k].length >= 1 && life[k].every((n) => isInt(n) && n > 0), `life.${k}`);
  }
  need(life?.price?.length === life?.stars?.length, "life: price и stars одной длины");
  need(typeof life?.ru === "string" && typeof life?.en === "string", "life: ru/en");
  if (errors.length) throw new Error("economy.json: " + errors.join("; "));
  return cfg;
}

export function loadEconomy(file = new URL("./economy.json", import.meta.url)) {
  return validateEconomy(JSON.parse(readFileSync(file, "utf8")));
}

// Сколько жетонов максимум может появиться за неделю при players активных игроках:
// у каждого не больше dailyCap в день за 7 дней плюс весь призовой фонд недели.
// Сверху — ещё разовые достижения: achievements (их число, achievements.js) × cfg.achievement на
// игрока один раз за всё время.
export const maxWeeklyEmission = (cfg, players, achievements = 0) =>
  7 * cfg.dailyCap * players + cfg.season.pool + achievements * cfg.achievement * players;

// Публичная часть настроек: правила для экрана «Как получить» и витрина магазина.
export const publicRules = (cfg) => ({
  dailyCap: cfg.dailyCap,
  achievement: cfg.achievement,
  record: cfg.record,
  daily: { ...cfg.daily },
  tasks: { ...cfg.tasks },
  invite: { inviter: cfg.invite.inviter, newcomer: cfg.invite.newcomer, gamesNeeded: cfg.invite.gamesNeeded },
  season: { pool: cfg.season.pool, boards: cfg.season.boards },
  shop: cfg.shop.map(({ id, game, price, stars, ru, en }) => ({ id, game, price, stars, ru, en })),
  life: { ...cfg.life },
});

// Ещё одна жизнь: offer — случайный номер конца игры от клиента (повтор с ним ничего не спишет),
// level — номер уровня в мире с нуля, от него зависит цена.
export const LIFE_OFFER = /^[a-z0-9]{8,32}$/;
const lifeOffer = (cfg, offer, level) =>
  typeof offer === "string" && LIFE_OFFER.test(offer) && Number.isInteger(level) && level >= 0 && level < cfg.life.price.length;

// Текст сообщения с итогами недели.
const SEASON_TEXT = {
  ru: {
    head: (label) => `🏁 Неделя ${label} закончилась.`,
    gained: (n) => `Жетонов за неделю: ${n}.`,
    place: (board, place, prize) => `${{ mario: "Прыг-Скок", tanks: "Танкодром", bombs: "Бомбодром", word: "Слово дня" }[board] || "Общий зачёт"}: ${place} место, приз ${prize}.`,
    balance: (n) => `Баланс: ${n}.`,
    off: "Не присылать итоги",
  },
  en: {
    head: (label) => `🏁 The week ${label} is over.`,
    gained: (n) => `Tickets this week: ${n}.`,
    place: (board, place, prize) => `${{ mario: "Hop-Skip", tanks: "Tank Field", bombs: "Bomb Field", word: "Word of the Day" }[board] || "Overall"}: place ${place}, prize ${prize}.`,
    balance: (n) => `Balance: ${n}.`,
    off: "Stop weekly results",
  },
};
export const langOf = (code) => (/^(ru|uk|be|kk)\b/i.test(code || "") ? "ru" : "en");

export function createEconomy(store, cfg, { now = Date.now, notify = null, hooks = {} } = {}) {
  const { db } = store;
  const q = {
    has: db.prepare("SELECT 1 FROM ledger WHERE player_id = ? AND reason = ? AND event = ?"),
    insert: db.prepare(`INSERT INTO ledger (player_id, amount, reason, event, season, day, at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    bump: db.prepare(`INSERT INTO wallets (player_id, balance) VALUES (?, ?)
      ON CONFLICT(player_id) DO UPDATE SET balance = balance + excluded.balance`),
    wallet: db.prepare("SELECT * FROM wallets WHERE player_id = ?"),
    ensure: db.prepare("INSERT OR IGNORE INTO wallets (player_id) VALUES (?)"),
    today: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM ledger
      WHERE player_id = ? AND day = ? AND amount > 0 AND reason IN (${CAPPED_SQL})`),
    setStreak: db.prepare("UPDATE wallets SET streak = ?, streak_day = ? WHERE player_id = ?"),
    setLang: db.prepare("UPDATE wallets SET lang = ? WHERE player_id = ?"),
    setNotify: db.prepare("UPDATE wallets SET notify = ? WHERE player_id = ?"),
    flag: db.prepare("UPDATE wallets SET flagged = ?, flagged_at = ? WHERE player_id = ?"),
    strike: db.prepare(`UPDATE wallets SET strikes = CASE WHEN strike_day = ? THEN strikes + 1 ELSE 1 END,
      strike_day = ? WHERE player_id = ? RETURNING strikes`),
    clearStrikes: db.prepare("UPDATE wallets SET strikes = 0, strike_day = NULL WHERE player_id = ?"),
    invitesThisSeason: db.prepare(`SELECT COUNT(*) AS n FROM ledger
      WHERE player_id = ? AND reason = 'invite' AND season = ? AND event LIKE 'friend:%'`),
    history: db.prepare(`SELECT id, amount, reason, event, at FROM ledger WHERE player_id = ? AND amount != 0
      ORDER BY id DESC LIMIT ?`),
    owned: db.prepare(`SELECT event AS item FROM ledger WHERE player_id = ? AND reason = 'shop' AND event NOT LIKE 'life:%'
      UNION SELECT item FROM purchases WHERE player_id = ? AND refunded_at IS NULL AND item NOT LIKE 'life:%'`),
    paid: db.prepare("SELECT 1 FROM purchases WHERE player_id = ? AND item = ? AND refunded_at IS NULL"),
    addPurchase: db.prepare(`INSERT OR IGNORE INTO purchases (player_id, item, stars, charge_id, at)
      VALUES (?, ?, ?, ?, ?)`),
    purchase: db.prepare("SELECT * FROM purchases WHERE charge_id = ?"),
    refund: db.prepare("UPDATE purchases SET refunded_at = ? WHERE charge_id = ? AND refunded_at IS NULL"),
    tanksGames: db.prepare("SELECT COUNT(*) AS n FROM tanks_runs WHERE player_id = ?"),
    bombsGames: db.prepare("SELECT COUNT(*) AS n FROM bombs_runs WHERE player_id = ?"),
    wordGames: db.prepare("SELECT COUNT(*) AS n FROM word_plays WHERE player_id = ? AND state != 'play'"),
    sum: db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE player_id = ?"),
    meta: db.prepare("SELECT value FROM economy_meta WHERE key = ?"),
    setMeta: db.prepare("INSERT OR IGNORE INTO economy_meta (key, value) VALUES (?, ?)"),
    lastDone: db.prepare("SELECT MAX(season) AS s FROM seasons WHERE state = 'done'"),
    seasonRow: db.prepare("SELECT * FROM seasons WHERE season = ?"),
    setSeason: db.prepare(`INSERT INTO seasons (season, state, at) VALUES (?, ?, ?)
      ON CONFLICT(season) DO UPDATE SET state = excluded.state, at = excluded.at`),
  };

  // Транзакции через SAVEPOINT: вкладываются друг в друга (призы внутри закрытия сезона).
  let depth = 0;
  const tx = (fn) => {
    const sp = `econ${depth++}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const out = fn();
      db.exec(`RELEASE ${sp}`);
      return out;
    } catch (err) {
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
      throw err;
    } finally {
      depth--;
    }
  };

  const wallet = (id) => { q.ensure.run(id); return q.wallet.get(id); };

  // Запись в журнал. Возвращает начисленную сумму (0 — не начислено: повтор, пометка, потолок).
  function post(playerId, amount, reason, event, { season, at = now() } = {}) {
    if (!REASONS.includes(reason)) throw new Error(`unknown reason ${reason}`);
    if (!Number.isSafeInteger(amount)) throw new Error("amount must be an integer");
    return tx(() => {
      if (q.has.get(playerId, reason, String(event))) return 0;
      let n = amount;
      if (EARNED.includes(reason) && wallet(playerId).flagged) return 0;
      if (CAPPED.includes(reason)) n = Math.min(n, cfg.dailyCap - q.today.get(playerId, dayUtc(at)).n);
      if (n === 0 || (CAPPED.includes(reason) && n < 0)) {
        // Потолок на сегодня исчерпан. Задание, рекорд и вход за день всё равно выполнены:
        // запись с нулём отмечает это (задание зачёркнуто, серия дней идёт), жетонов она не даёт.
        if (amount > 0 && MARKED.includes(reason)) q.insert.run(playerId, 0, reason, String(event), season ?? seasonOf(at), dayUtc(at), at);
        return 0;
      }
      q.insert.run(playerId, n, reason, String(event), season ?? seasonOf(at), dayUtc(at), at);
      q.bump.run(playerId, n);
      dropTop("overall");
      return n;
    });
  }

  const grant = (out, reason, n) => { if (n > 0) out.push({ reason, amount: n }); };
  // Сколько даст вход сегодня: база плюс шаг за каждый день серии, не больше max.
  const loginAmount = (w, day) => {
    const streak = w.streak_day === day - 1 ? w.streak + 1 : w.streak_day === day ? w.streak : 1;
    return Math.min(cfg.daily.base + cfg.daily.perStreakDay * (streak - 1), cfg.daily.max);
  };

  // Таблица целиком (все места) — тяжёлый запрос по журналу и играм, поэтому результат хранится
  // в памяти: до TOP_TTL_MS или до новой записи, которая может её изменить (dropTop).
  function rank(board, period, season) {
    const from = seasonStart(season);
    let sql;
    if (board === "overall") {
      sql = `SELECT l.player_id AS id, SUM(l.amount) AS value, MAX(l.id) AS tie FROM ledger l
        WHERE l.reason NOT IN ('prize', 'shop', 'annul', 'admin') AND l.amount != 0 ${period === "week" ? `AND l.season = ${season}` : ""}
        GROUP BY l.player_id HAVING value > 0`;
    } else if (board === "word") {
      sql = wordSums(period === "week" ? from : 0, Number.MAX_SAFE_INTEGER);
    } else {
      sql = `SELECT player_id AS id, MAX(score) AS value, MIN(created_at) AS tie FROM ${RUN_TABLES[board]}
        WHERE score > 0 ${period === "week" ? `AND created_at >= ${from}` : ""} GROUP BY player_id`;
    }
    return db.prepare(`SELECT t.id, t.value, COALESCE(p.name, 'Игрок') AS name,
        ROW_NUMBER() OVER (ORDER BY t.value DESC, t.tie ASC) AS place
      FROM (${sql}) t LEFT JOIN players p ON p.id = t.id LEFT JOIN wallets w ON w.player_id = t.id
      WHERE w.flagged IS NULL`).all();
  }
  const topCache = new Map();
  const dropTop = (board) => {
    for (const k of topCache.keys()) if (!board || k.startsWith(board + ":")) topCache.delete(k);
  };

  const economy = {
    cfg,
    tx,
    post,

    // Новые достижения игры game (каждое — один раз навсегда; achievements.js).
    achievements(playerId, list, out = [], game = "mario") {
      for (const a of list) grant(out, "achievement", post(playerId, cfg.achievement, "achievement", `${game}:${a.code}`));
      return out;
    },

    // Вход в сборник за день (общее задание главной): с серией дней подряд.
    checkin(playerId, out = []) {
      const at = now();
      const day = dayUtc(at);
      tx(() => {
        const w = wallet(playerId);
        if (w.streak_day === day || w.flagged) return;
        const n = post(playerId, loginAmount(w, day), "daily", `day:${day}`, { at });
        if (q.has.get(playerId, "daily", `day:${day}`)) q.setStreak.run(w.streak_day === day - 1 ? w.streak + 1 : 1, day, playerId);
        grant(out, "daily", n);
      });
      return out;
    },

    // Ежедневное задание игры (play — сыграть, level — пройти уровень). Раз в день по UTC.
    task(playerId, game, task, out = [], at = now()) {
      grant(out, "task", post(playerId, cfg.tasks[task], "task", `${game}:${task}:${dayUtc(at)}`, { at }));
      return out;
    },

    // Принятый сервером итог игры (game — mario, tanks или bombs): задание «сыграть», «пройти уровень»
    // (levels — сколько пройдено в этой игре), личный рекорд в этой игре, награда за приглашение.
    run(playerId, { newRecord, game = "mario", levels = 0 }, out = []) {
      dropTop(game); // новый результат игры может поменять её таблицу
      const at = now();
      const day = dayUtc(at);
      this.task(playerId, game, "play", out, at);
      if (levels > 0) this.task(playerId, game, "level", out, at);
      if (newRecord) grant(out, "record", post(playerId, cfg.record, "record", `${game}:${day}`, { at }));
      this.inviteCheck(playerId, out, at);
      return out;
    },

    // Новичок пришёл по личной ссылке (users_seen.source = ref) и сыграл gamesNeeded игр:
    // жетоны ему и пригласившему (тому — не больше perWeek друзей за неделю).
    inviteCheck(playerId, out = [], at = now()) {
      const seen = store.getSeen(playerId);
      if (!seen || seen.source !== "ref" || !seen.inviter || seen.inviter === playerId) return out;
      // Игры, которые сервер проверил: «Прыг-Скок», «Танкодром», «Бомбодром» и «Слово дня».
      const games = (id) => (store.getPlayer(id)?.games ?? 0) + q.tanksGames.get(id).n + q.bombsGames.get(id).n + q.wordGames.get(id).n;
      if (games(playerId) < cfg.invite.gamesNeeded || games(seen.inviter) < 1) return out;
      tx(() => {
        if (q.invitesThisSeason.get(seen.inviter, seasonOf(at)).n < cfg.invite.perWeek) {
          post(seen.inviter, cfg.invite.inviter, "invite", `friend:${playerId}`, { at });
        }
        grant(out, "invite", post(playerId, cfg.invite.newcomer, "invite", `from:${seen.inviter}`, { at }));
      });
      return out;
    },

    // Сервер отклонил отчёт как невозможный. После rejectedPerDay таких за день игрок помечается:
    // начисления ему не идут, в призы недели он не попадает. Снять пометку — /unflag.
    rejected(playerId) {
      const day = dayUtc(now());
      wallet(playerId);
      const { strikes } = q.strike.get(day, day, playerId);
      if (strikes >= cfg.suspicious.rejectedPerDay && !q.wallet.get(playerId).flagged) {
        q.flag.run("auto: отклонённые отчёты", now(), playerId);
        dropTop();
      }
    },

    flag(playerId, why = "admin") { wallet(playerId); q.flag.run(String(why).slice(0, 100), now(), playerId); dropTop(); },
    unflag(playerId) { wallet(playerId); q.flag.run(null, null, playerId); q.clearStrikes.run(playerId); dropTop(); },

    // Аннулировать всё, что игрок получил за сезон (начисления и призы), отдельной записью.
    // Повторная команда снимает только то, что пришло после прошлой.
    annul(playerId, season = seasonOf(now())) {
      return tx(() => {
        const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN reason NOT IN ('shop', 'annul') THEN amount END), 0) AS got,
            COALESCE(SUM(CASE WHEN reason = 'annul' AND event LIKE ? THEN amount END), 0) AS annulled,
            MAX(id) AS last FROM ledger WHERE player_id = ? AND (season = ? OR (reason = 'annul' AND event LIKE ?))`)
          .get(`${season}:%`, playerId, season, `${season}:%`);
        const amount = -(r.got + r.annulled);
        if (amount >= 0) return 0;
        return post(playerId, amount, "annul", `${season}:${r.last}`);
      });
    },

    buy(playerId, itemId) {
      const item = cfg.shop.find((it) => it.id === itemId);
      if (!item) return { ok: false, error: "unknown item" };
      return tx(() => {
        if (economy.owns(playerId, item.id)) return { ok: true, already: true, balance: wallet(playerId).balance };
        const w = wallet(playerId);
        if (w.balance < item.price) return { ok: false, error: "not enough", balance: w.balance };
        post(playerId, -item.price, "shop", item.id);
        return { ok: true, balance: q.wallet.get(playerId).balance };
      });
    },

    // Ещё одна жизнь за жетоны: списывается сразу, раз на один конец игры (offer).
    buyLife(playerId, offer, level) {
      if (!lifeOffer(cfg, offer, level)) return { ok: false, error: "bad offer" };
      const price = cfg.life.price[level];
      return tx(() => {
        if (q.has.get(playerId, "shop", `life:${offer}`)) return { ok: true, already: true, balance: wallet(playerId).balance };
        const w = wallet(playerId);
        if (w.balance < price) return { ok: false, error: "not enough", balance: w.balance };
        post(playerId, -price, "shop", `life:${offer}`);
        return { ok: true, balance: q.wallet.get(playerId).balance };
      });
    },
    // Жизнь за звёзды: товар для счёта (wallet-bot.js) или ошибка. amount — сумма из pre_checkout_query.
    lifeCheck(playerId, offer, level, amount) {
      if (!lifeOffer(cfg, offer, level)) return { ok: false, error: "bad offer" };
      const stars = cfg.life.stars[level];
      if (amount != null && amount !== stars) return { ok: false, error: "price changed" };
      if (q.has.get(playerId, "shop", `life:${offer}`) || q.paid.get(playerId, `life:${offer}`)) return { ok: false, error: "already" };
      const { ru, en } = cfg.life;
      return { ok: true, item: { id: `life:${offer}`, kind: "life", payload: `life:${level}:${offer}`, stars, ru, en } };
    },

    wallet,

    owns: (playerId, itemId) => !!(q.has.get(playerId, "shop", itemId) || q.paid.get(playerId, itemId)),

    // ---------- Telegram Stars ----------
    // Можно ли продать товар за звёзды (проверка перед оплатой, pre_checkout_query).
    starsCheck(playerId, itemId, amount) {
      const item = cfg.shop.find((it) => it.id === itemId);
      if (!item) return { ok: false, error: "unknown item" };
      if (amount != null && amount !== item.stars) return { ok: false, error: "price changed" };
      if (economy.owns(playerId, item.id)) return { ok: false, error: "already" };
      return { ok: true, item };
    },
    // Оплата прошла (successful_payment). Повтор того же charge_id ничего не добавит.
    starsPaid(playerId, itemId, stars, chargeId) {
      return q.addPurchase.run(playerId, itemId, stars, String(chargeId), now()).changes > 0;
    },
    purchase: (chargeId) => q.purchase.get(String(chargeId)),
    purchases: (playerId) => db.prepare("SELECT * FROM purchases WHERE player_id = ? ORDER BY id").all(playerId),
    refunded: (chargeId) => q.refund.run(now(), String(chargeId)).changes > 0,

    setLang(playerId, code) { if (code) { wallet(playerId); q.setLang.run(String(code).slice(0, 8), playerId); } },
    setNotify(playerId, on) { wallet(playerId); q.setNotify.run(on ? 1 : 0, playerId); },

    me(playerId) {
      const w = wallet(playerId);
      const at = now();
      const day = dayUtc(at);
      return {
        balance: w.balance,
        today: q.today.get(playerId, day).n,
        dailyCap: cfg.dailyCap,
        streak: w.streak_day === day || w.streak_day === day - 1 ? w.streak : 0,
        owned: q.owned.all(playerId, playerId).map((r) => r.item),
        history: q.history.all(playerId, 30).map(({ id, ...r }) => r),
        season: seasonOf(at),
        seasonEndsAt: seasonStart(seasonOf(at) + 1),
        notify: !!w.notify,
        tasks: economy.tasks(playerId, at),
        dayEndsAt: (day + 1) * DAY_MS,
      };
    },

    // Задания с отметкой «выполнено»: общие (главная) и по играм. Достижения «Прыг-Скока»
    // добавляет сервер (он знает их список).
    tasks(playerId, at = now()) {
      const w = wallet(playerId);
      const day = dayUtc(at);
      const has = (reason, event) => !!q.has.get(playerId, reason, event);
      const invited = q.invitesThisSeason.get(playerId, seasonOf(at)).n;
      const out = {
        main: [
          { id: "login", period: "day", amount: loginAmount(w, day), done: has("daily", `day:${day}`) },
          { id: "invite", period: "week", amount: cfg.invite.inviter, done: invited >= cfg.invite.perWeek,
            count: invited, max: cfg.invite.perWeek, newcomer: cfg.invite.newcomer, games: cfg.invite.gamesNeeded },
        ],
      };
      for (const g of GAMES) {
        out[g] = DAILY_TASKS.map((t) => t === "record"
          ? { id: t, period: "day", amount: cfg.record, done: has("record", `${g}:${day}`) }
          : { id: t, period: "day", amount: cfg.tasks[t], done: has("task", `${g}:${t}:${day}`) });
      }
      return out;
    },

    achievementsDone: (playerId) => new Set(db.prepare(`SELECT event FROM ledger
      WHERE player_id = ? AND reason = 'achievement'`).all(playerId).map((r) => r.event.replace(/^[a-z]+:/, ""))),

    // Таблицы: overall — жетоны (за неделю без призов и покупок или всего полученных), mario и tanks —
    // лучший счёт (за неделю или за всё время). Топ-100 и место игрока.
    top(board, period, playerId = null, at = now()) {
      const season = seasonOf(at);
      const key = `${board}:${period}:${season}`;
      const hit = topCache.get(key);
      const ranked = hit && at - hit.at < TOP_TTL_MS ? hit.ranked : rank(board, period, season);
      if (ranked !== hit?.ranked) topCache.set(key, { at, ranked });
      const rows = ranked.slice(0, 100).map((r) => ({ place: r.place, name: r.name, value: r.value, me: r.id === playerId }));
      const mine = playerId == null ? null : ranked.find((r) => r.id === playerId);
      return { board, period, rows, me: mine ? { place: mine.place, value: mine.value } : null };
    },

    // Сверка: кэш баланса равен сумме журнала.
    checkBalance: (playerId) => ({ cached: wallet(playerId).balance, ledger: q.sum.get(playerId).n }),

    // ---------- Сезон ----------

    // Закрыть все прошедшие и ещё не закрытые сезоны. Первый запуск запоминает текущий сезон
    // как начало учёта: недели до появления жетонов не закрываются.
    async closeDue() {
      const cur = seasonOf(now());
      q.setMeta.run("first_season", cur);
      const first = q.meta.get("first_season").value;
      const done = q.lastDone.get().s;
      const closed = [];
      for (let s = Math.max(first, done == null ? first : done + 1); s < cur; s++) {
        await this.closeSeason(s);
        closed.push(s);
      }
      return closed;
    },

    async closeSeason(season) {
      if (season >= seasonOf(now())) throw new Error("сезон ещё идёт");
      let row = q.seasonRow.get(season);
      if (!row) { snapshot(season); hooks.after?.("snapshot", season); row = q.seasonRow.get(season); }
      if (row.state === "snapshot") { payPrizes(season); hooks.after?.("paid", season); row = q.seasonRow.get(season); }
      if (row.state === "paid") {
        if (cfg.season.notify && notify) await sendResults(season);
        q.setSeason.run(season, "done", now());
      }
    },

    places: (season) => db.prepare("SELECT * FROM season_places WHERE season = ? ORDER BY board, place").all(season),
  };

  // Шаг 1: снимок балансов на конец сезона и места в таблицах (помеченные игроки — без мест).
  function snapshot(season) {
    tx(() => {
      const from = seasonStart(season);
      const to = seasonStart(season + 1);
      db.prepare(`INSERT INTO season_balances (season, player_id, balance, gained)
        SELECT ?, player_id, SUM(amount),
          SUM(CASE WHEN season = ? AND reason NOT IN ('prize', 'shop') THEN amount ELSE 0 END)
        FROM ledger WHERE season <= ? GROUP BY player_id`).run(season, season, season);
      // Лучший результат недели в игре; при равенстве выше тот, кто набрал его раньше.
      const best = (game) => db.prepare(`SELECT r.player_id, r.score AS value, MIN(r.created_at) AS first
          FROM ${RUN_TABLES[game]} r JOIN (SELECT player_id, MAX(score) AS best FROM ${RUN_TABLES[game]}
            WHERE created_at >= ? AND created_at < ? GROUP BY player_id) b
            ON b.player_id = r.player_id AND r.score = b.best
          LEFT JOIN wallets w ON w.player_id = r.player_id
          WHERE r.created_at >= ? AND r.created_at < ? AND r.score > 0 AND w.flagged IS NULL
          GROUP BY r.player_id ORDER BY value DESC, first ASC LIMIT ?`)
        .all(from, to, from, to, cfg.season.boards[game].length);
      const boards = {
        mario: best("mario"),
        tanks: best("tanks"),
        bombs: best("bombs"),
        word: db.prepare(`SELECT t.id AS player_id, t.value FROM (${wordSums(from, to)}) t
          LEFT JOIN wallets w ON w.player_id = t.id WHERE w.flagged IS NULL
          ORDER BY t.value DESC, t.tie ASC LIMIT ?`).all(cfg.season.boards.word.length),
        overall: db.prepare(`SELECT l.player_id, SUM(l.amount) AS value, MAX(l.id) AS first
          FROM ledger l LEFT JOIN wallets w ON w.player_id = l.player_id
          WHERE l.season = ? AND l.reason NOT IN ('prize', 'shop') AND l.amount != 0 AND w.flagged IS NULL
          GROUP BY l.player_id HAVING value > 0 ORDER BY value DESC, first ASC LIMIT ?`)
          .all(season, cfg.season.boards.overall.length),
      };
      const put = db.prepare(`INSERT INTO season_places (season, board, place, player_id, value, prize)
        VALUES (?, ?, ?, ?, ?, ?)`);
      for (const b of BOARDS) {
        boards[b].forEach((r, i) => put.run(season, b, i + 1, r.player_id, r.value, cfg.season.boards[b][i]));
      }
      q.setSeason.run(season, "snapshot", now());
    });
  }

  // Шаг 2: призы. Событие приза — «сезон:таблица:место», поэтому повтор ничего не добавит.
  function payPrizes(season) {
    tx(() => {
      for (const p of economy.places(season)) {
        if (p.prize > 0) post(p.player_id, p.prize, "prize", `${season}:${p.board}:${p.place}`, { season });
      }
      q.setSeason.run(season, "paid", now());
    });
  }

  // Шаг 3: сообщения. Отметка «отправлено» ставится до отправки: после перезапуска
  // игрок получит не больше одного сообщения.
  async function sendResults(season) {
    const rows = db.prepare(`SELECT b.player_id, b.gained, w.lang,
        (SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE player_id = b.player_id) AS balance
      FROM season_balances b JOIN wallets w ON w.player_id = b.player_id
      WHERE b.season = ? AND w.notify = 1 AND w.flagged IS NULL AND (b.gained > 0 OR EXISTS
        (SELECT 1 FROM season_places p WHERE p.season = b.season AND p.player_id = b.player_id))
        AND NOT EXISTS (SELECT 1 FROM season_notified n WHERE n.season = b.season AND n.player_id = b.player_id)`)
      .all(season);
    const mark = db.prepare("INSERT OR IGNORE INTO season_notified (season, player_id) VALUES (?, ?)");
    const placesOf = db.prepare("SELECT board, place, prize FROM season_places WHERE season = ? AND player_id = ?");
    for (const r of rows) {
      const t = SEASON_TEXT[r.lang ? langOf(r.lang) : "ru"];
      const lines = [t.head(seasonLabel(season)), t.gained(r.gained)];
      for (const p of placesOf.all(season, r.player_id)) lines.push(t.place(p.board, p.place, p.prize));
      lines.push(t.balance(r.balance));
      mark.run(season, r.player_id);
      try {
        await notify(r.player_id, lines.join("\n"), { offText: t.off });
      } catch { /* игрок мог заблокировать бота */ }
    }
  }

  return economy;
}

// ---------- Отчёты для администратора ----------

const REASON_NAMES = {
  achievement: "достижения", record: "рекорды", daily: "вход за день", task: "задания в играх", invite: "приглашения",
  prize: "призы", shop: "магазин", annul: "аннулировано", admin: "вручную",
};

export function economyStats(db, season) {
  const byReason = db.prepare(`SELECT reason, SUM(amount) AS n FROM ledger WHERE season = ? GROUP BY reason`).all(season);
  const issued = byReason.filter((r) => r.n > 0 && !["shop", "annul", "admin"].includes(r.reason)).reduce((a, r) => a + r.n, 0);
  const top = db.prepare(`SELECT l.player_id, p.name, SUM(l.amount) AS n FROM ledger l
    LEFT JOIN players p ON p.id = l.player_id
    WHERE l.season = ? AND l.amount > 0 AND l.reason != 'shop' GROUP BY l.player_id ORDER BY n DESC LIMIT 5`).all(season);
  const players = db.prepare("SELECT COUNT(DISTINCT player_id) AS n FROM ledger WHERE season = ? AND amount > 0").get(season).n;
  const flagged = db.prepare("SELECT COUNT(*) AS n FROM wallets WHERE flagged IS NOT NULL").get().n;
  const stars = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS sum FROM purchases
    WHERE at >= ? AND at < ? AND refunded_at IS NULL`).get(seasonStart(season), seasonStart(season + 1));
  return { season, byReason, issued, top, players, flagged, stars };
}

export function economyReport(db, cfg, at = Date.now()) {
  const s = economyStats(db, seasonOf(at));
  const of = (reason) => s.byReason.find((r) => r.reason === reason)?.n ?? 0;
  const share = s.byReason.filter((r) => r.n > 0 && !["shop", "annul", "admin"].includes(r.reason))
    .map((r) => `${REASON_NAMES[r.reason]} ${Math.round((r.n / s.issued) * 100)}%`).join(", ");
  return [
    `💠 Жетоны, неделя ${seasonLabel(s.season)} (сезон ${s.season}, дни по UTC)`,
    `Выдано: ${s.issued} у ${s.players} игроков${share ? ` (${share})` : ""}`,
    `Потрачено в магазине: ${-of("shop")}, аннулировано: ${-of("annul")}`,
    `Покупки за звёзды за неделю: ${s.stars.n} на ${s.stars.sum} ⭐`,
    `Предел недели: ${cfg.dailyCap} × 7 × игроков + фонд ${cfg.season.pool} = ` +
      `${maxWeeklyEmission(cfg, s.players)} при ${s.players} игроках; ` +
      `плюс разово достижения: ${ACHIEVEMENTS_TOTAL} × ${cfg.achievement} на игрока за всё время`,
    `Топ получателей: ${s.top.length ? s.top.map((t) => `${t.name || "?"} (${t.player_id}) ${t.n}`).join(", ") : "нет"}`,
    `Помечены как подозрительные: ${s.flagged}`,
  ].join("\n");
}

// Экспорт сезона: «игрок → сумма» (всё, что изменило баланс игрока за сезон, включая призы недели)
// и баланс на конец сезона. Сумма по файлу равна сумме по журналу за сезон.
export function exportSeason(db, season) {
  const rows = db.prepare(`SELECT player_id, SUM(amount) AS amount,
      (SELECT SUM(amount) FROM ledger b WHERE b.player_id = l.player_id AND b.season <= ?) AS balance
    FROM ledger l WHERE season = ? GROUP BY player_id ORDER BY player_id`).all(season, season);
  const ledgerTotal = db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE season = ?").get(season).n;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const state = db.prepare("SELECT state FROM seasons WHERE season = ?").get(season)?.state ?? "open";
  const csv = ["player_id,amount,balance", ...rows.map((r) => `${r.player_id},${r.amount},${r.balance}`)].join("\n") + "\n";
  return { season, rows, total, ledgerTotal, state, csv };
}
