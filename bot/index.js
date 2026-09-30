import { Bot, InlineKeyboard } from "grammy";
import { openDb } from "./db.js";
import { ACHIEVEMENTS } from "./achievements.js";
import { createApiServer } from "./server.js";
import { startTunnel } from "./tunnel.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не задан BOT_TOKEN. Скопируйте .env.example в .env и впишите токен.");
  process.exit(1);
}

const baseGameUrl = process.env.WEBAPP_URL || "https://admin2vitaplus.github.io/tg-mario/";
const port = Number(process.env.API_PORT) || 8080;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || new URL(baseGameUrl).origin).split(",").map((s) => s.trim());

const bot = new Bot(token);
const store = openDb(process.env.DB_FILE || "scores.db");

// ---------- Сервер очков ----------
const server = createApiServer({
  store,
  botToken: token,
  allowedOrigins,
  onAchievements: (userId, list) =>
    bot.api
      .sendMessage(userId, "Новые достижения!\n" + list.map((a) => `${a.icon} ${a.title}: ${a.text}`).join("\n"))
      .catch(() => {}),
});
await new Promise((ok) => server.listen(port, ok));
console.log(`Сервер очков слушает порт ${port}`);

// Публичный https-адрес сервера: свой домен (PUBLIC_API_URL) или бесплатный туннель.
let apiUrl = process.env.PUBLIC_API_URL || "";
if (!apiUrl && process.env.TUNNEL !== "off") {
  try {
    apiUrl = await startTunnel(port, process.env.CLOUDFLARED || "cloudflared");
    console.log(`Туннель: ${apiUrl}`);
  } catch (err) {
    console.warn(`Туннель не запущен (${err.message}). Игра будет работать, но без сохранения очков.`);
  }
}

// Адрес сервера передаётся игре в ссылке, поэтому при смене туннеля ничего не надо перенастраивать.
const gameUrl = apiUrl ? `${baseGameUrl}${baseGameUrl.includes("?") ? "&" : "?"}api=${encodeURIComponent(apiUrl)}` : baseGameUrl;

// ---------- Бот ----------
const playKeyboard = () => new InlineKeyboard().webApp("🎮 Играть", gameUrl);

const medal = (place) => ["🥇", "🥈", "🥉"][place - 1] || `${place}.`;

bot.command("start", (ctx) =>
  ctx.reply(
    "Привет! Это «Прыг-Скок» — платформер прямо в Telegram.\n" +
      "Собирай монеты, прыгай на жуков и доберись до флага.\n\n" +
      "/top — таблица рекордов, /me — мои достижения",
    { reply_markup: playKeyboard() },
  ),
);

bot.command("play", (ctx) => ctx.reply("Поехали!", { reply_markup: playKeyboard() }));

bot.command("top", (ctx) => {
  const top = store.top(10);
  if (!top.length) return ctx.reply("Рекордов пока нет. Будь первым!", { reply_markup: playKeyboard() });
  const lines = top.map((p, i) => `${medal(i + 1)} ${p.name} — ${p.best_score}`);
  return ctx.reply("🏆 Таблица рекордов\n\n" + lines.join("\n"), { reply_markup: playKeyboard() });
});

bot.command("me", (ctx) => {
  const player = store.getPlayer(ctx.from.id);
  if (!player) return ctx.reply("Ты ещё не играл. Нажми «Играть»!", { reply_markup: playKeyboard() });
  const earned = new Set(store.earned(player.id).map((a) => a.code));
  const rank = store.rank(player);
  const lines = ACHIEVEMENTS.map((a) => `${earned.has(a.code) ? a.icon : "🔒"} ${a.title} — ${a.text}`);
  return ctx.reply(
    `Рекорд: ${player.best_score}${rank ? ` (место ${rank})` : ""}\nИгр: ${player.games}\n` +
      `Достижения ${earned.size}/${ACHIEVEMENTS.length}:\n\n${lines.join("\n")}`,
  );
});

bot.command("help", (ctx) =>
  ctx.reply(
    "Управление: кнопки на экране или клавиатура (← →, прыжок Z/пробел, бег X/Shift).\n" +
      "/play — открыть игру\n/top — таблица рекордов\n/me — мои достижения",
  ),
);

bot.on("message", (ctx) => ctx.reply("Нажми кнопку, чтобы играть:", { reply_markup: playKeyboard() }));

bot.catch((err) => console.error("Ошибка бота:", err.error));

// Кнопка меню рядом с полем ввода тоже открывает игру.
await bot.api.setChatMenuButton({
  menu_button: { type: "web_app", text: "Играть", web_app: { url: gameUrl } },
});
await bot.api.setMyCommands([
  { command: "play", description: "Открыть игру" },
  { command: "top", description: "Таблица рекордов" },
  { command: "me", description: "Мои достижения" },
  { command: "help", description: "Как играть" },
]);

bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен, игра: ${gameUrl}`) });
