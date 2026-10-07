import { createRateLimiter } from "./ratelimit.js";

// Сообщения игроков владельцу и ответы им.
// Игрок пишет боту в личку → владельцу (ADMIN_ID) приходит сообщение с пометкой «#id<игрок>».
// Владелец отвечает на это сообщение (свайп или «Ответить») → бот отправляет ответ игроку.
// Пометка хранится в самом сообщении, поэтому ответы работают и после перезапуска бота;
// в базе и в логах тексты не сохраняются.

const MARK = /#id(\d{1,15})\b/;
// Что можно переслать; служебные сообщения (оплата, закреп и т. п.) не трогаем.
const WITH_CAPTION = ["photo", "video", "document", "audio", "voice", "animation"];
const OTHER = ["sticker", "video_note", "location", "contact"];

export const PLAYER_COMMANDS = [
  { command: "play", description: "Открыть игру" },
  { command: "me", description: "Моя статистика" },
  { command: "help", description: "Как играть" },
  { command: "paysupport", description: "Помощь с оплатой" },
];

export const OWNER_COMMANDS = [
  ...PLAYER_COMMANDS,
  { command: "top", description: "Таблица рекордов" },
  { command: "invite", description: "Ссылка-приглашение" },
  { command: "stats", description: "Статистика игр" },
  { command: "wallet", description: "Жетоны игрока: /wallet <id>" },
  { command: "flag", description: "Пометить игрока: /flag <id>" },
  { command: "unflag", description: "Снять пометку: /unflag <id>" },
  { command: "annul", description: "Аннулировать жетоны: /annul <id>" },
  { command: "refund", description: "Вернуть звёзды: /refund <id> <платёж>" },
];

const nameOf = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ").slice(0, 64) || "Игрок";

export function supportHandler({ admins, playKeyboard = () => undefined, perTenMinutes = 5, now = Date.now }) {
  const limiter = createRateLimiter({ limit: perTenMinutes, windowMs: 10 * 60_000, now });

  const toOwner = async (ctx, ownerId) => {
    const m = ctx.message;
    const u = ctx.from;
    const head = `✉️ ${nameOf(u)}${u.username ? ` @${u.username}` : ""} #id${u.id}\n` +
      "Ответьте на это сообщение, чтобы ответить игроку.";
    if (m.text) return ctx.api.sendMessage(ownerId, `${head}\n\n${m.text}`);
    if (WITH_CAPTION.some((k) => m[k])) {
      return ctx.api.copyMessage(ownerId, ctx.chat.id, m.message_id, { caption: `${head}${m.caption ? `\n\n${m.caption}` : ""}` });
    }
    await ctx.api.sendMessage(ownerId, head);
    return ctx.api.copyMessage(ownerId, ctx.chat.id, m.message_id);
  };

  const fromPlayer = async (ctx) => {
    const m = ctx.message;
    if (m.text?.startsWith("/")) {
      return ctx.reply("Доступные команды: /play — игра, /me — моя статистика, /help — как играть, " +
        "/paysupport — помощь с оплатой.\nВопрос можно просто написать сюда.", { reply_markup: playKeyboard() });
    }
    const supported = m.text || WITH_CAPTION.some((k) => m[k]) || OTHER.some((k) => m[k]);
    if (!admins.size || !supported) return ctx.reply("Нажми кнопку, чтобы играть:", { reply_markup: playKeyboard() });
    if (!limiter.take(ctx.from.id)) {
      return ctx.reply("Слишком много сообщений подряд. Подождите немного и напишите ещё раз.");
    }
    let delivered = 0;
    for (const ownerId of admins) {
      try {
        await toOwner(ctx, ownerId);
        delivered++;
      } catch (err) {
        console.warn(`Не удалось переслать сообщение игрока владельцу: ${err.description || err.message}`);
      }
    }
    return ctx.reply(delivered
      ? "Сообщение передано разработчику. Ответ придёт сюда, в этот чат."
      : "Не получилось передать сообщение, попробуйте позже.", { reply_markup: playKeyboard() });
  };

  // Ответ владельца: reply на сообщение бота с пометкой #id.
  const fromOwner = async (ctx) => {
    const r = ctx.message.reply_to_message;
    const mark = r && r.from?.id === ctx.me.id && MARK.exec(r.text || r.caption || "");
    if (!mark) return ctx.reply("Нажми кнопку, чтобы играть:", { reply_markup: playKeyboard() });
    const playerId = Number(mark[1]);
    try {
      if (ctx.message.text) await ctx.api.sendMessage(playerId, `💬 Ответ разработчика:\n\n${ctx.message.text}`);
      else await ctx.api.copyMessage(playerId, ctx.chat.id, ctx.message.message_id);
    } catch (err) {
      return ctx.reply(`Не доставлено: ${err.description || err.message}`);
    }
    return ctx.reply("✅ Ответ отправлен игроку.");
  };

  // Личные сообщения, до которых не дошли команды и оплата.
  return (ctx) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return undefined;
    return admins.has(ctx.from.id) ? fromOwner(ctx) : fromPlayer(ctx);
  };
}
