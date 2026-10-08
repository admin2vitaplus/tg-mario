import { Bot, InlineKeyboard } from "grammy";
import { ACHIEVEMENTS_TOTAL, BY_GAME } from "./achievements.js";
import { startApp } from "./app.js";
import { startTunnel, watchTunnel } from "./tunnel.js";
import { addSecret, installSafeConsole } from "./log.js";
import { statsReport } from "./stats.js";
import { economyReport } from "./economy.js";
import { ALLOWED_UPDATES, installWalletCommands, starsInvoice, walletNotifier } from "./wallet-bot.js";
import { groupPlay, inlineResults, watchEnabledGames } from "./invites.js";
import { OWNER_COMMANDS, PLAYER_COMMANDS, supportHandler } from "./support.js";

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
const createInvoice = starsInvoice(bot);

// ---------- Сервер очков ----------
const app = await startApp({
  botToken: token,
  onAchievements: (userId, list) =>
    bot.api
      .sendMessage(userId, "Новые достижения!\n" + list.map((a) => `${a.icon} ${a.title}: ${a.text}`).join("\n"))
      .catch(() => {}),
  notify: walletNotifier(bot),
  createInvoice,
  refundStars: (userId, chargeId) => bot.api.refundStarPayment(userId, chargeId),
});
const { store, tracker } = app;
// Telegram id владельца (администраторов) через запятую. Только им доступны служебные команды
// и им приходят сообщения игроков; пусто — служебные команды выключены, сообщения никуда не идут.
const admins = new Set((process.env.ADMIN_ID || "").split(",").map((s) => Number(s.trim())).filter(Number.isSafeInteger));
const baseGameUrl = app.gameUrl;
console.log(`Сервер очков слушает порт ${app.port}, коммит ${app.commit}`);

// Публичный https-адрес сервера: свой домен (PUBLIC_API_URL) или бесплатный туннель.
let apiUrl = process.env.PUBLIC_API_URL || "";
let tunnel = null;
if (!apiUrl && process.env.TUNNEL_METRICS) {
  // Туннель — отдельная служба: её адрес переживает перезапуски бота.
  try {
    tunnel = await watchTunnel(process.env.TUNNEL_METRICS);
    apiUrl = tunnel.url;
    console.log(`Туннель (служба): ${apiUrl}`);
  } catch (err) {
    // Без адреса игра до сервера не достучится; systemd перезапустит бота и попробует снова.
    console.error(`Туннель не найден: ${err.message}.`);
    process.exit(1);
  }
} else if (!apiUrl && process.env.TUNNEL !== "off") {
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

// Приглашение в «Танкодром»: t.me/<бот>?start=room_123456 (и старое tanks_) открывает комнату 123456.
// Дуэль «Бомбодрома»: t.me/<бот>?start=bomb_123456.
const roomUrl = (page, code) => {
  const u = new URL(withBot(withApi(new URL(page, baseGameUrl).toString())));
  u.searchParams.set("room", code);
  return u.toString();
};
const tanksRoomUrl = (code) => roomUrl("tanks/", code);

// ---------- Бот ----------
const playKeyboard = () => new InlineKeyboard().webApp("🎮 Играть", gameUrl);

const medal = (place) => ["🥇", "🥈", "🥉"][place - 1] || `${place}.`;

// Выключенная в web/config.js игра не попадает ни в /play, ни в инлайн-режим.
const enabledGames = watchEnabledGames(baseGameUrl);
const playInGroup = (ctx) => groupPlay({
  botName: bot.botInfo.username, apiUrl, userId: ctx.from?.id, languageCode: ctx.from?.language_code,
  enabled: enabledGames.get(),
});

bot.command("start", (ctx) => {
  if (ctx.chat?.type !== "private") {
    const { text, reply_markup } = playInGroup(ctx);
    return ctx.reply(text, { reply_markup });
  }
  if (ctx.from) tracker.arrive(ctx.from.id, ctx.match);
  const duel = /^bomb_(\d{4,6})$/.exec(ctx.match || "");
  if (duel) {
    return ctx.reply(`Тебя позвали на дуэль в «Бомбодром», комната ${duel[1]}.`, {
      reply_markup: new InlineKeyboard().webApp("💣 В бой", roomUrl("bombs/", duel[1])),
    });
  }
  const room = /^(?:tanks|room)_(\d{4,6})$/.exec(ctx.match || "");
  if (room) {
    return ctx.reply(`Тебя позвали в «Танкодром», комната ${room[1]}.`, {
      reply_markup: new InlineKeyboard().webApp("🛡 В бой", tanksRoomUrl(room[1])),
    });
  }
  return ctx.reply(
    "Привет! Это «Прыг-Скок» — платформер прямо в Telegram.\n" +
      "Собирай монеты, прыгай на жуков и доберись до флага.\n\n" +
      "/me — моя статистика. Вопрос разработчику можно просто написать сюда.",
    { reply_markup: playKeyboard() },
  );
});

// В группе кнопка web_app не работает: там /play даёт ссылки на игры (invites.js, ТЗ P1-3).
bot.command("play", (ctx) => {
  if (ctx.chat?.type === "private") return ctx.reply("Поехали!", { reply_markup: playKeyboard() });
  if (ctx.from) tracker.event(ctx.from.id, "invite_created");
  const { text, reply_markup } = playInGroup(ctx);
  return ctx.reply(text, { reply_markup });
});

// Инлайн-режим: в любом чате набрать @бот — и выбрать игру. Включается в BotFather (/setinline).
bot.on("inline_query", (ctx) => ctx.answerInlineQuery(inlineResults({
  botName: bot.botInfo.username, apiUrl, userId: ctx.from.id, languageCode: ctx.from.language_code, query: ctx.inlineQuery.query,
  enabled: enabledGames.get(),
}), { cache_time: 60, is_personal: true }));
// Отправленная карточка — приглашение (приходит, только если в BotFather включён /setinlinefeedback).
bot.on("chosen_inline_result", (ctx) => tracker.event(ctx.from.id, "invite_created"));

// Только для владельца: остальным игрокам доступны игра и своя статистика (ниже — owner()).
const owner = (handler) => (ctx, next) => (admins.has(ctx.from?.id) ? handler(ctx) : next());

bot.command("top", owner((ctx) => {
  const top = store.top(10);
  if (!top.length) return ctx.reply("Рекордов пока нет. Будь первым!", { reply_markup: playKeyboard() });
  const lines = top.map((p, i) => `${medal(i + 1)} ${p.name} — ${p.best_score}`);
  return ctx.reply("🏆 Таблица рекордов\n\n" + lines.join("\n"), { reply_markup: playKeyboard() });
}));

bot.command("me", (ctx) => {
  const player = store.getPlayer(ctx.from.id);
  if (!player) return ctx.reply("Ты ещё не играл. Нажми «Играть»!", { reply_markup: playKeyboard() });
  const earned = new Set(store.earned(player.id).map((a) => a.code));
  const rank = store.rank(player);
  const names = { mario: "Прыг-Скок", tanks: "Танкодром", bombs: "Бомбодром" };
  const lines = Object.entries(BY_GAME).map(([game, list]) => `${names[game]}:\n` +
    list.map((a) => `${earned.has(a.code) ? a.icon : "🔒"} ${a.title} — ${a.text}`).join("\n"));
  return ctx.reply(
    `Рекорд в «Прыг-Скоке»: ${player.best_score}${rank ? ` (место ${rank})` : ""}\nИгр: ${player.games}\n` +
      `Достижения ${earned.size}/${ACHIEVEMENTS_TOTAL}:\n\n${lines.join("\n\n")}`,
  );
});

// Личная ссылка-приглашение: кто придёт по ней, засчитывается в K-фактор.
bot.command("invite", owner((ctx) => {
  const link = `https://t.me/${bot.botInfo.username}?start=ref_${ctx.from.id}`;
  tracker.event(ctx.from.id, "invite_created");
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Сыграем? Тут ретро-игры прямо в Telegram.")}`;
  const { invite } = app.economy.cfg;
  return ctx.reply(`Позови друга по этой ссылке:\n${link}\n\nКогда друг сыграет ${invite.gamesNeeded} игры, ` +
    `тебе ${invite.inviter} жетонов, ему ${invite.newcomer}.`, {
    reply_markup: new InlineKeyboard().url("📨 Отправить другу", share),
  });
}));

// Статистика только для администраторов (ADMIN_ID); остальным команда как будто не существует.
bot.command("stats", (ctx, next) => {
  if (!admins.has(ctx.from?.id)) return next();
  return ctx.reply(statsReport(store.db) + "\n\n" + economyReport(store.db, app.economy.cfg));
});

// Панель владельца (admin.js): ссылка на страницу самого сервера бота, вход по логину и паролю.
bot.command("admin", (ctx, next) => {
  if (!admins.has(ctx.from?.id) || ctx.chat?.type !== "private") return next();
  if (!apiUrl) return ctx.reply("У сервера сейчас нет публичного адреса, панель не откроется.");
  // Без логина и хэша пароля страница откроется, но войти будет нельзя: подсказываем, что задать.
  if (!app.adminEnabled) {
    return ctx.reply("Панель выключена: в .env бота не заданы ADMIN_LOGIN и ADMIN_PASSWORD_HASH.\n" +
      "В папке бота на сервере: npm run admin:password — напечатает строку ADMIN_PASSWORD_HASH=…; " +
      "впишите её и ADMIN_LOGIN=<логин> в .env и перезапустите бота (sudo systemctl restart tgmario).");
  }
  const url = new URL("admin", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`).toString();
  return ctx.reply(`Панель: статистика, игроки, жетоны и покупки. Вход по логину и паролю.\n${url}`, {
    reply_markup: new InlineKeyboard().url("📊 Открыть панель", url),
  });
});

// Жетоны: итоги недели и команды администратора (/wallet, /flag, /unflag, /annul).
installWalletCommands(bot, { economy: app.economy, admins });

bot.command("help", (ctx) =>
  ctx.reply(
    "Управление: кнопки на экране или клавиатура (← →, прыжок Z/пробел, бег X/Shift).\n" +
      "/play — открыть игру\n/me — моя статистика\n/paysupport — помощь с оплатой\n" +
      "Вопрос разработчику можно просто написать сюда.\n\n" +
      `Игра в чате с друзьями: добавьте бота в группу и напишите /play, или в любом чате наберите @${bot.botInfo.username} и выберите игру.`,
  ),
);

// Личные сообщения игроков пересылаются владельцу, его ответы — игрокам (support.js).
// В группах бот молчит на обычные сообщения: игры там зовут через /play и инлайн-режим.
bot.on("message", supportHandler({ admins, playKeyboard }));

bot.catch((err) => console.error("Ошибка бота:", err.error));

// Кнопка меню рядом с полем ввода тоже открывает игру.
await bot.api.setChatMenuButton({
  menu_button: { type: "web_app", text: "Играть", web_app: { url: gameUrl } },
});
// Меню команд: игрокам — игра и своя статистика, владельцу в его чате — все команды.
await bot.api.setMyCommands(PLAYER_COMMANDS);
for (const id of admins) {
  // Если владелец ещё не писал боту, Telegram откажет; меню появится после перезапуска.
  await bot.api.setMyCommands(OWNER_COMMANDS, { scope: { type: "chat", chat_id: id } })
    .catch((err) => console.warn(`Меню владельца не установлено: ${err.description || err.message}`));
}

// Ссылки на счета товаров магазина готовятся заранее (wallet-bot.js), в фоне.
createInvoice.prepare(app.economy.cfg.shop).catch(() => {});

// Список обновлений задаётся явно: без pre_checkout_query покупки за звёзды не проходят (wallet-bot.js).
bot.start({ allowed_updates: ALLOWED_UPDATES, onStart: (me) => console.log(`Бот @${me.username} запущен, игра: ${gameUrl}`) });
