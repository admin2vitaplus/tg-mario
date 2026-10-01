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
  // Keep the launch parameters (?api=, ?bot=) for the game's own page.
  if (g.url) { location.href = g.url + location.search; return; }
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
