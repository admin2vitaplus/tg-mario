import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readTunnelUrl, watchTunnel } from "../tunnel.js";

// Поддельная служба cloudflared: /quicktunnel отдаёт текущий адрес (или ошибку, пока его нет).
async function fakeMetrics() {
  const state = { hostname: "", down: false };
  const server = createServer((req, res) => {
    if (state.down || req.url !== "/quicktunnel") { res.writeHead(503).end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ hostname: state.hostname }));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { state, addr: `127.0.0.1:${server.address().port}`, close: () => server.close() };
}
const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };

test("reads the quick tunnel address from cloudflared metrics", async () => {
  const m = await fakeMetrics();
  try {
    m.state.hostname = "abc-def.trycloudflare.com";
    assert.equal(await readTunnelUrl(m.addr), "https://abc-def.trycloudflare.com");
    assert.equal(await readTunnelUrl(`http://${m.addr}`), "https://abc-def.trycloudflare.com");
    m.state.hostname = "bad host/../x";
    await assert.rejects(readTunnelUrl(m.addr), /ещё не получил адрес/);
  } finally { m.close(); }
});

test("waits for the tunnel service, then restarts the bot only when the address changes", async () => {
  const m = await fakeMetrics();
  const changes = [];
  try {
    setTimeout(() => { m.state.hostname = "first.trycloudflare.com"; }, 50);
    const t = await watchTunnel(m.addr, { intervalMs: 20, retryMs: 10, waitMs: 2000, onChange: (now, was) => changes.push([was, now]) });
    assert.equal(t.url, "https://first.trycloudflare.com");

    // Служба туннеля перезапускается, но вернулась с тем же адресом — ничего не делаем.
    m.state.down = true;
    await new Promise((r) => setTimeout(r, 80));
    m.state.down = false;
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(changes, []);

    m.state.hostname = "second.trycloudflare.com";
    await until(() => changes.length);
    assert.deepEqual(changes, [["https://first.trycloudflare.com", "https://second.trycloudflare.com"]]);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(changes.length, 1);
    await t.stop();
  } finally { m.close(); }
});

test("gives up when the tunnel service never answers", async () => {
  const m = await fakeMetrics();
  m.state.down = true;
  try {
    await assert.rejects(watchTunnel(m.addr, { retryMs: 10, waitMs: 100 }), /нет адреса от службы туннеля/);
  } finally { m.close(); }
});

test("a fixed public address is used as is, only https", async () => {
  const { fixedPublicUrl } = await import("../tunnel.js");
  assert.equal(fixedPublicUrl("https://206-223-241-130.sslip.io:8443"), "https://206-223-241-130.sslip.io:8443");
  assert.equal(fixedPublicUrl(" https://game.example.ru/ "), "https://game.example.ru");
  assert.equal(fixedPublicUrl("https://game.example.ru:443/api/"), "https://game.example.ru");
  assert.throws(() => fixedPublicUrl("http://206-223-241-130.sslip.io:8080"), /https/);
  assert.throws(() => fixedPublicUrl("206-223-241-130.sslip.io"), /не похож на адрес|https/);
});
