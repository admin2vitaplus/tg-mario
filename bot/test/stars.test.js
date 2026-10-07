import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { Bot } from "grammy";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, loadEconomy } from "../economy.js";
import { ALLOWED_UPDATES, installWalletCommands, starsInvoice } from "../wallet-bot.js";
import { supportHandler } from "../support.js";

// Покупка за Telegram Stars целиком: счёт → проверка перед оплатой → оплата → товар у игрока.
// Telegram подменён: вызовы API записываются, обновления подаются в настоящие обработчики бота.

const CFG = loadEconomy();
const TOKEN = "123456:TEST";
const BOT_INFO = { id: 1, is_bot: true, first_name: "Бот", username: "test_bot", can_join_groups: true,
  can_read_all_group_messages: false, supports_inline_queries: true };
const player = { id: 5, is_bot: false, first_name: "Ева", language_code: "ru" };

function setup({ invoiceError = null } = {}) {
  const store = openDb(":memory:");
  const economy = createEconomy(store, CFG);
  const bot = new Bot(TOKEN, { botInfo: BOT_INFO });
  const calls = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (method === "createInvoiceLink" && invoiceError) throw Object.assign(new Error("Bad Request"), { description: invoiceError });
    return { ok: true, result: method === "createInvoiceLink" ? `https://t.me/$inv${calls.length}` : true };
  });
  installWalletCommands(bot, { economy, admins: new Set([9]) });
  // Как в index.js: обычные сообщения после команд жетонов уходят владельцу.
  bot.on("message", supportHandler({ admins: new Set([9]) }));
  let id = 0;
  const send = (update) => bot.handleUpdate({ update_id: ++id, ...update });
  const preCheckout = (payload, amount, currency = "XTR") => send({ pre_checkout_query: {
    id: `q${id}`, from: player, currency, total_amount: amount, invoice_payload: payload } });
  const paid = (payload, amount, charge) => send({ message: {
    message_id: id, date: 1, chat: { id: player.id, type: "private", first_name: player.first_name }, from: player,
    successful_payment: { currency: "XTR", total_amount: amount, invoice_payload: payload,
      telegram_payment_charge_id: charge, provider_payment_charge_id: "" } } });
  return { store, economy, bot, calls, preCheckout, paid };
}

const last = (calls, method) => calls.filter((c) => c.method === method).at(-1);

test("Stars: the bot takes every update type it handles, pre_checkout_query among them", () => {
  assert.ok(ALLOWED_UPDATES.includes("pre_checkout_query"));
  const src = ["../index.js", "../wallet-bot.js"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  const used = new Set([...src.matchAll(/bot\.on\("([a-z_]+)/g)].map((m) => m[1]));
  if (/bot\.command\(/.test(src)) used.add("message");
  if (/bot\.callbackQuery\(/.test(src)) used.add("callback_query");
  for (const type of used) assert.ok(ALLOWED_UPDATES.includes(type), `${type} is handled but not asked from Telegram`);
  const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(index, /bot\.start\(\{[^}]*allowed_updates: ALLOWED_UPDATES/);
});

test("Stars: shop item — invoice, pre-checkout yes, payment hands the item over once", async () => {
  const { economy, bot, calls, preCheckout, paid } = setup();
  const item = CFG.shop[0];
  const link = await starsInvoice(bot)(economy.starsCheck(player.id, item.id).item, player);
  assert.match(link, /^https:\/\/t\.me\/\$/);
  const inv = last(calls, "createInvoiceLink").payload;
  assert.equal(inv.currency, "XTR");
  assert.equal(inv.provider_token, "");
  assert.equal(inv.payload, `shop:${item.id}`);
  assert.deepEqual(inv.prices.map((p) => p.amount), [item.stars]);
  assert.ok(inv.title.length <= 32 && inv.description.length <= 255);

  await preCheckout(inv.payload, item.stars);
  assert.equal(last(calls, "answerPreCheckoutQuery").payload.ok, true);
  await paid(inv.payload, item.stars, "ch1");
  assert.deepEqual(economy.me(player.id).owned, [item.id]);
  assert.match(last(calls, "sendMessage").payload.text, /Спасибо/);
  // Оплата не уходит владельцу как сообщение игрока.
  assert.ok(!calls.some((c) => c.payload.chat_id === 9));
  // Повтор того же платежа ничего не добавит, а вторая покупка того же товара не пройдёт проверку.
  await paid(inv.payload, item.stars, "ch1");
  assert.equal(economy.purchases(player.id).length, 1);
  await preCheckout(inv.payload, item.stars);
  const no = last(calls, "answerPreCheckoutQuery").payload;
  assert.equal(no.ok, false);
  assert.equal(no.error_message, "Этот товар у вас уже есть.");
});

test("Stars: pre-checkout says no to a changed price, other currency or unknown payload", async () => {
  const { calls, preCheckout } = setup();
  const item = CFG.shop[0];
  for (const [payload, amount, currency] of [[`shop:${item.id}`, item.stars + 1], [`shop:${item.id}`, item.stars, "USD"], ["shop:nope", 1], ["junk", 1]]) {
    await preCheckout(payload, amount, currency);
    const a = last(calls, "answerPreCheckoutQuery").payload;
    assert.equal(a.ok, false, payload);
    assert.ok(a.error_message);
  }
});

test("Stars: one more life in Hop-Skip — payload, price by level, paid once", async () => {
  const { economy, bot, calls, preCheckout, paid } = setup();
  const offer = "abcdef0123456789";
  const level = 2;
  await starsInvoice(bot)(economy.lifeCheck(player.id, offer, level).item, player);
  const inv = last(calls, "createInvoiceLink").payload;
  assert.equal(inv.payload, `life:${level}:${offer}`);
  assert.deepEqual(inv.prices.map((p) => p.amount), [CFG.life.stars[level]]);
  await preCheckout(inv.payload, CFG.life.stars[level]);
  assert.equal(last(calls, "answerPreCheckoutQuery").payload.ok, true);
  await paid(inv.payload, CFG.life.stars[level], "ch_life");
  assert.equal(economy.purchases(player.id).length, 1);
  await preCheckout(inv.payload, CFG.life.stars[level]);
  assert.equal(last(calls, "answerPreCheckoutQuery").payload.ok, false);
});

function initData(u) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(u) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

test("Stars over HTTP: the game gets the link; a Telegram refusal is 502 «invoice failed», not 500", async () => {
  for (const invoiceError of [null, "Bad Request: STARS_INVOICE_INVALID"]) {
    const { store, economy, bot } = setup({ invoiceError });
    const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["https://game.example"], economy, createInvoice: starsInvoice(bot) });
    await new Promise((ok) => server.listen(0, ok));
    const errors = [];
    const was = console.error;
    console.error = (...a) => errors.push(a.join(" "));
    try {
      const call = (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: "POST", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", Origin: "https://game.example", Authorization: `tma ${initData(player)}` },
      }).then(async (r) => ({ status: r.status, cors: r.headers.get("access-control-allow-origin"), json: await r.json() }));
      for (const [path, body] of [["/api/wallet/invoice", { item: CFG.shop[0].id }], ["/api/wallet/life-invoice", { offer: "abcdef0123456789", level: 0 }]]) {
        const r = await call(path, body);
        assert.equal(r.cors, "https://game.example");
        if (invoiceError) {
          assert.equal(r.status, 502);
          assert.deepEqual(r.json, { error: "invoice failed" });
        } else {
          assert.equal(r.status, 200);
          assert.match(r.json.link, /^https:\/\/t\.me\/\$/);
        }
      }
      if (invoiceError) assert.ok(errors.some((e) => e.includes("STARS_INVOICE_INVALID")), "the reason is in the bot's log");
    } finally {
      console.error = was;
      await new Promise((ok) => server.close(ok));
    }
  }
});
