import { InlineKeyboard } from "grammy";
import { seasonOf } from "./economy.js";

// Жетоны в боте (ТЗ P1-7): сообщение с итогами недели и его отключение,
// команды администратора (ADMIN_ID) для проверки игрока, пометки и аннулирования.

// Итоги недели уходят по одному сообщению с паузой, чтобы не упереться в лимиты Telegram.
export const walletNotifier = (bot) => async (userId, text, { offText }) => {
  await bot.api.sendMessage(userId, text, { reply_markup: new InlineKeyboard().text(`🔕 ${offText}`, "wallet:off") });
  await new Promise((ok) => setTimeout(ok, 50));
};

export function installWalletCommands(bot, { economy, admins }) {
  const id = (s) => (/^\d{1,15}$/.test(s || "") ? Number(s) : null);
  const args = (ctx) => String(ctx.match || "").trim().split(/\s+/).filter(Boolean);
  const admin = (handler) => (ctx, next) => (admins.has(ctx.from?.id) ? handler(ctx) : next());

  bot.callbackQuery("wallet:off", async (ctx) => {
    economy.setNotify(ctx.from.id, false);
    await ctx.answerCallbackQuery();
    return ctx.reply("Итоги недели больше не придут. Включить снова — /weekly");
  });

  bot.command("weekly", (ctx) => {
    economy.setNotify(ctx.from.id, true);
    return ctx.reply("Итоги недели снова будут приходить по понедельникам.");
  });

  // /wallet <id> — баланс, пометка и последние операции игрока.
  bot.command("wallet", admin((ctx) => {
    const pid = id(args(ctx)[0]);
    if (!pid) return ctx.reply("Формат: /wallet <telegram id>");
    const me = economy.me(pid);
    const check = economy.checkBalance(pid);
    const w = economy.wallet(pid);
    const lines = me.history.slice(0, 15).map((h) =>
      `${new Date(h.at).toISOString().slice(0, 16).replace("T", " ")} ${h.amount > 0 ? "+" : ""}${h.amount} ${h.reason} ${h.event}`);
    return ctx.reply([
      `Игрок ${pid}: баланс ${me.balance} (по журналу ${check.ledger})`,
      w.flagged ? `⚠️ Помечен: ${w.flagged}` : "Не помечен",
      "",
      ...(lines.length ? lines : ["Операций нет"]),
    ].join("\n"));
  }));

  // /flag <id> [причина] — помеченному не начисляется ничего, в призы недели он не попадает.
  bot.command("flag", admin((ctx) => {
    const [raw, ...why] = args(ctx);
    const pid = id(raw);
    if (!pid) return ctx.reply("Формат: /flag <telegram id> [причина]");
    economy.flag(pid, why.join(" ") || "admin");
    return ctx.reply(`Игрок ${pid} помечен. Аннулировать полученное за неделю: /annul ${pid}`);
  }));

  bot.command("unflag", admin((ctx) => {
    const pid = id(args(ctx)[0]);
    if (!pid) return ctx.reply("Формат: /unflag <telegram id>");
    economy.unflag(pid);
    return ctx.reply(`Пометка с игрока ${pid} снята.`);
  }));

  // /annul <id> [сезон] — всё полученное за сезон снимается одной отрицательной записью в журнале.
  bot.command("annul", admin((ctx) => {
    const [raw, rawSeason] = args(ctx);
    const pid = id(raw);
    const season = rawSeason ? id(rawSeason) : seasonOf(Date.now());
    if (!pid || season == null) return ctx.reply("Формат: /annul <telegram id> [номер сезона]");
    const n = economy.annul(pid, season);
    return ctx.reply(n ? `Аннулировано ${-n} у игрока ${pid} за сезон ${season}. Баланс: ${economy.me(pid).balance}`
      : `За сезон ${season} у игрока ${pid} аннулировать нечего.`);
  }));
}
