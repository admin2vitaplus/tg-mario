// Rules tests for Бомбодром: node --test web/bombs/sim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './sim.js';

const S = globalThis.BombSim;
const { COLS, ROWS, TS, EMPTY, HARD, SOFT, RIGHT, DOWN } = S;
const at = (s, cx, cy) => s.cells[cy * COLS + cx];

function playing(players = 1, seed = 7, stage = 0) {
  const s = S.newGame(players, seed);
  if (stage) S.startStage(s, stage);
  while (s.phase === 'intro') S.step(s, []);
  return s;
}
const idle = (s, n, inputs = []) => { for (let i = 0; i < n; i++) S.step(s, inputs); };
// An empty field with only the border and the pillars.
function bare(s) {
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] !== HARD) s.cells[i] = EMPTY;
  s.enemies = [];
}

test('the field: steel border, a pillar on every second cell, the starts free', () => {
  for (let seed = 1; seed < 30; seed++) {
    for (const players of [1, 2, 3, 4]) {
      const s = S.newGame(players, seed);
      for (let x = 0; x < COLS; x++) { assert.equal(at(s, x, 0), HARD); assert.equal(at(s, x, ROWS - 1), HARD); }
      for (let y = 0; y < ROWS; y++) { assert.equal(at(s, 0, y), HARD); assert.equal(at(s, COLS - 1, y), HARD); }
      assert.equal(at(s, 2, 2), HARD);
      for (const [x, y] of S.STARTS.slice(0, players)) assert.equal(at(s, x, y), EMPTY);
      assert.equal(at(s, ...s.door), SOFT, 'the door is hidden under a block');
      assert.equal(at(s, s.item.x, s.item.y), SOFT, 'so is the item');
      assert.notDeepEqual([s.item.x, s.item.y], s.door);
      assert.ok(s.enemies.length >= 6);
    }
  }
});

test('the same seed and buttons give the same game', () => {
  const run = () => {
    const s = S.newGame(2, 99);
    for (let f = 0; f < 3000; f++) S.step(s, [{ dir: (f >> 5) % 4, a: f % 97 === 0, b: false }, { dir: ((f >> 4) + 2) % 4, a: f % 131 === 0, b: false }]);
    return JSON.stringify([s.players, s.enemies, Array.from(s.cells), s.phase]);
  };
  assert.equal(run(), run());
});

test('a player cannot walk into steel and rounds a corner onto a row', () => {
  const s = playing();
  bare(s);
  const p = s.players[0];
  idle(s, 60, [{ dir: 0, a: false, b: false }]); // up: steel border right above
  assert.equal(p.y, TS);
  p.x = 3 * TS; p.y = TS + 20; // a little below row 1, under nothing
  idle(s, 30, [{ dir: RIGHT, a: false, b: false }]);
  assert.equal(p.y, TS, 'slid onto the row');
  assert.ok(p.x > 3 * TS);
});

test('a bomb breaks the first soft block, kills an enemy and the player who stays', () => {
  const s = playing();
  bare(s);
  const p = s.players[0];
  s.cells[1 * COLS + 3] = SOFT;
  s.cells[1 * COLS + 4] = SOFT;
  s.enemies = [];
  const e = { id: 50, type: 0, x: TS, y: 3 * TS, dir: DOWN, dead: 0, tx: 1, ty: 3, wait: 1e9 };
  s.enemies.push(e);
  S.step(s, [{ dir: -1, a: true, b: false }]);
  assert.equal(s.bombs.length, 1);
  p.range = 2;
  s.bombs[0].range = 2;
  idle(s, S.FUSE + 1);
  assert.equal(p.alive, false, 'standing on the own bomb');
  assert.equal(at(s, 3, 1), S.BURN);
  assert.equal(at(s, 4, 1), SOFT, 'the flame stops at the first block');
  e.wait = 0;
  S.step(s, []);
});

test('an enemy in the flame dies and gives points to the bomb owner', () => {
  const s = playing();
  bare(s);
  const p = s.players[0];
  s.enemies.push({ id: 50, type: 1, x: 3 * TS, y: TS, dir: 0, dead: 0, tx: 3, ty: 1, wait: 0 });
  s.bombs.push({ x: 1, y: 1, t: 1, owner: 0, range: 3, remote: false, passers: 0 });
  p.x = TS; p.y = 3 * TS; // out of the way, below the bomb behind the pillar row
  p.shield = 10;
  S.step(s, []);
  assert.equal(s.enemies[0].dead > 0, true);
  assert.equal(p.score, S.ENEMY[1].score);
});

test('bombs set each other off', () => {
  const s = playing();
  bare(s);
  s.players[0].x = 9 * TS; s.players[0].y = 5 * TS;
  s.bombs.push({ x: 1, y: 1, t: 1, owner: 0, range: 2, remote: false, passers: 0 });
  s.bombs.push({ x: 3, y: 1, t: 999, owner: 0, range: 2, remote: false, passers: 0 });
  S.step(s, []);
  assert.equal(s.bombs.length, 0);
  assert.ok(s.fire[1 * COLS + 5] > 0, 'the second bomb burned further');
});

test('alone, the door works only when no enemy is left', () => {
  const s = playing();
  bare(s);
  s.door = [3, 1];
  s.enemies.push({ id: 50, type: 0, x: 9 * TS, y: 9 * TS, dir: 0, dead: 0, tx: 9, ty: 9, wait: 1e9 });
  const p = s.players[0];
  p.x = 3 * TS; p.y = TS;
  S.step(s, []);
  assert.equal(s.phase, 'play');
  s.enemies = [];
  S.step(s, []);
  assert.equal(s.phase, 'clear');
  idle(s, 200);
  assert.equal(s.phase, 'clearDone');
  S.startStage(s, s.stage + 1);
  assert.equal(s.stage, 1);
});

test('in a duel the first one in the door wins the stage, then both go on', () => {
  const s = playing(2);
  bare(s);
  s.door = [5, 5];
  s.enemies.push({ id: 50, type: 0, x: 9 * TS, y: 9 * TS, dir: 0, dead: 0, tx: 9, ty: 9, wait: 1e9 });
  const b = s.players[1];
  b.x = 5 * TS; b.y = 5 * TS;
  S.step(s, []);
  assert.equal(s.phase, 'clear', 'enemies do not lock the door in a duel');
  assert.equal(s.winner, 1);
  assert.equal(b.wins, 1);
  idle(s, 200);
  S.startStage(s, 1);
  assert.deepEqual([s.players[0].x, s.players[0].y], [TS, TS]);
  assert.deepEqual([s.players[1].x, s.players[1].y], [(COLS - 2) * TS, (ROWS - 2) * TS]);
});

test('in a duel a bomb hurts the other player; out of lives ends the match', () => {
  const s = playing(2);
  bare(s);
  const [a, b] = s.players;
  b.x = 3 * TS; b.y = TS;
  a.x = TS; a.y = 5 * TS;
  b.lives = 1;
  s.bombs.push({ x: 1, y: 1, t: 1, owner: 0, range: 3, remote: false, passers: 0 });
  S.step(s, []);
  assert.equal(b.alive, false);
  idle(s, S.DIE + 1);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
});

test('a lost life in a duel brings the player back at the own edge with a shield', () => {
  const s = playing(2);
  bare(s);
  const b = s.players[1];
  b.x = 3 * TS; b.y = TS;
  s.bombs.push({ x: 1, y: 1, t: 1, owner: 0, range: 3, remote: false, passers: 0 });
  s.players[0].x = TS; s.players[0].y = 5 * TS;
  S.step(s, []);
  idle(s, S.DIE + 1);
  assert.equal(b.alive, true);
  assert.equal(b.lives, 2);
  assert.deepEqual([b.x, b.y], [(COLS - 2) * TS, (ROWS - 2) * TS]);
  assert.ok(b.shield > 0);
});

test('alone, a lost life restarts the stage; the last one ends the game', () => {
  const s = playing(1, 3, 2);
  const p = s.players[0];
  p.lives = 2;
  p.remote = true;
  bare(s);
  s.bombs.push({ x: 1, y: 1, t: 1, owner: 0, range: 1, remote: false, passers: 0 });
  S.step(s, []);
  idle(s, S.DIE + 1);
  assert.equal(s.phase, 'intro');
  assert.equal(s.stage, 2);
  assert.equal(p.lives, 1);
  assert.equal(p.remote, false, 'rare items are lost');
  while (s.phase === 'intro') S.step(s, []);
  bare(s);
  s.bombs.push({ x: 1, y: 1, t: 1, owner: 0, range: 1, remote: false, passers: 0 });
  S.step(s, []);
  idle(s, S.DIE + 200);
  assert.equal(s.phase, 'overDone');
});

test('the remote bomb waits for B', () => {
  const s = playing();
  bare(s);
  const p = s.players[0];
  p.remote = true;
  S.step(s, [{ dir: -1, a: true, b: false }]);
  idle(s, S.FUSE + 20, [{ dir: DOWN, a: false, b: false }]);
  assert.equal(s.bombs.length, 1);
  S.step(s, [{ dir: -1, a: false, b: true }]);
  assert.equal(s.bombs.length, 0);
});

test('enemies never stand inside steel or a block they cannot pass', () => {
  for (let seed = 1; seed < 10; seed++) {
    const s = playing(1, seed, seed % S.STAGES.length);
    s.players[0].mystery = 1e9;
    for (let f = 0; f < 3000; f++) {
      S.step(s, []);
      for (const e of s.enemies) {
        const [cx, cy] = S.cellOf(e.x, e.y);
        const c = at(s, cx, cy);
        assert.notEqual(c, HARD);
        if (!S.ENEMY[e.type].wall) assert.notEqual(c, SOFT);
      }
    }
  }
});

test('the last stage cleared wins the game', () => {
  const s = playing(1, 5, S.STAGES.length - 1);
  bare(s);
  s.door = [3, 1];
  s.players[0].x = 3 * TS; s.players[0].y = TS;
  S.step(s, []);
  assert.equal(s.won, true);
  idle(s, 200);
  assert.equal(s.phase, 'overDone');
});

test('50 stages, each with all its enemies, its item and a door, alone and in a duel', () => {
  assert.equal(S.STAGES.length, 50);
  for (let n = 0; n < S.STAGES.length; n++) {
    const st = S.STAGES[n];
    assert.ok(S.ITEMS.includes(st.item), 'stage ' + (n + 1));
    assert.ok(st.foes.length <= S.ENEMY.length);
    for (const players of [1, 2]) {
      for (const seed of [3, 41]) {
        const s = playing(players, seed, n);
        assert.equal(s.enemies.length, st.foes.reduce((a, b) => a + b), 'stage ' + (n + 1));
        assert.ok(s.enemies.length <= 14, 'room left for the ones from the door (16 at most)');
        assert.equal(at(s, ...s.door), SOFT);
        for (const [x, y] of S.STARTS.slice(0, players)) assert.equal(at(s, x, y), EMPTY);
      }
    }
  }
});

function clearStage(s) {
  bare(s);
  s.door = [3, 1];
  s.players[0].x = 3 * TS; s.players[0].y = TS;
  S.step(s, []);
}

test('clearing stage 20, 30 or 40 alone gives a life; other stages and duels do not', () => {
  for (const n of [1, 10, 20, 30, 40, 50]) {
    const s = playing(1, 5, n - 1);
    clearStage(s);
    assert.equal(s.players[0].lives, S.LIFE_STAGES.includes(n) ? 4 : 3, 'stage ' + n);
  }
  const d = playing(2, 5, 19);
  clearStage(d);
  assert.equal(d.players[0].lives, 3);
  const full = playing(1, 5, 39);
  full.players[0].lives = 9;
  clearStage(full);
  assert.equal(full.players[0].lives, 9, 'no more than nine');
});

// ---------- Rules 2: kick, glove, the closing field in a duel ----------
function playing2(players = 1, seed = 7, stage = 0) {
  const s = S.newGame(players, seed, { rules: 2 });
  if (stage) S.startStage(s, stage);
  while (s.phase === 'intro') S.step(s, []);
  return s;
}

test('rules 2: some stages hide the kick or the glove; rules 1 keep the old items', () => {
  for (const [n, item] of Object.entries(S.NEW_ITEMS)) {
    const s = S.newGame(1, 5, { rules: 2 });
    S.startStage(s, Number(n));
    assert.equal(s.item.type, item);
    const old = S.newGame(1, 5);
    S.startStage(old, Number(n));
    assert.equal(old.item.type, S.STAGES[n].item);
  }
  const d = S.newGame(2, 5, { rules: 2 });
  assert.equal(d.item.type, 'kick');
  S.startStage(d, 1);
  assert.equal(d.item.type, 'glove');
  S.startStage(d, 2);
  assert.equal(d.item.type, S.STAGES[2].item);
});

test('rules 2: the kick sends a bomb sliding until something stops it', () => {
  const s = playing2();
  bare(s);
  const p = s.players[0];
  p.kick = true;
  p.x = 1 * TS; p.y = 1 * TS;
  s.bombs.push({ x: 2, y: 1, t: 999, owner: 0, range: 1, remote: false, passers: 0 });
  idle(s, 3, [{ dir: RIGHT, a: false, b: false }]);
  const b = s.bombs[0];
  assert.equal(b.slide, RIGHT);
  idle(s, S.SLIDE * 40);
  assert.equal(b.y, 1);
  assert.equal(b.x, COLS - 2, 'stops at the steel border');
  assert.equal(b.slide, -1);
});

test('rules 2: without the kick a bomb stays put', () => {
  const s = playing2();
  bare(s);
  const p = s.players[0];
  p.x = 1 * TS; p.y = 1 * TS;
  s.bombs.push({ x: 2, y: 1, t: 999, owner: 0, range: 1, remote: false, passers: 0 });
  idle(s, 30, [{ dir: RIGHT, a: false, b: false }]);
  assert.equal(s.bombs[0].x, 2);
});

test('rules 2: the glove throws the bomb underfoot three cells ahead, over a pillar', () => {
  const s = playing2();
  bare(s);
  const p = s.players[0];
  p.glove = true;
  p.x = 1 * TS; p.y = 1 * TS; p.dir = DOWN;
  S.step(s, [{ dir: -1, a: true, b: false }]);
  assert.deepEqual([s.bombs[0].x, s.bombs[0].y], [1, 1]);
  S.step(s, [{ dir: -1, a: false, b: true }]);
  assert.deepEqual([s.bombs[0].x, s.bombs[0].y], [1, 4]);
  assert.equal(s.bombs.length, 1);
});

test('rules 2, duel: after two minutes steel closes in from the edges and crushes whoever stands there', () => {
  const s = playing2(2, 9);
  const steelBefore = s.cells.filter((c) => c === HARD).length;
  s.enemies = [];
  for (const q of s.players) q.mystery = 1e6;
  idle(s, S.SHRINK_AT);
  assert.equal(s.cells.filter((c) => c === HARD).length, steelBefore, 'nothing yet');
  const p = s.players[0];
  p.shield = 0; p.mystery = 0;
  p.x = 1 * TS; p.y = 1 * TS; // the first cell of the spiral
  s.enemies = [];
  idle(s, 1);
  assert.equal(at(s, 1, 1), HARD);
  assert.equal(p.alive, false, 'crushed');
  idle(s, S.SHRINK_EVERY * 40);
  assert.ok(s.cells.filter((c) => c === HARD).length > steelBefore + 30);
  if (s.door) assert.notEqual(at(s, s.door[0], s.door[1]), HARD, 'the door stays reachable');
  // Back after the lost life: on open floor, not inside the steel.
  idle(s, S.DIE + 1);
  assert.equal(p.alive, true);
  const [cx, cy] = S.cellOf(p.x, p.y);
  assert.equal(at(s, cx, cy), EMPTY);
});

test('rules 1 and solo games never close in', () => {
  for (const s of [playing(2, 9), playing2(1, 9)]) {
    const steel = s.cells.filter((c) => c === HARD).length;
    s.enemies = [];
    for (const p of s.players) p.mystery = 1e6;
    idle(s, S.SHRINK_AT + 600);
    assert.equal(s.cells.filter((c) => c === HARD).length, steel);
  }
});

test('four bombers: one per corner; out of lives they drop out, the last one standing wins', () => {
  const s = playing(4);
  assert.equal(s.duel, true);
  assert.deepEqual(s.players.map((p) => [p.x / TS, p.y / TS]), S.STARTS);
  bare(s);
  const [a, b, c, d] = s.players;
  // Two of them lose their last life: the game goes on without them.
  for (const p of [b, c]) { p.lives = 1; p.alive = false; p.dieT = 0; }
  idle(s, S.DIE + 1);
  assert.equal(s.phase, 'play');
  assert.deepEqual([b.out, c.out, b.alive, c.alive], [true, true, false, false]);
  // The third one out: the one left wins.
  d.lives = 1; d.alive = false; d.dieT = 0;
  idle(s, S.DIE + 1);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, a.pi);
  assert.equal(S.newGame(9, 1).players.length, S.MAX_PLAYERS);
});
