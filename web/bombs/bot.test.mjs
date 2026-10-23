// The computer rival for Бомбодром: node --test web/bombs/bot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './sim.js';
import './bot.js';

const S = globalThis.BombSim, B = globalThis.BombBot;

test('two bots finish duels: they blow up blocks and someone wins', () => {
  let ended = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = S.newGame(2, seed, { rules: 2 });
    const soft = s.cells.filter((c) => c === S.SOFT).length;
    const m = [B.newMemory(), B.newMemory()];
    while (s.phase !== 'overDone' && s.phase !== 'clearDone' && s.frame < 60 * 60 * 5) {
      S.step(s, [B.think(s, 0, m[0]), B.think(s, 1, m[1])]);
      s.events.length = 0;
    }
    assert.ok(s.cells.filter((c) => c === S.SOFT).length < soft - 5, 'blocks blown up');
    if (s.winner >= 0) ended++;
  }
  assert.ok(ended >= 5, 'nearly every duel has a winner: ' + ended);
});

test('the bot runs from its own bomb instead of standing in the fire', () => {
  const s = S.newGame(2, 3, { rules: 2 });
  while (s.phase === 'intro') S.step(s, []);
  s.enemies = [];
  const m = B.newMemory();
  let deaths = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const before = s.players[1].lives;
    S.step(s, [{ dir: -1, a: false, b: false }, B.think(s, 1, m)]);
    if (s.players[1].lives < before) deaths++;
    if (s.phase !== 'play') break;
  }
  assert.equal(deaths, 0);
});
