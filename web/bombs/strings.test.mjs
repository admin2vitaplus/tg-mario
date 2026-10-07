import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const S = require('./strings.js');
import './sim.js';
const sim = globalThis.BombSim;
const marks = (text) => (text.match(/\{\w+\}/g) || []).sort().join(',');

test('Russian and English have the same keys and the same {marks}', () => {
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.ru).sort());
  for (const key of Object.keys(S.ru)) assert.equal(marks(S.en[key]), marks(S.ru[key]), key);
});

test('every key the game and the page use exists', () => {
  const dir = new URL('.', import.meta.url);
  const js = readFileSync(new URL('bombs.js', dir), 'utf8');
  const html = readFileSync(new URL('index.html', dir), 'utf8');
  const used = new Set([
    ...[...js.matchAll(/\bT\('(\w+)'\s*[,)]/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-t[hp]?="(\w+)"/g)].map((m) => m[1]),
  ]);
  for (const key of used) assert.ok(key in S.ru, key);
  // Built names: items, looks.
  for (const it of sim.ITEMS) assert.ok('item_' + it in S.ru, it);
  for (const [cat, ids] of [['hero', ['white', 'red', 'blue', 'green', 'ninja']], ['blocks', ['brick', 'crates', 'hedge', 'ice', 'candy']], ['ground', ['grass', 'stone', 'sand', 'snow', 'night']]]) {
    assert.ok('cat_' + cat in S.ru);
    for (const id of ids) {
      assert.ok(cat + '_' + id in S.ru, cat + '_' + id);
      assert.match(js, new RegExp(`id: '${id}'`));
    }
  }
});

test('language follows Telegram', () => {
  assert.equal(S.pickLang('ru'), 'ru');
  assert.equal(S.pickLang('uk'), 'ru');
  assert.equal(S.pickLang('en-US'), 'en');
  assert.equal(S.make('en')('stage_clear', { n: 3 }), 'STAGE 3 CLEAR');
  assert.equal(S.make('ru')('joining', { code: '123456' }), 'Входим в комнату 123456…');
});

test('server room errors all have translations', () => {
  const rooms = readFileSync(new URL('../../bot/tanks-rooms.js', import.meta.url), 'utf8');
  const codes = [...rooms.matchAll(/t: "error", code: "(\w+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 5);
  for (const c of codes) { assert.ok('err_' + c in S.ru, c); assert.ok('err_' + c in S.en, c); }
});

test('shop looks match the server shop and its prices', () => {
  const js = readFileSync(new URL('bombs.js', import.meta.url), 'utf8');
  const shop = JSON.parse(readFileSync(new URL('../../bot/economy.json', import.meta.url), 'utf8')).shop.filter((i) => i.game === 'bombs');
  assert.ok(shop.length >= 2);
  for (const it of shop) assert.match(js, new RegExp(`shop: '${it.id}', tokens: ${it.price}\\b`), it.id);
});
