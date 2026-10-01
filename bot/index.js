import { Bot, InlineKeyboard } from "grammy";
import { ACHIEVEMENTS } from "./achievements.js";
import { startApp } from "./app.js";
import { startTunnel } from "./tunnel.js";
import { addSecret, installSafeConsole } from "./log.js";
import { statsReport } from "./stats.js";

installSafeConsole();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не задан BOT_TOKEN. Скопируйте .env.example в .env и впишите токен.");
  process.exit(1);
}
addSecret(token);
if (!process.env.WEBAPP_URL) {
  console.error("Не задан WEBAPP_URL — адрес игры (Mini App). Впишите его в .env, например WEBAPP_URL=https://<сайт игры>/");
  process.exit(1);
}

const bot = new Bot(token);

// ---------- Сервер очков ----------
const app = await startApp({
  botToken: token,
  onAchievements: (userId, list) =>
    bot.api
      .sendMessage(userId, "Новые достижения!\n" + list.map((a) => `${a.icon} ${a.title}: ${a.text}`).join("\n"))
      .catch(() => {}),
});
const { store, tracker } = app;
// Telegram id администраторов через запятую; пусто — команда /stats выключена.
const admins = new Set((process.env.ADMIN_ID || "").split(",").map((s) => Number(s.trim())).filter(Number.isSafeInteger));
const baseGameUrl = app.gameUrl;
console.log(`Сервер очков слушает порт ${app.port}, коммит ${app.commit}`);

// Публичный https-адрес сервера: свой домен (PUBLIC_API_URL) или бесплатный туннель.
let apiUrl = process.env.PUBLIC_API_URL || "";
let tunnel = null;
if (!apiUrl && process.env.TUNNEL !== "off") {
  try {
    tunnel = await startTunnel(app.port, process.env.CLOUDFLARED || "cloudflared");
    apiUrl = tunnel.url;
    console.log(`Туннель: ${apiUrl}`);
  } catch (err) {
    console.warn(`Туннель не запущен: ${err.message}.`);
  }
}
if (!apiUrl) {
  console.error(
    "\n!!! У сервера нет публичного https-адреса.\n" +
      "!!! Рекорды, достижения и сетевые «Танки» работать НЕ будут.\n" +
      "!!! Установите cloudflared (см. bot/README.md) или впишите PUBLIC_API_URL в .env и перезапустите бота.\n",
  );
}

// Штатная остановка (systemd шлёт SIGTERM): бот, HTTP и WebSocket, туннель, база.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Получен ${signal}, останавливаюсь…`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await Promise.allSettled([bot.isRunning() ? bot.stop() : null, app.close(), tunnel?.stop()]);
  } finally {
    process.exit(0);
  }
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

// Адрес сервера передаётся игре в ссылке, поэтому при смене туннеля ничего не надо перенастраивать.
const withApi = (url) => {
  const u = new URL(url);
  if (apiUrl) u.searchParams.set("api", apiUrl);
  return u.toString();
};
// Имя бота нужно игре, чтобы при переезде сервера предложить открыть её заново через бота.
await bot.init();
const withBot = (url) => {
  const u = new URL(url);
  u.searchParams.set("bot", bot.botInfo.username);
  return u.toString();
};
const gameUrl = withBot(withApi(baseGameUrl));

// Приглашение в «Танкодром»: t.me/<бот>?start=tanks_1234 открывает комнату 1234.
const tanksRoomUrl = (code) => {
  const u = new URL(withBot(withApi(new URL("tanks/", baseGameUrl).toString())));
  u.searchParams.set("room", code);
  return u.toString();
};

// ---------- Бот ----------
const playKeyboard = () => new InlineKeyboard().webApp("🎮 Играть", gameUrl);

const medal = (place) => ["🥇", "🥈", "🥉"][place - 1] || `${place}.`;

bot.command("start", (ctx) => {
  if (ctx.from) tracker.arrive(ctx.from.id, ctx.match);
  const room = /^(?:tanks|room)_(\d{4})$/.exec(ctx.match || "");
  if (room) {
    return ctx.reply(`Тебя позвали в «Танкодром», комната ${room[1]}.`, {
      reply_markup: new InlineKeyboard().webApp("🛡 В бой", tanksRoomUrl(room[1])),
    });
  }
  return ctx.reply(
    "Привет! Это «Прыг-Скок» — платформер прямо в Telegram.\n" +
      "Собирай монеты, прыгай на жуков и доберись до флага.\n\n" +
      "/top — таблица рекордов, /me — мои достижения",
    { reply_markup: playKeyboard() },
  );
});

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

// Личная ссылка-приглашение: кто придёт по ней, засчитывается в K-фактор.
bot.command("invite", (ctx) => {
  const link = `https://t.me/${bot.botInfo.username}?start=ref_${ctx.from.id}`;
  tracker.event(ctx.from.id, "invite_created");
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Сыграем? Тут ретро-игры прямо в Telegram.")}`;
  return ctx.reply(`Позови друга по этой ссылке:\n${link}`, {
    reply_markup: new InlineKeyboard().url("📨 Отправить другу", share),
  });
});

// Статистика только для администраторов (ADMIN_ID); остальным команда как будто не существует.
bot.command("stats", (ctx, next) => {
  if (!admins.has(ctx.from?.id)) return next();
  return ctx.reply(statsReport(store.db));
});

bot.command("help", (ctx) =>
  ctx.reply(
    "Управление: кнопки на экране или клавиатура (← →, прыжок Z/пробел, бег X/Shift).\n" +
      "/play — открыть игру\n/top — таблица рекордов\n/me — мои достижения\n/invite — позвать друга",
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
  { command: "invite", description: "Позвать друга" },
  { command: "help", description: "Как играть" },
]);

bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен, игра: ${gameUrl}`) });
