import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { attachTanksRooms } from "../tanks-rooms.js";

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
  const opened = new Promise((ok) => { ws.onopen = ok; });
  return { ws, next, opened, send: (m) => ws.send(JSON.stringify(m)) };
}

test("two players meet in a room and exchange messages", async () => {
  const server = createServer((req, res) => res.end());
  attachTanksRooms(server);
  await new Promise((ok) => server.listen(0, ok));
  const url = `ws://127.0.0.1:${server.address().port}/ws/tanks`;
  try {
    const host = client(url);
    await host.opened;
    host.send({ t: "create" });
    const room = await host.next();
    assert.equal(room.t, "room");
    assert.match(room.code, /^\d{4}$/);

    const stranger = client(url);
    await stranger.opened;
    stranger.send({ t: "join", code: "0000" });
    assert.equal((await stranger.next()).t, "error");

    const guest = client(url);
    await guest.opened;
    guest.send({ t: "join", code: room.code });
    assert.equal((await guest.next()).t, "joined");
    assert.equal((await host.next()).t, "peer");

    stranger.send({ t: "join", code: room.code });
    assert.equal((await stranger.next()).msg, "В комнате уже двое");

    guest.send({ t: "i", d: 1, f: 1 });
    assert.deepEqual(await host.next(), { t: "i", d: 1, f: 1 });
    host.send({ t: "s", f: 10 });
    assert.deepEqual(await guest.next(), { t: "s", f: 10 });

    guest.ws.close();
    assert.equal((await host.next()).t, "left");
    host.ws.close();
    stranger.ws.close();
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
