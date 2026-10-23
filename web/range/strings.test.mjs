import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const S = require('./strings.js');
const marks = (text) => (text.match(/\{\w+\}/g) || []).sort().join(',');
const dir = new URL('.', import.meta.url);
const js = readFileSync(new URL('range.js', dir), 'utf8');

test('Russian and English have the same keys and the same {marks}', () => {
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.ru).sort());
  for (const key of Object.keys(S.ru)) assert.equal(marks(S.en[key]), marks(S.ru[key]), key);
});

test('every key the game and the page use exists', () => {
  const html = readFileSync(new URL('index.html', dir), 'utf8');
  const used = new Set([
    ...[...js.matchAll(/\bT\('(\w+)'\s*[,)]/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-t="(\w+)"/g)].map((m) => m[1]),
  ]);
  for (const key of used) assert.ok(key in S.ru, key);
  for (const [cat, ids] of [['sight', ['cross', 'ring', 'frame', 'laser']], ['birds', ['tin', 'wood', 'paper', 'robot']], ['scene', ['day', 'sunset', 'night', 'winter']]]) {
    assert.ok('cat_' + cat in S.ru);
    for (const id of ids) {
      assert.ok(cat + '_' + id in S.ru, cat + '_' + id);
      assert.match(js, new RegExp(`id: '${id}'`));
    }
  }
  for (const st of ['on', 'wait', 'off', 'denied', 'touch']) assert.ok('aim_status_' + st in S.ru, st);
});

test('language follows Telegram', () => {
  assert.equal(S.pickLang('ru'), 'ru');
  assert.equal(S.pickLang('be'), 'ru');
  assert.equal(S.pickLang('en-US'), 'en');
  assert.equal(S.make('en')('banner_round', { n: 3 }), 'ROUND 3');
  assert.equal(S.make('ru')('aim_speed', { n: 120 }), 'Чувствительность: 120%');
});

test('shop looks match the server shop and its prices', () => {
  const shop = JSON.parse(readFileSync(new URL('../../bot/economy.json', import.meta.url), 'utf8')).shop.filter((i) => i.game === 'range');
  assert.ok(shop.length >= 2);
  for (const it of shop) assert.match(js, new RegExp(`shop: '${it.id}', tokens: ${it.price}\\b`), it.id);
});
