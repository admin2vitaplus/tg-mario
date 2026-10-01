import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const S = require('./strings.js');
import './sim.js';
const sim = globalThis.TankSim;
const marks = (text) => (text.match(/\{\w+\}/g) || []).sort().join(',');

test('Russian and English have the same keys and the same {marks}', () => {
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.ru).sort());
  for (const key of Object.keys(S.ru)) assert.equal(marks(S.en[key]), marks(S.ru[key]), key);
});

test('every key the game and the page use exists', () => {
  const dir = new URL('.', import.meta.url);
  const js = readFileSync(new URL('tanks.js', dir), 'utf8');
  const html = readFileSync(new URL('index.html', dir), 'utf8');
  const used = new Set([
    ...[...js.matchAll(/\bT\('(\w+)'\s*[,)]/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-t[hp]?="(\w+)"/g)].map((m) => m[1]),
  ]);
  for (const key of used) assert.ok(key in S.ru, key);
  // Built names: categories, looks items, maps.
  for (const cat of ['tank', 'weather', 'enemies', 'walls', 'ground']) assert.ok('cat_' + cat in S.ru);
  sim.MAPS.forEach((m, i) => assert.equal(S.ru['map_' + i], m.name));
});

test('language follows Telegram', () => {
  assert.equal(S.pickLang('ru'), 'ru');
  assert.equal(S.pickLang('uk'), 'ru');
  assert.equal(S.pickLang('en-US'), 'en');
  assert.equal(S.pickLang('de'), 'en');
  assert.equal(S.pickLang(''), 'en');
  const T = S.make('en');
  assert.equal(T('stage_clear', { n: 3 }), 'STAGE 3 CLEAR');
  assert.equal(S.make('ru')('joining', { code: '123456' }), 'Входим в комнату 123456…');
});

test('server room errors all have translations', () => {
  const rooms = readFileSync(new URL('../../bot/tanks-rooms.js', import.meta.url), 'utf8');
  const codes = [...rooms.matchAll(/t: "error", code: "(\w+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 5);
  for (const c of codes) { assert.ok('err_' + c in S.ru, c); assert.ok('err_' + c in S.en, c); }
});
