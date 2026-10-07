// Связь игры с сервером очков: отчёты об уровнях и играх, всплывающие достижения, кнопка жетонов игры.
// Адрес сервера приходит от бота в ссылке (?api=https://...). Без него игра работает как раньше.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';

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

const request = (method, path, body, opts) => server.request(method, '/api/mario' + path, body, opts);

// Счётчики текущей игры. at — когда она началась (0 — игры нет или итог уже отправлен),
// reported — сколько отчётов об уровнях сервер принял, pending — отчёт, который ещё в пути.
let run;
function newRun() { run = { deaths: 0, levelDeaths: 0, coins: 0, bossFire: false, at: 0, reported: 0, pending: Promise.resolve() }; }
newRun();
// Новая игра с 1-1 (или с начала мира).
function begin() { newRun(); run.at = Date.now(); }
// Брошенная посередине игра засчитывается, если в неё играли хотя бы 20 секунд.
const QUIT_MS = 20000;

function track(kind) {
  if (kind === 'coin') run.coins++;
  else if (kind === 'death') { run.deaths++; run.levelDeaths++; }
  else if (kind === 'bossFire') run.bossFire = true;
}

const canSave = () => !!(base && initData && server.online !== false);

function levelDone(level, score, timeLeft, world) {
  const deaths = run.levelDeaths;
  run.levelDeaths = 0;
  if (!canSave()) return;
  const r0 = run;
  r0.pending = request('POST', '/level', { world: world || 1, level, score, timeLeft, deaths })
    .then((r) => { r0.reported++; showAchievements(r.newAchievements); if (window.Wallet) window.Wallet.grants(r.wallet); })
    .catch(() => {});
}

// Возвращает Promise с { best, rank, newRecord } или null, если сохранить нельзя.
// Сервер сверяет число уровней с отчётами, которые он принял, поэтому итог ждёт отчёт в пути
// и называет столько уровней, сколько отчётов дошло: один потерянный отчёт не губит всю игру.
function runDone(score, levels, completed, keepalive) {
  const r = run;
  newRun();
  if (!canSave()) return Promise.resolve(null);
  return r.pending.then(() => request('POST', '/run', {
    score, levels: Math.min(levels, r.reported), completed, coins: r.coins, deaths: r.deaths, bossFire: r.bossFire,
  }, { keepalive })).then((res) => {
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
      const en = window.Cartridge && window.Cartridge.lang === 'en';
      el.innerHTML = `<span class="achIcon"></span><div><b>${en ? 'Achievement!' : 'Достижение!'}</b><br><span class="achTitle"></span></div>`;
      el.querySelector('.achIcon').textContent = a.icon;
      el.querySelector('.achTitle').textContent = (en && a.titleEn) || a.title;
      toastBox.appendChild(el);
      try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* ignore */ }
      setTimeout(() => el.remove(), 3500);
    }, i * 1200);
  });
}

// ---------- Жетоны игры ----------
// Таблица рекордов, достижения и задания «Прыг-Скока» — в его разделе жетонов (lib/wallet.js
// подхватывает кнопку по data-wallet-game). Без сервера и Telegram кнопки нет.
{
  const btn = document.createElement('button');
  btn.id = 'ovWallet';
  btn.className = 'ui-btn teal wGameBtn';
  btn.dataset.walletGame = 'mario';
  btn.textContent = '◆ Жетоны';
  const ov = document.getElementById('ovBtn');
  if (ov) ov.insertAdjacentElement('afterend', btn);
}

function openScores() {
  if (window.Wallet) window.Wallet.open('table', { game: 'mario' });
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

// Игрок уходит в меню или закрывает игру посередине: итог того, что сыграно.
function quit(score, levels) {
  if (!run.at || Date.now() - run.at < QUIT_MS) return Promise.resolve(null);
  return runDone(score, levels, false, true);
}

window.GameAPI = { enabled: !!base, ready, track, levelDone, runDone, newRun, begin, quit, openScores, reopenViaBot };
})();
