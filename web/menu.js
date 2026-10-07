// Cartridge-style game menu shown before anything else.
// The list comes from config.js. A game either lives on this page and its
// files load only when it is chosen (`scripts`), or has its own page (`url`).
(() => {
'use strict';

// Telegram: tell it the page is up as early as possible, before any game loads.
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor('#000000');
      tg.setBackgroundColor('#000000');
    }
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
  } catch (e) { /* not inside Telegram */ }
}

// The page's language: Russian for ru/uk/be/kk Telegram (or browser), English otherwise.
// Words fixed in index.html carry their English in data-en; games on this page use Cartridge.L().
const langCode = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code)
  || (typeof navigator !== 'undefined' && navigator.language) || 'ru';
const EN = !/^(ru|uk|be|kk)\b/i.test(langCode);
const L = (ru, en) => (EN ? en : ru);
window.Cartridge = { lang: EN ? 'en' : 'ru', L };
if (EN) {
  document.documentElement.lang = 'en';
  document.title = 'Yellow Cartridge';
  document.querySelectorAll('[data-en]').forEach((el) => { el.innerHTML = el.dataset.en; });
}
const EN_TITLES = { 'pryg-skok': 'HOP-SKIP', tanks: 'TANK FIELD', bombs: 'BOMB FIELD', word: 'WORD OF THE DAY' };
const title = (g) => (EN ? g.titleEn || EN_TITLES[g.id] || g.title : g.title);

let startGame = null; // a game to open right away, from the launch link
// How long opening a game with its own page waits for the server check (lib/server.js).
const URL_GAME_WAIT_MS = 400;

// A t.me/<bot>?startapp=<label> link opens this menu with start_param, but
// without ?api=: the label may carry the server's tunnel name after «__»
// (room_123456__abc-def means the server abc-def.trycloudflare.com, see lib/server.js), and an invite
// to a «Танкодром» room goes straight to that room.
(() => {
  if (typeof URLSearchParams === 'undefined') return;
  const start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param)
    || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
  const m = /^([\w-]+?)(?:__([a-z0-9-]{1,63}))?$/.exec(start);
  if (!m) return;
  // Coming back from a game (lib/back.js) the launch link has been followed already.
  try { if (sessionStorage.getItem('cartridge_start_done')) return; } catch (e) { /* ignore */ }
  const params = new URLSearchParams(location.search);
  // room_<code> is a «Танкодром» room, bomb_<code> a «Бомбодром» duel.
  const room = /^(room|tanks|bomb)_(\d{4,8})$/.exec(m[1]);
  const roomGame = room && (room[1] === 'bomb' ? 'bombs' : 'tanks');
  if (room && window.CARTRIDGE && window.CARTRIDGE.isEnabled(roomGame)) {
    params.set('room', room[2]);
    // lib/server.js checks the tunnel from the link against the remembered address;
    // the room page gets the one that answered.
    const server = window.Server;
    const go = () => {
      try { sessionStorage.setItem('cartridge_start_done', '1'); } catch (e) { /* ignore */ }
      if (server && server.online) params.set('api', server.base);
      location.replace(roomGame + '/?' + params + location.hash);
    };
    // The room page checks the server again itself, so the wait is short (URL_GAME_WAIT_MS).
    if (server && server.online === null) {
      let gone = false;
      const once = () => { if (!gone) { gone = true; go(); } };
      server.ready.then(once, once);
      setTimeout(once, URL_GAME_WAIT_MS);
    } else go();
    return;
  }
  // A link to a game (startapp=word, or ref_<id>-word from a shared result) opens that game.
  const want = /(?:^|-)([a-z]+)$/.exec(m[1]);
  const game = want && window.CARTRIDGE && window.CARTRIDGE.enabledGames().find((g) => g.start === want[1]);
  if (game) startGame = game.id;
})();

const cfg = window.CARTRIDGE || { games: [], enabledGames: () => [] };
const games = cfg.enabledGames();
// A lobby of cards: one per game, and «скоро» cards so the two-column grid is even (at least one).
const soon = games.length % 2 ? 1 : games.length ? 0 : 1;
const lines = games.concat(Array(soon).fill({ title: L('СКОРО', 'SOON') }));

const menu = document.getElementById('menu');
const list = document.getElementById('menuList');
const hint = menu.querySelector('.hint');
let cursor = 0;
let loading = false;

// ---------- Covers: small pixel pictures drawn here, no image files (ASSETS.md) ----------
const COVER_W = 64;
const COVER_H = 40;
function px(ctx, color, x, y, w = 1, h = 1) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
// A sprite from rows of letters, each letter a colour.
function sprite(ctx, rows, x, y, pal, k = 1) {
  rows.forEach((row, j) => [...row].forEach((c, i) => { if (pal[c]) px(ctx, pal[c], x + i * k, y + j * k, k, k); }));
}
const COVERS = {
  'pryg-skok'(ctx) {
    px(ctx, '#6b8cff', 0, 0, COVER_W, COVER_H);
    px(ctx, '#fff', 8, 6, 10, 3); px(ctx, '#fff', 10, 4, 6, 2); px(ctx, '#fff', 42, 9, 12, 3); px(ctx, '#fff', 45, 7, 6, 2);
    px(ctx, '#2a9a2a', 30, 26, 24, 8); px(ctx, '#2a9a2a', 34, 22, 16, 4); px(ctx, '#2a9a2a', 38, 19, 8, 3);
    for (let x = 0; x < COVER_W; x += 8) { px(ctx, '#c0601c', x, 34, 8, 6); px(ctx, '#7a3a10', x, 34, 8, 1); px(ctx, '#7a3a10', x + 7, 34, 1, 6); px(ctx, '#7a3a10', x, 37, 8, 1); }
    px(ctx, '#f8b800', 26, 12, 8, 8); px(ctx, '#8a5a00', 26, 19, 8, 1); px(ctx, '#8a5a00', 33, 12, 1, 8);
    sprite(ctx, ['.11.', '...1', '..1.', '....', '..1.'], 28, 13, { 1: '#7a3a10' });
    sprite(ctx, ['.CCC.', 'CCCCC', '.SSE.', '.SSS.', 'JJJJJ', '.PPP.', '.P.P.', 'BB.BB'], 8, 18, { C: '#1fa2a8', S: '#f8b878', E: '#222', J: '#f8d020', P: '#2848a8', B: '#6b3a10' }, 2);
    sprite(ctx, ['.RRRR.', 'RROORR', 'RRRRRR', '.YYYY.', 'K....K'], 46, 24, { R: '#d83010', O: '#f8a060', Y: '#f8d878', K: '#222' }, 2);
  },
  tanks(ctx) {
    px(ctx, '#111', 0, 0, COVER_W, COVER_H);
    const brick = (x, y) => { px(ctx, '#a84810', x, y, 8, 8); px(ctx, '#5a2408', x, y + 3, 8, 1); px(ctx, '#5a2408', x, y + 7, 8, 1); px(ctx, '#5a2408', x + 3, y, 1, 3); px(ctx, '#5a2408', x + 6, y + 4, 1, 3); };
    const steel = (x, y) => { px(ctx, '#9a9aa8', x, y, 8, 8); px(ctx, '#e0e0e8', x + 2, y + 2, 4, 4); };
    brick(2, 4); brick(10, 4); brick(48, 24); brick(56, 24); brick(40, 32); steel(30, 0); steel(2, 28);
    const TANK = ['....B....', '....B....', 'TT.BBB.TT', 'TTBBBBBTT', 'TTBDDDBTT', 'TTBDDDBTT', 'TTBBBBBTT', 'TT.....TT'];
    const tank = (x, y, body, dark, down) => sprite(ctx, down ? [...TANK].reverse() : TANK, x, y, { B: body, D: dark, T: dark }, 2);
    tank(20, 18, '#f8d020', '#9c7a00', false);
    tank(44, 2, '#c8c8d0', '#606070', true);
    px(ctx, '#fff', 28, 8, 2, 4);
  },
  bombs(ctx) {
    px(ctx, '#2a7a2a', 0, 0, COVER_W, COVER_H);
    const steel = (x, y) => { px(ctx, '#8a8a96', x, y, 8, 8); px(ctx, '#d8d8e4', x, y, 8, 1); px(ctx, '#d8d8e4', x, y, 1, 8); px(ctx, '#4a4a56', x, y + 7, 8, 1); px(ctx, '#4a4a56', x + 7, y, 1, 8); };
    const brick = (x, y) => { px(ctx, '#b05020', x, y, 8, 8); px(ctx, '#4a2410', x, y + 3, 8, 1); px(ctx, '#4a2410', x, y + 7, 8, 1); px(ctx, '#4a2410', x + 3, y, 1, 3); px(ctx, '#4a2410', x + 6, y + 4, 1, 3); };
    for (let x = 0; x < COVER_W; x += 8) { steel(x, 0); steel(x, 32); }
    for (let x = 8; x < COVER_W; x += 16) steel(x, 16);
    brick(40, 8); brick(48, 8); brick(56, 24); brick(0, 24);
    // Flame across the middle row and a bomb.
    px(ctx, '#e83800', 16, 10, 24, 4); px(ctx, '#f8a800', 16, 11, 24, 2); px(ctx, '#e83800', 26, 8, 4, 8); px(ctx, '#fff8d0', 27, 11, 2, 2);
    sprite(ctx, ['..ff.', '.kk..', 'kkkk.', 'kkkkk', 'kkkkk', '.kkk.'], 50, 18, { f: '#f8a020', k: '#101018' }, 2);
    sprite(ctx, ['.HHH.', 'HHHHH', '.FFF.', 'BBBBB', '.B.B.'], 6, 16, { H: '#e8e8f0', F: '#f8c890', B: '#f0f0f8' }, 2);
  },
  word(ctx) {
    px(ctx, '#111', 0, 0, COVER_W, COVER_H);
    const rows = [['#555', '#c8a000', '#555', '#555', '#2e9e40'], ['#2e9e40', '#555', '#c8a000', '#2e9e40', '#2e9e40'], ['#2e9e40', '#2e9e40', '#2e9e40', '#2e9e40', '#2e9e40']];
    rows.forEach((row, j) => row.forEach((c, i) => px(ctx, c, 8 + i * 10, 4 + j * 12, 8, 9)));
  },
  soon(ctx) {
    px(ctx, '#151518', 0, 0, COVER_W, COVER_H);
    px(ctx, '#3a3a40', 20, 8, 24, 26); px(ctx, '#55555c', 24, 12, 16, 10); px(ctx, '#3a3a40', 22, 34, 20, 2);
    for (let x = 23; x < 42; x += 3) px(ctx, '#2a2a30', x, 28, 2, 6);
  },
};
const SUBTITLES = {
  'pryg-skok': ['Платформер · 4 мира', 'Platformer · 4 worlds'],
  tanks: ['Танки · онлайн вдвоём', 'Tanks · online for two'],
  bombs: ['Бомбы · 20 этапов и дуэль', 'Bombs · 20 stages and a duel'],
  word: ['Слово из 5 букв', 'A five-letter word'],
};

function cover(g) {
  const cv = document.createElement('canvas');
  cv.className = 'cover';
  cv.width = COVER_W;
  cv.height = COVER_H;
  const ctx = cv.getContext && cv.getContext('2d');
  if (ctx) (COVERS[g.id] || COVERS.soon)(ctx);
  return cv;
}

function render() {
  list.innerHTML = '';
  lines.forEach((g, i) => {
    const li = document.createElement('li');
    li.className = 'card' + (i === cursor ? ' on' : '') + (g.id ? '' : ' soon');
    const name = document.createElement('b');
    name.className = 'cardTitle';
    name.textContent = g.id ? title(g) : g.title;
    const sub = document.createElement('span');
    sub.className = 'cardSub';
    sub.textContent = g.id ? L(...(SUBTITLES[g.id] || ['', ''])) : L('Новые игры в пути', 'New games on the way');
    li.append(cover(g), name, sub);
    if (g.id) {
      const play = document.createElement('span');
      play.className = 'ui-btn primary cardPlay';
      play.textContent = L('Играть', 'Play');
      li.append(play);
      li.addEventListener('click', () => { cursor = i; render(); choose(); });
    }
    list.append(li);
  });
}

function load(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = resolve;
    el.onerror = () => reject(new Error(attrs.src || attrs.href));
    document.head.append(el);
  });
}

// Everything downloads at once; async: false keeps the scripts running in order.
function loadGame(g) {
  return Promise.all([
    ...(g.styles || []).map((href) => load('link', { rel: 'stylesheet', href })),
    ...(g.scripts || []).map((src) => load('script', { src, async: false })),
  ]);
}

function choose() {
  const g = lines[cursor];
  if (!g.id || loading) return;
  if (g.url) {
    // Keep the launch parameters, with the server address that answered (lib/server.js).
    const server = window.Server;
    const go = () => {
      const params = new URLSearchParams(location.search);
      if (server && server.online) params.set('api', server.base);
      const q = params.toString();
      location.href = g.url + (q ? '?' + q : '');
    };
    // The check goes through the tunnel and can take seconds; the game page checks
    // the server again itself, so the menu waits only a moment for it.
    if (server && server.online === null) {
      loading = true;
      hint.textContent = L('Загрузка…', 'Loading…');
      let gone = false;
      const once = () => { if (!gone) { gone = true; go(); } };
      server.ready.then(once, once);
      setTimeout(once, URL_GAME_WAIT_MS);
    } else go();
    return;
  }
  loading = true;
  hint.textContent = L('Загрузка…', 'Loading…');
  menu.classList.add('loading');
  loadGame(g).then(() => {
    menu.classList.add('hidden');
    document.removeEventListener('keydown', onKey, true);
  }).catch(() => {
    hint.textContent = L('Не удалось загрузить игру. Проверьте связь и выберите её ещё раз.', 'Could not load the game. Check the connection and choose it again.');
  }).finally(() => {
    loading = false;
    menu.classList.remove('loading');
  });
}

function move(d) {
  cursor = (cursor + d + lines.length) % lines.length;
  render();
}

// Two cards in a row: left and right step by one, up and down by a row.
function onKey(e) {
  if (e.key === 'ArrowRight') move(1);
  else if (e.key === 'ArrowLeft') move(-1);
  else if (e.key === 'ArrowDown') move(2);
  else if (e.key === 'ArrowUp') move(-2);
  else if (e.key === 'Enter' || e.key === 'z' || e.key === ' ') choose();
  else return;
  e.preventDefault();
  e.stopPropagation();
}

// While the player looks at the menu, the first game on this page (the engine is the heavy
// part) downloads quietly, so choosing it starts at once; the offline cache (sw.js) keeps it.
// Not on a data-saving or very slow line.
function prefetch() {
  const net = typeof navigator !== 'undefined' && navigator.connection;
  if (net && (net.saveData || /2g/.test(net.effectiveType || ''))) return;
  // The platformer's files, and the files of every game with its own page (`preload`),
  // so choosing a game opens it from the cache.
  const files = [];
  const g = games.find((x) => x.scripts);
  if (g) files.push(...g.scripts, ...(g.styles || []));
  for (const x of games) if (x.url && x.preload) files.push(...x.preload);
  for (const href of [...new Set(files)]) {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.append(link);
  }
}
if (typeof window.addEventListener === 'function') {
  window.addEventListener('load', () => setTimeout(prefetch, 1000));
}

document.addEventListener('keydown', onKey, true);
render();
if (startGame) {
  const i = lines.findIndex((g) => g.id === startGame);
  if (i >= 0) {
    try { sessionStorage.setItem('cartridge_start_done', '1'); } catch (e) { /* ignore */ }
    cursor = i;
    render();
    choose();
  }
}
})();
