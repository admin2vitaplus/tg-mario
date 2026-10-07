// «Прыг-Скок» checkpoint rules in web/game.js. The scene object is reused by
// Phaser on every restart, so a flag set in one life or one level leaks into
// the next unless init() clears it (owner's bug: died at the start of 1-2 after
// passing the 1-1 midpoint and came back in the middle of 1-2).
// Run: npm test (from the repo root).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'web', 'game.js'), 'utf8');
const body = (name) => {
  const start = src.indexOf(`\n  ${name}(`);
  assert.ok(start > 0, `${name}() not found`);
  const end = src.indexOf('\n  }\n', start);
  return src.slice(start, end);
};

test('a new life or level starts with the checkpoint not passed', () => {
  assert.match(body('init'), /this\.passedCheckpoint = false;/);
});

test('only the main course counts for the checkpoint, not a bonus room', () => {
  const line = src.split('\n').find((l) => l.includes('this.passedCheckpoint = true'));
  assert.ok(line, 'checkpoint is passed somewhere');
  assert.match(line, /this\.area === 0/);
});

test('a lost life restarts from the checkpoint only when it was passed in this level', () => {
  assert.match(body('die'), /checkpoint: this\.passedCheckpoint \? this\.s\.level : undefined/);
});

// Owner's bug: in 1-3 the hero came back at the midpoint right on top of two beetles and died at once.
test('no foe is placed next to where the hero appears', () => {
  const create = body('create');
  assert.match(src, /const SPAWN_CLEAR = [5-9];/);
  assert.match(create, /const clear = \(\[x\]\) => Math\.abs\(x - sx\) > SPAWN_CLEAR;/);
  for (const spots of ['enemySpots', 'throwerSpots', 'spikySpots', 'fishSpots']) {
    assert.match(create, new RegExp(`of ${spots}\\.filter\\(clear\\)`), spots);
  }
});

test('game over: no «continue from world»; a bought life goes on, otherwise a new game from 1-1', () => {
  const over = body('gameOver');
  assert.doesNotMatch(over, /restart\(\{ world/);
  assert.match(over, /this\.scene\.restart\(\{\}\)/);
  assert.match(over, /Wallet\.buyLife\(id, this\.s\.level\)/);
  assert.match(over, /lives: 1, score: this\.s\.score/);
});
