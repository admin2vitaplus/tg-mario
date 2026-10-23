// «⚡ Испытание дня» in the collection's menu (bot/challenge.js): one game a day for everyone,
// the best score of the day counts (a game started from its first level, alone). The first
// challenge game of the day gives жетоны, more for every day in a row; the top three of the
// day get prizes. Tables: everyone, this chat (players who opened the game from the same chat)
// and friends (invited by a link). Works only when the game was opened through the bot.
// Names come from the server and go on the page only as text.
//
//   Challenge.open()     -> the panel
//   Challenge.refresh()  -> asks the server again
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';
const myId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
const lang = /^(ru|uk|be|kk)\b/i.test((tg && tg.initDataUnsafe && tg.initDataUnsafe.user &&
  tg.initDataUnsafe.user.language_code) || navigator.language || '') ? 'ru' : 'en';

const STR = {
  ru: {
    title: 'ИСПЫТАНИЕ ДНЯ', button: '⚡ Испытание дня',
    game_mario: 'Прыг-Скок', game_tanks: 'Танкодром', game_bombs: 'Бомбодром', game_range: 'Тир',
    sub_todo: '{game} · +{n} ◆', sub_done: '{game} · место {place}', sub_done_noplace: '{game} · сыграно',
    today: 'Сегодня: {game}', left: 'Новое испытание через {left} (00:00 UTC)',
    how: 'Наберите как можно больше очков в одной игре, начатой с первого уровня. В зачёт идёт лучший счёт за день.',
    reward: 'Первая игра испытания сегодня: +{n} ◆. Каждый день подряд +{step}, до {max}.',
    reward_done: 'Награда за сегодня получена. Завтра будет +{n} ◆, если не пропустите день.',
    streak: 'Дней подряд: {n}', best: 'Ваш лучший счёт сегодня: {n}',
    prizes: 'Призы дня за 1–3 места: {list} ◆, когда играют хотя бы {min}.',
    play: 'Играть', tomorrow: 'Завтра: {game}',
    tab_all: 'Все', tab_chat: 'Этот чат', tab_friends: 'Друзья',
    chat_none: 'Откройте игру из чата с друзьями (через /play или @бота), и здесь появится таблица этого чата.',
    friends_none: 'Позовите друзей по своей ссылке в «◆ Жетоны», и их счёт будет здесь.',
    empty: 'Сегодня ещё никто не играл. Будьте первым!', you: 'Вы', me_place: 'Ваше место: {place} из {n}',
    yesterday: 'Вчера, {game}', y_prized: 'призы выданы', y_none: 'вчера никто не играл',
    loading: 'Загрузка…', offline: 'Сервер сейчас недоступен. Показано то, что было загружено раньше.',
    close: 'Закрыть', off_game: 'Эта игра сейчас выключена в сборнике.',
    h: 'ч', m: 'мин',
  },
  en: {
    title: 'CHALLENGE OF THE DAY', button: '⚡ Challenge of the day',
    game_mario: 'Hop-Skip', game_tanks: 'Tank Field', game_bombs: 'Bomb Field', game_range: 'Shooting Range',
    sub_todo: '{game} · +{n} ◆', sub_done: '{game} · place {place}', sub_done_noplace: '{game} · played',
    today: 'Today: {game}', left: 'New challenge in {left} (00:00 UTC)',
    how: 'Score as much as you can in one game started from the first level. Your best score of the day counts.',
    reward: 'First challenge game today: +{n} ◆. Each day in a row +{step}, up to {max}.',
    reward_done: 'Today\'s reward is yours. Tomorrow gives +{n} ◆ if you keep the streak.',
    streak: 'Days in a row: {n}', best: 'Your best score today: {n}',
    prizes: 'Prizes of the day for places 1–3: {list} ◆, when at least {min} play.',
    play: 'Play', tomorrow: 'Tomorrow: {game}',
    tab_all: 'All', tab_chat: 'This chat', tab_friends: 'Friends',
    chat_none: 'Open the game from a chat with friends (/play or @bot) to see this chat\'s table here.',
    friends_none: 'Invite friends with your link in «◆ Tickets» and their scores will be here.',
    empty: 'Nobody has played today yet. Be the first!', you: 'You', me_place: 'Your place: {place} of {n}',
    yesterday: 'Yesterday, {game}', y_prized: 'prizes given', y_none: 'nobody played yesterday',
    loading: 'Loading…', offline: 'The server is not reachable right now. Showing what was loaded before.',
    close: 'Close', off_game: 'This game is switched off in the collection right now.',
    h: 'h', m: 'min',
  },
};
const T = (key, vars) => {
  let s = STR[lang][key] || STR.ru[key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
};
const gameName = (g) => T('game_' + g);
// The challenge's game ids are the server's; the menu (config.js) calls the platformer pryg-skok.
const CONFIG_ID = { mario: 'pryg-skok' };

const server = window.Server || { hasServer: false };
const enabled = !!(server.hasServer && initData);
const TABS = ['all', 'chat', 'friends'];

const CACHE_KEY = 'challenge_cache_' + (myId || 0);
let state = null;
let at = 0;
let off = false;
try {
  const c = JSON.parse(localStorage.getItem(CACHE_KEY));
  // Yesterday's cache would show the wrong game: only today's is used.
  if (c && c.day === Math.floor(Date.now() / 86400000)) state = c;
} catch (e) { /* nothing saved */ }
const save = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
function left(ms) {
  const min = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? h + ' ' + T('h') + ' ' + (min % 60) + ' ' + T('m') : min + ' ' + T('m');
}

// ---------- The button in the menu ----------
let btn = null;
function button() {
  const menu = document.getElementById('menuList') && document.getElementById('menu');
  if (!enabled || !menu) return;
  if (off) { if (btn) btn.remove(); btn = null; return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'challengeBtn';
    btn.innerHTML = '<span class="cbLabel"></span><span class="cbSub"></span><i>›</i>';
    btn.addEventListener('click', open);
    // Right under the жетоны banner (lib/wallet.js): the first thing to do today.
    const after = document.getElementById('walletBanner') || menu.querySelector('h1');
    if (after) after.insertAdjacentElement('afterend', btn); else menu.prepend(btn);
  }
  btn.querySelector('.cbLabel').textContent = T('button');
  const sub = btn.querySelector('.cbSub');
  if (!state) sub.textContent = T('loading');
  else if (!state.played) sub.textContent = T('sub_todo', { game: gameName(state.game), n: state.reward });
  else sub.textContent = state.all.me ? T('sub_done', { game: gameName(state.game), place: state.all.me.place })
    : T('sub_done_noplace', { game: gameName(state.game) });
  btn.classList.toggle('fresh', !!state && !state.played);
}

let loading = null;
function refresh() {
  if (!enabled || off) return Promise.resolve(state);
  if (loading) return loading;
  loading = server.request('GET', '/api/challenge').then((r) => {
    state = r;
    at = Date.now();
    save();
    button();
    if (panel) render();
    return state;
  }, (e) => {
    // An older server: no challenge yet, the button goes away until it is updated.
    if (e && e.status === 404) { off = true; button(); close(); }
    throw e;
  }).finally(() => { loading = null; });
  return loading;
}

// ---------- The panel ----------
let panel = null;
let tab = 'all';

function table(t, emptyText) {
  const box = document.createDocumentFragment();
  if (!t || !t.rows.length) { box.append(el('p', 'wNote', emptyText)); return box; }
  const ol = el('ol', 'wTop');
  for (const p of t.rows) {
    const li = el('li', p.me ? 'me' : '');
    li.append(el('span', null, String(p.place)), el('span', null, p.me ? T('you') : p.name), el('b', null, String(p.value)));
    ol.append(li);
  }
  // Below the shown rows the player still sees their own place.
  if (t.me && !t.rows.some((p) => p.me)) {
    ol.append(el('li', 'wGap', '…'));
    const li = el('li', 'me');
    li.append(el('span', null, String(t.me.place)), el('span', null, T('you')), el('b', null, String(t.me.value)));
    ol.append(li);
  }
  box.append(ol);
  if (t.me) box.append(el('p', 'wNote', T('me_place', { place: t.me.place, n: t.players })));
  return box;
}

function play() {
  const id = CONFIG_ID[state.game] || state.game;
  const cart = window.CARTRIDGE;
  if (cart && cart.isEnabled && !cart.isEnabled(id)) return;
  close();
  if (window.Cartridge && window.Cartridge.play) window.Cartridge.play(id);
}

function render() {
  const body = panel.querySelector('.wBody');
  panel.querySelectorAll('.wTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  body.replaceChildren();
  if (!state) { body.append(el('p', 'wNote', T('loading'))); return; }
  if (!at && server.online === false) body.append(el('p', 'wNote wWarn', T('offline')));
  const r = state.rules;
  const head = el('div', 'chHead');
  head.append(el('b', 'chGame', T('today', { game: gameName(state.game) })),
    el('span', 'chLeft', T('left', { left: left(state.endsAt - Date.now()) })));
  body.append(head, el('p', 'wNote', T('how')));
  const cart = window.CARTRIDGE;
  const on = !cart || !cart.isEnabled || cart.isEnabled(CONFIG_ID[state.game] || state.game);
  if (on) {
    const go = el('button', 'wAct chPlay', '▶ ' + T('play') + ': ' + gameName(state.game));
    go.addEventListener('click', play);
    body.append(go);
  } else body.append(el('p', 'wNote wWarn', T('off_game')));
  const facts = el('ul', 'chFacts');
  facts.append(el('li', state.played ? 'done' : '', state.played
    ? T('reward_done', { n: state.next }) : T('reward', { n: state.reward, step: r.perStreakDay, max: r.max })));
  facts.append(el('li', null, T('streak', { n: state.streak })));
  if (state.best != null) facts.append(el('li', null, T('best', { n: state.best })));
  if (r.prizes.length) facts.append(el('li', null, T('prizes', { list: r.prizes.join(', '), min: r.minPlayers })));
  facts.append(el('li', 'chTomorrow', T('tomorrow', { game: gameName(state.tomorrow) })));
  body.append(facts);
  if (tab === 'chat' && !state.chat) body.append(el('p', 'wNote', T('chat_none')));
  else if (tab === 'friends' && state.friends.players <= (state.played ? 1 : 0)) {
    body.append(table(state.friends, ''), el('p', 'wNote', T('friends_none')));
  } else body.append(table(state[tab], T('empty')));
  const y = state.yesterday;
  if (y) {
    const sec = el('div', 'chYesterday');
    sec.append(el('h2', 'wSec', T('yesterday', { game: gameName(y.game) }) + (y.prized ? ' · ' + T('y_prized') : '')));
    if (y.rows.length) sec.append(table({ rows: y.rows, me: null }, ''));
    else sec.append(el('p', 'wNote', T('y_none')));
    body.append(sec);
  }
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  close();
}
function close() {
  if (!panel) return;
  document.removeEventListener('keydown', onKey, true);
  panel.remove();
  panel = null;
}
function open() {
  if (!enabled || off) return;
  close();
  tab = state && state.chat && state.chat.players > 1 ? 'chat' : 'all';
  // The full-screen panel of lib/wallet.css, with its title, tabs and close button.
  panel = el('div', 'wallet challenge');
  const tabs = el('div', 'wTabs wMain');
  for (const t of TABS) {
    const b = el('button', null, T('tab_' + t));
    b.dataset.tab = t;
    tabs.append(b);
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { tab = b.dataset.tab; render(); }
  });
  const shut = el('button', 'wClose', T('close'));
  shut.addEventListener('click', close);
  panel.append(el('h1', null, '⚡ ' + T('title')), tabs, el('div', 'wBody'), shut);
  document.addEventListener('keydown', onKey, true);
  document.body.append(panel);
  render();
  refresh().catch(() => { if (panel) render(); });
}

// Back in the menu after a game, or the next day: the place and the game may have changed.
const AGAIN_MS = 30000;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && enabled && Date.now() - at > AGAIN_MS) refresh().catch(() => {});
});

// The platformer plays on this page: coming back from it to the menu (the menu shows again) asks too.
const menuEl = document.getElementById('menu');
if (menuEl && typeof MutationObserver === 'function') {
  let hidden = menuEl.classList.contains('hidden');
  new MutationObserver(() => {
    const now = menuEl.classList.contains('hidden');
    if (hidden && !now && enabled && Date.now() - at > AGAIN_MS) refresh().catch(() => {});
    hidden = now;
  }).observe(menuEl, { attributes: true, attributeFilter: ['class'] });
}

window.Challenge = { enabled, open, refresh };

if (enabled) {
  button();
  refresh().catch(() => {});
}
})();
