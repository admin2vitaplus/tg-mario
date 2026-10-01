// Checks of the web/ folder: no outside addresses, portable paths, games that
// can be switched off, and size budgets. Run: npm test (from the repo root).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const WEB = path.join(import.meta.dirname, '..', 'web');
const TEXT = /\.(html|css|js|mjs|json|txt|svg|webmanifest)$/;

function files(dir = WEB) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : [p];
  });
}
const rel = (p) => path.relative(WEB, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');

// Hosts that may appear in code. Telegram links (t.me) are opened by the
// Telegram app itself, never loaded by the page. Vendored libraries mention a
// few hosts in strings and comments that they never load either; a new host
// in them still fails the test.
const ALLOWED_EVERYWHERE = ['t.me'];
const ALLOWED_IN = {
  'lib/phaser.min.js': ['phaser.io', 'www.w3.org'],
  'lib/telegram-web-app.js': ['game.com', 'www.w3.org', 'web.telegram.org', 'core.telegram.org', 't.me'],
};

test('web/ refers to no outside http(s) address', () => {
  const bad = [];
  for (const f of files().filter((p) => TEXT.test(p))) {
    const name = rel(f);
    const allowed = new Set([...ALLOWED_EVERYWHERE, ...(ALLOWED_IN[name] || [])]);
    for (const m of read(f).matchAll(/https?:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) {
      if (!allowed.has(m[1].toLowerCase())) bad.push(`${name}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], 'outside addresses found');
});

test('pages and styles load files only by relative paths', () => {
  const bad = [];
  for (const f of files().filter((p) => /\.(html|css)$/.test(p))) {
    const refs = [
      ...read(f).matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/g),
      ...read(f).matchAll(/url\(\s*["']?([^"')]+)/g),
      ...read(f).matchAll(/@import\s+["']([^"']+)/g),
    ].map((m) => m[1]);
    for (const r of refs) {
      if (/^(data:|#)/.test(r)) continue;
      if (/^([a-z]+:|\/)/i.test(r)) bad.push(`${rel(f)}: ${r}`);
    }
  }
  assert.deepEqual(bad, [], 'absolute paths found');
});

test('no hosting address is written into web/', () => {
  const bad = files().filter((p) => TEXT.test(p) && /github\.io|githubusercontent|admin2vitaplus/i.test(read(p))).map(rel);
  assert.deepEqual(bad, []);
});

// ---------- Games on and off ----------

function loadConfig(patch) {
  const ctx = { window: {} };
  vm.runInNewContext(read(path.join(WEB, 'config.js')), ctx);
  const cfg = ctx.window.CARTRIDGE;
  if (patch) patch(cfg);
  return cfg;
}

// Just enough of a page for menu.js.
function fakePage() {
  const el = (id) => ({
    id, children: [], className: '', textContent: '', removed: false,
    classList: { add() {}, remove() {}, toggle() {} },
    set innerHTML(v) { this.children = []; },
    append(c) { this.children.push(c); },
    addEventListener() {},
    querySelector() { return el('hint'); },
    remove() { this.removed = true; },
  });
  const byId = { menu: el('menu'), menuList: el('menuList'), menuScores: el('menuScores') };
  return {
    byId,
    document: {
      getElementById: (id) => byId[id] || null,
      createElement: () => el(),
      addEventListener() {},
      removeEventListener() {},
      head: el('head'),
    },
  };
}

function runMenu(patch) {
  const cfg = loadConfig(patch);
  const page = fakePage();
  const ctx = { window: { CARTRIDGE: cfg }, document: page.document, location: { search: '' } };
  vm.runInNewContext(read(path.join(WEB, 'menu.js')), ctx);
  return { lines: page.byId.menuList.children.map((li) => li.textContent), scores: !page.byId.menuScores.removed };
}

test('every game in the config has what the menu needs', () => {
  const cfg = loadConfig();
  const ids = new Set();
  for (const g of cfg.games) {
    assert.match(g.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(g.id), 'duplicate id ' + g.id);
    ids.add(g.id);
    assert.ok(g.title);
    assert.equal(typeof g.enabled, 'boolean');
    assert.ok(g.url || (g.scripts && g.scripts.length), g.id + ' has neither url nor scripts');
    const own = g.url ? [g.url + 'index.html'] : [...g.scripts, ...(g.styles || [])];
    for (const f of own) {
      assert.ok(!/^([a-z]+:|\/)/i.test(f), `${g.id}: ${f} is not relative`);
      assert.ok(fs.existsSync(path.join(WEB, f)), `${g.id}: ${f} is missing`);
    }
  }
});

test('the menu lists all enabled games', () => {
  const { lines, scores } = runMenu();
  assert.ok(lines.some((l) => l.includes('ПРЫГ-СКОК')));
  assert.ok(lines.some((l) => l.includes('ТАНКОДРОМ')));
  assert.ok(scores);
});

for (const id of ['pryg-skok', 'tanks']) {
  test(`switching off ${id} removes it from the menu and breaks nothing`, () => {
    const cfg = loadConfig();
    const title = cfg.game(id).title;
    const { lines } = runMenu((c) => { c.game(id).enabled = false; });
    assert.ok(!lines.some((l) => l.includes(title)));
    assert.equal(lines.length, cfg.slots);
    assert.ok(lines.some((l) => !l.includes('СКОРО')), 'the other game stays');
  });
}

test('with every game off the menu still opens, without the scores button', () => {
  const { lines, scores } = runMenu((c) => c.games.forEach((g) => { g.enabled = false; }));
  assert.ok(lines.every((l) => l.includes('СКОРО')));
  assert.equal(scores, false);
});

// ---------- Size budgets (gzip) ----------

const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(WEB, f)), { level: 9 }).length;

// Files a page loads by itself: its scripts and stylesheets.
function pageFiles(page) {
  const dir = path.posix.dirname(page);
  const html = read(path.join(WEB, page));
  const refs = [
    ...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
  ].map((m) => path.posix.normalize(path.posix.join(dir, m[1])));
  return [page, ...refs];
}
const sum = (list) => [...new Set(list)].reduce((n, f) => n + gz(f), 0);
const KB = 1024;

test('the menu fits in 80 KB', () => {
  const size = sum(pageFiles('index.html'));
  assert.ok(size <= 80 * KB, `menu is ${(size / KB).toFixed(1)} KB`);
});

test('the menu does not load any game up front', () => {
  const menu = pageFiles('index.html');
  for (const g of loadConfig().games.filter((x) => x.scripts)) {
    for (const f of g.scripts) assert.ok(!menu.includes(f), `menu loads ${f}`);
  }
});

test('menu plus any one game fits in 450 KB', () => {
  const menu = pageFiles('index.html');
  for (const g of loadConfig().games) {
    const own = g.url ? pageFiles(path.posix.join(g.url, 'index.html')) : [...g.scripts, ...(g.styles || [])];
    const size = sum([...menu, ...own]);
    assert.ok(size <= 450 * KB, `${g.id}: ${(size / KB).toFixed(1)} KB`);
  }
});

// ---------- Offline cache ----------

test('the offline cache lists only existing files and skips the server', () => {
  const sw = read(path.join(WEB, 'sw.js'));
  assert.match(sw, /'__BUILD__'/, 'the deploy step replaces __BUILD__');
  const core = JSON.parse(sw.match(/const CORE = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  for (const f of core) if (f !== './') assert.ok(fs.existsSync(path.join(WEB, f)), f + ' is missing');
  assert.match(sw, /\(api\|ws\)/);
});
