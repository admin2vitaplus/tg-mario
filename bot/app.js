import { openDb } from "./db.js";
import { createApiServer } from "./server.js";
import { attachTanksRooms } from "./tanks-rooms.js";
import { createTracker } from "./stats.js";
import { currentCommit } from "./version.js";
import { createEconomy, loadEconomy } from "./economy.js";
import { createTanksResults } from "./tanks-results.js";
import { createWord } from "./word.js";
import { createAdmin } from "./admin.js";

// Всё, кроме самого бота Telegram и туннеля: база, HTTP API и комнаты «Танкодрома».
// Вынесено отдельно, чтобы запуск и остановку можно было проверить тестом без сети и токена.
// notify(userId, text, { offText }) — сообщение игроку от бота (итоги недели); без него сообщений нет.
// createInvoice(item, user) — ссылка на счёт в Telegram Stars (bot.api.createInvoiceLink); без неё покупок за звёзды нет.
// admins — Telegram id из ADMIN_ID: им открыта панель /admin; refundStars(userId, chargeId) — возврат звёзд из панели.
export async function startApp({
  env = process.env, botToken, onAchievements, notify = null, createInvoice = null, port, tanksLimits,
  admins = new Set(), refundStars = null,
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
  const economy = createEconomy(store, loadEconomy(), { notify });
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
  const word = createWord(store, { economy, tracker });
  const admin = createAdmin({
    store, economy, admins, refundStars, commit, dbFile,
    live: () => (tanks ? { rooms: tanks.rooms.size, sockets: tanks.wss.clients.size } : null),
  });
  const server = createApiServer({
    store, botToken, allowedOrigins, onAchievements, commit, tracker, economy, tanks: tanksResults, createInvoice, word, admin,
  });
  tanks = attachTanksRooms(server, { allowedOrigins, botToken, limits: tanksLimits });

  // Соединения держим в списке, чтобы при остановке закрыть и «живые» keep-alive.
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });

  const listenPort = port ?? (Number(env.API_PORT) || 8080);
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(listenPort, ok); });

  let stopping = null;
  const close = () => stopping ??= (async () => {
    clearInterval(pruneTimer);
    clearInterval(seasonTimer);
    await closing;
    for (const ws of tanks.wss.clients) ws.close(1001, "server shutdown");
    await new Promise((ok) => {
      server.close(() => ok());
      server.closeIdleConnections?.();
      setTimeout(() => { for (const s of sockets) s.destroy(); for (const ws of tanks.wss.clients) ws.terminate(); }, 2000).unref();
    });
    tanks.wss.close();
    store.close();
  })();

  return { server, store, tanks, tracker, economy, word, commit, gameUrl, allowedOrigins, port: server.address().port, close };
}
