import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, loadEconomy, DAY_MS } from "../economy.js";
import { createWord, loadDictionaries, marks, streaks, scoreOf, FIRST_DAY, LANGS } from "../word.js";

const TOKEN = "123456:TEST";

function initData(user, authDate, extra = {}) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "q", user: JSON.stringify(user), ...extra });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

const dict = loadDictionaries();

// Сервер с жетонами и «Словом дня»; часы подменяются, чтобы переходить через полночь.
async function withServer(fn) {
  const store = openDb(":memory:");
  const clock = { t: (FIRST_DAY + 10) * DAY_MS + 3600_000 };
  const now = () => clock.t;
  const economy = createEconomy(store, loadEconomy(), { now });
  const word = createWord(store, { dict, economy, now });
  const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["*"], economy, word, now });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body, chat } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (user) headers.Authorization = `tma ${initData(user, Math.floor(clock.t / 1000), chat ? { chat_instance: chat, chat_type: "group" } : {})}`;
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  try {
    await fn({ call, clock, word, economy, store });
  } finally {
    server.close();
    store.close();
  }
}

const alice = { id: 1, first_name: "Алиса", language_code: "ru" };
const bob = { id: 2, first_name: "Боб", language_code: "ru" };
const carol = { id: 3, first_name: "Карина", language_code: "ru" };
// Допустимое слово, которое не равно ответу.
const wrong = (lang, answer, n = 0) => [...dict[lang].allowed].filter((w) => w !== answer)[n];

test("dictionaries: words of the day are 5 letters, have no forbidden words and are allowed guesses", () => {
  for (const lang of LANGS) {
    const { answers, allowed } = dict[lang];
    assert.ok(answers.length >= 365, `${lang}: ${answers.length} words of the day — less than a year`);
    for (const w of answers) {
      assert.equal([...w].length, 5, w);
      assert.ok(allowed.has(w), w);
    }
    assert.ok(allowed.size > answers.length * 5, `${lang}: too few allowed guesses`);
  }
  // Слова, запрещённые правилами жетонов (ТЗ P1-7), не бывают словом дня.
  for (const bad of ["вывод", "token", "монет"]) {
    assert.ok(!dict.ru.answers.includes(bad) && !dict.en.answers.includes(bad), bad);
  }
});

test("marks: right place, wrong place and repeated letters", () => {
  assert.equal(marks("книга", "книга"), "22222");
  assert.equal(marks("книга", "агнец"), "11100");
  assert.equal(marks("apple", "paper"), "11210");
  // Лишняя повторная буква не подсвечивается: в ответе одна «l».
  assert.equal(marks("plant", "label"), "11000");
  assert.equal(marks("plant", "llama"), "02200");
  assert.equal(marks("abbey", "babes"), "11220");
});

test("streaks count days in a row, ending today or yesterday", () => {
  assert.deepEqual(streaks([], 10), { current: 0, best: 0 });
  assert.deepEqual(streaks([10, 9, 8, 5, 4], 10), { current: 3, best: 3 });
  assert.deepEqual(streaks([9, 8], 10), { current: 2, best: 2 });
  assert.deepEqual(streaks([8, 7, 6, 5], 10), { current: 0, best: 4 });
  assert.equal(scoreOf(true, 1), 6);
  assert.equal(scoreOf(true, 6), 1);
  assert.equal(scoreOf(false, 6), 0);
});

test("the word of the day is the same for everyone, is kept, and does not repeat in a round", () => {
  const store = openDb(":memory:");
  const clock = { t: FIRST_DAY * DAY_MS };
  const small = { ru: { answers: ["книга", "слово", "песня"], allowed: new Set(["книга", "слово", "песня"]) }, en: dict.en };
  const word = createWord(store, { dict: small, now: () => clock.t });
  const seen = [];
  for (let d = 0; d < 3; d++) {
    const a = word.answerOf("ru", FIRST_DAY + d);
    assert.equal(word.answerOf("ru", FIRST_DAY + d), a, "the same answer on a second request");
    seen.push(a);
  }
  assert.deepEqual([...seen].sort(), ["книга", "песня", "слово"], "no repeats until the list is used up");
  assert.ok(small.ru.answers.includes(word.answerOf("ru", FIRST_DAY + 3)));
  store.close();
});

test("a game: the answer stays on the server until the end, six tries, a win gives points and жетоны", () =>
  withServer(async ({ call, word }) => {
    const r0 = await call("GET", "/api/word/today?lang=ru", { user: alice });
    assert.equal(r0.status, 200);
    assert.equal(r0.json.state, "play");
    assert.equal(r0.json.answer, null);
    assert.equal(r0.json.number, 11);
    const answer = word.answerOf("ru", r0.json.day);
    assert.ok(!JSON.stringify(r0.json).includes(answer), "the answer is not sent before the end");

    // Не слово и не 5 букв — попытка не тратится.
    assert.equal((await call("POST", "/api/word/guess", { user: alice, body: { lang: "ru", word: "ыыыыы", day: r0.json.day } })).status, 422);
    assert.equal((await call("POST", "/api/word/guess", { user: alice, body: { lang: "ru", word: "кот" } })).status, 400);

    const g1 = await call("POST", "/api/word/guess", { user: alice, body: { lang: "ru", word: wrong("ru", answer), day: r0.json.day } });
    assert.equal(g1.status, 200);
    assert.equal(g1.json.guesses.length, 1);
    assert.equal(g1.json.answer, null);
    assert.equal(g1.json.wallet, undefined, "no жетоны before the end");
    // Повтор той же попытки не тратит ход.
    assert.equal((await call("POST", "/api/word/guess", { user: alice, body: { lang: "ru", word: wrong("ru", answer) } })).status, 422);

    const win = await call("POST", "/api/word/guess", { user: alice, body: { lang: "ru", word: answer.toUpperCase() } });
    assert.equal(win.status, 200);
    assert.equal(win.json.state, "won");
    assert.equal(win.json.score, 5);
    assert.equal(win.json.answer, answer);
    assert.equal(win.json.guesses[1].marks, "22222");
    assert.equal(win.json.streak, 1);
    const reasons = win.json.wallet.grants.map((g) => g.reason);
    assert.deepEqual(reasons, ["task", "task"], "play and solve tasks");

    // После конца — ни одной попытки больше.
    assert.equal((await call("POST", "/api/word/guess", { user: alice, body: { lang: "ru", word: wrong("ru", answer, 3) } })).status, 409);

    // Задания «Слова дня» в «◆ Жетоны» отмечены, игра видна в таблице недели.
    const me = await call("GET", "/api/wallet/me", { user: alice });
    assert.deepEqual(me.json.tasks.word.filter((t) => t.done).map((t) => t.id), ["play", "level"]);
    const top = await call("GET", "/api/wallet/top?board=word&period=week", { user: alice });
    assert.deepEqual(top.json.me, { place: 1, value: 5 });
  }));

test("six wrong tries lose the day; the answer is shown then", () =>
  withServer(async ({ call, word }) => {
    const day = (await call("GET", "/api/word/today?lang=en", { user: bob })).json.day;
    const answer = word.answerOf("en", day);
    let r;
    for (let i = 0; i < 6; i++) {
      r = await call("POST", "/api/word/guess", { user: bob, body: { lang: "en", word: wrong("en", answer, i), day } });
      assert.equal(r.status, 200);
    }
    assert.equal(r.json.state, "lost");
    assert.equal(r.json.score, 0);
    assert.equal(r.json.answer, answer);
    assert.deepEqual(r.json.wallet.grants.map((g) => g.reason), ["task"], "only «play», no «solve»");
  }));

test("a guess sent for yesterday's word after midnight is refused, the new day starts clean", () =>
  withServer(async ({ call, clock }) => {
    const day = (await call("GET", "/api/word/today?lang=ru", { user: alice })).json.day;
    clock.t += DAY_MS;
    const r = await call("POST", "/api/word/guess", { user: alice, body: { lang: "ru", word: "книга", day } });
    assert.equal(r.status, 409);
    assert.equal(r.json.day, day + 1);
  }));

test("the chat table shows who played from this chat; the week sums the best result of each day", () =>
  withServer(async ({ call, word, clock }) => {
    const chat = "-4815162342";
    const solve = async (user, lang, tries, from = chat) => {
      const chat = from;
      const day = (await call("GET", `/api/word/today?lang=${lang}`, { user, chat })).json.day;
      const answer = word.answerOf(lang, day);
      for (let i = 0; i < tries - 1; i++) {
        await call("POST", "/api/word/guess", { user, chat, body: { lang, word: wrong(lang, answer, i), day } });
      }
      return call("POST", "/api/word/guess", { user, chat, body: { lang, word: answer, day } });
    };
    await solve(alice, "ru", 2); // 5 очков
    await solve(alice, "en", 1); // 6 очков: в зачёт дня идёт лучший
    await solve(bob, "ru", 4);   // 3 очка
    await solve(carol, "ru", 1, "777"); // играла из другого чата

    let r = await call("GET", "/api/word/chat", { user: alice, chat });
    assert.equal(r.json.chat, true);
    assert.deepEqual(r.json.today.map((p) => [p.name, p.score, p.me]), [["Алиса", 6, true], ["Боб", 3, false]]);
    assert.deepEqual(r.json.week.map((p) => [p.place, p.name, p.value]), [[1, "Алиса", 6], [2, "Боб", 3]]);

    // Следующий день той же недели (вторник → среда): суммы растут.
    clock.t += DAY_MS;
    await solve(bob, "ru", 1);
    r = await call("GET", "/api/word/chat", { user: bob, chat });
    assert.deepEqual(r.json.today.map((p) => p.name), ["Боб"]);
    assert.deepEqual(r.json.week.map((p) => [p.name, p.value]), [["Боб", 9], ["Алиса", 6]]);

    // Без чата — пустая таблица, а не ошибка.
    r = await call("GET", "/api/word/chat", { user: carol });
    assert.deepEqual(r.json, { chat: false, today: [], week: [] });
  }));

test("a weekly prize table exists for the word game and closing the week pays it", async () => {
  const store = openDb(":memory:");
  const clock = { t: (FIRST_DAY + 2) * DAY_MS };
  const economy = createEconomy(store, loadEconomy(), { now: () => clock.t });
  const word = createWord(store, { dict, economy, now: () => clock.t });
  await economy.closeDue();
  const day = word.today();
  word.guess(alice.id, "ru", word.answerOf("ru", day), { day });
  clock.t += 8 * DAY_MS;
  await economy.closeDue();
  const row = store.db.prepare("SELECT * FROM season_places WHERE board = 'word'").get();
  assert.equal(row.player_id, alice.id);
  assert.equal(row.value, 6);
  assert.equal(row.prize, loadEconomy().season.boards.word[0]);
  store.close();
});

test("a shared result link counts as an invite and opens the game", async () => {
  const { parseStart } = await import("../stats.js");
  assert.deepEqual(parseStart("ref_42-word__abc-def"), { source: "ref", ref: "42" });
  assert.deepEqual(parseStart("src_word"), { source: "src_word", ref: null });
  assert.deepEqual(parseStart("src_vk-ads"), { source: "src_vk-ads", ref: null });
});
