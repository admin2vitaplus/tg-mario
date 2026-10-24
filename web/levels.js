// «Прыг-Скок» level grid helpers; the maps themselves are in worlds.js. Each level builder
// returns one wide character grid split into areas, plus pipes, lifts, plant pipes and
// the checkpoint. Loaded before worlds.js and game.js;
// also loaded by tests/levels.test.mjs, so it uses no browser or Phaser APIs.
// Chars: # ground, B brick, ? bonus (coin), M bonus (berry), L bonus (extra life), C brick with coins,
// H hard block, [ ] pipe lip, { } pipe body, o coin, e enemy, | pole, T pole top,
// ~ lava surface, = lava, f lava ball jumping from below, r fire bar around this block,
// ( - ) treetop cap, i tree trunk, _ castle bridge, q w side pipe mouth, z x side pipe body,
// h hidden block with an extra life, k hidden block with a coin (invisible until hit from below),
// V brick with a vine, c cloud block, u cannon barrel (fires bullets), j cannon stand.
(function () {
'use strict';

// A level is one wide grid split into areas (the main course, a bonus room, an exit
// outside). Each area has its own colors and camera limits; pipes move the hero between them.
function grid(W) {
  const H = 15;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const put = (x, y, ch) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch; };
  const row = (x, y, s) => { [...s].forEach((ch, i) => { if (ch !== ' ') put(x + i, y, ch); }); };
  const fill = (x0, x1, y0, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch); };
  const L = {
    g, W, H, put, row, fill,
    areas: [],
    pipes: [],
    lifts: [],
    // Pipes with a biting plant: left tile and top row of the pipe.
    plants: [],
    // Text painted on the level: center tile x, row, text.
    signs: [],
    // Castle maze: crossing x with the feet outside rows sends the hero back to (back, backY).
    loops: [],
    // Bricks with a vine: hit from below, it grows to the top of the screen; climbing out
    // of the top leads to `to` (an area, the vine's column there and the cloud row it reaches).
    vines: [],
    vine(x, y, to) { put(x, y, 'V'); L.vines.push({ x, y, to }); },
    pipe(x, h) {
      const top = 13 - h;
      put(x, top, '['); put(x + 1, top, ']');
      for (let y = top + 1; y < 13; y++) { put(x, y, '{'); put(x + 1, y, '}'); }
    },
    // Pipe lying on its side with the mouth at (x, y..y+1), turning up into the ceiling.
    sidePipe(x, y, top) {
      put(x, y, 'q'); put(x, y + 1, 'w');
      put(x + 1, y, 'z'); put(x + 1, y + 1, 'x');
      for (let yy = top; yy <= y + 1; yy++) { put(x + 2, yy, '{'); put(x + 3, yy, '}'); }
    },
    column(x, h) { for (let y = 13 - h; y < 13; y++) put(x, y, 'H'); },
    // Cannon h tiles tall on the ground: the barrel on top fires bullets, the stand below.
    cannon(x, h) { put(x, 13 - h, 'u'); for (let y = 14 - h; y < 13; y++) put(x, y, 'j'); },
    stairsUp(x, n) { for (let i = 0; i < n; i++) L.column(x + i, i + 1); },
    stairsDown(x, n) { for (let i = 0; i < n; i++) L.column(x + i, n - i); },
    floor(ch = '#', x0 = 0, x1 = W - 1) { fill(x0, x1, 13, 14, ch); },
    gap(a, b, lava) {
      fill(a, b, 13, 14, '.');
      if (lava) { fill(a, b, 13, 13, '~'); fill(a, b, 14, 14, '='); }
    },
    tree(x, w, top) {
      put(x, top, '(');
      for (let i = 1; i < w - 1; i++) put(x + i, top, '-');
      put(x + w - 1, top, ')');
      const t0 = x + Math.floor((w - 1) / 2);
      const t1 = w >= 6 ? t0 + 1 : t0;
      fill(t0, t1, top + 1, 14, 'i');
    },
    enemies(xs, y = 12) { for (const x of xs) put(x, y, 'e'); },
    flagpole(x) {
      put(x, 3, 'T');
      for (let y = 4; y < 12; y++) put(x, y, '|');
      put(x, 12, 'H');
    },
    area(x0, x1, tiles, sky, scenery = 'none') { L.areas.push({ x0, x1, tiles, sky, scenery }); },
    // Bonus clouds above the course, x0..x1: the vine comes up at x0 + 1 next to a cloud ledge,
    // a cloud lift carries the hero under rows of coins, and falling off the far end (or anywhere) drops
    // the hero back onto the main course at tile x `drop`. Returns the vine target.
    clouds(x0, x1, drop, sky = '#6b8cff') {
      L.areas.push({ x0, x1, tiles: 'tiles', sky, scenery: 'sky', drop });
      fill(x0 + 2, x0 + 7, 12, 12, 'c');
      const lift = x1 - x0 - 20;
      L.lifts.push({ x: x0 + 8, y: 12, w: 3, axis: 'x', dist: lift, carry: 4 });
      for (let x = x0 + 4; x < x1 - 8; x++) {
        if (x % 2 === 0) put(x, 8, 'o');
        if (x > x0 + 10 && x % 2 === 1) put(x, 6, 'o');
      }
      fill(x1 - 9, x1 - 6, 12, 12, 'c');
      return { area: L.areas.length - 1, x: x0 + 1, y: 12 };
    },
    done(extra) {
      return Object.assign({ grid: g, W, H, areas: L.areas, pipes: L.pipes, lifts: L.lifts, plants: L.plants, signs: L.signs, loops: L.loops, vines: L.vines }, extra);
    },
  };
  return L;
}

// Tiles the hero stands on or bumps into (tests/levels.test.mjs uses the same).
const SOLID = new Set(['#', 'B', '?', 'M', 'L', 'C', 'H', '[', ']', '{', '}', '(', '-', ')', '_', 'q', 'w', 'z', 'x', 'r', 'p', 'V', 'c', 'u', 'j']);

// Rough reachability on the tile grid for a small hero (one tile tall): walking, falling,
// jumps up to 4 tiles high (7 wide when 2 high or less), lifts along their whole track, springboards,
// hidden blocks, pipes, vines up to the clouds, falling off the clouds and swimming in water areas.
// Returns the set of reachable body cells "x,y".
function reach(lvl, from) {
  const at = (x, y) => lvl.grid[y]?.[x];
  const areaOf = (x) => lvl.areas.findIndex((a) => x >= a.x0 && x < a.x1);
  const solid = (x, y) => SOLID.has(at(x, y));
  const free = (x, y) => x >= 0 && x < lvl.W && y >= 0 && y < lvl.H && !solid(x, y) && !'~=f'.includes(at(x, y));
  const liftTop = new Set();
  for (const l of lvl.lifts) {
    const xs = l.axis === 'x' ? l.w + l.dist : l.w;
    const ys = l.axis === 'y' ? l.dist : 0;
    for (let dx = 0; dx < xs; dx++) for (let dy = 0; dy <= ys; dy++) liftTop.add(`${l.x + dx},${l.y + dy - 1}`);
  }
  const water = (x) => !!(lvl.areas[areaOf(x)] || {}).water;
  const stand = (x, y) => free(x, y) && (solid(x, y + 1) || liftTop.has(`${x},${y}`));
  const loopOk = (x, y, x2, y2) => (lvl.loops || []).every((lp) => {
    const crosses = (x < lp.x) !== (x2 < lp.x);
    return !crosses || (y >= lp.rows[0] && y <= lp.rows[1]);
  });
  const land = (x, y) => {
    while (y < lvl.H && free(x, y) && !stand(x, y)) y++;
    if (y < lvl.H && stand(x, y)) return [x, y];
    // Off the bonus clouds the hero drops back onto the main course from the top.
    const drop = y >= lvl.H ? (lvl.areas[areaOf(x)] || {}).drop : undefined;
    return drop !== undefined ? land(drop, 0) : null;
  };
  const seen = new Set();
  const queue = [];
  const push = (c, x, y) => {
    if (!c) return;
    const k = `${c[0]},${c[1]}`;
    if (seen.has(k) || !loopOk(x, y, c[0], c[1])) return;
    seen.add(k);
    queue.push(c);
  };
  push(land(from[0], from[1] - 1), from[0], from[1] - 1);
  while (queue.length) {
    const [x, y] = queue.shift();
    if (water(x)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (free(x + dx, y + dy) && y + dy >= 2) push([x + dx, y + dy], x, y);
      }
    }
    const spring = at(x, y + 1) === 'p';
    const up = spring ? 12 : 4;
    for (let dy = -up; dy <= lvl.H; dy++) {
      // A running jump (take-off at 300 px/s, 150 px/s across) clears about 7 tiles on the level
      // and lands 6 tiles further on a ledge 3-4 tiles up.
      const reachX = dy > 0 ? 7 + Math.floor(dy / 2) : spring || dy >= -2 ? 7 : 6;
      // Room to rise straight up before the jump.
      let clear = true;
      for (let yy = y - 1; yy >= y + dy - 1 && yy >= 0; yy--) if (!free(x, yy)) { clear = false; break; }
      if (dy < 0 && !clear) continue;
      for (let dx = -reachX; dx <= reachX; dx++) {
        const x2 = x + dx;
        const y2 = y + dy;
        if (stand(x2, y2)) push([x2, y2], x, y);
      }
    }
    for (const dx of [-1, 1]) if (free(x + dx, y)) push(land(x + dx, y), x, y);
    // A vine brick hit from below (head up to 4 tiles above the feet) grows a vine to the clouds.
    for (const v of lvl.vines || []) {
      if (v.x !== x || v.y >= y || y - v.y > 5) continue;
      let open = true;
      for (let yy = v.y + 1; yy < y; yy++) if (!free(x, yy)) open = false;
      if (open) push([v.to.x + 1, v.to.y - 1], x, y);
    }
    // A hidden block hit from below turns solid and can then be stood on.
    for (let yy = y - 1; yy >= y - 5 && free(x, yy); yy--) {
      if ('hk'.includes(at(x, yy))) { if (free(x, yy - 1)) push([x, yy - 1], x, y); break; }
    }
    for (const p of lvl.pipes) {
      const on = p.type === 'down' ? (y === p.y - 1 && (x === p.x || x === p.x + 1)) : (y === p.y + 1 && x === p.x - 1);
      if (!on || p.to.world) continue;
      if (p.to.pipeX !== undefined) push([p.to.pipeX, p.to.pipeY - 1], p.to.pipeX, p.to.pipeY - 1);
      else push(land(p.to.x, p.to.y - 1), p.to.x, p.to.y - 1);
    }
  }
  return seen;
}

// Can the hero touch the tile (x, y) from the cells reach() found: stand on it, or jump into it
// from at most 2 tiles aside and 4 below (12 from a springboard) with nothing in the way.
function touches(lvl, cells, x, y) {
  if (cells.has(x + ',' + y)) return true;
  const solid = (tx, ty) => SOLID.has(lvl.grid[ty]?.[tx]);
  for (let sx = x - 2; sx <= x + 2; sx++) {
    for (let sy = y; sy < lvl.H; sy++) {
      if (!cells.has(sx + ',' + sy) || sy - y > (lvl.grid[sy + 1]?.[sx] === 'p' ? 12 : 4)) continue;
      let open = true;
      for (let yy = y; yy <= sy; yy++) if (solid(x, yy) || solid(sx, yy)) open = false;
      if (open) return true;
    }
  }
  return false;
}

// Three medals on every level (bits 1, 2, 4), each in place of a coin the hero can reach: the highest in a bonus
// room off the main course, then the highest one in each part of the course, at least
// MEDAL_GAP tiles from each other. Chosen from the map, so a level that changes keeps its medals.
const MEDAL_GAP = 5;
function medalSpots(lvl) {
  const start = (lvl.start || [3, 13])[0];
  const areaOf = (x) => lvl.areas.findIndex((a) => x >= a.x0 && x < a.x1);
  const main = areaOf(start);
  const coins = [];
  for (let y = 0; y < lvl.H; y++) {
    for (let x = 0; x < lvl.W; x++) if (lvl.grid[y][x] === 'o') coins.push({ x, y, side: areaOf(x) !== main });
  }
  const higher = (a, b) => a.y - b.y || a.x - b.x;
  // Only coins the hero can surely get (reach and touches below), while there are enough of them.
  const cells = reach(lvl, lvl.start || [3, 13]);
  const sure = coins.filter((c) => touches(lvl, cells, c.x, c.y));
  const jumpable = (c) => sure.length < 3 || sure.includes(c);
  const picked = [];
  const take = (list, gap = MEDAL_GAP) => {
    const c = list.filter(jumpable).sort(higher).find((o) => !picked.includes(o) && picked.every((p) => Math.abs(p.x - o.x) >= gap));
    if (c && picked.length < 3) picked.push(c);
    return !!c;
  };
  take(coins.filter((c) => c.side));
  const course = coins.filter((c) => !c.side);
  if (course.length) {
    const x0 = Math.min(...course.map((c) => c.x)), x1 = Math.max(...course.map((c) => c.x)) + 1;
    for (let part = 0; part < 3; part++) {
      const a = x0 + ((x1 - x0) * part) / 3, b = x0 + ((x1 - x0) * (part + 1)) / 3;
      take(course.filter((c) => c.x >= a && c.x < b));
    }
  }
  // Too few coins far apart: closer ones, then any.
  for (const gap of [MEDAL_GAP, 3, 0]) while (picked.length < 3 && take(coins, gap));
  while (picked.length < 3 && coins.some((c) => !picked.includes(c))) picked.push(coins.filter((c) => !picked.includes(c)).sort(higher)[0]);
  return picked.sort((a, b) => a.x - b.x).map((c) => [c.x, c.y]);
}

// worlds.js adds the eight worlds.
window.PrygLevels = { WORLDS: [], grid, medalSpots, reach, touches };
})();
