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

test("a random opponent: the first one waits in an open room, the next one comes into it", () =>
  withRooms({}, async ({ rooms, connect }) => {
    // A room made by «create» is for a friend only: nobody random comes into it.
    const friend = await connect();
    friend.send({ t: "create" });
    const own = await friend.next();
    assert.equal(own.random, undefined);

    const first = await connect();
    first.send({ t: "find" });
    const room = await first.next();
    assert.equal(room.t, "room");
    assert.equal(room.random, true);
    assert.notEqual(room.code, own.code);

    const second = await connect();
    second.send({ t: "find" });
    const joined = await second.next();
    assert.deepEqual([joined.t, joined.code, joined.random], ["joined", room.code, true]);
    assert.equal((await first.next()).t, "peer");
    assert.deepEqual(rooms.members(room.code), { host: null, guest: null });

    // The room is full now: the next one searching gets a room of their own.
    const third = await connect();
    third.send({ t: "find" });
    const next = await third.next();
    assert.equal(next.t, "room");
    assert.notEqual(next.code, room.code);
    second.send({ t: "i", d: 2, f: 0 });
    assert.deepEqual(await first.next(), { t: "i", d: 2, f: 0 });
  }));

test("a random opponent is never the same player, nor a host whose link dropped", () =>
  withRooms({ botToken: TOKEN }, async ({ rooms, connect }) => {
    const auth = "?auth=" + encodeURIComponent(initData({ id: 7, first_name: "Аня" }));
    const a = await connect(auth);
    a.send({ t: "find" });
    const room = await a.next();
    // The same player from a second phone waits on their own.
    const again = await connect(auth);
    again.send({ t: "find" });
    const own = await again.next();
    assert.equal(own.t, "room");
    assert.notEqual(own.code, room.code);
    // The first host's link drops: the next player gets the second room.
    await cut(rooms, room.code, 0, a);
    const b = await connect("?auth=" + encodeURIComponent(initData({ id: 8, first_name: "Боря" })));
    b.send({ t: "find" });
    const joined = await b.next();
    assert.equal(joined.code, own.code);
    assert.equal((await again.next()).t, "peer");
    assert.deepEqual(rooms.members(own.code), { host: 7, guest: 8 });
  }));

test("a random duel opponent is looked for only among those who want a duel", () =>
  withRooms({}, async ({ connect }) => {
    const coop = await connect();
    coop.send({ t: "find" });
    const together = await coop.next();
    const a = await connect();
    a.send({ t: "find", kind: "duel" });
    const room = await a.next();
    assert.equal(room.t, "room");
    assert.notEqual(room.code, together.code);
    const b = await connect();
    b.send({ t: "find", kind: "duel" });
    const joined = await b.next();
    assert.deepEqual([joined.t, joined.code], ["joined", room.code]);
    assert.equal((await a.next()).t, "peer");
  }));

test("a room for four: seats in order, the host talks to all, guests to the host, lock and leaving", () =>
  withRooms({}, async ({ rooms, connect }) => {
    const host = await connect();
    host.send({ t: "create", seats: 4 });
    const room = await host.next();
    assert.deepEqual([room.t, room.size], ["room", 4]);
    const guests = [];
    for (let i = 1; i <= 3; i++) {
      const g = await connect();
      g.send({ t: "join", code: room.code });
      const joined = await g.next();
      assert.deepEqual([joined.t, joined.seat, joined.size], ["joined", i, 4]);
      assert.deepEqual(await host.next(), { t: "peer", seat: i });
      guests.push(g);
    }
    const fifth = await connect();
    fifth.send({ t: "join", code: room.code });
    assert.equal((await fifth.next()).code, "full");
    // The host's world goes to every guest; a guest's buttons come to the host with the seat.
    host.send({ t: "s", f: 1 });
    for (const g of guests) assert.deepEqual(await g.next(), { t: "s", f: 1 });
    guests[1].send({ t: "i", d: 3 });
    const got = await host.next();
    assert.deepEqual([got.t, got.s, JSON.parse(got.m)], ["g", 2, { t: "i", d: 3 }]);
    // A guest who leaves frees the seat; the game goes on for the others.
    guests[0].ws.close(1000);
    assert.deepEqual(await host.next(), { t: "gone", seat: 1 });
    assert.equal(rooms.rooms.get(room.code).seats[1], null);
    // Locked by the host: nobody new comes in, even to a free seat; the lock is not passed on.
    host.send({ t: "lock" });
    host.send({ t: "s", f: 2 });
    assert.deepEqual(await guests[1].next(), { t: "s", f: 2 });
    assert.deepEqual(await guests[2].next(), { t: "s", f: 2 });
    const late = await connect();
    late.send({ t: "join", code: room.code });
    assert.equal((await late.next()).code, "full");
    // The host leaving closes the room for everybody.
    host.ws.close(1000);
    assert.equal((await guests[1].next()).t, "left");
    assert.equal((await guests[2].next()).t, "left");
  }));

test("a random game for four: searchers fill one room, a two-player search stays apart", () =>
  withRooms({ limits: { rejoinMs: 50, sweepMs: 20 } }, async ({ rooms, connect }) => {
    const duel = await connect();
    duel.send({ t: "find" });
    const duelRoom = await duel.next();
    const host = await connect();
    host.send({ t: "find", kind: "party" });
    const room = await host.next();
    assert.deepEqual([room.t, room.size, room.random], ["room", 4, true]);
    assert.notEqual(room.code, duelRoom.code);
    const a = await connect();
    a.send({ t: "find", kind: "party" });
    const ja = await a.next();
    assert.deepEqual([ja.code, ja.seat, ja.size], [room.code, 1, 4]);
    assert.deepEqual(await host.next(), { t: "peer", seat: 1 });
    const b = await connect();
    b.send({ t: "find", kind: "party" });
    assert.equal((await b.next()).seat, 2);
    assert.deepEqual(await host.next(), { t: "peer", seat: 2 });
    // A guest whose link drops: the host is told, and after the wait the seat is free.
    await cut(rooms, room.code, 1, a);
    assert.deepEqual(await host.next(), { t: "wait", seat: 1 });
    assert.deepEqual(await host.next(), { t: "gone", seat: 1 });
    const c = await connect();
    c.send({ t: "find", kind: "party" });
    assert.equal((await c.next()).seat, 1);
  }));
