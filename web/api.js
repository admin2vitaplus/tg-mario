// Связь игры с сервером очков: рекорды, таблица лидеров и достижения.
// Адрес сервера приходит от бота в ссылке (?api=https://...). Без него игра работает как раньше.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';
const myId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;

// Address, health check and requests: lib/server.js.
const server = window.Server;
const base = server.hasServer;
const botName = (() => {
  let name = new URLSearchParams(location.search).get('bot');
  try {
    if (name) localStorage.setItem('prygskok_bot', name);
    else name = localStorage.getItem('prygskok_bot');
  } catch (e) { /* ignore */ }
  if (!name && window.CARTRIDGE) name = window.CARTRIDGE.bot;
  return (name || '').replace(/[^A-Za-z0-9_]/g, '');
})();

// Адрес туннеля меняется при перезапуске сервера, и запомненный или старый адрес ведёт в никуда.
// lib/server.js проверяет все известные адреса сразу; если ни один не ответил — честно говорим
// об этом и предлагаем открыть игру заново через бота.
const ready = server.ready;

function reopenViaBot() {
  if (!botName) return;
  const link = 'https://t.me/' + botName + '?start=play';
  try {
    if (tg && tg.openTelegramLink) { tg.openTelegramLink(link); tg.close(); return; }
  } catch (e) { /* fall through */ }
  location.href = link;
}

function offlineHtml() {
  return '<p class="scNote">Сервер рекордов переехал на новый адрес, а игра открыта по старой ссылке.</p>' +
    (botName ? '<p class="scNote"><button class="scReopen">Открыть игру заново</button></p>'
             : '<p class="scNote">Отправьте боту /start и откройте игру кнопкой «Играть» из его ответа.</p>');
}

const request = (method, path, body) => server.request(method, '/api/mario' + path, body);

// Счётчики текущей игры.
let run;
function newRun() { run = { deaths: 0, levelDeaths: 0, coins: 0, bossFire: false }; }
newRun();

function track(kind) {
  if (kind === 'coin') run.coins++;
  else if (kind === 'death') { run.deaths++; run.levelDeaths++; }
  else if (kind === 'bossFire') run.bossFire = true;
}

const canSave = () => !!(base && initData && server.online !== false);

function levelDone(level, score, timeLeft) {
  const deaths = run.levelDeaths;
  run.levelDeaths = 0;
  if (!canSave()) return;
  request('POST', '/level', { level, score, timeLeft, deaths })
    .then((r) => { showAchievements(r.newAchievements); if (window.Wallet) window.Wallet.grants(r.wallet); })
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
    if (window.Wallet) window.Wallet.grants(res.wallet);
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
  if (!base) {
    bodyEl.innerHTML = '<p class="scNote">Сервер рекордов не подключён.<br><br>' +
      'Таблица работает, когда игра открыта кнопкой «Играть» из сообщения бота ' +
      '(команда /start), а сам бот запущен. После первого такого запуска ' +
      'адрес запомнится и рекорды будут видны отовсюду.</p>';
    return;
  }
  if (server.online === false) { bodyEl.innerHTML = offlineHtml(); return; }
  const fail = () => {
    bodyEl.innerHTML = server.online === false ? offlineHtml()
      : '<p class="scNote">Сервер рекордов сейчас недоступен: бот выключен или нет связи. Попробуйте позже.</p>';
  };
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
bodyEl.addEventListener('click', (e) => { if (e.target.closest('.scReopen')) reopenViaBot(); });

function openScores() {
  panel.classList.remove('hidden');
  showTab('top');
}

// Кнопка «Рекорды» на заставке и экране окончания игры. Видна всегда:
// без сервера экран рекордов объясняет, почему таблица пуста.
{
  const btn = document.createElement('button');
  btn.id = 'ovScores';
  btn.textContent = '🏆 Рекорды и достижения';
  btn.addEventListener('click', openScores);
  const ov = document.getElementById('ovBtn');
  if (ov) ov.insertAdjacentElement('afterend', btn);
  ready.then((ok) => { if (base && !ok) btn.textContent = '⚠️ Рекорды: сервер переехал'; });
}

// ---------- Статистика (lib/events.js) ----------
// «Открыли» — когда в меню картриджа выбран «Прыг-Скок», «начали» — каждая кнопка «Играть».
// Конец игры сервер записывает сам по итогу игры.
{
  const stat = (type) => window.GameEvents && window.GameEvents.send(type, 'mario');
  const menu = document.getElementById('menu');
  if (menu) {
    const watch = new MutationObserver(() => {
      if (menu.classList.contains('hidden')) { watch.disconnect(); stat('game_open'); }
    });
    watch.observe(menu, { attributes: true, attributeFilter: ['class'] });
  }
  const play = document.getElementById('ovBtn');
  if (play) play.addEventListener('click', () => stat('game_start'));
}

window.GameAPI = { enabled: !!base, ready, track, levelDone, runDone, newRun, openScores, reopenViaBot };
})();
