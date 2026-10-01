import { openDb } from "./db.js";
import { createApiServer } from "./server.js";
import { attachTanksRooms } from "./tanks-rooms.js";
import { createTracker } from "./stats.js";
import { currentCommit } from "./version.js";
import { createEconomy, loadEconomy } from "./economy.js";

// Всё, кроме самого бота Telegram и туннеля: база, HTTP API и комнаты «Танкодрома».
// Вынесено отдельно, чтобы запуск и остановку можно было проверить тестом без сети и токена.
// notify(userId, text, { offText }) — сообщение игроку от бота (итоги недели); без него сообщений нет.
export async function startApp({ env = process.env, botToken, onAchievements, notify = null, port, tanksLimits } = {}) {
  const gameUrl = env.WEBAPP_URL || "https://admin2vitaplus.github.io/tg-mario/";
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
  const server = createApiServer({ store, botToken, allowedOrigins, onAchievements, commit, tracker, economy });
  const tanks = attachTanksRooms(server, { allowedOrigins, botToken, limits: tanksLimits });

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

  return { server, store, tanks, tracker, economy, commit, gameUrl, allowedOrigins, port: server.address().port, close };
}
