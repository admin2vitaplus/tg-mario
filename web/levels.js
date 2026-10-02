// «Прыг-Скок» level maps. Each builder returns one wide character grid split into
// areas, plus pipes, lifts, plant pipes and the checkpoint. Loaded before game.js;
// also loaded by tests/levels.test.mjs, so it uses no browser or Phaser APIs.
// Chars: # ground, B brick, ? bonus (coin), M bonus (berry), L bonus (extra life), C brick with coins,
// H hard block, [ ] pipe lip, { } pipe body, o coin, e enemy, | pole, T pole top,
// ~ lava surface, = lava, f lava ball jumping from below, r fire bar around this block,
// ( - ) treetop cap, i tree trunk, _ castle bridge, q w side pipe mouth, z x side pipe body,
// h hidden block with an extra life, k hidden block with a coin (invisible until hit from below).
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
    done(extra) {
      return Object.assign({ grid: g, W, H, areas: L.areas, pipes: L.pipes, lifts: L.lifts, plants: L.plants, signs: L.signs }, extra);
    },
  };
  return L;
}

// 1-1 follows the classic rhythm: first blocks and a berry, four pipes of growing height
// (the last one leads down to a coin room), a hidden extra life, brick rows high up,
// block clusters, two pairs of staircases (the second over a pit) and a big staircase to the flag.
function levelField() {
  const L = grid(230);
  const { row, fill, pipe, column, stairsUp, stairsDown, put } = L;
  L.area(0, 212, 'tiles', '#6b8cff', 'field');
  L.area(214, 230, 'tilesCave', '#000000');
  L.floor('#', 0, 211);
  L.gap(69, 70);
  L.gap(86, 88);
  L.gap(153, 154);

  row(16, 9, '?');
  row(20, 9, 'BMB?B');
  row(22, 5, '?');
  pipe(28, 2);
  pipe(38, 3);
  pipe(46, 4);
  pipe(57, 4);
  put(64, 8, 'h');
  row(77, 9, 'BMB');
  row(80, 5, 'BBBBBBBB');
  row(91, 5, 'BBB?');
  row(94, 9, 'C');
  row(100, 9, 'BB');
  row(106, 9, '?  ?  ?');
  row(109, 5, 'M');
  row(118, 9, 'B');
  row(121, 5, 'BBB');
  row(128, 5, 'B??B');
  row(129, 9, 'BB');
  stairsUp(134, 4);
  stairsDown(140, 4);
  stairsUp(148, 4);
  column(152, 4);
  stairsDown(155, 4);
  pipe(163, 2);
  row(168, 9, 'BB?B');
  pipe(179, 2);
  stairsUp(181, 8);
  column(189, 8);
  L.flagpole(198);

  L.enemies([22, 40, 51, 53, 97, 99, 107, 114, 116, 124, 126, 128, 130, 174, 176]);
  L.enemies([81, 83], 4);

  // Coin room under the last tall pipe; its side pipe leads back up through the pipe near the end.
  L.floor('#', 214, 229);
  fill(214, 214, 2, 12, 'B');
  fill(214, 229, 1, 1, 'B');
  fill(217, 223, 10, 12, 'B');
  row(217, 9, 'ooooooo');
  row(217, 8, 'ooooooo');
  row(218, 6, 'ooooo');
  L.sidePipe(226, 11, 2);
  L.pipes.push({ type: 'down', x: 57, y: 9, to: { area: 1, x: 216, y: 3 } });
  L.pipes.push({ type: 'side', x: 226, y: 11, to: { area: 0, pipeX: 163, pipeY: 11 } });

  // After the high bricks the hero comes back here instead of the start.
  return L.done({ goal: 'pole', goalX: 198, checkpoint: { x: 92, start: [92, 13] } });
}

// Underground: brick ceiling, low passages, lots of coins, biting plants in the pipes,
// a pipe down to a coin room, lifts over a pit, a side pipe up to the flag.
// Riding the high lift up lets the hero jump onto the ceiling and run over the exit
// to the warp zone, whose three pipes lead to worlds 2, 3 and 4.
function levelCave() {
  const L = grid(252);
  const { row, fill, pipe, column, stairsUp } = L;
  L.area(0, 178, 'tilesCave', '#000000');
  L.area(178, 198, 'tilesCave', '#000000');
  L.area(200, 232, 'tiles', '#6b8cff', 'field');
  L.area(234, 252, 'tilesCave', '#000000');
  L.floor('#', 0, 177);
  fill(0, 0, 1, 12, 'B');
  fill(6, 145, 1, 1, 'B');
  L.gap(46, 48);
  L.gap(98, 100);
  L.gap(122, 123);

  row(10, 9, 'M?????');
  row(18, 11, 'oo');
  stairsUp(27, 4);
  column(31, 4);
  column(32, 3);
  row(28, 6, 'oooo');
  fill(38, 43, 5, 6, 'B');
  row(38, 8, 'oooooo');
  row(39, 6, 'C');
  row(45, 9, 'BBBBB');
  fill(52, 53, 2, 8, 'B');
  row(52, 9, 'CB');
  row(56, 11, 'oooooo');
  fill(56, 63, 9, 9, 'B');
  row(56, 8, 'oooooooo');
  fill(66, 71, 2, 9, 'B');
  fill(66, 71, 5, 7, '.');
  row(66, 6, 'oooooo');
  row(73, 9, 'B?B');
  pipe(80, 3);
  row(84, 6, 'oooo');
  pipe(88, 4);
  row(92, 9, 'BMB');
  fill(94, 97, 3, 3, 'B');
  row(101, 9, 'BBB');
  row(101, 8, 'ooo');
  pipe(106, 2);
  row(110, 5, 'BBBBBBBBBB');
  row(110, 9, 'B?BCB?B');
  row(110, 8, 'ooooooo');
  column(118, 2);
  row(125, 9, 'oooo');
  fill(126, 129, 10, 10, 'H');
  stairsUp(136, 6);
  fill(142, 145, 7, 12, 'H');
  row(142, 6, 'oooo');
  L.plants.push({ x: 80, y: 10 }, { x: 88, y: 9 });

  // Pit with two lifts and no ceiling above it; the right lift rises high enough
  // to jump onto the ceiling.
  L.gap(146, 157);
  L.lifts.push({ x: 148, y: 6, w: 3, axis: 'y', dist: 5, period: 4, phase: 0 });
  L.lifts.push({ x: 154, y: 2, w: 3, axis: 'y', dist: 8, period: 5, phase: 0.5 });
  fill(158, 177, 1, 1, 'B');
  row(160, 9, 'BB?BB');
  row(160, 8, 'ooooo');
  L.sidePipe(170, 11, 2);
  fill(174, 177, 1, 12, 'H');
  L.pipes.push({ type: 'side', x: 170, y: 11, to: { area: 2, pipeX: 202, pipeY: 11 } });

  // Warp zone behind the exit wall, reached over the ceiling.
  L.floor('#', 178, 197);
  fill(181, 197, 1, 1, 'B');
  fill(196, 197, 2, 12, 'B');
  pipe(183, 3);
  pipe(188, 3);
  pipe(193, 3);
  L.signs.push({ x: 189, y: 4.5, text: 'ЗОНА ПЕРЕХОДА' });
  [[183, 2], [188, 3], [193, 4]].forEach(([x, world]) => {
    L.signs.push({ x: x + 1, y: 8.5, text: String(world) });
    L.pipes.push({ type: 'down', x, y: 10, to: { world } });
  });

  // Outside: exit pipe, stairs and the flag.
  L.floor('#', 200, 231);
  pipe(202, 2);
  stairsUp(208, 8);
  column(216, 8);
  L.flagpole(224);

  // Coin room under the tall pipe with a plant; out through the short pipe further on.
  L.floor('#', 234, 251);
  fill(234, 234, 2, 12, 'B');
  fill(234, 251, 1, 1, 'B');
  fill(237, 243, 10, 12, 'B');
  row(237, 9, 'ooooooo');
  row(237, 8, 'ooooooo');
  row(238, 6, 'ooooo');
  L.sidePipe(246, 11, 2);
  L.pipes.push({ type: 'down', x: 88, y: 9, to: { area: 3, x: 236, y: 3 } });
  L.pipes.push({ type: 'side', x: 246, y: 11, to: { area: 0, pipeX: 106, pipeY: 11 } });

  L.enemies([16, 20, 35, 37, 58, 60, 62, 76, 84, 86, 96, 112, 114, 120, 131, 133, 163, 166]);
  return L.done({ goal: 'pole', goalX: 224, checkpoint: { x: 92, start: [92, 13] } });
}

// Treetops: platforms high above a bottomless drop, with lifts between them.
function levelTrees() {
  const L = grid(180);
  const { row, tree } = L;
  L.area(0, 180, 'tiles', '#6b8cff', 'sky');
  L.floor('#', 0, 15);
  tree(17, 4, 11);
  tree(23, 6, 8);
  row(24, 5, 'oooo');
  tree(31, 3, 10);
  tree(36, 5, 7);
  tree(44, 7, 9);
  row(46, 5, '?M?');
  L.lifts.push({ x: 53, y: 9, w: 3, axis: 'x', dist: 5, period: 4, phase: 0 });
  tree(61, 5, 7);
  row(62, 4, 'ooo');
  tree(69, 4, 10);
  tree(76, 8, 7);
  row(77, 4, 'oooooo');
  L.lifts.push({ x: 87, y: 6, w: 3, axis: 'y', dist: 5, period: 3.5, phase: 0.25 });
  tree(92, 4, 8);
  row(93, 6, 'oo');
  tree(99, 6, 11);
  row(100, 8, '?  ?');
  L.lifts.push({ x: 107, y: 9, w: 3, axis: 'x', dist: 4, period: 3.5, phase: 0 });
  tree(115, 5, 7);
  row(116, 4, 'ooo');
  tree(122, 3, 9);
  tree(128, 6, 7);
  row(129, 4, 'oooo');
  L.lifts.push({ x: 136, y: 5, w: 3, axis: 'y', dist: 5, period: 3.5, phase: 0.75 });
  tree(141, 5, 9);
  L.floor('#', 148, 179);
  L.stairsUp(152, 4);
  L.flagpole(166);

  L.enemies([25], 7);
  L.enemies([38], 6);
  L.enemies([46, 48], 8);
  L.enemies([79, 81], 6);
  L.enemies([101], 10);
  L.enemies([130], 6);
  L.enemies([158, 161]);
  return L.done({ goal: 'pole', goalX: 166, checkpoint: { x: 76, start: [79, 7] } });
}

// Castle: lava pits with jumping lava balls, rotating fire bars, and a bridge
// guarded by a big beetle. Pulling the lever at the far end drops the bridge.
function levelCastle() {
  const L = grid(200);
  const { row, fill, column, put } = L;
  L.area(0, 200, 'tilesCastle', '#000000');
  L.floor();
  fill(0, 145, 0, 2, 'H');
  fill(0, 5, 8, 12, 'H');
  fill(6, 15, 9, 12, 'H');
  L.gap(16, 19, true);
  put(18, 13, 'f');
  fill(20, 26, 9, 12, 'H');
  fill(27, 45, 3, 4, 'H');
  put(34, 8, 'r');
  put(30, 9, 'M');
  L.gap(46, 49, true);
  put(48, 13, 'f');
  fill(50, 54, 11, 12, 'H');
  row(58, 9, '? ? ?');
  L.gap(66, 69, true);
  put(67, 13, 'f');
  fill(70, 73, 10, 12, 'H');
  put(72, 10, 'r');
  fill(74, 90, 3, 5, 'H');
  row(78, 10, 'oooooo');
  put(86, 12, 'r');
  L.gap(92, 99, true);
  fill(95, 96, 10, 14, 'H');
  put(93, 13, 'f');
  put(98, 13, 'f');
  fill(100, 104, 8, 12, 'H');
  put(104, 8, 'r');
  row(108, 9, '?M?');
  column(115, 3);
  put(115, 10, 'r');
  L.gap(120, 132, true);
  fill(123, 125, 11, 14, 'H');
  fill(128, 130, 9, 14, 'H');
  put(121, 13, 'f');
  put(126, 13, 'f');
  put(131, 13, 'f');
  fill(133, 145, 3, 4, 'H');
  fill(133, 135, 10, 12, 'H');
  put(134, 10, 'r');

  // Boss room: a bridge over lava, the lever behind it.
  fill(146, 199, 0, 3, 'H');
  fill(146, 149, 9, 12, 'H');
  L.gap(150, 165, true);
  fill(150, 165, 9, 9, '_');
  fill(166, 172, 9, 14, 'H');
  fill(173, 199, 4, 12, 'H');

  L.enemies([12, 24], 8);
  L.enemies([40, 42, 56, 64, 80, 84, 110, 112, 140, 144]);
  return L.done({
    goal: 'lever', goalX: 167, start: [3, 8],
    bridge: { x0: 150, x1: 165, y: 9 },
    boss: { x: 161, min: 153, max: 164 },
  });
}

const LEVELS = [
  { name: 'ПОЛЕ', build: levelField, time: 400 },
  { name: 'ПОДЗЕМЕЛЬЕ', build: levelCave, time: 400 },
  { name: 'ВЕРХУШКИ ДЕРЕВЬЕВ', build: levelTrees, time: 300 },
  { name: 'ЗАМОК', build: levelCastle, time: 300 },
];

window.PrygLevels = { LEVELS, grid };
})();
