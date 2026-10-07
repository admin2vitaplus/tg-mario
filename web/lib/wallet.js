// Жетоны (docs/TZ.md, P1-7): balance in the menu, «how to get», history and the shop.
// Only the server credits жетоны; this page can look at the balance and buy items.
// Works only when the game was opened through the bot (?api= and Telegram initData);
// otherwise nothing is shown.
//
//   Wallet.owns(shopId)       -> true if bought (remembered on the phone for offline starts)
//   Wallet.price(shopId)      -> price, or null before the shop list has loaded
//   Wallet.buy(shopId, via)   -> Promise<boolean>; via 'tokens' (жетоны) or 'stars' (Telegram
//                                Stars); without it the player picks one
//   Wallet.stars(shopId)      -> price in Telegram Stars, or null
//   Wallet.lifeOffer(level)   -> Hop-Skip's one more life for the level in the world (0-3):
//                                { price, stars }, or null before the rules have loaded
//   Wallet.buyLife(offer, level) -> Promise<boolean>, true when the life is paid
//   Wallet.grants(res.wallet) -> shows «+10» toasts after a game result
//   Wallet.open(tab, {game})  -> the collection's own panel (tabs: tasks, top, shop, history) or,
//                                with game 'mario' | 'tanks' | 'bombs' | 'word', that game's (tasks, top, shop)
//   Wallet.button(el, game)   -> turns a button into «◆ balance», opening the game's panel
//
// The collection's tasks (a visit a day, friends) and each game's own tasks (play, clear
// a level, beat your best; each game's achievements once) are crossed off when done; the
// daily ones open again at 00:00 UTC.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';
const myId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
const lang = /^(ru|uk|be|kk)\b/i.test((tg && tg.initDataUnsafe && tg.initDataUnsafe.user &&
  tg.initDataUnsafe.user.language_code) || navigator.language || '') ? 'ru' : 'en';

const STR = {
  ru: {
    title: 'ЖЕТОНЫ',
    tab_tasks: 'Задания', tab_top: 'Топ-100', tab_table: 'Таблица', tab_history: 'История', tab_shop: 'Магазин',
    game_mario: 'Прыг-Скок', game_tanks: 'Танкодром', game_bombs: 'Бомбодром', game_word: 'Слово дня',
    sec_day: 'Каждый день · обновятся через {left} (00:00 UTC)',
    sec_week: 'Каждую неделю · новая неделя через {left}',
    sec_once: 'Достижения · один раз', achieved: 'Достижение',
    t_login: 'Зайти в сборник сегодня',
    t_login_note: 'Дней подряд: {streak}. Каждый следующий день +{step}, до {max}.',
    t_invite: 'Позвать друга: {count} из {max} за неделю',
    t_invite_note: 'Друг сыграет {games} {games_w} — тебе {inviter} {inviter_w}, ему {newcomer}.',
    t_play: 'Сыграть игру', t_level: 'Пройти уровень', t_record: 'Побить свой рекорд',
    t_level_word: 'Отгадать слово', t_record_word: 'Побить свой рекорд серии (от 2 дней)', t_level_bombs: 'Пройти этап',
    t_play_note: 'Засчитывается в конце игры или при выходе в меню, если играли от 20 секунд.',
    t_record_note: 'Набрать больше очков, чем твой лучший результат в этой игре. Первая игра тоже считается.',
    t_other: 'Свои задания у каждой игры: откройте игру и нажмите «◆» в её меню.',
    period_week: 'За неделю', period_all: 'За всё время',
    top_overall: 'Жетоны, полученные за {p}', top_game: 'Лучший счёт за {p}',
    top_word: 'Очки за {p}: каждый день до 6 (6 — с первой попытки)',
    p_week: 'неделю', p_all: 'всё время',
    prizes: 'Призы недели за 1–{n} места: {list}.',
    me_place: 'Твоё место: {place} ({value})', me_none: 'Тебя пока нет в этой таблице.',
    table_empty: 'Пока пусто. Будь первым!', you: 'Ты',
    banner_sub: 'Задания · Топ-100 · Магазин',
    shop_game: 'Товары этой игры. Все товары — в «◆ Жетоны» на главной.',
    close: 'Закрыть', loading: 'Загрузка…',
    offline: 'Сервер сейчас недоступен. Попробуйте позже.',
    moved: 'сервер переехал — открыть заново',
    not_ready: 'Жетоны появятся, когда сервер обновится до новой версии.',
    expired: 'Игра открыта слишком давно, и Telegram больше не подтверждает вход. Откройте её заново.',
    moved_long: 'Сервер перезапустился и сменил адрес, а игра открыта по старой ссылке.',
    reopen: 'Открыть игру заново',
    balance: 'Баланс: {n}',
    today: 'Сегодня получено {n} из {cap}. Серия дней: {streak}.',
    how_cap: 'В день можно получить не больше {cap}, не считая призов недели.',
    how_note: 'Жетоны начисляет сервер за результаты, которые он проверил.',
    invite: 'Позвать друга',
    invite_text: 'Сыграем? Ретро-игры прямо в Telegram.',
    no_history: 'Операций пока нет. Сыграй — и здесь появятся первые жетоны.',
    r_achievement: 'Достижение', r_record: 'Личный рекорд', r_daily: 'Вход за день', r_task: 'Задание',
    r_invite: 'Приглашение', r_prize: 'Приз недели', r_shop: 'Покупка', r_annul: 'Отменено администратором', r_admin: 'От администратора',
    prize_place: '{place} место ({board})', board_mario: 'Прыг-Скок', board_tanks: 'Танкодром', board_bombs: 'Бомбодром', board_word: 'Слово дня', board_overall: 'общий зачёт',
    shop_note: 'Купленное включается в «Внешнем виде» игры.',
    buy: 'Купить', bought: 'Куплено',
    confirm: 'Купить «{name}» за {n} {w}?',
    choose: 'Как купить «{name}»?',
    pay_tokens: '◆ {n} {w}', pay_stars: '⭐ {n}', cancel: 'Отмена',
    life_name: 'Прыг-Скок: ещё одна жизнь',
    life_choose: 'Ещё одна жизнь: игра продолжится с этого места. Как оплатить?',
    life_confirm: 'Купить ещё одну жизнь за {n} {w}? Игра продолжится с этого места.',
    paid_wait: 'Оплата прошла, товар появится через несколько секунд. Если нет — откройте игру заново.',
    not_enough: 'Не хватает жетонов: нужно {n}, есть {have}.',
    buy_failed: 'Не получилось купить. Проверьте связь и попробуйте ещё раз.',
    toast: '+{n} {w}', days: '{n} д.', hours: '{n} ч', minutes: '{n} мин',
    task_play: 'сыграть игру', task_level: 'пройти уровень', invite_friend: 'друг доиграл', invite_from: 'по приглашению друга',
  },
  en: {
    title: 'TICKETS',
    tab_tasks: 'Tasks', tab_top: 'Top 100', tab_table: 'Table', tab_history: 'History', tab_shop: 'Shop',
    game_mario: 'Hop-Skip', game_tanks: 'Tank Field', game_bombs: 'Bomb Field', game_word: 'Word of the Day',
    sec_day: 'Every day · new ones in {left} (00:00 UTC)',
    sec_week: 'Every week · new week in {left}',
    sec_once: 'Achievements · once', achieved: 'Achievement',
    t_login: 'Open the collection today',
    t_login_note: 'Days in a row: {streak}. Each next day +{step}, up to {max}.',
    t_invite: 'Invite a friend: {count} of {max} this week',
    t_invite_note: 'Your friend plays {games} {games_w} — {inviter} {inviter_w} for you, {newcomer} for them.',
    t_play: 'Play a game', t_level: 'Clear a level', t_record: 'Beat your best',
    t_level_word: 'Guess the word', t_record_word: 'Beat your best streak (2 days or more)', t_level_bombs: 'Clear a stage',
    t_play_note: 'Counts when the game ends, or when you leave for the menu after 20 seconds of play.',
    t_record_note: 'Score more than your best in this game. Your first game counts too.',
    t_other: 'Each game has its own tasks: open the game and tap «◆» in its menu.',
    period_week: 'This week', period_all: 'All time',
    top_overall: 'Tickets got in {p}', top_game: 'Best score in {p}',
    top_word: 'Points in {p}: up to 6 a day (6 for the first try)',
    p_week: 'this week', p_all: 'all time',
    prizes: 'Weekly prizes for places 1–{n}: {list}.',
    me_place: 'Your place: {place} ({value})', me_none: 'You are not in this table yet.',
    table_empty: 'Empty so far. Be the first!', you: 'You',
    banner_sub: 'Tasks · Top 100 · Shop',
    shop_game: 'This game\'s items. All items are in «◆ Tickets» on the main screen.',
    close: 'Close', loading: 'Loading…',
    offline: 'The server is not reachable right now. Try again later.',
    moved: 'server moved — reopen',
    not_ready: 'Tickets will appear once the server is updated.',
    expired: 'The game has been open too long and Telegram no longer confirms who you are. Open it again.',
    moved_long: 'The server restarted at a new address, and the game was opened by an old link.',
    reopen: 'Open the game again',
    balance: 'Balance: {n}',
    today: 'Today: {n} of {cap}. Days in a row: {streak}.',
    how_cap: 'At most {cap} a day, weekly prizes aside.',
    how_note: 'Tickets are given by the server for results it has checked.',
    invite: 'Invite a friend',
    invite_text: 'Want to play? Retro games right in Telegram.',
    no_history: 'Nothing here yet. Play a game to get your first tickets.',
    r_achievement: 'Achievement', r_record: 'Personal best', r_daily: 'Visit of the day', r_task: 'Task',
    r_invite: 'Invite', r_prize: 'Weekly prize', r_shop: 'Purchase', r_annul: 'Cancelled by admin', r_admin: 'From the admin',
    prize_place: 'place {place} ({board})', board_mario: 'Hop-Skip', board_tanks: 'Tank Field', board_bombs: 'Bomb Field', board_word: 'Word of the Day', board_overall: 'overall',
    shop_note: 'What you buy is switched on in the game\'s Looks.',
    buy: 'Buy', bought: 'Bought',
    confirm: 'Buy «{name}» for {n} {w}?',
    choose: 'How to buy «{name}»?',
    pay_tokens: '◆ {n} {w}', pay_stars: '⭐ {n}', cancel: 'Cancel',
    life_name: 'Hop-Skip: one more life',
    life_choose: 'One more life: the game goes on from here. How to pay?',
    life_confirm: 'Buy one more life for {n} {w}? The game goes on from here.',
    paid_wait: 'Paid. The item will appear in a few seconds; if not, open the game again.',
    not_enough: 'Not enough tickets: {n} needed, you have {have}.',
    buy_failed: 'Could not buy. Check the connection and try again.',
    toast: '+{n} {w}', days: '{n} d', hours: '{n} h', minutes: '{n} min',
    task_play: 'play a game', task_level: 'clear a level', invite_friend: 'your friend played', invite_from: 'invited by a friend',
  },
};
// Russian plural for «жетон»: 1 жетон, 2 жетона, 5 жетонов.
function word(n) {
  if (lang !== 'ru') return n === 1 ? 'ticket' : 'tickets';
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'жетонов';
  if (b === 1) return 'жетон';
  return b >= 2 && b <= 4 ? 'жетона' : 'жетонов';
}
function T(key, vars) {
  let s = STR[lang][key] || STR.ru[key] || key;
  if (vars && typeof vars.n === 'number') vars = Object.assign({ w: word(vars.n) }, vars);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Address and requests: lib/server.js.
const server = window.Server || { hasServer: false };
const botName = (() => {
  let name = new URLSearchParams(location.search).get('bot');
  try { if (!name) name = localStorage.getItem('prygskok_bot'); } catch (e) { /* ignore */ }
  if (!name && window.CARTRIDGE) name = window.CARTRIDGE.bot;
  return (name || '').replace(/[^A-Za-z0-9_]/g, '');
})();
const enabled = !!(server.hasServer && initData);

const OWNED_KEY = 'wallet_owned';
let owned = (() => {
  try { const v = JSON.parse(localStorage.getItem(OWNED_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
})();
let me = null;
let info = null;
let meAt = 0;          // when `me` came from the server (0: from the phone or not yet)
let infoFresh = false; // the shop list was asked for in this launch
const tables = {};     // board:period -> { data: answer of /top, at, loading }

const request = (method, path, body) => server.request(method, '/api/wallet' + path, body);

function keepOwned(list) {
  owned = list.slice();
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned)); } catch (e) { /* private mode */ }
}

// The last balance, tasks and tables are kept on the phone: the panel opens at once with them
// and catches up when the server answers (the server is behind a tunnel and can be slow).
const CACHE_KEY = 'wallet_cache_' + (myId || 0);
const CACHE_VERSION = 1;
function save() {
  if (!enabled) return;
  const keep = {};
  for (const k of Object.keys(tables)) if (tables[k].data) keep[k] = { data: tables[k].data, at: tables[k].at };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ v: CACHE_VERSION, me, info, tables: keep }));
  } catch (e) { /* private mode or full */ }
}
if (enabled) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && c.v === CACHE_VERSION && c.me && c.info) {
      me = c.me;
      info = c.info;
      for (const k of Object.keys(c.tables || {})) tables[k] = c.tables[k];
    }
  } catch (e) { /* nothing saved */ }
}

function setMe(m) {
  me = m;
  meAt = Date.now();
  keepOwned(m.owned || []);
  badge();
  save();
}

// One refresh at a time: opening tabs quickly does not pile up requests. Without `force`, an
// answer younger than FRESH_MS is reused (switching tabs asks nothing).
const FRESH_MS = 20000;
let loading = null;
function refresh(force) {
  if (!enabled) return Promise.resolve(null);
  if (loading) return loading;
  if (!force && infoFresh && me && Date.now() - meAt < FRESH_MS) return Promise.resolve(me);
  loading = Promise.all([infoFresh ? info : request('GET', '/info'), request('GET', '/me')]).then(([i, m]) => {
    info = i;
    infoFresh = true;
    setMe(m);
    return m;
  }).finally(() => { loading = null; });
  return loading;
}

// A table, from memory when it is younger than TABLE_FRESH_MS; an older one stays on screen
// while the new one loads.
const TABLE_FRESH_MS = 30000;
function loadTable(board, period) {
  const key = board + ':' + period;
  const t = tables[key];
  if (t && t.loading) return t.loading;
  if (t && t.data && Date.now() - t.at < TABLE_FRESH_MS) return Promise.resolve(t.data);
  const p = request('GET', `/top?board=${board}&period=${period}`).then((r) => {
    tables[key] = { data: r, at: Date.now() };
    save();
    return r;
  }, (e) => {
    if (tables[key]) delete tables[key].loading;
    throw e;
  });
  tables[key] = Object.assign({}, t, { loading: p });
  return p;
}

// ---------- Balance in the menu ----------
let badgeEl = null;
function badge() {
  // Only the collection's menu (with its game list); a game page keeps its own screen.
  if (!enabled) return;
  // A narrow button (data-short) shows only the number.
  for (const b of gameButtons) {
    b.textContent = '◆' + (me ? ' ' + me.balance + (b.dataset.short ? '' : ' ' + word(me.balance)) : b.dataset.short ? '' : ' ' + T('title').toLowerCase());
  }
  const menu = document.getElementById('menuList') && document.getElementById('menu');
  if (!menu) return;
  // The banner on top of the menu: the balance and the way into the tasks, tables and shop.
  if (!badgeEl) {
    badgeEl = document.createElement('button');
    badgeEl.id = 'walletBanner';
    badgeEl.innerHTML = '<span class="wbLabel"></span><b class="wbValue"></b><span class="wbSub"></span><i>›</i>';
    badgeEl.addEventListener('click', () => (server.online === false ? reopen() : open('tasks')));
    const h1 = menu.querySelector('h1');
    if (h1) h1.insertAdjacentElement('afterend', badgeEl); else menu.prepend(badgeEl);
  }
  const moved = server.online === false;
  badgeEl.querySelector('.wbLabel').textContent = '◆ ' + T('title');
  badgeEl.querySelector('.wbValue').textContent = moved ? T('moved') : me ? me.balance + ' ' + word(me.balance) : '…';
  badgeEl.querySelector('.wbSub').textContent = moved ? '' : T('banner_sub');
}

// A game's own «◆ Жетоны» button: its tasks, its table and its shop.
const gameButtons = [];
function button(el, game) {
  if (!el) return;
  if (!enabled) { el.remove(); return; }
  gameButtons.push(el);
  el.addEventListener('click', () => (server.online === false ? reopen() : open('tasks', { game })));
  badge();
}

// ---------- Toasts after a game result ----------
function grants(w) {
  if (!w || !Array.isArray(w.grants)) return;
  if (w.me) setMe(w.me);
  else if (me && typeof w.balance === 'number') { me.balance = w.balance; badge(); }
  // The tasks crossed off by this result show up the next time the panel opens.
  if (w.grants.length && !w.me) refreshSoon();
  let box = document.getElementById('walletToasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'walletToasts';
    document.body.append(box);
  }
  w.grants.forEach((g, i) => setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'walletToast';
    el.textContent = '◆ ' + T('toast', { n: g.amount }) + ' · ' + T('r_' + g.reason);
    box.append(el);
    setTimeout(() => el.remove(), 3000);
  }, i * 900));
}

// New achievements of a game (the server sends them with its result).
function achieved(list) {
  if (!Array.isArray(list) || !list.length) return;
  let box = document.getElementById('walletToasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'walletToasts';
    document.body.append(box);
  }
  list.forEach((a, i) => setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'walletToast';
    el.textContent = (a.icon || '★') + ' ' + T('achieved') + ': ' + achTitle(a);
    box.append(el);
    setTimeout(() => el.remove(), 3500);
  }, i * 1200));
}

// ---------- Panel ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const itemName = (id) => {
  if (String(id).startsWith('life:')) return T('life_name');
  const it = info && info.shop.find((x) => x.id === id);
  return it ? it[lang] : id;
};
function left(ms) {
  const h = Math.max(0, Math.floor(ms / 3600000));
  if (h < 1) return T('minutes', { n: Math.max(1, Math.ceil(ms / 60000)) });
  return h >= 48 ? T('days', { n: Math.floor(h / 24) }) : T('hours', { n: h });
}
// «3 игры», «5 игр».
function gamesWord(n) {
  if (lang !== 'ru') return n === 1 ? 'game' : 'games';
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return 'игр';
  return b === 1 ? 'игру' : b >= 2 && b <= 4 ? 'игры' : 'игр';
}
// A Hop-Skip achievement in the player's language (the server sends both).
const achTitle = (a) => (lang === 'en' && a.titleEn) || a.title;
const achText = (a) => (lang === 'en' && a.textEn) || a.text;

// A game switched off in config.js (enabled: false) is hidden here too: its shop items and its
// own panel. What the player already got from it stays in the history.
// The жетоны id 'mario' is 'pryg-skok' in config.js.
const CONFIG_ID = { mario: 'pryg-skok' };
const gameOn = (g) => !g || !window.CARTRIDGE || !window.CARTRIDGE.isEnabled || window.CARTRIDGE.isEnabled(CONFIG_ID[g] || g);

let panel = null;
let current = 'tasks';
let scope = null;      // null — the collection; 'mario' | 'tanks' | 'bombs' | 'word' — that game
let period = 'week';   // tables: 'week' | 'all'

function tabsOf(game) { return game ? ['tasks', 'table', 'shop'] : ['tasks', 'top', 'shop', 'history']; }

function taskRow(t, title, note) {
  return `<li class="wTask${t.done ? ' done' : ''}"><span class="wMark">${t.done ? '✓' : '◆'}</span>` +
    `<span><b>${esc(title)}</b>${note ? `<br><small>${esc(note)}</small>` : ''}</span>` +
    `<i>${t.done ? '' : '+' + t.amount}</i></li>`;
}

function renderTasks(body) {
  const note = (t) => `<p class="wNote">${esc(t)}</p>`;
  const now = Date.now();
  let html = `<p class="wBig">${esc(T('balance', { n: me.balance }))}</p>` +
    note(T('today', { n: me.today, cap: me.dailyCap, streak: me.streak }));
  const list = (me.tasks && me.tasks[scope || 'main']) || [];
  const day = list.filter((t) => t.period === 'day');
  const week = list.filter((t) => t.period === 'week');
  const once = list.filter((t) => t.period === 'once');
  const r = info;
  if (day.length) {
    html += `<h2 class="wSec">${esc(T('sec_day', { left: left(me.dayEndsAt - now) }))}</h2><ul class="wTasks">` +
      day.map((t) => (t.id === 'login'
        ? taskRow(t, T('t_login'), T('t_login_note', { streak: me.streak, step: r.daily.perStreakDay, max: r.daily.max }))
        : taskRow(t, T(STR.ru['t_' + t.id + '_' + scope] ? 't_' + t.id + '_' + scope : 't_' + t.id),
          scope !== 'word' && STR.ru['t_' + t.id + '_note'] ? T('t_' + t.id + '_note') : ''))).join('') + '</ul>';
  }
  if (week.length) {
    html += `<h2 class="wSec">${esc(T('sec_week', { left: left(me.seasonEndsAt - now) }))}</h2><ul class="wTasks">` +
      week.map((t) => taskRow(t, T('t_invite', { count: t.count, max: t.max }),
        T('t_invite_note', { games: t.games, games_w: gamesWord(t.games), inviter: t.amount, inviter_w: word(t.amount), newcomer: t.newcomer }))).join('') + '</ul>';
    if (botName && myId) html += `<button class="wAct" data-act="invite">${esc(T('invite'))}</button>`;
  }
  if (once.length) {
    html += `<h2 class="wSec">${esc(T('sec_once'))}</h2><ul class="wTasks">` +
      once.map((t) => taskRow(t, (t.icon ? t.icon + ' ' : '') + achTitle(t), achText(t))).join('') + '</ul>';
  }
  if (!scope) html += note(T('t_other'));
  body.innerHTML = html + note(T('how_cap', { cap: r.dailyCap })) + note(T('how_note'));
}

function renderTable(body) {
  const board = scope || 'overall';
  const t = tables[board + ':' + period] && tables[board + ':' + period].data;
  const prizes = (info.season.boards[board] || []).filter((n) => n > 0);
  let html = '<div class="wTabs wPeriod">' + ['week', 'all'].map((p) =>
    `<button data-period="${p}" class="${p === period ? 'on' : ''}">${esc(T('period_' + p))}</button>`).join('') + '</div>' +
    `<p class="wNote">${esc(T(scope === 'word' ? 'top_word' : scope ? 'top_game' : 'top_overall', { p: T('p_' + period) }))}</p>`;
  if (period === 'week' && prizes.length) {
    html += `<p class="wNote">${esc(T('prizes', { n: prizes.length, list: prizes.join(', ') }))}</p>`;
  }
  // Load (or refresh) this table, and the other period too, so switching it is instant.
  const want = { scope, period };
  loadTable(board, period).then((r) => {
    if (r !== t && panel && current === 'table' && want.scope === scope && want.period === period) renderTable(body);
  }, () => {
    if (!t && panel && current === 'table' && want.scope === scope && want.period === period) {
      body.innerHTML = html + `<p class="wNote">${esc(T('offline'))}</p>`;
    }
  });
  loadTable(board, period === 'week' ? 'all' : 'week').catch(() => {});
  if (!t) {
    body.innerHTML = html + `<p class="wNote">${esc(T('loading'))}</p>`;
    return;
  }
  html += `<p class="wNote">${esc(t.me ? T('me_place', { place: t.me.place, value: t.me.value }) : T('me_none'))}</p>`;
  // Below the top 100 the player still sees their own row, at the end.
  const mine = t.me && !t.rows.some((p) => p.me)
    ? `<li class="wGap">…</li><li class="me"><span>${t.me.place}</span><span>${esc(T('you'))}</span><b>${t.me.value}</b></li>` : '';
  html += t.rows.length ? '<ol class="wTop">' + t.rows.map((p) =>
    `<li class="${p.me ? 'me' : ''}"><span>${p.place}</span><span>${esc(p.name)}</span><b>${p.value}</b></li>`).join('') + mine + '</ol>'
    : `<p class="wNote">${esc(T('table_empty'))}</p>`;
  body.innerHTML = html;
}

function render(body) {
  const note = (t) => `<p class="wNote">${esc(t)}</p>`;
  if (current === 'tasks') renderTasks(body);
  else if (current === 'table') renderTable(body);
  else if (current === 'history') {
    if (!me.history.length) { body.innerHTML = note(T('no_history')); return; }
    body.innerHTML = '<ul class="wHist">' + me.history.map((h) => {
      let what = T('r_' + h.reason);
      if (h.reason === 'shop') what += ': ' + itemName(h.event);
      // What exactly: the game and the task, the achievement, the friend.
      const [g, task] = String(h.event).split(':');
      if (h.reason === 'task' || h.reason === 'record') {
        if (STR.ru['game_' + g]) what += ': ' + T('game_' + g);
        if (h.reason === 'task' && STR.ru['task_' + task]) what += ' · ' + T('task_' + task);
      }
      if (h.reason === 'achievement') {
        const a = me.tasks && me.tasks[g] && me.tasks[g].find((t) => t.id === 'ach:' + task);
        if (a) what += ': ' + achTitle(a);
      }
      if (h.reason === 'invite' && STR.ru['invite_' + g]) what += ': ' + T('invite_' + g);
      if (h.reason === 'prize') {
        const [, board, place] = String(h.event).split(':');
        if (place) what += ': ' + T('prize_place', { place, board: T('board_' + board) });
      }
      const d = new Date(h.at);
      const date = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
      return `<li><span>${date}</span><span>${esc(what)}</span><b class="${h.amount < 0 ? 'neg' : ''}">` +
        `${h.amount > 0 ? '+' : ''}${h.amount}</b></li>`;
    }).join('') + '</ul>';
  } else {
    const items = info.shop.filter((it) => (!scope || it.game === scope) && gameOn(it.game));
    body.innerHTML = `<p class="wBig">${esc(T('balance', { n: me.balance }))}</p>` +
      note(scope ? T('shop_game') : T('shop_note')) +
      '<ul class="wShop">' + items.map((it) => {
        const has = owned.includes(it.id);
        return `<li><span>${esc(it[lang])}</span>` + (has ? `<i>${esc(T('bought'))}</i>`
          : `<span class="wPay"><button class="wAct" data-act="buy" data-via="tokens" data-id="${esc(it.id)}">◆ ${it.price}</button>` +
            (canStars() ? `<button class="wAct wStars" data-act="buy" data-via="stars" data-id="${esc(it.id)}">⭐ ${it.stars}</button>` : '') +
            '</span>') + '</li>';
      }).join('') + '</ul>';
  }
}

function show(tab) {
  current = tab === 'top' ? 'table' : tab;
  panel.querySelectorAll('.wTabs.wMain button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const body = panel.querySelector('.wBody');
  if (me && info) render(body);
  else body.innerHTML = `<p class="wNote">${esc(T('loading'))}</p>`;
  const before = me;
  refresh().then(() => { if (me !== before && panel && current === (tab === 'top' ? 'table' : tab)) render(body); })
    .catch((e) => {
      // A saved copy stays on screen only while the server has not refused this launch.
      if (!panel || (me && (meAt || (e && e.status === 0 && server.online !== false)))) return;
      // Which of the failures it was, so the player (and whoever reads the report) can tell.
      let html = `<p class="wNote">${esc(T('offline'))}</p>`;
      if (server.online === false && botName) {
        html = `<p class="wNote">${esc(T('moved_long'))}</p><button class="wAct" data-act="reopen">${esc(T('reopen'))}</button>`;
      } else if (e && e.status === 404) html = `<p class="wNote">${esc(T('not_ready'))}</p>`;
      else if (e && e.status === 401) html = `<p class="wNote">${esc(T('expired'))}</p>` +
        (botName ? `<button class="wAct" data-act="reopen">${esc(T('reopen'))}</button>` : '');
      body.innerHTML = html + `<p class="wNote wCode">${esc(e && e.status ? 'HTTP ' + e.status : (e && e.message) || '')}</p>`;
    });
}

function close() {
  if (!panel) return;
  document.removeEventListener('keydown', onKey, true);
  panel.remove();
  panel = null;
}
function onKey(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  close();
}

// Old callers asked for 'how'; it is the tasks tab now.
function open(tab, opts) {
  if (!enabled) return;
  checkinIfNewDay();
  close();
  scope = opts && ['mario', 'tanks', 'bombs', 'word'].includes(opts.game) && gameOn(opts.game) ? opts.game : null;
  period = 'week';
  const tabs = tabsOf(scope);
  if (tab === 'how' || !tabs.includes(tab)) tab = 'tasks';
  panel = document.createElement('div');
  panel.className = 'wallet';
  const title = scope ? T('title') + ' · ' + T('game_' + scope) : T('title');
  panel.innerHTML = `<h1>◆ ${esc(title)}</h1><div class="wTabs wMain">` +
    tabs.map((t) => `<button data-tab="${t}">${esc(T('tab_' + t))}</button>`).join('') +
    `</div><div class="wBody"></div><button class="wClose">${esc(T('close'))}</button>`;
  panel.querySelector('.wTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) show(b.dataset.tab);
  });
  panel.querySelector('.wClose').addEventListener('click', close);
  panel.querySelector('.wBody').addEventListener('click', (e) => {
    const p = e.target.closest('[data-period]');
    if (p) { period = p.dataset.period; renderTable(panel.querySelector('.wBody')); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'buy') buy(b.dataset.id, b.dataset.via).then((ok) => { if (ok && panel) show('shop'); });
    if (b.dataset.act === 'invite') invite();
    if (b.dataset.act === 'reopen') reopen();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(panel);
  show(tab);
  // The table is what takes the server longest: start loading it while the player looks around.
  if (current !== 'table') loadTable(scope || 'overall', 'week').catch(() => {});
}

// The bot's /start answers with a button that carries the server's current address.
function reopen() {
  if (!botName) return;
  const link = 'https://t.me/' + botName + '?start=play';
  try {
    if (tg && tg.openTelegramLink) { tg.openTelegramLink(link); tg.close(); return; }
  } catch (e) { /* fall through */ }
  location.href = link;
}

function invite() {
  const link = 'https://t.me/' + botName + '?start=ref_' + myId;
  const share = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(T('invite_text'));
  try {
    if (tg && tg.openTelegramLink) { tg.openTelegramLink(share); return; }
  } catch (e) { /* fall through */ }
  window.open(share, '_blank');
}

function ask(text) {
  return new Promise((resolve) => {
    try {
      if (tg && tg.showConfirm && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) { tg.showConfirm(text, resolve); return; }
    } catch (e) { /* fall through */ }
    resolve(window.confirm(text));
  });
}
function tell(text) {
  try {
    if (tg && tg.showAlert && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) { tg.showAlert(text); return; }
  } catch (e) { /* fall through */ }
  window.alert(text);
}

// Telegram Stars are paid inside Telegram only (6.1+ has openInvoice).
const canStars = () => !!(tg && tg.openInvoice && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1'));

// A choice of how to pay: Telegram's own popup with up to three buttons.
function choose(it, message) {
  if (!canStars()) return Promise.resolve('tokens');
  return new Promise((resolve) => {
    try {
      tg.showPopup({
        message: message || T('choose', { name: it[lang] }),
        buttons: [
          { id: 'tokens', type: 'default', text: T('pay_tokens', { n: it.price }) },
          { id: 'stars', type: 'default', text: T('pay_stars', { n: it.stars }) },
          { type: 'cancel' },
        ],
      }, (id) => resolve(id || null));
    } catch (e) { resolve('tokens'); }
  });
}

function bought(id, r) {
  keepOwned((r && r.owned) || owned.concat(id));
  if (me && r && typeof r.balance === 'number') me.balance = r.balance;
  badge();
  save();
  try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* ignore */ }
  return true;
}

function buyTokens(it) {
  if (me.balance < it.price) { tell(T('not_enough', { n: it.price, have: me.balance })); return Promise.resolve(false); }
  return ask(T('confirm', { name: it[lang], n: it.price })).then((yes) => {
    if (!yes) return false;
    return request('POST', '/buy', { item: it.id }).then((r) => bought(it.id, r));
  });
}

// The server makes the invoice; the bot hands the item over once Telegram reports the
// payment, so after «paid» the page waits for the item to show up.
function buyStars(it) {
  return request('POST', '/invoice', { item: it.id }).then((r) => new Promise((resolve) => {
    tg.openInvoice(r.link, (status) => {
      if (status !== 'paid') { resolve(false); return; }
      let tries = 0;
      const check = () => refresh(true).then(() => {
        if (owned.includes(it.id)) resolve(bought(it.id));
        else if (++tries < 8) setTimeout(check, 1500);
        else { tell(T('paid_wait')); resolve(false); }
      }, () => (++tries < 8 ? setTimeout(check, 1500) : resolve(false)));
      check();
    });
  }));
}

function buy(id, via) {
  if (!enabled) return Promise.resolve(false);
  return (info && me ? Promise.resolve() : refresh()).then(() => {
    const it = info.shop.find((x) => x.id === id);
    if (!it) return false;
    if (owned.includes(id)) return true;
    return (via ? Promise.resolve(via) : choose(it)).then((how) => {
      if (how === 'stars' && canStars()) return buyStars(it);
      if (how === 'tokens') return buyTokens(it);
      return false;
    });
  }).catch((e) => {
    if (e && e.status === 409) return refresh(true).then(() => owned.includes(id), () => false);
    tell(T('buy_failed'));
    return false;
  });
}

// One more life in Hop-Skip once the lives are over (the price grows with the level in the
// world). offer: a random id of this game over, so a repeated request is not charged twice.
// Resolves true when paid: with жетоны at once, with Stars when Telegram says «paid».
function lifeOffer(level) {
  const l = info && info.life;
  if (!l || !Number.isInteger(level) || level < 0 || level >= l.price.length) return null;
  return { price: l.price[level], stars: l.stars[level] };
}
function buyLife(offer, level) {
  if (!enabled) return Promise.resolve(false);
  return (info && me ? Promise.resolve() : refresh()).then(() => {
    const o = lifeOffer(level);
    if (!o) return false;
    return choose(o, T('life_choose')).then((how) => {
      if (how === 'stars' && canStars()) {
        return request('POST', '/life-invoice', { offer, level }).then((r) => new Promise((resolve) => {
          tg.openInvoice(r.link, (status) => resolve(status === 'paid'));
        }));
      }
      if (how !== 'tokens') return false;
      if (me.balance < o.price) { tell(T('not_enough', { n: o.price, have: me.balance })); return false; }
      return ask(T('life_confirm', { n: o.price })).then((yes) => {
        if (!yes) return false;
        return request('POST', '/life', { offer, level }).then((r) => {
          if (typeof r.balance === 'number') me.balance = r.balance;
          badge();
          save();
          try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* ignore */ }
          return true;
        });
      });
    });
  }).catch((e) => {
    if (e && e.status === 409 && e.body && e.body.error === 'not enough') {
      tell(T('not_enough', { n: (lifeOffer(level) || {}).price, have: e.body.balance }));
    } else if (e && e.status === 409 && e.body && e.body.error === 'already') {
      return true;
    } else tell(T('buy_failed'));
    return false;
  });
}

let soon = null;
function refreshSoon() {
  clearTimeout(soon);
  soon = setTimeout(() => refresh(true).catch(() => {}), 500);
}

// The collection's daily task «open it today» is done by opening it: once a day, the
// server decides (UTC days), and a repeat gives nothing.
// Its answer carries the whole panel (`me`), so a launch costs one request for it, not two.
const CHECKIN_KEY = 'wallet_checkin';
function start() {
  const day = Math.floor(Date.now() / 86400000);
  let done = false;
  try { done = localStorage.getItem(CHECKIN_KEY) === day + ':' + myId; } catch (e) { /* private mode */ }
  if (done) return refresh(true);
  loading = Promise.all([infoFresh ? info : request('GET', '/info'), request('POST', '/checkin')]).then(([i, w]) => {
    info = i;
    infoFresh = true;
    try { localStorage.setItem(CHECKIN_KEY, day + ':' + myId); } catch (e) { /* private mode */ }
    grants(w);
    return w.me ? me : null;
  }).finally(() => { loading = null; });
  // An older server answers without `me`; a failed check-in is tried again next launch.
  return loading.then((m) => m || refresh(true), () => refresh(true));
}

// The game stayed open past 00:00 UTC: the new day's visit counts when the player comes back.
function checkinIfNewDay() {
  let last = null;
  try { last = localStorage.getItem(CHECKIN_KEY); } catch (e) { return; }
  if (last && last !== Math.floor(Date.now() / 86400000) + ':' + myId && !loading) start().catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && enabled) checkinIfNewDay(); });

window.Wallet = {
  enabled,
  button,
  owns: (id) => owned.includes(id),
  price: (id) => { const it = info && info.shop.find((x) => x.id === id); return it ? it.price : null; },
  stars: (id) => { const it = info && info.shop.find((x) => x.id === id); return it ? it.stars : null; },
  buy,
  lifeOffer,
  buyLife,
  grants,
  achieved,
  open,
  refresh,
};

// Games mark their «◆» button with data-wallet-game="<game>".
document.querySelectorAll('[data-wallet-game]').forEach((el) => button(el, el.dataset.walletGame));

if (enabled) {
  badge();
  start().catch(() => badge());
}
})();
