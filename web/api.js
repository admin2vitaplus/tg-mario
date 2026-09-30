// Связь игры с сервером очков: рекорды, таблица лидеров и достижения.
// Адрес сервера приходит от бота в ссылке (?api=https://...). Без него игра работает как раньше.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';
const myId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;

function pickBase() {
  let url = new URLSearchParams(location.search).get('api');
  try {
    if (url) localStorage.setItem('prygskok_api', url);
    else url = localStorage.getItem('prygskok_api');
  } catch (e) { /* ignore */ }
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.origin : '';
  } catch (e) {
    return '';
  }
}
const base = pickBase();

function request(method, path, body) {
  if (!base) return Promise.reject(new Error('no server'));
  const headers = { 'Content-Type': 'application/json' };
  if (initData) headers.Authorization = 'tma ' + initData;
  return fetch(base + '/api/mario' + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(new Error(j.error || r.status)))));
}

// Счётчики текущей игры.
let run;
function newRun() { run = { deaths: 0, levelDeaths: 0, coins: 0, bossFire: false }; }
newRun();

function track(kind) {
  if (kind === 'coin') run.coins++;
  else if (kind === 'death') { run.deaths++; run.levelDeaths++; }
  else if (kind === 'bossFire') run.bossFire = true;
}

const canSave = () => !!(base && initData);

function levelDone(level, score, timeLeft) {
  const deaths = run.levelDeaths;
  run.levelDeaths = 0;
  if (!canSave()) return;
  request('POST', '/level', { level, score, timeLeft, deaths })
    .then((r) => showAchievements(r.newAchievements))
    .catch(() => {});
}

// Возвращает Promise с { best, rank, newRecord } или null, если сохранить нельзя.
function runDone(score, levels, completed) {
  const r = run;
  newRun();
  if (!canSave()) return Promise.resolve(null);
  return request('POST', '/run', {
    score, levels, completed, coins: r.coins, deaths: r.deaths, bossFire: r.bossFire,
  }).then((res) => {
    showAchievements(res.newAchievements);
    return res;
  }).catch(() => null);
}

// ---------- Всплывающее уведомление о достижении ----------
const toastBox = document.createElement('div');
toastBox.id = 'achToasts';
document.body.appendChild(toastBox);

function showAchievements(list) {
  (list || []).forEach((a, i) => {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'achToast';
      el.innerHTML = `<span class="achIcon"></span><div><b>Достижение!</b><br><span class="achTitle"></span></div>`;
      el.querySelector('.achIcon').textContent = a.icon;
      el.querySelector('.achTitle').textContent = a.title;
      toastBox.appendChild(el);
      try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* ignore */ }
      setTimeout(() => el.remove(), 3500);
    }, i * 1200);
  });
}

// ---------- Экран рекордов и достижений ----------
const panel = document.createElement('div');
panel.id = 'scores';
panel.className = 'hidden';
panel.innerHTML = `
  <div class="scTabs">
    <button data-tab="top" class="on">🏆 Рекорды</button>
    <button data-tab="ach">⭐ Достижения</button>
  </div>
  <div class="scBody"></div>
  <button class="scClose">Закрыть</button>`;
document.body.appendChild(panel);
const bodyEl = panel.querySelector('.scBody');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showTab(tab) {
  panel.querySelectorAll('.scTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  bodyEl.innerHTML = '<p class="scNote">Загрузка…</p>';
  const fail = () => { bodyEl.innerHTML = '<p class="scNote">Сервер рекордов сейчас недоступен.</p>'; };
  if (tab === 'top') {
    request('GET', '/top').then((list) => {
      if (!list.length) { bodyEl.innerHTML = '<p class="scNote">Рекордов пока нет. Будь первым!</p>'; return; }
      bodyEl.innerHTML = '<ol class="scTop">' + list.map((p) =>
        `<li class="${p.id === myId ? 'me' : ''}"><span>${p.place}</span><span>${esc(p.name)}</span><span>${p.score}</span></li>`,
      ).join('') + '</ol>';
    }).catch(fail);
  } else {
    const mine = initData ? request('GET', '/me').catch(() => null) : Promise.resolve(null);
    Promise.all([request('GET', '/achievements'), mine]).then(([all, me]) => {
      const got = new Set(me ? me.achievements.map((a) => a.code) : []);
      const head = me
        ? `<p class="scNote">Рекорд: ${me.best}${me.rank ? ` · место ${me.rank}` : ''} · открыто ${got.size} из ${all.length}</p>`
        : '<p class="scNote">Откройте игру через бота, чтобы получать достижения.</p>';
      bodyEl.innerHTML = head + '<ul class="scAch">' + all.map((a) =>
        `<li class="${got.has(a.code) ? 'got' : ''}"><span class="achIcon">${got.has(a.code) ? a.icon : '🔒'}</span>` +
        `<div><b>${esc(a.title)}</b><br>${esc(a.text)}</div></li>`,
      ).join('') + '</ul>';
    }).catch(fail);
  }
}

panel.querySelector('.scTabs').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (t) showTab(t.dataset.tab);
});
panel.querySelector('.scClose').addEventListener('click', () => panel.classList.add('hidden'));

function openScores() {
  panel.classList.remove('hidden');
  showTab('top');
}

// Кнопка «Рекорды» на заставке и экране окончания игры.
if (base) {
  const btn = document.createElement('button');
  btn.id = 'ovScores';
  btn.textContent = '🏆 Рекорды и достижения';
  btn.addEventListener('click', openScores);
  const ov = document.getElementById('ovBtn');
  if (ov) ov.insertAdjacentElement('afterend', btn);
}

window.GameAPI = { enabled: !!base, track, levelDone, runDone, newRun, openScores };
})();
