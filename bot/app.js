import { openDb } from "./db.js";
import { createApiServer } from "./server.js";
import { attachTanksRooms } from "./tanks-rooms.js";
import { currentCommit } from "./version.js";

// Всё, кроме самого бота Telegram и туннеля: база, HTTP API и комнаты «Танкодрома».
// Вынесено отдельно, чтобы запуск и остановку можно было проверить тестом без сети и токена.
export async function startApp({ env = process.env, botToken, onAchievements, port } = {}) {
  const gameUrl = env.WEBAPP_URL || "https://admin2vitaplus.github.io/tg-mario/";
  const allowedOrigins = (env.ALLOWED_ORIGINS || new URL(gameUrl).origin).split(",").map((s) => s.trim()).filter(Boolean);
  const dbFile = env.DB_FILE || "scores.db";

  const store = openDb(dbFile);
  if (store.version.from !== store.version.to) {
    console.log(`База ${dbFile}: схема обновлена с версии ${store.version.from} до ${store.version.to}`);
  }
  const commit = currentCommit(env);
  const server = createApiServer({ store, botToken, allowedOrigins, onAchievements, commit });
  const tanks = attachTanksRooms(server, { allowedOrigins });

  // Соединения держим в списке, чтобы при остановке закрыть и «живые» keep-alive.
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });

  const listenPort = port ?? (Number(env.API_PORT) || 8080);
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(listenPort, ok); });

  let closing = null;
  const close = () => closing ??= (async () => {
    for (const ws of tanks.wss.clients) ws.close(1001, "server shutdown");
    await new Promise((ok) => {
      server.close(() => ok());
      server.closeIdleConnections?.();
      setTimeout(() => { for (const s of sockets) s.destroy(); for (const ws of tanks.wss.clients) ws.terminate(); }, 2000).unref();
    });
    tanks.wss.close();
    store.close();
  })();

  return { server, store, tanks, commit, gameUrl, allowedOrigins, port: server.address().port, close };
}
