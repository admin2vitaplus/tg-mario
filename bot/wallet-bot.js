import { InlineKeyboard } from "grammy";
import { langOf, seasonOf } from "./economy.js";

// Жетоны в боте (ТЗ P1-7): сообщение с итогами недели и его отключение,
// команды администратора (ADMIN_ID) для проверки игрока, пометки и аннулирования.

// Итоги недели уходят по одному сообщению с паузой, чтобы не упереться в лимиты Telegram.
export const walletNotifier = (bot) => async (userId, text, { offText }) => {
  await bot.api.sendMessage(userId, text, { reply_markup: new InlineKeyboard().text(`🔕 ${offText}`, "wallet:off") });
  await new Promise((ok) => setTimeout(ok, 50));
};

// Счёт в Telegram Stars на товар магазина. Товар выдаётся только после successful_payment.
export const starsInvoice = (bot) => (item, user) => {
  const en = langOf(user.language_code) === "en";
  const life = item.kind === "life";
  return bot.api.createInvoiceLink(
    item[en ? "en" : "ru"].slice(0, 32),
    life ? (en ? "The game goes on from the same place right after payment." :
      "Игра продолжится с того же места сразу после оплаты.") :
      en ? "Looks for the game. It appears in «Looks» right after payment." :
        "Оформление для игры. Появится во «Внешнем виде» сразу после оплаты.",
    item.payload || `shop:${item.id}`,
    "", // Telegram Stars: без платёжного провайдера
    "XTR",
    [{ label: item[en ? "en" : "ru"].slice(0, 32), amount: item.stars }],
  );
};

export function installWalletCommands(bot, { economy, admins }) {
  const id = (s) => (/^\d{1,15}$/.test(s || "") ? Number(s) : null);
  const args = (ctx) => String(ctx.match || "").trim().split(/\s+/).filter(Boolean);
  const admin = (handler) => (ctx, next) => (admins.has(ctx.from?.id) ? handler(ctx) : next());

  // ---------- Telegram Stars ----------
  // Перед списанием звёзд Telegram спрашивает бота, можно ли продать (на ответ есть 10 секунд).
  // Ещё одна жизнь в «Прыг-Скоке»: life:<уровень в мире>:<offer>.
  const lifeOf = (payload) => {
    const m = /^life:(\d{1,2}):([a-z0-9]{8,32})$/.exec(payload);
    return m && { level: Number(m[1]), offer: m[2] };
  };

  bot.on("pre_checkout_query", (ctx) => {
    const q = ctx.preCheckoutQuery;
    const life = lifeOf(q.invoice_payload);
    if (life) {
      const check = q.currency === "XTR" ? economy.lifeCheck(q.from.id, life.offer, life.level, q.total_amount) : { ok: false };
      if (check.ok) return ctx.answerPreCheckoutQuery(true);
      const why = check.error === "already" ? "Эта жизнь уже оплачена." : "Покупка недоступна, вернитесь в игру.";
      return ctx.answerPreCheckoutQuery(false, { error_message: why });
    }
    const m = /^shop:([a-z0-9-]{1,32})$/.exec(q.invoice_payload);
    const check = m && q.currency === "XTR" ? economy.starsCheck(q.from.id, m[1], q.total_amount) : { ok: false };
    if (check.ok) return ctx.answerPreCheckoutQuery(true);
    const why = check.error === "already" ? "Этот товар у вас уже есть." : "Товар недоступен, откройте магазин заново.";
    return ctx.answerPreCheckoutQuery(false, { error_message: why });
  });

  bot.on("message:successful_payment", (ctx) => {
    const p = ctx.message.successful_payment;
    const life = lifeOf(p.invoice_payload);
    if (life && p.currency === "XTR") {
      economy.starsPaid(ctx.from.id, `life:${life.offer}`, p.total_amount, p.telegram_payment_charge_id);
      console.log(`Жизнь за звёзды: ${p.total_amount} ⭐`);
      return ctx.reply(langOf(ctx.from.language_code) === "en"
        ? "Thank you! One more life: go back to the game.\nQuestions about payment: /paysupport"
        : "Спасибо! Ещё одна жизнь добавлена — вернитесь в игру.\nВопросы по оплате — /paysupport");
    }
    const m = /^shop:([a-z0-9-]{1,32})$/.exec(p.invoice_payload);
    if (!m || p.currency !== "XTR") return;
    const item = economy.cfg.shop.find((it) => it.id === m[1]);
    economy.starsPaid(ctx.from.id, m[1], p.total_amount, p.telegram_payment_charge_id);
    console.log(`Покупка за звёзды: ${m[1]}, ${p.total_amount} ⭐`);
    return ctx.reply(langOf(ctx.from.language_code) === "en"
      ? `Thank you! «${item ? item.en : m[1]}» is in the game's Looks now.\nQuestions about payment: /paysupport`
      : `Спасибо! «${item ? item.ru : m[1]}» уже во «Внешнем виде» игры.\nВопросы по оплате — /paysupport`);
  });

  bot.command("paysupport", (ctx) => ctx.reply(langOf(ctx.from?.language_code) === "en"
    ? "Purchases for Stars are looks for the games and one more life in Hop-Skip after the game is over.\n" +
      "If a purchase does not show in the game, close the game and open it again. If that does not help " +
      "or you want a refund, write here what you bought and when: the admin will check and refund the Stars."
    : "За звёзды продаются оформление для игр и ещё одна жизнь в «Прыг-Скоке» после конца игры.\n" +
      "Если покупка не появилась в игре, закройте и откройте игру заново. Если не помогло или нужен возврат, " +
      "напишите сюда, что купили и когда: администратор проверит и вернёт звёзды."));

  // /refund <telegram id> <charge id> — вернуть звёзды; товар у игрока пропадает.
  bot.command("refund", admin(async (ctx) => {
    const [raw, charge] = args(ctx);
    const pid = id(raw);
    const p = charge && economy.purchase(charge);
    if (!pid || !p || p.player_id !== pid) return ctx.reply("Формат: /refund <telegram id> <id платежа из /wallet>");
    try {
      await ctx.api.refundStarPayment(pid, charge);
    } catch (err) {
      return ctx.reply(`Telegram не вернул звёзды: ${err.description || err.message}`);
    }
    economy.refunded(charge);
    return ctx.reply(`Вернул ${p.stars} ⭐ игроку ${pid}, товар «${p.item}» снят.`);
  }));

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
    const paid = economy.purchases(pid).map((p) =>
      `⭐ ${p.stars} ${p.item} ${p.charge_id}${p.refunded_at ? " (возвращено)" : ""}`);
    return ctx.reply([
      `Игрок ${pid}: баланс ${me.balance} (по журналу ${check.ledger})`,
      ...paid,
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
