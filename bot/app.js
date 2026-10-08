import { openDb } from "./db.js";
import { createApiServer } from "./server.js";
import { attachTanksRooms } from "./tanks-rooms.js";
import { createTracker } from "./stats.js";
import { currentCommit } from "./version.js";
import { createEconomy, loadEconomy } from "./economy.js";
import { createTanksResults } from "./tanks-results.js";
import { createBombsResults } from "./bombs-results.js";
import { createWord } from "./word.js";
import { createAdmin } from "./admin.js";
import { createAdminAuth } from "./admin-auth.js";
import { isAdminPath } from "./admin.js";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";

// Всё, кроме самого бота Telegram и туннеля: база, HTTP API и комнаты «Танкодрома».
// Вынесено отдельно, чтобы запуск и остановку можно было проверить тестом без сети и токена.
// notify(userId, text, { offText }) — сообщение игроку от бота (итоги недели); без него сообщений нет.
// createInvoice(item, user) — ссылка на счёт в Telegram Stars (bot.api.createInvoiceLink); без неё покупок за звёзды нет.
// refundStars(userId, chargeId) — возврат звёзд из панели владельца (вход: ADMIN_LOGIN и ADMIN_PASSWORD_HASH).
export async function startApp({
  env = process.env, botToken, onAchievements, notify = null, createInvoice = null, port, tanksLimits,
  refundStars = null,
} = {}) {
  // Адрес игры не вшит в код: он задаётся в .env, чтобы переезд сайта не требовал правки бота.
  const gameUrl = env.WEBAPP_URL;
  if (!gameUrl || !/^https?:\/\//.test(gameUrl)) {
    throw new Error("Не задан WEBAPP_URL — адрес игры (Mini App). Впишите его в .env, например WEBAPP_URL=https://<сайт игры>/");
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS || new URL(gameUrl).origin).split(",").map((s) => s.trim()).filter(Boolean);
  const dbFile = env.DB_FILE || "scores.db";

  const store = openDb(dbFile);
  if (store.version.from !== store.version.to) {
    console.log(`База ${dbFile}: схема обновлена с версии ${store.version.from} до ${store.version.to}`);
  }
  const commit = currentCommit(env);
  const tracker = createTracker(store);
  // Сырые события старше 90 дней сворачиваются в суммы по дням: при запуске и раз в сутки.
  const prune = () => { try { store.pruneEvents(); } catch (err) { console.error("Ошибка очистки статистики:", err.message); } };
  prune();
  const pruneTimer = setInterval(prune, 24 * 3600 * 1000);
  pruneTimer.unref();
  // Жетоны (ТЗ P1-7): правила в economy.json. Прошедшие недели закрываются при запуске
  // и проверяются каждые 10 минут; закрытие продолжается с места, где его прервал перезапуск.
  // ADMIN_ID (через запятую) не помечаются автоматически за отклонённые отчёты.
  const trusted = new Set(String(env.ADMIN_ID || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isSafeInteger(n) && n > 0));
  const economy = createEconomy(store, loadEconomy(), { notify, trusted });
  let closing = null;
  const closeSeasons = () => closing ??= economy.closeDue()
    .then((list) => { if (list.length) console.log(`Жетоны: закрыты сезоны ${list.join(", ")}`); })
    .catch((err) => console.error("Ошибка закрытия сезона жетонов:", err.message))
    .finally(() => { closing = null; });
  closeSeasons();
  const seasonTimer = setInterval(closeSeasons, 10 * 60 * 1000);
  seasonTimer.unref();
  // Онлайн-матч засчитывается обоим игрокам комнаты, поэтому итоги танков знают состав комнат.
  let tanks = null;
  const tanksResults = createTanksResults(store, { members: (code) => tanks?.members(code) ?? null });
  let bombs = null;
  const bombsResults = createBombsResults(store, { members: (code) => bombs?.members(code) ?? null });
  const word = createWord(store, { economy, tracker });
  const auth = createAdminAuth({ login: (env.ADMIN_LOGIN || "").trim(), passwordHash: (env.ADMIN_PASSWORD_HASH || "").trim() });
  if (!auth.enabled) console.log("Панель /admin выключена: не заданы ADMIN_LOGIN и ADMIN_PASSWORD_HASH.");
  const admin = createAdmin({
    store, economy, auth, refundStars, commit, dbFile,
    live: () => (tanks ? { rooms: tanks.rooms.size + (bombs?.rooms.size ?? 0), sockets: tanks.wss.clients.size + (bombs?.wss.clients.size ?? 0) } : null),
  });
  const server = createApiServer({
    store, botToken, allowedOrigins, onAchievements, commit, tracker, economy, tanks: tanksResults, bombs: bombsResults, createInvoice, word, admin,
  });
  tanks = attachTanksRooms(server, { allowedOrigins, botToken, limits: tanksLimits });
  // Дуэль «Бомбодрома» — такие же комнаты на своём пути.
  bombs = attachTanksRooms(server, { allowedOrigins, botToken, limits: tanksLimits, path: "/ws/bombs" });

  // Соединения держим в списке, чтобы при остановке закрыть и «живые» keep-alive.
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });

  const listenPort = port ?? (Number(env.API_PORT) || 8080);
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(listenPort, ok); });

  // Отдельный вход в панель по IP сервера, мимо туннеля (ADMIN_HTTPS_PORT + сертификат и ключ).
  // На этом порту только панель: игры и оплаты по-прежнему идут через туннель.
  const adminHttps = await startAdminHttps(env, server);

  let stopping = null;
  const close = () => stopping ??= (async () => {
    clearInterval(pruneTimer);
    clearInterval(seasonTimer);
    await closing;
    const roomSets = [tanks, bombs];
    for (const r of roomSets) for (const ws of r.wss.clients) ws.close(1001, "server shutdown");
    await new Promise((ok) => {
      server.close(() => ok());
      server.closeIdleConnections?.();
      setTimeout(() => { for (const s of sockets) s.destroy(); for (const r of roomSets) for (const ws of r.wss.clients) ws.terminate(); }, 2000).unref();
    });
    for (const r of roomSets) r.wss.close();
    await adminHttps?.close();
    store.close();
  })();

  return {
    server, store, tanks, bombs, tracker, economy, word, commit, gameUrl, allowedOrigins, port: server.address().port, close,
    adminEnabled: auth.enabled, adminHttpsPort: adminHttps?.port ?? null,
  };
}

// HTTPS-сервер только для панели. Запросы передаются тому же обработчику, что и на основном порту,
// всё остальное — 404. Без порта, сертификата или ключа (или если файлы не читаются) — выключен,
// бот при этом работает как обычно.
async function startAdminHttps(env, server) {
  const port = Number(env.ADMIN_HTTPS_PORT);
  if (!env.ADMIN_HTTPS_PORT || !Number.isInteger(port) || port < 0 || port > 65535) return null;
  let cert, key;
  try {
    cert = readFileSync(env.ADMIN_TLS_CERT || "");
    key = readFileSync(env.ADMIN_TLS_KEY || "");
  } catch (err) {
    console.error(`Панель по HTTPS выключена: не читаются ADMIN_TLS_CERT/ADMIN_TLS_KEY (${err.message})`);
    return null;
  }
  const https = createHttpsServer({ cert, key }, (req, res) => {
    const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "");
    if (path === "") return res.writeHead(302, { Location: "/admin" }).end();
    if (!isAdminPath(path)) return res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
    server.emit("request", req, res);
  });
  const sockets = new Set();
  https.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  try {
    await new Promise((ok, fail) => { https.once("error", fail); https.listen(port, ok); });
  } catch (err) {
    console.error(`Панель по HTTPS выключена: порт ${port} не открылся (${err.message})`);
    return null;
  }
  console.log(`Панель по HTTPS на порту ${https.address().port}`);
  return {
    port: https.address().port,
    close: () => new Promise((ok) => {
      https.close(() => ok());
      https.closeIdleConnections?.();
      setTimeout(() => { for (const s of sockets) s.destroy(); }, 2000).unref();
    }),
  };
}
