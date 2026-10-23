// The computer partner for Танкодром: node --test web/tanks/bot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './sim.js';
import './bot.js';

const S = globalThis.TankSim, B = globalThis.TankBot;
const IDLE = { dir: -1, fire: false };

function run(seed) {
  const s = S.newGame(2, seed, { rules: 2, mode: 'bot' });
  const mem = B.newMemory();
  while (s.phase !== 'overDone' && s.phase !== 'clearDone' && s.frame < 60 * 60 * 5) {
    S.step(s, [IDLE, B.think(s, 1, mem)]);
    s.events.length = 0;
  }
  return s;
}

test('the bot alone (the player idle) fights: it kills enemies and can clear a stage', () => {
  const games = [1, 2, 3, 4, 5].map(run);
  assert.ok(games.every((s) => s.players[1].kills.reduce((a, b) => a + b) >= 5), 'kills in every game');
  assert.ok(games.some((s) => s.phase === 'clearDone'), 'clears a stage at least once');
});

test('the bot gives pad buttons only', () => {
  const s = S.newGame(2, 3, { rules: 2, mode: 'bot' });
  const mem = B.newMemory();
  for (let i = 0; i < 600; i++) {
    const inp = B.think(s, 1, mem);
    assert.ok(inp.dir >= -1 && inp.dir <= 3 && typeof inp.fire === 'boolean');
    S.step(s, [IDLE, inp]);
  }
});
