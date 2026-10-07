import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_COMMANDS, PLAYER_COMMANDS, supportHandler } from "../support.js";

const OWNER = 248;
const BOT = 999;

// Поддельный контекст grammY: всё, что бот отправил, складывается в sent.
function chat() {
  const sent = [];
  const api = {
    sendMessage: async (to, text) => { if (to === 13) throw new Error("bot was blocked by the user"); sent.push({ to, text }); return { message_id: sent.length }; },
    copyMessage: async (to, from, id, extra = {}) => { sent.push({ to, copy: id, from, caption: extra.caption }); return { message_id: sent.length }; },
  };
  const ctx = (from, message, type = "private") => ({
    from, chat: { id: from.id, type }, me: { id: BOT }, api, message: { message_id: 50, ...message },
    reply: async (text) => { sent.push({ to: from.id, text }); },
  });
  return { sent, ctx };
}

const ann = { id: 77, first_name: "Аня", username: "anya" };

test("a player's message reaches the owner, and the owner's reply reaches the player", async () => {
  const { sent, ctx } = chat();
  const handle = supportHandler({ admins: new Set([OWNER]) });

  await handle(ctx(ann, { text: "Не пришла покупка" }));
  const toOwner = sent.find((m) => m.to === OWNER);
  assert.match(toOwner.text, /Аня @anya #id77/);
  assert.match(toOwner.text, /Не пришла покупка/);
  assert.match(sent.at(-1).text, /передано разработчику/);

  sent.length = 0;
  const owner = { id: OWNER, first_name: "Валерий" };
  await handle(ctx(owner, { text: "Вернул звёзды", reply_to_message: { from: { id: BOT }, text: toOwner.text } }));
  assert.deepEqual(sent, [
    { to: 77, text: "💬 Ответ разработчика:\n\nВернул звёзды" },
    { to: OWNER, text: "✅ Ответ отправлен игроку." },
  ]);
});

test("photos keep the player mark in the caption; stickers get a separate header", async () => {
  const { sent, ctx } = chat();
  const handle = supportHandler({ admins: new Set([OWNER]) });
  await handle(ctx(ann, { photo: [{}], caption: "скрин" }));
  assert.deepEqual(sent[0], { to: OWNER, copy: 50, from: 77, caption: sent[0].caption });
  assert.match(sent[0].caption, /#id77[\s\S]*скрин/);

  sent.length = 0;
  await handle(ctx(ann, { sticker: {} }));
  assert.match(sent[0].text, /#id77/);
  assert.equal(sent[1].copy, 50);
});

test("owner replies to anything else, unknown commands and spam are not forwarded", async () => {
  const { sent, ctx } = chat();
  const handle = supportHandler({ admins: new Set([OWNER]), perTenMinutes: 2 });
  await handle(ctx(ann, { text: "/stats" }));
  assert.equal(sent.filter((m) => m.to === OWNER).length, 0);
  assert.match(sent.at(-1).text, /Доступные команды/);

  for (let i = 0; i < 3; i++) await handle(ctx(ann, { text: `привет ${i}` }));
  assert.equal(sent.filter((m) => m.to === OWNER).length, 2);
  assert.match(sent.at(-1).text, /Слишком много сообщений/);

  // Ответ не на пересланное сообщение — ничего игрокам не уходит.
  sent.length = 0;
  await handle(ctx({ id: OWNER }, { text: "просто так" }));
  await handle(ctx({ id: OWNER }, { text: "чужое", reply_to_message: { from: { id: 5 }, text: "#id77" } }));
  assert.deepEqual(sent.map((m) => m.to), [OWNER, OWNER]);

  // Игрок заблокировал бота — владелец узнаёт об этом.
  sent.length = 0;
  await handle(ctx({ id: OWNER }, { text: "ответ", reply_to_message: { from: { id: BOT }, text: "✉️ Кто-то #id13" } }));
  assert.match(sent[0].text, /Не доставлено/);
});

test("without an owner set, nothing is forwarded; group chats are ignored", async () => {
  const { sent, ctx } = chat();
  await supportHandler({ admins: new Set() })(ctx(ann, { text: "вопрос" }));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Нажми кнопку/);
  sent.length = 0;
  await supportHandler({ admins: new Set([OWNER]) })(ctx(ann, { text: "в группе" }, "group"));
  assert.equal(sent.length, 0);
});

test("players see only the game and their own stats in the command menu", () => {
  assert.deepEqual(PLAYER_COMMANDS.map((c) => c.command), ["play", "me", "help", "paysupport"]);
  for (const c of ["top", "invite", "stats", "wallet", "flag", "unflag", "annul", "refund"]) {
    assert.ok(OWNER_COMMANDS.some((o) => o.command === c), c);
    assert.ok(!PLAYER_COMMANDS.some((o) => o.command === c), c);
  }
});
