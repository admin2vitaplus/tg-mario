// Пройденные уровни во всех играх и общий экран выбора уровня.
// Пройденный уровень открыт навсегда: с него (и со следующего за ним) можно начать новую игру.
// Сервер помнит пройденные уровни по игроку (GET /api/progress) и сам проверяет, что игра
// начата с открытого уровня; телефон держит копию, чтобы экран открывался сразу и без сети.
//
//   Progress.load()                        -> Promise: свежие уровни с сервера (один раз за страницу)
//   Progress.mark(game, i)                 -> уровень i пройден (сразу, не дожидаясь сервера)
//   Progress.open(game, count)             -> [номера открытых уровней], первый открыт всегда
//   Progress.pick({ game, count, label, onPick, cols }) -> экран выбора; onPick(i) — выбранный уровень
// game — mario, tanks или bombs; номера уровней с 0 (у «Прыг-Скока» — сквозные, (мир − 1) × 4 + уровень).
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
const KEY = 'progress_' + ((user && user.id) || 0);
const lang = /^(ru|uk|be|kk)\b/i.test((user && user.language_code) || navigator.language || '') ? 'ru' : 'en';
const STR = {
  ru: { title: 'Выбор уровня', hint: 'Пройденные уровни открыты навсегда.', back: '← Назад', locked: 'закрыт', passed: 'пройден' },
  en: { title: 'Choose a level', hint: 'Cleared levels stay open for good.', back: '← Back', locked: 'locked', passed: 'cleared' },
};
const T = (k) => STR[lang][k];

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* nothing kept */ }
const sets = {};
const setOf = (game) => sets[game] || (sets[game] = new Set((saved[game] || []).filter(Number.isInteger)));
function keep() {
  const out = {};
  for (const g of Object.keys(sets)) out[g] = [...sets[g]].sort((a, b) => a - b);
  try { localStorage.setItem(KEY, JSON.stringify(Object.assign(saved, out))); } catch (e) { /* private mode */ }
}

function mark(game, i) {
  if (!Number.isInteger(i) || i < 0 || setOf(game).has(i)) return;
  setOf(game).add(i);
  keep();
}

// Сервер знает и уровни, пройденные до появления выбора, и пройденные на другом телефоне.
let loading = null;
function load() {
  const s = window.Server;
  if (loading) return loading;
  if (!s || !s.hasServer || !tg || !tg.initData) return Promise.resolve();
  loading = s.request('GET', '/api/progress').then((r) => {
    for (const [game, list] of Object.entries(r || {})) {
      if (Array.isArray(list)) list.forEach((i) => { if (Number.isInteger(i) && i >= 0) setOf(game).add(i); });
    }
    keep();
  }).catch(() => { loading = null; });
  return loading;
}

function open(game, count) {
  const out = new Set([0]);
  for (const i of setOf(game)) {
    if (i < count) out.add(i);
    if (i + 1 < count) out.add(i + 1);
  }
  return [...out].sort((a, b) => a - b);
}

// ---------- Экран выбора ----------
let box = null;
function close() {
  if (box) box.remove();
  box = null;
}
window.addEventListener('keydown', (e) => { if (box && e.key === 'Escape') { e.stopPropagation(); close(); } }, true);

function pick({ game, count, label, onPick, onClose, cols }) {
  close();
  const can = new Set(open(game, count));
  const passed = setOf(game);
  box = document.createElement('div');
  box.className = 'ui-pick';
  box.setAttribute('role', 'dialog');
  const panel = document.createElement('div');
  panel.className = 'ui-pick-box';
  const h = document.createElement('h2');
  h.textContent = T('title');
  const hint = document.createElement('p');
  hint.textContent = T('hint');
  const grid = document.createElement('div');
  grid.className = 'ui-pick-grid';
  if (cols) grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  for (let i = 0; i < count; i++) {
    const b = document.createElement('button');
    const name = label ? label(i) : String(i + 1);
    b.className = 'ui-pick-cell' + (passed.has(i) ? ' done' : can.has(i) ? ' next' : '');
    b.textContent = name;
    b.disabled = !can.has(i);
    b.setAttribute('aria-label', name + (passed.has(i) ? ', ' + T('passed') : can.has(i) ? '' : ', ' + T('locked')));
    b.addEventListener('click', () => { close(); onPick(i); });
    grid.appendChild(b);
  }
  const back = document.createElement('button');
  back.className = 'ui-btn ghost';
  back.textContent = T('back');
  back.addEventListener('click', () => { close(); if (onClose) onClose(); });
  panel.append(h, hint, grid, back);
  box.appendChild(panel);
  document.body.appendChild(box);
  // Открытый последним уровень виден сразу, даже в конце длинного списка.
  const last = grid.children[Math.max(...can)];
  if (last && last.scrollIntoView) last.scrollIntoView({ block: 'center' });
  // Пока экран открыт, с сервера могли прийти уровни с другого телефона: обновляем.
  load().then(() => {
    if (!box || box.firstChild !== panel) return;
    const now = new Set(open(game, count));
    [...grid.children].forEach((b, i) => {
      b.disabled = !now.has(i);
      b.classList.toggle('done', passed.has(i));
      b.classList.toggle('next', !passed.has(i) && now.has(i));
    });
  });
}

window.Progress = { load, mark, open, pick, close, isOpen: () => !!box, lang };
load();
})();
