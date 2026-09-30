import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не задан BOT_TOKEN. Скопируйте .env.example в .env и впишите токен.");
  process.exit(1);
}

const gameUrl = process.env.WEBAPP_URL || "https://admin2vitaplus.github.io/sklad/";

const bot = new Bot(token);

const playKeyboard = () => new InlineKeyboard().webApp("🎮 Играть", gameUrl);

bot.command("start", (ctx) =>
  ctx.reply(
    "Привет! Это «Прыг-Скок» — платформер прямо в Telegram.\n" +
      "Собирай монеты, прыгай на жуков и доберись до флага.",
    { reply_markup: playKeyboard() },
  ),
);

bot.command("play", (ctx) => ctx.reply("Поехали!", { reply_markup: playKeyboard() }));

bot.command("help", (ctx) =>
  ctx.reply(
    "Управление: кнопки на экране или клавиатура (← →, прыжок Z/пробел, бег X/Shift).\n" +
      "/play — открыть игру",
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
  { command: "help", description: "Как играть" },
]);

bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен, игра: ${gameUrl}`) });
