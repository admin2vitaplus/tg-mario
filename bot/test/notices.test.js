import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createAdmin } from "../admin.js";
import { createAdminAuth, hashPassword } from "../admin-auth.js";
import { createNotices, telegramText } from "../notices.js";

const TOKEN = "123456:TEST";
const PASSWORD = "очень-секретный пароль";
const HASH = hashPassword(PASSWORD);
const OWNER = { owner: true };
const alice = { id: 1, first_name: "Алиса" };
const bob = { id: 2, first_name: "Bob", language_code: "en" };

function initData(user) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "q", user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function withServer(fn, { message = null } = {}) {
  const store = openDb(":memory:");
  const auth = createAdminAuth({ login: "owner", passwordHash: HASH });
  const notices = createNotices(store);
  const admin = createAdmin({ store, auth, notices, message, logger: () => {} });
  const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["https://game.example"], admin, notices });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  let session = null;
  const call = async (method, path, { user, body } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (user === OWNER) {
      session ??= (await (await fetch(base + "/api/admin/login", {
        method: "POST", headers, body: JSON.stringify({ login: "owner", password: PASSWORD }),
      })).json()).token;
      headers.Authorization = `Admin ${session}`;
    } else if (user) headers.Authorization = `tma ${initData(user)}`;
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    store.touchPlayer(alice);
    store.touchPlayer(bob);
    await fn({ call, store, notices });
  } finally {
    server.close();
    store.close();
  }
}

let n = 0;
const key = () => `key${String(++n).padStart(6, "0")}`;

test("general notices reach everyone, personal ones only their player", () =>
  withServer(async ({ call }) => {
    let r = await call("POST", "/api/admin/notice", { user: OWNER, body: { kind: "update", title: "Новый мир", body: "Мир 9 открыт", titleEn: "New world", key: key() } });
    assert.equal(r.status, 200);
    r = await call("POST", "/api/admin/notice", { user: OWNER, body: { kind: "news", player: 1, title: "Алисе", body: "Только тебе", key: key() } });
    assert.equal(r.status, 200);

    const a = (await call("GET", "/api/notices", { user: alice })).json;
    assert.deepEqual(a.items.map((i) => [i.kind, i.title]), [["personal", "Алисе"], ["update", "Новый мир"]]);
    assert.equal(a.unread, 2);
    // Английский текст — тем, кто его просит; нет английского — русский.
    const b = (await call("GET", "/api/notices?lang=en", { user: bob })).json;
    assert.deepEqual(b.items.map((i) => [i.title, i.body]), [["New world", "Мир 9 открыт"]]);
    assert.equal(b.unread, 1);
    assert.equal((await call("GET", "/api/notices")).status, 401);
  }));

test("reading marks everything up to the newest; new notices are unread again", () =>
  withServer(async ({ call }) => {
    await call("POST", "/api/admin/notice", { user: OWNER, body: { kind: "news", title: "1", key: key() } });
    const first = (await call("GET", "/api/notices", { user: alice })).json;
    let r = await call("POST", "/api/notices/read", { user: alice, body: { upTo: first.items[0].id + 100 } });
    assert.deepEqual(r.json, { seen: first.items[0].id, unread: 0 });
    // Прочитанное назад не откатывается.
    r = await call("POST", "/api/notices/read", { user: alice, body: { upTo: 0 } });
    assert.equal(r.json.seen, first.items[0].id);
    assert.equal((await call("POST", "/api/notices/read", { user: alice, body: { upTo: "x" } })).status, 400);
    await call("POST", "/api/admin/notice", { user: OWNER, body: { kind: "update", title: "2", key: key() } });
    assert.equal((await call("GET", "/api/notices", { user: alice })).json.unread, 1);
    // У Боба своё: он ничего не открывал.
    assert.equal((await call("GET", "/api/notices", { user: bob })).json.unread, 2);
  }));

test("the panel: checks, one notice per form key, hiding, Telegram copy of a personal one", async () => {
  const sent = [];
  await withServer(async ({ call }) => {
    assert.equal((await call("POST", "/api/admin/notice", { user: alice, body: { kind: "news", title: "x", key: key() } })).status, 401);
    assert.equal((await call("POST", "/api/admin/notice", { user: OWNER, body: { kind: "news", title: "", body: " ", key: key() } })).status, 400);
    assert.equal((await call("POST", "/api/admin/notice", { user: OWNER, body: { kind: "spam", title: "x", key: key() } })).status, 400);
    assert.equal((await call("POST", "/api/admin/notice", { user: OWNER, body: { kind: "news", title: "x" } })).status, 400);
    assert.equal((await call("POST", "/api/admin/notice", { user: OWNER, body: { title: "x", player: 999, key: key() } })).status, 404);

    const k = key();
    const body = { player: 2, title: "Hi", body: "Привет", bodyEn: "Hello", telegram: true, key: k };
    const r1 = await call("POST", "/api/admin/notice", { user: OWNER, body });
    const r2 = await call("POST", "/api/admin/notice", { user: OWNER, body });
    assert.deepEqual(r1.json, r2.json);
    assert.equal(r1.json.telegram, "sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 2);
    assert.match(sent[0][1], /^🔔 Hi\n\nПривет$/);

    let list = (await call("GET", "/api/admin/notices", { user: OWNER })).json;
    assert.equal(list.telegram, true);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].read, false);
    await call("GET", "/api/notices", { user: bob });
    await call("POST", "/api/notices/read", { user: bob, body: { upTo: r1.json.id } });
    list = (await call("GET", "/api/admin/notices", { user: OWNER })).json;
    assert.equal(list.items[0].read, true);

    const h = await call("POST", "/api/admin/notice/hide", { user: OWNER, body: { id: r1.json.id } });
    assert.deepEqual(h.json, { ok: true, hidden: true });
    assert.deepEqual((await call("GET", "/api/notices", { user: bob })).json.items, []);
    assert.ok((await call("GET", "/api/admin/notices", { user: OWNER })).json.items[0].hiddenAt);
  }, { message: async (id, text) => { sent.push([id, text]); } });
});

test("a failed Telegram copy still keeps the notice in the game", () =>
  withServer(async ({ call }) => {
    const r = await call("POST", "/api/admin/notice", { user: OWNER, body: { player: 1, title: "x", telegram: true, key: key() } });
    assert.equal(r.json.telegram, "failed");
    assert.equal((await call("GET", "/api/notices", { user: alice })).json.items.length, 1);
  }, { message: async () => { throw Object.assign(new Error("blocked"), { description: "Forbidden: bot was blocked by the user" }); } }));

test("long texts fit, longer ones are cut", () =>
  withServer(async ({ call }) => {
    const r = await call("POST", "/api/admin/notice", { user: OWNER, body: {
      kind: "update", title: "З".repeat(200), body: "Ж".repeat(2500), titleEn: "T", bodyEn: "B".repeat(2000), key: key(),
    } });
    assert.equal(r.status, 200);
    const item = (await call("GET", "/api/notices", { user: alice })).json.items[0];
    assert.equal(item.title.length, 80);
    assert.equal(item.body.length, 2000);
  }));

test("Telegram text of a notice", () => {
  assert.equal(telegramText({ title: "", body: "Текст" }), "🔔 Уведомление\n\nТекст");
  assert.equal(telegramText({ title: "Т", body: "Б", title_en: "T", body_en: null }, true), "🔔 T\n\nБ");
});

// ---------- Журнал изменений (changelog.json) ----------

import { changelogProblems, readChangelog } from "../notices.js";

test("changelog.json is valid, readable for players and free of forbidden words", () => {
  const list = readChangelog();
  assert.deepEqual(changelogProblems(list), []);
  assert.ok(list.length >= 20);
  const text = list.map((e) => [e.title, e.body, e.titleEn, e.bodyEn].join(" ")).join(" ").toLowerCase();
  for (const w of ["крипт", "монет", "токен", "заработ", "вывод", "обмен на деньги", "mario", "nintendo", "dendy", "nes ", "bomberman", "battle city", "coin", "token", "crypto"]) {
    assert.ok(!text.includes(w), `forbidden: ${w}`);
  }
});

test("changelog problems are reported", () => {
  const ok = { id: "a-1", date: "2026-10-02", size: "major", title: "T", body: "B", titleEn: "T", bodyEn: "B" };
  assert.deepEqual(changelogProblems([ok, { ...ok, id: "a-2" }]), []);
  assert.equal(changelogProblems([ok, ok]).length, 1, "same id twice");
  assert.equal(changelogProblems([ok, { ...ok, id: "a-2", date: "2026-10-01" }]).length, 1, "out of order");
  assert.equal(changelogProblems([{ ...ok, titleEn: "" }]).length, 1, "English is required");
  assert.equal(changelogProblems([{ ...ok, id: "Bad id" }]).length, 1);
  assert.equal(changelogProblems([{ ...ok, size: undefined }]).length, 1, "size is required");
  assert.equal(changelogProblems([{ ...ok, size: "huge" }]).length, 1);
  assert.deepEqual(changelogProblems([ok, { ...ok, id: "a-3", date: undefined }]), [], "no date: the day it goes live");
});

test("changelog entries become updates once, with their dates; edits follow, hidden ones stay hidden", () => {
  const store = openDb(":memory:");
  const clock = { t: Date.UTC(2026, 9, 30, 15) };
  const notices = createNotices(store, { now: () => clock.t });
  try {
    store.touchPlayer(alice);
    const manual = notices.add({ kind: "news", title: "Новость" }).notice;
    notices.read(1, manual.id);
    const list = [
      { id: "old-one", date: "2026-10-01", size: "minor", title: "Старое", body: "", titleEn: "Old", bodyEn: "" },
      { id: "fresh", size: "major", title: "Свежее", body: "Текст", titleEn: "Fresh", bodyEn: "Text" },
    ];
    assert.equal(notices.syncChangelog(list), 2);
    assert.equal(notices.syncChangelog(list), 0, "only once");
    let me = notices.list(1, "en");
    // Без даты — когда сервер увидел запись; список идёт по датам, новое сверху.
    assert.deepEqual(me.items.map((i) => [i.title, i.kind]), [["Fresh", "update"], ["Новость", "news"], ["Old", "minor"]]);
    assert.equal(me.items[2].at, Date.UTC(2026, 9, 1, 9));
    assert.equal(me.unread, 2, "new entries are unread even when their date is old");
    notices.syncChangelog([{ ...list[0], size: "major", title: "Старое, исправлено" }, list[1]]);
    assert.deepEqual([notices.list(1).items.at(-1).title, notices.list(1).items.at(-1).kind], ["Старое, исправлено", "update"]);
    notices.hide(me.items[0].id);
    notices.syncChangelog(list);
    me = notices.list(1, "en");
    assert.deepEqual(me.items.map((i) => i.title), ["Новость", "Old"]);
  } finally {
    store.close();
  }
});
