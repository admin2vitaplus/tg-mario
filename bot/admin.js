import { readFileSync, statSync } from "node:fs";
import { loadavg } from "node:os";
import { collectStats } from "./stats.js";
import { dayOf } from "./days.js";
import { economyStats, seasonLabel, seasonOf, seasonStart } from "./economy.js";

// Панель владельца: страница /admin и маршруты /api/admin/*. Вход по логину и паролю
// (ADMIN_LOGIN, ADMIN_PASSWORD_HASH, см. admin-auth.js); без них панель выключена.
// Без действующей сессии сервер отвечает 401 и ничего не показывает.

const PAGE_FILES = {
  "index.html": "text/html; charset=utf-8",
  "admin.js": "text/javascript; charset=utf-8",
  "admin.css": "text/css; charset=utf-8",
};
const PAGE_DIR = new URL("./admin/", import.meta.url);
// Страница только со своего сервера: никаких внешних скриптов и стилей.
const PAGE_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export const ADMIN_DAYS = 30;
const OVERVIEW_TTL_MS = 30_000;
// Ручное начисление или списание за один раз — не больше этого.
export const MAX_ADJUST = 100_000;

export const isAdminPath = (path) => path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/");

// Файл страницы панели или null. Файлы читаются один раз.
const pageCache = new Map();
export function adminPage(path) {
  // /admin — сама страница; её файлы — /admin/<имя> (и при открытии с «/» на конце — /admin/admin/<имя>).
  const name = path === "/admin" ? "index.html" : /^\/admin(?:\/admin)?\/(admin\.(?:js|css))$/.exec(path)?.[1];
  if (!name) return null;
  if (!pageCache.has(name)) pageCache.set(name, readFileSync(new URL(name, PAGE_DIR)));
  return { body: pageCache.get(name), headers: { "Content-Type": PAGE_FILES[name], ...PAGE_HEADERS } };
}

const id = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Ряды по дням за последние ADMIN_DAYS дней (дни по Москве, как в /stats).
function dailySeries(db, today) {
  const from = today - ADMIN_DAYS + 1;
  const map = (rows) => new Map(rows.map((r) => [r.day, r.n]));
  const players = map(db.prepare(`SELECT day, COUNT(DISTINCT user_id) AS n FROM events
    WHERE day BETWEEN ? AND ? AND user_id IS NOT NULL GROUP BY day`).all(from, today));
  const fresh = map(db.prepare(`SELECT day, COUNT(*) AS n FROM users_seen
    WHERE day BETWEEN ? AND ? AND source != 'old' GROUP BY day`).all(from, today));
  const games = map(db.prepare(`SELECT day, COUNT(*) AS n FROM events
    WHERE day BETWEEN ? AND ? AND type = 'game_finish' GROUP BY day`).all(from, today));
  const matches = map(db.prepare(`SELECT day, COUNT(*) AS n FROM events WHERE day BETWEEN ? AND ?
    AND type = 'match_finished' AND (detail IS NULL OR detail != 'second') GROUP BY day`).all(from, today));
  const out = [];
  for (let d = from; d <= today; d++) {
    out.push({ day: d, players: players.get(d) ?? 0, newPlayers: fresh.get(d) ?? 0, games: games.get(d) ?? 0, matches: matches.get(d) ?? 0 });
  }
  return out;
}

function economyBlock(db, at) {
  const season = seasonOf(at);
  const week = economyStats(db, season);
  const prev = economyStats(db, season - 1);
  const of = (s, reason) => s.byReason.find((r) => r.reason === reason)?.n ?? 0;
  const total = db.prepare(`SELECT COALESCE(SUM(balance), 0) AS balance, COUNT(*) AS wallets,
    SUM(flagged IS NOT NULL) AS flagged FROM wallets`).get();
  const flagged = db.prepare(`SELECT w.player_id AS id, p.name, w.flagged AS why, w.flagged_at AS at, w.balance
    FROM wallets w LEFT JOIN players p ON p.id = w.player_id WHERE w.flagged IS NOT NULL
    ORDER BY w.flagged_at DESC LIMIT 50`).all();
  const sum = (s) => ({
    season: s.season, label: seasonLabel(s.season), issued: s.issued, players: s.players,
    spent: -of(s, "shop"), annulled: -of(s, "annul"), admin: of(s, "admin"),
    byReason: s.byReason, top: s.top.map((t) => ({ id: t.player_id, name: t.name, n: t.n })),
    stars: s.stars,
  });
  return {
    week: sum(week), prev: sum(prev), seasonEndsAt: seasonStart(season + 1),
    balance: total.balance, wallets: total.wallets, flaggedCount: total.flagged ?? 0, flagged,
  };
}

function starsBlock(db) {
  const all = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS sum,
    COALESCE(SUM(CASE WHEN refunded_at IS NOT NULL THEN stars END), 0) AS refunded FROM purchases`).get();
  const items = db.prepare(`SELECT CASE WHEN item LIKE 'life:%' THEN 'life' ELSE item END AS item,
    COUNT(*) AS n, SUM(stars) AS sum FROM purchases WHERE refunded_at IS NULL GROUP BY 1 ORDER BY sum DESC`).all();
  const recent = db.prepare(`SELECT u.id, u.player_id, p.name, u.item, u.stars, u.charge_id, u.at, u.refunded_at
    FROM purchases u LEFT JOIN players p ON p.id = u.player_id ORDER BY u.id DESC LIMIT 50`).all();
  return { ...all, items, recent };
}

export function createAdmin({
  store, economy = null, auth, refundStars = null, commit = "unknown", startedAt = Date.now(),
  dbFile = null, live = () => null, now = Date.now, logger = console.log,
}) {
  const { db } = store;
  let cpuMark = { at: Date.now(), usage: process.cpuUsage() };
  let overview = null;

  // CPU процесса между двумя просмотрами панели (на сервере предел 40 %).
  const cpuPercent = () => {
    const t = Date.now();
    const used = process.cpuUsage(cpuMark.usage);
    const ms = t - cpuMark.at;
    cpuMark = { at: t, usage: process.cpuUsage() };
    return ms > 0 ? Math.round(((used.user + used.system) / 1000 / ms) * 1000) / 10 : null;
  };

  const server = () => {
    const m = process.memoryUsage();
    let dbSize = null;
    if (dbFile && dbFile !== ":memory:") {
      try { dbSize = statSync(dbFile).size + (statSync(`${dbFile}-wal`, { throwIfNoEntry: false })?.size ?? 0); } catch { /* нет файла */ }
    }
    return {
      commit, uptime: Math.floor((Date.now() - startedAt) / 1000), node: process.version,
      rss: m.rss, heap: m.heapUsed, cpu: cpuPercent(), load: loadavg()[0], dbSize, live: live(),
    };
  };

  const collectOverview = () => {
    const at = now();
    const stats = collectStats(db, at);
    return {
      at,
      today: stats.today,
      players: stats.players,
      k: stats.k,
      retention: stats.retention,
      newBySource: stats.newBySource,
      games: stats.games,
      days: dailySeries(db, dayOf(at)),
      economy: economy ? economyBlock(db, at) : null,
      stars: starsBlock(db),
    };
  };

  const player = (pid) => {
    const p = store.getPlayer(pid);
    const seen = store.getSeen(pid);
    const w = db.prepare("SELECT * FROM wallets WHERE player_id = ?").get(pid);
    if (!p && !seen && !w) return null;
    const one = (sql) => db.prepare(sql).get(pid);
    return {
      id: pid,
      name: p?.name ?? null,
      username: p?.username ?? null,
      createdAt: p?.created_at ?? seen?.at ?? null,
      seen: seen ? { at: seen.at, source: seen.source, inviter: seen.inviter } : null,
      lastActive: one("SELECT MAX(at) AS at FROM events WHERE user_id = ?").at,
      mario: { games: p?.games ?? 0, best: p?.best_score ?? 0, rank: store.rank(p), achievements: store.earned(pid).length },
      tanks: one("SELECT COUNT(*) AS games, COALESCE(MAX(score), 0) AS best FROM tanks_runs WHERE player_id = ?"),
      bombs: one("SELECT COUNT(*) AS games, COALESCE(MAX(score), 0) AS best FROM bombs_runs WHERE player_id = ?"),
      word: one("SELECT COUNT(*) AS games, COALESCE(SUM(score), 0) AS score FROM word_plays WHERE player_id = ? AND state != 'play'"),
      invited: one("SELECT COUNT(*) AS n FROM users_seen WHERE inviter = ?").n,
      wallet: w ? { balance: w.balance, flagged: w.flagged, flaggedAt: w.flagged_at, streak: w.streak, notify: !!w.notify, lang: w.lang } : null,
      history: db.prepare("SELECT amount, reason, event, at FROM ledger WHERE player_id = ? ORDER BY id DESC LIMIT 50").all(pid),
      purchases: db.prepare("SELECT item, stars, charge_id, at, refunded_at FROM purchases WHERE player_id = ? ORDER BY id DESC").all(pid),
    };
  };

  // Поиск: число — id, иначе часть имени или @username. Пусто — последние активные.
  const search = (q) => {
    const s = text(q, 64).replace(/^@/, "");
    const cols = `p.id, p.name, p.username, p.best_score AS best, w.balance, w.flagged,
      (SELECT MAX(at) FROM events e WHERE e.user_id = p.id) AS lastActive`;
    if (!s) {
      return db.prepare(`SELECT ${cols} FROM players p LEFT JOIN wallets w ON w.player_id = p.id
        WHERE p.id IN (SELECT user_id FROM events WHERE day >= ? AND user_id IS NOT NULL GROUP BY user_id
          ORDER BY MAX(at) DESC LIMIT 30) ORDER BY lastActive DESC`).all(dayOf(now()) - 30);
    }
    // Имена бывают кириллицей, а LIKE в SQLite без учёта регистра только для латиницы: сравниваем здесь.
    const low = s.toLocaleLowerCase("ru");
    const exact = id(s);
    const ids = db.prepare("SELECT id, name, username FROM players").all()
      .filter((p) => p.id === exact || p.name.toLocaleLowerCase("ru").includes(low) || (p.username || "").toLowerCase().includes(low))
      .slice(0, 200).map((p) => p.id);
    if (!ids.length) return [];
    return db.prepare(`SELECT ${cols} FROM players p LEFT JOIN wallets w ON w.player_id = p.id
      WHERE p.id IN (${ids.map(Number).join(",")}) ORDER BY p.id = ? DESC, p.best_score DESC LIMIT 30`).all(exact ?? -1);
  };

  const guard = (fn) => async (body, _user, url, { req }) => {
    if (!auth.check(req.headers.authorization)) return [401, { error: "unauthorized" }];
    return fn(body, url);
  };
  const needEconomy = (fn) => (economy ? fn : () => [503, { error: "no economy" }]);
  // Что сделал владелец — в журнал службы (journalctl), без паролей и ключей.
  const log = (what) => logger(`Панель: ${what}`);

  const routes = {
    // Настроен ли вход: страница сразу пишет, если логин и пароль на сервере не заданы.
    "GET /api/admin/status": () => [200, { enabled: auth.enabled }],
    "POST /api/admin/login": (body, _user, _url, { ip }) => {
      const r = auth.login(ip, body.login, body.password);
      if (r.ok) { log(`вход с ${ip}`); return [200, { ok: true, token: r.token, expiresAt: r.expiresAt }]; }
      if (r.error === "disabled") return [404, { error: "not found" }];
      if (r.error === "wrong") logger(`Панель: неверный вход с ${ip}`);
      return [r.error === "locked" ? 429 : 401, r];
    },
    "POST /api/admin/logout": (_b, _u, _url, { req }) => { auth.logout(req.headers.authorization); return [200, { ok: true }]; },
    "GET /api/admin/me": guard(() => [200, { ok: true, refund: !!refundStars, economy: !!economy }]),
    "GET /api/admin/overview": guard(() => {
      const at = now();
      if (!overview || at - overview.at > OVERVIEW_TTL_MS || at < overview.at) overview = collectOverview();
      return [200, { ...overview, server: server() }];
    }),
    "GET /api/admin/players": guard((_b, url) => [200, search(url.searchParams.get("q"))]),
    "GET /api/admin/player": guard((_b, url) => {
      const pid = id(url.searchParams.get("id"));
      if (!pid) return [400, { error: "bad data" }];
      const p = player(pid);
      return p ? [200, p] : [404, { error: "not found" }];
    }),

    // Начислить (amount > 0) или списать (amount < 0) жетоны: отдельная запись журнала с причиной admin.
    // key — случайная метка с кнопки: повторная отправка той же формы ничего не добавит.
    "POST /api/admin/adjust": guard(needEconomy((body) => {
      const pid = id(body.id);
      const amount = Number(body.amount);
      const key = typeof body.key === "string" && /^[a-z0-9]{8,32}$/.test(body.key) ? body.key : null;
      if (!pid || !key || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > MAX_ADJUST) {
        return [400, { error: "bad data" }];
      }
      const r = economy.tx(() => {
        const w = economy.wallet(pid);
        if (amount < 0 && w.balance + amount < 0) return { ok: false, error: "not enough", balance: w.balance };
        const n = economy.post(pid, amount, "admin", `${key}:${text(body.note, 60)}`);
        return { ok: true, posted: n, balance: economy.wallet(pid).balance };
      });
      if (r.ok) log(`жетоны ${amount > 0 ? "+" : ""}${amount} игроку ${pid}`);
      return [r.ok ? 200 : 409, r];
    })),
    "POST /api/admin/flag": guard(needEconomy((body) => {
      const pid = id(body.id);
      if (!pid) return [400, { error: "bad data" }];
      if (body.on === false) economy.unflag(pid);
      else economy.flag(pid, text(body.why, 100) || "admin");
      log(`${body.on === false ? "снял пометку" : "пометил"} ${pid}`);
      return [200, { ok: true }];
    })),
    "POST /api/admin/annul": guard(needEconomy((body) => {
      const pid = id(body.id);
      const season = body.season == null ? seasonOf(now()) : Number(body.season);
      if (!pid || !Number.isSafeInteger(season) || season < 0) return [400, { error: "bad data" }];
      const n = economy.annul(pid, season);
      log(`аннулировал ${-n} у ${pid} за сезон ${season}`);
      return [200, { ok: true, annulled: -n, balance: economy.wallet(pid).balance }];
    })),
    "POST /api/admin/refund": guard(needEconomy(async (body) => {
      if (!refundStars) return [503, { error: "no refunds" }];
      const pid = id(body.id);
      const charge = text(body.charge, 200);
      const p = charge && economy.purchase(charge);
      if (!pid || !p || p.player_id !== pid) return [400, { error: "bad data" }];
      if (p.refunded_at) return [409, { error: "already" }];
      try {
        await refundStars(pid, charge);
      } catch (err) {
        return [502, { error: "telegram", detail: String(err.description || err.message).slice(0, 200) }];
      }
      economy.refunded(charge);
      log(`вернул ${p.stars} звёзд игроку ${pid}`);
      return [200, { ok: true, stars: p.stars }];
    })),
  };

  return { routes };
}

