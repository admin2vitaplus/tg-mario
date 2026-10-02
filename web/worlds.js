// «Прыг-Скок» worlds 2-4: four levels each, in the same order as world 1
// (field, a special level, a high level, a castle). Loaded after levels.js and before game.js;
// also loaded by tests/levels.test.mjs, so it uses no browser or Phaser APIs.
// Extra chars (see game.js): v water surface, y water, s fish, p springboard, t bolt thrower, n spiky.
(function () {
'use strict';

const { grid, WORLDS } = window.PrygLevels;
const SKY = '#6b8cff';
const BLACK = '#000000';
const SEA = '#2038b8';

// Castle end: a bridge over lava guarded by the big beetle, the lever behind it.
// Takes 54 tiles from x.
function castleEnd(L, x) {
  const { row, fill } = L;
  fill(x, x + 53, 0, 3, 'H');
  fill(x, x + 3, 9, 12, 'H');
  L.gap(x + 4, x + 19, true);
  fill(x + 4, x + 19, 9, 9, '_');
  fill(x + 20, x + 26, 9, 14, 'H');
  fill(x + 27, x + 53, 4, 12, 'H');
  return {
    goal: 'lever', goalX: x + 21,
    bridge: { x0: x + 4, x1: x + 19, y: 9 },
    boss: { x: x + 15, min: x + 7, max: x + 18 },
  };
}

// Coin room under a pipe, at x0..x0+15, with a side pipe out.
function coinRoom(L, x0) {
  const { row, fill } = L;
  L.floor('#', x0, x0 + 15);
  fill(x0, x0, 2, 12, 'B');
  fill(x0, x0 + 15, 1, 1, 'B');
  fill(x0 + 3, x0 + 9, 10, 12, 'B');
  row(x0 + 3, 9, 'ooooooo');
  row(x0 + 3, 8, 'ooooooo');
  row(x0 + 4, 6, 'ooooo');
  L.sidePipe(x0 + 12, 11, 2);
}

// ---------- World 2 ----------

// 2-1: a meadow with groups of beetles, plant pipes, a springboard to high coins
// and a pipe down to a coin room.
function level21() {
  const L = grid(226);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 208, 'tiles', SKY, 'field');
  L.area(210, 226, 'tilesCave', BLACK);
  L.floor('#', 0, 207);
  L.gap(60, 62);
  L.gap(99, 101);
  L.gap(152, 155);

  stairsUp(10, 3);
  column(13, 3);
  row(18, 9, 'B?BMB');
  row(20, 5, '?');
  row(28, 9, 'oooo');
  pipe(34, 3);
  L.plants.push({ x: 34, y: 10 });
  row(40, 9, 'BBBBBBBB');
  row(41, 5, '?k?');
  row(46, 5, 'BB');
  pipe(52, 4);
  L.plants.push({ x: 52, y: 9 });
  row(64, 9, 'BMB');
  stairsUp(70, 4);
  column(74, 4);
  row(76, 8, 'oooo');
  row(82, 9, '?B?B?');
  put(86, 5, 'h');
  row(90, 9, 'BB');
  row(103, 9, 'BBB');
  row(103, 5, 'BBBBBB');
  row(104, 4, 'oooo');
  pipe(112, 2);
  pipe(120, 3);
  L.plants.push({ x: 120, y: 10 });
  pipe(128, 2);
  row(134, 9, 'B?B');
  stairsUp(144, 4);
  column(148, 4);
  stairsDown(156, 4);
  row(162, 9, 'BBMBB');
  // Springboard: hold A when landing to fly up to the coins.
  put(170, 12, 'p');
  row(168, 3, 'oooooo');
  row(168, 2, 'oooooo');
  pipe(176, 2);
  stairsUp(186, 8);
  column(194, 8);
  L.flagpole(203);

  L.enemies([24, 26, 30, 44, 46, 48, 66, 78, 80, 92, 94, 96, 108, 116, 124, 132, 136, 138, 160, 165, 180, 182]);
  L.enemies([42, 44], 8);

  coinRoom(L, 210);
  L.pipes.push({ type: 'down', x: 128, y: 11, to: { area: 1, x: 212, y: 3 } });
  L.pipes.push({ type: 'side', x: 222, y: 11, to: { area: 0, pipeX: 176, pipeY: 11 } });

  return L.done({ goal: 'pole', goalX: 203, checkpoint: { x: 100, start: [104, 13] } });
}

// 2-2: under water. Every press of A is a stroke up; fish swim at the hero,
// pits in the sea floor drop to nowhere. A side pipe in the far wall leads up to the flag.
function level22() {
  const L = grid(212);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 176, 'tilesSea', SEA);
  L.areas[0].water = true;
  L.area(178, 212, 'tiles', SKY, 'field');
  fill(0, 175, 1, 1, 'v');
  L.floor('#', 0, 175);
  L.gap(28, 31);
  L.gap(66, 70);
  L.gap(112, 116);
  L.gap(140, 143);

  column(12, 3);
  column(13, 3);
  row(16, 6, 'oooo');
  fill(20, 21, 9, 12, 'H');
  fill(22, 25, 4, 4, 'H');
  row(22, 3, 'oooo');
  column(36, 5);
  column(37, 5);
  fill(42, 47, 2, 5, 'H');
  row(42, 8, 'oooooo');
  fill(52, 53, 6, 12, 'H');
  fill(58, 63, 10, 10, 'H');
  row(58, 9, 'oooooo');
  fill(74, 80, 8, 8, 'H');
  fill(74, 74, 2, 7, 'H');
  row(75, 7, 'ooooo');
  column(86, 2);
  fill(90, 92, 2, 6, 'H');
  fill(96, 105, 9, 9, 'H');
  row(96, 8, 'oooooooooo');
  fill(100, 101, 10, 12, 'H');
  column(120, 4);
  column(121, 4);
  fill(126, 131, 3, 5, 'H');
  row(126, 6, 'oooooo');
  fill(134, 137, 10, 10, 'H');
  column(148, 3);
  fill(152, 157, 2, 3, 'H');
  row(152, 4, 'oooooo');
  // Exit wall with the side pipe.
  fill(166, 175, 2, 10, 'H');
  L.sidePipe(162, 11, 11);
  fill(166, 175, 11, 12, 'H');
  L.pipes.push({ type: 'side', x: 162, y: 11, to: { area: 1, pipeX: 180, pipeY: 11 } });

  // Fish, some low and some high.
  for (const [x, y] of [[24, 9], [34, 5], [40, 11], [48, 7], [56, 4], [64, 10], [72, 5], [82, 9], [88, 4],
    [98, 11], [106, 6], [110, 9], [118, 4], [124, 10], [132, 8], [138, 4], [146, 10], [150, 6], [158, 9]]) put(x, y, 's');

  // Outside: the exit pipe, stairs and the flag.
  L.floor('#', 178, 211);
  L.pipe(180, 2);
  stairsUp(186, 8);
  column(194, 8);
  L.flagpole(203);

  return L.done({ goal: 'pole', goalX: 203, checkpoint: { x: 84, start: [86, 11] } });
}

// 2-3: long bridges over the sea; fish leap out of the water at the hero.
function level23() {
  const L = grid(212);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 212, 'tiles', SKY, 'sky');
  fill(0, 211, 13, 13, 'v');
  fill(0, 211, 14, 14, 'y');
  L.floor('#', 0, 13);
  stairsUp(8, 4);
  fill(12, 13, 9, 12, 'H');

  const bridges = [[14, 30, 9], [34, 44, 9], [47, 52, 7], [56, 72, 9], [76, 82, 8], [86, 100, 9],
    [104, 108, 6], [112, 128, 9], [132, 136, 7], [140, 156, 9], [160, 166, 8], [170, 182, 9]];
  for (const [a, b, y] of bridges) {
    fill(a, b, y, y, '_');
    fill(a, a, y + 1, 12, 'H');
    fill(b, b, y + 1, 12, 'H');
  }
  row(18, 5, '?M?');
  row(24, 6, 'oooo');
  row(36, 5, 'ooo');
  row(58, 5, 'B?B?B');
  row(62, 4, 'ooo');
  row(78, 4, 'ooo');
  row(90, 5, '???');
  row(105, 3, 'ooo');
  row(116, 5, 'BMB');
  row(122, 5, 'oooo');
  row(133, 4, 'ooo');
  row(144, 5, '?B?');
  row(150, 6, 'oooo');
  row(162, 5, 'ooo');
  row(174, 5, 'B?B');
  L.floor('#', 186, 211);
  fill(186, 187, 9, 12, 'H');
  stairsUp(190, 6);
  column(196, 6);
  L.flagpole(204);

  L.enemies([22, 64, 94, 120, 148], 8);
  return L.done({ goal: 'pole', goalX: 204, leapFish: { x0: 12, x1: 180 }, checkpoint: { x: 100, start: [114, 9] } });
}

// 2-4: castle with lifts over lava, fire bars and the beetle on the bridge.
function level24() {
  const L = grid(220);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 220, 'tilesCastle', BLACK);
  L.floor();
  fill(0, 165, 0, 2, 'H');
  fill(0, 5, 8, 12, 'H');
  fill(6, 13, 9, 12, 'H');
  L.gap(14, 23, true);
  put(16, 13, 'f');
  put(21, 13, 'f');
  L.lifts.push({ x: 15, y: 10, w: 3, axis: 'x', dist: 5, period: 3.5, phase: 0 });
  fill(24, 30, 9, 12, 'H');
  put(27, 9, 'r');
  fill(31, 50, 3, 4, 'H');
  put(38, 4, 'r');
  row(34, 9, '?M?');
  put(44, 12, 'r');
  L.gap(52, 63, true);
  put(54, 13, 'f');
  put(61, 13, 'f');
  L.lifts.push({ x: 53, y: 10, w: 3, axis: 'x', dist: 6, period: 4, phase: 0 });
  fill(64, 70, 10, 12, 'H');
  put(67, 10, 'r');
  fill(71, 90, 3, 5, 'H');
  row(74, 10, 'oooooo');
  put(82, 5, 'r');
  L.gap(92, 103, true);
  fill(95, 96, 11, 14, 'H');
  fill(99, 100, 11, 14, 'H');
  put(95, 11, 'r');
  put(93, 13, 'f');
  put(98, 13, 'f');
  put(102, 13, 'f');
  fill(104, 108, 8, 12, 'H');
  row(112, 9, '???');
  fill(118, 119, 10, 12, 'H');
  put(118, 10, 'r');
  L.gap(122, 140, true);
  L.lifts.push({ x: 124, y: 9, w: 3, axis: 'x', dist: 5, period: 4, phase: 0 });
  L.lifts.push({ x: 135, y: 8, w: 3, axis: 'y', dist: 3, period: 3, phase: 0.5 });
  put(126, 13, 'f');
  put(137, 13, 'f');
  fill(141, 165, 3, 4, 'H');
  fill(141, 145, 10, 12, 'H');
  put(144, 10, 'r');
  row(150, 9, 'B?B');

  L.enemies([10, 12], 8);
  L.enemies([40, 46, 78, 84, 110, 114, 150, 156, 160]);
  return L.done(Object.assign(castleEnd(L, 166), { start: [3, 8] }));
}

// ---------- World 3 (night) ----------

// 3-1: night meadow; bolt throwers guard the brick towers.
function level31() {
  const L = grid(226);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 208, 'tiles', SKY, 'field');
  L.areas[0].night = true;
  L.area(210, 226, 'tilesCave', BLACK);
  L.floor('#', 0, 207);
  L.gap(46, 48);
  L.gap(119, 121);

  row(14, 9, 'B?B');
  row(15, 5, 'M');
  pipe(24, 2);
  pipe(32, 3);
  L.plants.push({ x: 32, y: 10 });
  row(38, 9, 'oooo');
  stairsUp(52, 3);
  column(55, 3);
  row(60, 9, 'BBBBBB');
  row(60, 5, 'BB?BBB');
  put(62, 8, 't');
  put(62, 4, 'o');
  put(63, 4, 'o');
  row(72, 9, '?');
  row(76, 9, 'BhB');
  pipe(84, 4);
  L.plants.push({ x: 84, y: 9 });
  row(92, 9, 'BBBB');
  row(92, 5, 'BBBB');
  put(94, 12, 't');
  row(100, 9, 'oooo');
  stairsUp(106, 4);
  stairsDown(112, 4);
  row(124, 9, 'B?B?B');
  put(128, 5, 'M');
  // Springboard to the coins over the towers.
  put(136, 12, 'p');
  row(134, 3, 'oooooooo');
  pipe(142, 2);
  row(148, 9, 'BBBBBB');
  row(148, 5, 'BBBBBB');
  put(150, 8, 't');
  put(152, 12, 't');
  pipe(164, 2);
  stairsUp(186, 8);
  column(194, 8);
  L.flagpole(203);

  L.enemies([20, 22, 36, 40, 68, 70, 88, 98, 102, 116, 130, 132, 158, 172, 174, 176]);

  coinRoom(L, 210);
  L.pipes.push({ type: 'down', x: 84, y: 9, to: { area: 1, x: 212, y: 3 } });
  L.pipes.push({ type: 'side', x: 222, y: 11, to: { area: 0, pipeX: 142, pipeY: 11 } });

  return L.done({ goal: 'pole', goalX: 203, checkpoint: { x: 100, start: [101, 13] } });
}

// 3-2: a long night road with many beetles, few blocks and a pair of throwers.
function level32() {
  const L = grid(212);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 212, 'tiles', SKY, 'field');
  L.areas[0].night = true;
  L.floor('#', 0, 211);
  L.gap(70, 72);
  L.gap(130, 133);

  row(18, 9, '?M?');
  row(30, 9, 'oooooo');
  pipe(40, 2);
  row(48, 9, 'BkB');
  put(56, 5, 'h');
  row(62, 9, 'B?B');
  pipe(80, 3);
  L.plants.push({ x: 80, y: 10 });
  row(86, 8, 'oooooo');
  row(96, 9, 'BBBB');
  put(98, 12, 't');
  column(104, 2);
  row(110, 9, 'B?B?B');
  row(112, 5, 'M');
  stairsUp(122, 4);
  column(126, 4);
  column(127, 4);
  stairsUp(134, 3);
  row(142, 9, 'oooo');
  pipe(150, 2);
  row(156, 9, 'BBBB');
  put(158, 12, 't');
  stairsUp(176, 8);
  column(184, 8);
  L.flagpole(194);

  L.enemies([14, 16, 24, 26, 28, 34, 36, 44, 46, 52, 54, 58, 66, 68, 76, 90, 92, 106, 108, 116, 118, 120,
    138, 140, 146, 162, 164, 166, 170]);
  return L.done({ goal: 'pole', goalX: 194, checkpoint: { x: 104, start: [106, 13] } });
}

// 3-3: night treetops, swinging lifts between them.
function level33() {
  const L = grid(190);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 190, 'tiles', SKY, 'sky');
  L.areas[0].night = true;
  L.floor('#', 0, 14);
  tree(16, 5, 10);
  tree(24, 4, 7);
  row(25, 4, 'oo');
  L.lifts.push({ x: 30, y: 8, w: 3, axis: 'y', dist: 4, period: 3, phase: 0 });
  tree(36, 7, 9);
  row(38, 5, '?M?');
  tree(46, 3, 6);
  L.lifts.push({ x: 51, y: 9, w: 3, axis: 'x', dist: 5, period: 3.5, phase: 0 });
  tree(62, 6, 8);
  row(63, 4, 'oooo');
  tree(71, 4, 11);
  L.lifts.push({ x: 77, y: 7, w: 3, axis: 'y', dist: 5, period: 3.5, phase: 0.5 });
  tree(83, 8, 8);
  row(84, 4, 'oooooo');
  L.lifts.push({ x: 93, y: 8, w: 3, axis: 'x', dist: 4, period: 3, phase: 0.25 });
  tree(102, 4, 7);
  tree(108, 5, 10);
  row(109, 7, '? ?');
  L.lifts.push({ x: 115, y: 6, w: 3, axis: 'y', dist: 5, period: 3, phase: 0 });
  tree(121, 6, 8);
  row(122, 4, 'oooo');
  L.lifts.push({ x: 129, y: 8, w: 3, axis: 'x', dist: 5, period: 3.5, phase: 0.5 });
  tree(139, 4, 7);
  tree(145, 5, 9);
  L.lifts.push({ x: 152, y: 7, w: 3, axis: 'y', dist: 4, period: 3, phase: 0.75 });
  tree(157, 4, 8);
  L.floor('#', 162, 189);
  L.stairsUp(166, 4);
  L.flagpole(178);

  L.enemies([26], 6);
  L.enemies([39, 41], 8);
  L.enemies([65], 7);
  L.enemies([86, 88], 7);
  L.enemies([123], 7);
  L.enemies([147], 8);
  L.enemies([172, 174]);
  return L.done({ goal: 'pole', goalX: 178, checkpoint: { x: 83, start: [86, 8] } });
}

// 3-4: castle with long lava pits, many fire bars and lava balls.
function level34() {
  const L = grid(220);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 220, 'tilesCastle', BLACK);
  L.floor();
  fill(0, 165, 0, 2, 'H');
  fill(0, 5, 8, 12, 'H');
  fill(6, 12, 10, 12, 'H');
  put(9, 10, 'r');
  L.gap(13, 17, true);
  put(15, 13, 'f');
  fill(18, 24, 9, 12, 'H');
  put(21, 9, 'r');
  fill(25, 44, 3, 4, 'H');
  put(30, 4, 'r');
  put(38, 4, 'r');
  row(33, 9, '?M?');
  L.gap(47, 51, true);
  put(49, 13, 'f');
  fill(52, 55, 11, 12, 'H');
  put(53, 11, 'r');
  L.gap(56, 60, true);
  put(58, 13, 'f');
  fill(61, 66, 9, 12, 'H');
  put(64, 9, 'r');
  fill(67, 88, 3, 5, 'H');
  row(70, 10, 'oooooooo');
  put(76, 12, 'r');
  put(84, 5, 'r');
  L.gap(90, 105, true);
  fill(94, 95, 10, 14, 'H');
  fill(100, 101, 8, 14, 'H');
  put(94, 10, 'r');
  put(92, 13, 'f');
  put(97, 13, 'f');
  put(103, 13, 'f');
  fill(106, 110, 8, 12, 'H');
  put(110, 8, 'r');
  row(114, 9, '?M?');
  fill(120, 121, 10, 12, 'H');
  put(120, 10, 'r');
  L.gap(124, 140, true);
  L.lifts.push({ x: 126, y: 9, w: 3, axis: 'x', dist: 4, period: 3.5, phase: 0 });
  L.lifts.push({ x: 134, y: 7, w: 3, axis: 'y', dist: 4, period: 3, phase: 0.25 });
  put(125, 13, 'f');
  put(131, 13, 'f');
  put(138, 13, 'f');
  fill(141, 165, 3, 4, 'H');
  fill(141, 144, 10, 12, 'H');
  put(142, 10, 'r');
  put(154, 4, 'r');

  L.enemies([42, 72, 80, 112, 116, 150, 156, 160]);
  return L.done(Object.assign(castleEnd(L, 166), { start: [3, 8] }));
}

// ---------- World 4 ----------

// 4-1: a meadow under a cloud rider that drops spiky eggs.
function level41() {
  const L = grid(226);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 208, 'tiles', SKY, 'field');
  L.area(210, 226, 'tilesCave', BLACK);
  L.floor('#', 0, 207);
  L.gap(58, 60);
  L.gap(111, 113);
  L.gap(150, 152);

  row(16, 9, '?M?');
  pipe(26, 2);
  row(32, 9, 'BBBB');
  row(33, 5, '??');
  pipe(42, 3);
  L.plants.push({ x: 42, y: 10 });
  row(48, 9, 'oooo');
  stairsUp(52, 4);
  column(56, 4);
  row(64, 9, 'B?BkB');
  put(68, 5, 'h');
  pipe(74, 4);
  L.plants.push({ x: 74, y: 9 });
  row(82, 9, 'BBMBB');
  row(90, 8, 'oooooo');
  pipe(98, 2);
  row(104, 9, '???');
  stairsUp(114, 3);
  row(122, 9, 'BBB');
  row(122, 5, 'B?B');
  pipe(130, 3);
  L.plants.push({ x: 130, y: 10 });
  row(138, 9, 'oooo');
  stairsUp(144, 4);
  column(148, 4);
  stairsDown(153, 4);
  pipe(166, 2);
  stairsUp(186, 8);
  column(194, 8);
  L.flagpole(203);

  L.enemies([22, 36, 38, 66, 80, 94, 96, 118, 136, 160, 172, 176]);
  coinRoom(L, 210);
  L.pipes.push({ type: 'down', x: 98, y: 11, to: { area: 1, x: 212, y: 3 } });
  L.pipes.push({ type: 'side', x: 222, y: 11, to: { area: 0, pipeX: 166, pipeY: 11 } });

  return L.done({ goal: 'pole', goalX: 203, rider: { x0: 10, x1: 176 }, checkpoint: { x: 100, start: [102, 13] } });
}

// 4-2: a deep cave: low ceilings, lifts over pits, plant pipes, a hidden life
// and a side pipe out to the flag.
function level42() {
  const L = grid(232);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 196, 'tilesCave', BLACK);
  L.area(198, 232, 'tiles', SKY, 'field');
  L.floor('#', 0, 195);
  fill(0, 0, 1, 12, 'B');
  fill(6, 185, 1, 1, 'B');
  L.gap(34, 37);
  L.gap(76, 86);
  L.gap(130, 133);

  row(10, 9, 'M?B?B');
  fill(18, 25, 2, 4, 'B');
  row(18, 8, 'oooooooo');
  stairsUp(26, 4);
  row(40, 9, 'BBBBB');
  put(42, 9, 'C');
  fill(40, 44, 5, 5, 'B');
  pipe(48, 3);
  L.plants.push({ x: 48, y: 10 });
  fill(54, 59, 7, 7, 'B');
  row(54, 6, 'oooooo');
  pipe(62, 4);
  L.plants.push({ x: 62, y: 9 });
  row(68, 9, 'B?B');
  L.lifts.push({ x: 77, y: 9, w: 3, axis: 'x', dist: 6, period: 4, phase: 0 });
  row(80, 6, 'ooo');
  fill(87, 92, 9, 12, 'H');
  fill(93, 110, 2, 5, 'B');
  row(96, 9, '?M?');
  put(104, 9, 'h');
  row(112, 10, 'oooo');
  pipe(118, 3);
  L.plants.push({ x: 118, y: 10 });
  column(124, 2);
  L.lifts.push({ x: 130, y: 8, w: 3, axis: 'y', dist: 4, period: 3, phase: 0 });
  stairsUp(136, 4);
  fill(140, 143, 9, 12, 'H');
  row(146, 9, 'BBCBB');
  fill(152, 160, 2, 6, 'B');
  row(152, 8, 'ooooooooo');
  pipe(164, 2);
  row(170, 9, 'B?B');
  L.sidePipe(180, 11, 2);
  fill(184, 195, 1, 12, 'H');
  L.pipes.push({ type: 'side', x: 180, y: 11, to: { area: 1, pipeX: 200, pipeY: 11 } });

  L.floor('#', 198, 231);
  pipe(200, 2);
  stairsUp(206, 8);
  column(214, 8);
  L.flagpole(222);

  L.enemies([14, 16, 30, 32, 46, 52, 66, 72, 96, 100, 114, 122, 146, 150, 168, 172, 176]);
  return L.done({ goal: 'pole', goalX: 222, checkpoint: { x: 93, start: [95, 13] } });
}

// 4-3: giant mushrooms high above the void, lifts between them.
function level43() {
  const L = grid(196);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 196, 'tilesMush', SKY, 'sky');
  L.floor('#', 0, 14);
  tree(16, 5, 9);
  tree(23, 3, 6);
  row(23, 4, 'ooo');
  tree(28, 6, 10);
  L.lifts.push({ x: 36, y: 8, w: 3, axis: 'y', dist: 5, period: 3, phase: 0 });
  tree(42, 4, 6);
  row(42, 3, '?M?');
  tree(49, 7, 9);
  L.lifts.push({ x: 59, y: 9, w: 3, axis: 'x', dist: 5, period: 3.5, phase: 0.25 });
  tree(70, 4, 7);
  row(71, 4, 'oo');
  tree(77, 3, 10);
  tree(82, 6, 6);
  row(83, 3, 'oooo');
  L.lifts.push({ x: 91, y: 7, w: 3, axis: 'y', dist: 5, period: 3, phase: 0.5 });
  tree(97, 5, 9);
  L.lifts.push({ x: 105, y: 8, w: 3, axis: 'x', dist: 5, period: 3, phase: 0 });
  tree(116, 4, 7);
  row(117, 4, 'oo');
  tree(123, 7, 9);
  row(125, 6, '? ?');
  L.lifts.push({ x: 133, y: 6, w: 3, axis: 'y', dist: 5, period: 3.5, phase: 0.25 });
  tree(139, 5, 8);
  L.lifts.push({ x: 147, y: 8, w: 3, axis: 'x', dist: 4, period: 3, phase: 0.75 });
  tree(155, 4, 7);
  tree(161, 5, 9);
  L.floor('#', 168, 195);
  L.stairsUp(172, 4);
  L.flagpole(184);

  L.enemies([30, 32], 9);
  L.enemies([51, 53], 8);
  L.enemies([84], 5);
  L.enemies([99], 8);
  L.enemies([125, 127], 8);
  L.enemies([141], 7);
  L.enemies([178, 180]);
  return L.done({ goal: 'pole', goalX: 184, checkpoint: { x: 82, start: [84, 6] } });
}

// 4-4: castle maze. At two forks only one way goes on; the wrong one leads back to the fork.
function level44() {
  const L = grid(232);
  const { row, fill, pipe, column, stairsUp, stairsDown, put, tree } = L;
  L.area(0, 232, 'tilesCastle', BLACK);
  L.floor();
  fill(0, 177, 0, 2, 'H');
  fill(0, 5, 8, 12, 'H');
  fill(6, 12, 9, 12, 'H');
  L.gap(13, 17, true);
  put(15, 13, 'f');
  fill(18, 22, 9, 12, 'H');
  put(20, 9, 'r');
  row(24, 9, '?M?');

  // Fork 1 (x 34-72): a shelf splits the hall in two. The way on is along the top of the shelf.
  stairsUp(28, 4);
  fill(34, 70, 7, 7, 'H');
  row(37, 6, 'oooo');
  put(46, 7, 'r');
  put(52, 12, 'r');
  L.gap(60, 63, true);
  put(61, 13, 'f');
  fill(71, 72, 3, 12, 'H');
  fill(71, 72, 5, 6, '.');
  fill(71, 72, 11, 12, '.');
  L.loops.push({ x: 73, rows: [0, 6], back: 27, backY: 13 });

  fill(78, 80, 11, 12, 'H');
  put(79, 11, 'r');
  L.gap(84, 88, true);
  put(86, 13, 'f');
  fill(89, 92, 11, 12, 'H');
  fill(99, 104, 9, 12, 'H');
  row(99, 8, 'oooooo');

  // Fork 2 (x 106-142): this time the way on is the bottom corridor.
  fill(106, 140, 7, 7, 'H');
  row(110, 10, 'oooooo');
  put(118, 7, 'r');
  put(130, 12, 'r');
  fill(141, 142, 3, 12, 'H');
  fill(141, 142, 5, 6, '.');
  fill(141, 142, 11, 12, '.');
  L.loops.push({ x: 143, rows: [8, 14], back: 103, backY: 9 });

  fill(147, 150, 10, 12, 'H');
  put(148, 10, 'r');
  L.gap(151, 160, true);
  L.lifts.push({ x: 152, y: 9, w: 3, axis: 'x', dist: 4, period: 3.5, phase: 0 });
  put(155, 13, 'f');
  fill(161, 177, 3, 4, 'H');
  fill(161, 165, 10, 12, 'H');
  row(168, 9, 'B?B');

  L.enemies([24, 40, 50, 66, 82, 94, 112, 120, 134, 168, 172]);
  return L.done(Object.assign(castleEnd(L, 178), { start: [3, 8] }));
}

WORLDS.push(
  [
    { name: 'ЛУГ', build: level21, time: 400 },
    { name: 'ПОД ВОДОЙ', build: level22, time: 400 },
    { name: 'МОСТЫ НАД МОРЕМ', build: level23, time: 300 },
    { name: 'ЗАМОК', build: level24, time: 300 },
  ],
  [
    { name: 'НОЧНОЙ ЛУГ', build: level31, time: 300 },
    { name: 'НОЧНАЯ ДОРОГА', build: level32, time: 400 },
    { name: 'НОЧНЫЕ ДЕРЕВЬЯ', build: level33, time: 300 },
    { name: 'ЗАМОК', build: level34, time: 300 },
  ],
  [
    { name: 'ОБЛАЧНЫЙ ЛУГ', build: level41, time: 400 },
    { name: 'ГЛУБОКОЕ ПОДЗЕМЕЛЬЕ', build: level42, time: 400 },
    { name: 'ГРИБЫ', build: level43, time: 300 },
    { name: 'ЗАМОК-ЛАБИРИНТ', build: level44, time: 400 },
  ],
);
})();
