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

// A t.me/<bot>?startapp=<label> link opens this menu with start_param, but
// without ?api=: the label may carry the server's tunnel name after «__»
// (room_123456__abc-def means the server abc-def.trycloudflare.com, see lib/server.js), and an invite
// to a «Танкодром» room goes straight to that room.
(() => {
  if (typeof URLSearchParams === 'undefined') return;
  const start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param)
    || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
  const m = /^(\w+?)(?:__([a-z0-9-]{1,63}))?$/.exec(start);
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
  }
})();

const cfg = window.CARTRIDGE || { games: [], enabledGames: () => [], slots: 0 };
const games = cfg.enabledGames();
const lines = games.concat(Array(Math.max(0, cfg.slots - games.length)).fill({ title: 'СКОРО' }));

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
    li.textContent = `${i + 1}. ${g.title}`;
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
      hint.textContent = 'Загрузка…';
      server.ready.then(go);
    } else go();
    return;
  }
  loading = true;
  hint.textContent = 'Загрузка…';
  menu.classList.add('loading');
  loadGame(g).then(() => {
    menu.classList.add('hidden');
    document.removeEventListener('keydown', onKey, true);
  }).catch(() => {
    hint.textContent = 'Не удалось загрузить игру. Проверьте связь и выберите её ещё раз.';
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

document.addEventListener('keydown', onKey, true);
const scoresBtn = document.getElementById('menuScores');
if (games.some((g) => g.scores)) {
  scoresBtn.addEventListener('click', () => {
    if (window.GameAPI) window.GameAPI.openScores();
  });
} else {
  scoresBtn.remove();
}
render();
})();
