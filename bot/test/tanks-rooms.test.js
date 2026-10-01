import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { attachTanksRooms } from "../tanks-rooms.js";

const TOKEN = "123456:TEST";

function initData(user) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

// Клиент WebSocket встроен в Node 22.
function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const w = waiters.shift();
    if (w) w(msg); else inbox.push(msg);
  };
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((ok) => waiters.push(ok)));
  // opened: true — соединение открыто, false — сервер отказал.
  const opened = new Promise((ok) => { ws.onopen = () => ok(true); ws.onerror = () => ok(false); });
  const closed = new Promise((ok) => ws.addEventListener("close", ok));
  return { ws, next, opened, closed, send: (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m)) };
}

async function withRooms(options, fn) {
  const server = createServer((req, res) => res.end());
  const rooms = attachTanksRooms(server, options);
  await new Promise((ok) => server.listen(0, ok));
  const url = `ws://127.0.0.1:${server.address().port}/ws/tanks`;
  const open = [];
  const connect = async (query = "") => {
    const c = client(url + query);
    open.push(c);
    await c.opened;
    return c;
  };
  try {
    await fn({ rooms, connect, url });
  } finally {
    for (const c of open) c.ws.close();
    rooms.close();
    server.closeAllConnections?.();
    server.close();
  }
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Обрыв связи (а не выход из комнаты): сервер теряет соединение без закрывающего кадра.
async function cut(rooms, code, seat, c) {
  rooms.rooms.get(code).seats[seat].ws.terminate();
  await c.closed;
}

test("two players meet in a room, exchange messages and come back after a drop", () =>
  withRooms({ limits: { rejoinMs: 50 } }, async ({ rooms, connect }) => {
    const host = await connect();
    host.send({ t: "create" });
    const room = await host.next();
    assert.equal(room.t, "room");
    assert.match(room.code, /^\d{6}$/);
    assert.ok(room.token);

    const stranger = await connect();
    stranger.send({ t: "join", code: "000000" });
    assert.equal((await stranger.next()).t, "error");

    let guest = await connect();
    guest.send({ t: "join", code: room.code });
    const joined = await guest.next();
    assert.equal(joined.t, "joined");
    assert.equal((await host.next()).t, "peer");

    stranger.send({ t: "join", code: room.code });
    assert.equal((await stranger.next()).msg, "В комнате уже двое");
    stranger.send({ t: "rejoin", code: room.code, token: "чужой" });
    assert.equal((await stranger.next()).t, "error");

    guest.send({ t: "i", d: 1, f: 1 });
    assert.deepEqual(await host.next(), { t: "i", d: 1, f: 1 });
    host.send('{"t":"ping"}'); // не пересылается
    host.send({ t: "s", f: 10 });
    assert.deepEqual(await guest.next(), { t: "s", f: 10 });

    // Связь у гостя оборвалась — хозяин ждёт, гость возвращается по токену.
    await cut(rooms, room.code, 1, guest);
    assert.equal((await host.next()).t, "wait");
    guest = await connect();
    guest.send({ t: "rejoin", code: room.code, token: joined.token });
    assert.deepEqual(await guest.next(), { t: "rejoined", code: room.code, role: "guest", peer: true });
    assert.equal((await host.next()).t, "back");
    host.send({ t: "s", f: 11 });
    assert.deepEqual(await guest.next(), { t: "s", f: 11 });

    // Не вернулся вовремя — комната закрывается.
    await cut(rooms, room.code, 1, guest);
    assert.equal((await host.next()).t, "wait");
    await pause(80);
    rooms.sweep();
    assert.equal((await host.next()).t, "left");
    assert.equal(rooms.rooms.size, 0);
  }));

test("leaving on purpose closes the room at once", () =>
  withRooms({}, async ({ rooms, connect }) => {
    const host = await connect();
    host.send({ t: "create" });
    const room = await host.next();
    const guest = await connect();
    guest.send({ t: "join", code: room.code });
    await guest.next();
    await host.next();
    guest.ws.close();
    assert.equal((await host.next()).t, "left");
    assert.equal(rooms.rooms.size, 0);
  }));

test("host can step away to invite a friend before the guest arrives", () =>
  withRooms({ limits: { hostAwayMs: 200, rejoinMs: 20 } }, async ({ rooms, connect }) => {
    let host = await connect();
    host.send({ t: "create" });
    const room = await host.next();
    await cut(rooms, room.code, 0, host);
    await pause(60);
    rooms.sweep(); // дольше rejoinMs, но хозяин ещё не встретил гостя — комната живёт
    assert.equal(rooms.rooms.size, 1);

    const guest = await connect();
    guest.send({ t: "join", code: room.code });
    assert.equal((await guest.next()).t, "joined");
    assert.equal((await guest.next()).t, "wait");

    host = await connect();
    host.send({ t: "rejoin", code: room.code, token: room.token });
    assert.deepEqual(await host.next(), { t: "rejoined", code: room.code, role: "host", peer: true });
    assert.equal((await guest.next()).t, "back");
  }));

test("rooms nobody joins are closed after the wait time", () =>
  withRooms({ limits: { waitMs: 50 } }, async ({ rooms, connect }) => {
    const host = await connect();
    host.send({ t: "create" });
    await host.next();
    await pause(80);
    rooms.sweep();
    assert.equal((await host.next()).msg, "Никто не пришёл, комната закрыта");
    assert.equal(rooms.rooms.size, 0);
  }));

test("1000 abandoned rooms are cleaned up after the TTL", () =>
  withRooms({ limits: { perIp: 2000, roomsPerIp: 2000, maxRooms: 2000, hostAwayMs: 100 } }, async ({ rooms, connect }) => {
    const hosts = await Promise.all(Array.from({ length: 1000 }, () => connect()));
    for (const h of hosts) h.send({ t: "create" });
    await Promise.all(hosts.map((h) => h.next()));
    assert.equal(rooms.rooms.size, 1000);
    for (const ws of rooms.wss.clients) ws.terminate();
    await Promise.all(hosts.map((h) => h.closed));
    while (rooms.wss.clients.size) await pause(10);
    await pause(150);
    rooms.sweep();
    assert.equal(rooms.rooms.size, 0);
    assert.equal(rooms.conns.size, 0);
  }));

test("silent connections are dropped", () =>
  withRooms({ limits: { idleMs: 50 } }, async ({ rooms, connect }) => {
    const c = await connect();
    await pause(80);
    rooms.sweep();
    await c.closed;
  }));

test("too large messages close the connection", () =>
  withRooms({ limits: { maxMessage: 1024 } }, async ({ connect }) => {
    const c = await connect();
    c.send("x".repeat(2000));
    const e = await c.closed;
    assert.equal(e.code, 1009);
  }));

test("connections per address and per Telegram player are limited", () =>
  withRooms({ botToken: TOKEN, limits: { perIp: 3, perUser: 2 } }, async ({ connect }) => {
    const auth = "?auth=" + encodeURIComponent(initData({ id: 7 }));
    assert.equal((await connect(auth)).ws.readyState, WebSocket.OPEN);
    assert.equal((await connect(auth)).ws.readyState, WebSocket.OPEN);
    assert.notEqual((await connect(auth)).ws.readyState, WebSocket.OPEN); // третье от того же игрока
    assert.equal((await connect()).ws.readyState, WebSocket.OPEN);
    assert.notEqual((await connect()).ws.readyState, WebSocket.OPEN); // четвёртое с адреса
  }));

test("guessing room codes is limited", () =>
  withRooms({ limits: { joinTries: 3 } }, async ({ connect }) => {
    const c = await connect();
    for (let i = 0; i < 3; i++) {
      c.send({ t: "join", code: "00000" + i });
      assert.equal((await c.next()).msg, "Комната не найдена");
    }
    c.send({ t: "join", code: "000009" });
    assert.equal((await c.next()).msg, "Слишком много попыток, подождите минуту");
  }));

test("one address can hold only a few rooms", () =>
  withRooms({ limits: { roomsPerIp: 2 } }, async ({ connect }) => {
    for (let i = 0; i < 2; i++) {
      const c = await connect();
      c.send({ t: "create" });
      assert.equal((await c.next()).t, "room");
    }
    const c = await connect();
    c.send({ t: "create" });
    assert.equal((await c.next()).t, "error");
  }));
