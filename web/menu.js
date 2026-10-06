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
const EN_TITLES = { 'pryg-skok': 'HOP-SKIP', tanks: 'TANK FIELD', word: 'WORD OF THE DAY' };
const title = (g) => (EN ? g.titleEn || EN_TITLES[g.id] || g.title : g.title);

let startGame = null; // a game to open right away, from the launch link

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
  const room = /^(?:room|tanks)_(\d{4,8})$/.exec(m[1]);
  if (room && window.CARTRIDGE && window.CARTRIDGE.isEnabled('tanks')) {
    params.set('room', room[1]);
    // lib/server.js checks the tunnel from the link against the remembered address;
    // the room page gets the one that answered.
    const server = window.Server;
    const go = () => {
      try { sessionStorage.setItem('cartridge_start_done', '1'); } catch (e) { /* ignore */ }
      if (server && server.online) params.set('api', server.base);
      location.replace('tanks/?' + params + location.hash);
    };
    if (server) server.ready.then(go); else go();
    return;
  }
  // A link to a game (startapp=word, or ref_<id>-word from a shared result) opens that game.
  const want = /(?:^|-)([a-z]+)$/.exec(m[1]);
  const game = want && window.CARTRIDGE && window.CARTRIDGE.enabledGames().find((g) => g.start === want[1]);
  if (game) startGame = game.id;
})();

const cfg = window.CARTRIDGE || { games: [], enabledGames: () => [], slots: 0 };
const games = cfg.enabledGames();
const lines = games.concat(Array(Math.max(0, cfg.slots - games.length)).fill({ title: L('СКОРО', 'SOON') }));

const menu = document.getElementById('menu');
const list = document.getElementById('menuList');
const hint = menu.querySelector('.hint');
let cursor = 0;
let loading = false;

function render() {
  list.innerHTML = '';
  lines.forEach((g, i) => {
    const li = document.createElement('li');
    li.className = (i === cursor ? 'on ' : '') + (g.id ? '' : 'soon');
    li.textContent = `${i + 1}. ${g.id ? title(g) : g.title}`;
    li.addEventListener('click', () => { cursor = i; render(); choose(); });
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
    if (server && server.online === null) {
      loading = true;
      hint.textContent = L('Загрузка…', 'Loading…');
      server.ready.then(go);
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

function onKey(e) {
  if (e.key === 'ArrowDown') move(1);
  else if (e.key === 'ArrowUp') move(-1);
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
  const g = games.find((x) => x.scripts);
  if (!g) return;
  for (const href of [...g.scripts, ...(g.styles || [])]) {
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
