// Танкодром: a computer partner for the second tank, when no friend came (mode 'bot').
// It only presses buttons: think() looks at the game and gives { dir, fire } like a pad,
// so the game is recorded and checked by the server like any game for two.
(function (root) {
'use strict';

const S = root.TankSim;
const { UP, RIGHT, DOWN, LEFT } = S;
const BASE_X = 104, BASE_Y = 200; // the middle of the base
const NEAR = 10;                  // px off the line that still counts as in line

// mem keeps the bot's plans between frames; one per game.
function newMemory() {
  return { x: -1, y: -1, still: 0, detour: 0, detourDir: UP, want: -1, wait: 0 };
}

// Would a shell from t in direction dir hit the base or the partner before anything else we want?
function badShot(s, t, dir, target) {
  const cx = t.x + 8, cy = t.y + 8;
  if (dir === DOWN && Math.abs(cx - BASE_X) < 14) return true;
  if ((dir === LEFT || dir === RIGHT) && cy > 176 && Math.sign(BASE_X - cx) === (dir === RIGHT ? 1 : -1)) return true;
  const far = target ? Math.abs(target.x - t.x) + Math.abs(target.y - t.y) : 1e9;
  for (const p of s.players) {
    const o = p.tank;
    if (!o || o === t) continue;
    const ox = o.x + 8, oy = o.y + 8;
    const ahead = dir === UP ? cy - oy : dir === DOWN ? oy - cy : dir === LEFT ? cx - ox : ox - cx;
    const off = dir === UP || dir === DOWN ? Math.abs(ox - cx) : Math.abs(oy - cy);
    if (ahead > 0 && off < 14 && ahead < far) return true;
  }
  return false;
}

function think(s, pi, mem) {
  const t = s.players[pi] && s.players[pi].tank;
  if (!t || s.phase !== 'play') return { dir: -1, fire: false };
  // Stuck against a wall: shoot it and go round for a while.
  if (t.x === mem.x && t.y === mem.y && mem.want >= 0) mem.still++;
  else mem.still = 0;
  mem.x = t.x;
  mem.y = t.y;
  if (mem.still > 14 && !mem.detour) {
    mem.detour = 30;
    mem.detourDir = (mem.want + (s.frame & 1 ? 1 : 3)) % 4;
  }
  // The enemy to go for: near the bot, and above all near the base.
  let target = null, best = 1e9;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const d = (Math.abs(e.x - t.x) + Math.abs(e.y - t.y)) / 2 + Math.abs(e.x + 8 - BASE_X) + Math.abs(e.y + 8 - BASE_Y);
    if (d < best) { best = d; target = e; }
  }
  let dir, fire = false;
  if (mem.detour > 0) {
    mem.detour--;
    dir = mem.detourDir;
    fire = !badShot(s, t, t.dir, null) && t.dir === dir;
  } else if (!target) {
    // Nobody out yet: wait in front of the base, a little to the right.
    const gx = 136, gy = 152;
    dir = Math.abs(t.x - gx) > 4 ? (t.x < gx ? RIGHT : LEFT) : Math.abs(t.y - gy) > 4 ? (t.y < gy ? DOWN : UP) : -1;
  } else {
    const dx = target.x - t.x, dy = target.y - t.y;
    if (Math.abs(dx) < NEAR) dir = dy < 0 ? UP : DOWN;
    else if (Math.abs(dy) < NEAR) dir = dx < 0 ? LEFT : RIGHT;
    // Line up on the axis that is closer.
    else if (Math.abs(dx) < Math.abs(dy)) dir = dx < 0 ? LEFT : RIGHT;
    else dir = dy < 0 ? UP : DOWN;
    const inLine = (Math.abs(dx) < NEAR && dir === (dy < 0 ? UP : DOWN)) || (Math.abs(dy) < NEAR && dir === (dx < 0 ? LEFT : RIGHT));
    // Facing the enemy, or a wall on the way to it: fire.
    fire = t.dir === dir && (inLine || mem.still > 4) && !badShot(s, t, dir, target);
  }
  mem.want = dir;
  return { dir, fire };
}

root.TankBot = { think, newMemory };
})(typeof window !== 'undefined' ? window : globalThis);
