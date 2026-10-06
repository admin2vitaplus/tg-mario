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
