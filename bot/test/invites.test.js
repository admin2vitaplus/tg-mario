import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME_LINKS, appLink, groupPlay, inlineResults } from "../invites.js";
import { parseStart } from "../stats.js";

const api = "https://quiet-river-sound-test.trycloudflare.com";

test("links open the collection from a chat, carry the inviter and the tunnel", () => {
  assert.equal(appLink("cart_bot", "ref_7-word", api), "https://t.me/cart_bot?startapp=ref_7-word__quiet-river-sound-test");
  assert.equal(appLink("cart_bot", "word", ""), "https://t.me/cart_bot?startapp=word");
  assert.equal(appLink("cart_bot", "word", "https://scores.example.org"), "https://t.me/cart_bot?startapp=word");
  // Длиннее 64 символов Telegram не примет: туннель отбрасывается.
  const long = "https://" + "a".repeat(60) + ".trycloudflare.com";
  assert.equal(appLink("b", "ref_123456789012-word", long), "https://t.me/b?startapp=ref_123456789012-word");
  // Статистика видит в такой ссылке приглашение от игрока 7.
  assert.deepEqual(parseStart("ref_7-word__quiet-river-sound-test"), { source: "ref", ref: "7" });
  assert.deepEqual(parseStart("ref_7-tanks"), { source: "ref", ref: "7" });
});

test("inline mode offers every game in the player's language and filters by the query", () => {
  const ru = inlineResults({ botName: "cart_bot", apiUrl: api, userId: 7, languageCode: "ru", query: "" });
  assert.deepEqual(ru.map((r) => r.id), GAME_LINKS.map((g) => g.start));
  for (const r of ru) {
    assert.equal(r.type, "article");
    assert.ok(r.input_message_content.message_text.length > 10);
    assert.match(r.reply_markup.inline_keyboard[0][0].url, new RegExp(`startapp=ref_7-${r.id}__quiet`));
  }
  assert.match(ru[0].title, /Слово дня/);
  const en = inlineResults({ botName: "cart_bot", apiUrl: api, userId: 7, languageCode: "en-US", query: "tank" });
  assert.deepEqual(en.map((r) => r.id), ["tanks"]);
  assert.match(en[0].title, /Tank Field/);
  assert.deepEqual(inlineResults({ botName: "b", userId: 1, query: "слово" }).map((r) => r.id), ["word"]);
});

test("/play in a group gives a link button for every game", () => {
  const p = groupPlay({ botName: "cart_bot", apiUrl: "", userId: 9, languageCode: "ru" });
  const urls = p.reply_markup.inline_keyboard.map((row) => row[0].url);
  assert.deepEqual(urls, GAME_LINKS.map((g) => `https://t.me/cart_bot?startapp=ref_9-${g.start}`));
  const anon = groupPlay({ botName: "cart_bot", apiUrl: "" });
  assert.equal(anon.reply_markup.inline_keyboard[0][0].url, "https://t.me/cart_bot?startapp=word");
});

test("every game the bot links to opens straight from the menu (start in web/config.js)", () => {
  const config = readFileSync(new URL("../../web/config.js", import.meta.url), "utf8");
  for (const g of GAME_LINKS) assert.match(config, new RegExp(`start: '${g.start}'`), g.start);
});

test("no forbidden or outside names in the invite texts", () => {
  // «mario» — только служебный ключ start, в текстах его нет.
  const texts = GAME_LINKS.map((g) => JSON.stringify([g.ru, g.en])).join(" ").toLowerCase();
  for (const bad of ["mario", "nintendo", "dendy", "battle city", "wordle", "крипт", "монет", "токен", "заработ"]) {
    assert.ok(!texts.includes(bad), bad);
  }
});
