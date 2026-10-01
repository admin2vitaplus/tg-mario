// Жетоны (docs/TZ.md, P1-7): balance in the menu, «how to get», history and the shop.
// Only the server credits жетоны; this page can look at the balance and buy items.
// Works only when the game was opened through the bot (?api= and Telegram initData);
// otherwise nothing is shown.
//
//   Wallet.owns(shopId)       -> true if bought (remembered on the phone for offline starts)
//   Wallet.price(shopId)      -> price, or null before the shop list has loaded
//   Wallet.buy(shopId)        -> Promise<boolean>, asks the player first
//   Wallet.grants(res.wallet) -> shows «+10» toasts after a game result
//   Wallet.open(tab)          -> 'how' | 'history' | 'shop'
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
    tab_how: 'Как получить', tab_history: 'История', tab_shop: 'Магазин',
    close: 'Закрыть', loading: 'Загрузка…',
    offline: 'Сервер сейчас недоступен. Попробуйте позже.',
    moved: 'сервер переехал — открыть заново',
    moved_long: 'Сервер перезапустился и сменил адрес, а игра открыта по старой ссылке.',
    reopen: 'Открыть игру заново',
    balance: 'Баланс: {n}',
    today: 'Сегодня получено {n} из {cap}. Серия дней: {streak}.',
    how_ach: 'Достижение — {n} (каждое один раз)',
    how_record: 'Личный рекорд в «Прыг-Скоке» — {n}, раз в день',
    how_daily: 'Первая игра за день — {base}, каждый день подряд ещё +{step}, до {max}',
    how_invite: 'Друг по твоей ссылке сыграет {games} игры — тебе {inviter}, ему {newcomer}',
    how_week: 'Итоги недели: призы за места в таблице «Прыг-Скока» и в общем зачёте, фонд {pool}',
    how_ends: 'Неделя закончится через {left} (понедельник 00:00 UTC)',
    how_cap: 'В день можно получить не больше {cap}, не считая призов недели.',
    how_note: 'Жетоны начисляет сервер за результаты, которые он проверил.',
    invite: 'Позвать друга',
    invite_text: 'Сыграем? Ретро-игры прямо в Telegram.',
    no_history: 'Операций пока нет. Сыграй — и здесь появятся первые жетоны.',
    r_achievement: 'Достижение', r_record: 'Личный рекорд', r_daily: 'Игра за день',
    r_invite: 'Приглашение', r_prize: 'Приз недели', r_shop: 'Покупка', r_annul: 'Отменено администратором',
    prize_place: '{place} место ({board})', board_mario: 'Прыг-Скок', board_overall: 'общий зачёт',
    shop_note: 'Купленное включается в «Внешнем виде» игры.',
    buy: 'Купить', bought: 'Куплено',
    confirm: 'Купить «{name}» за {n} {w}?',
    not_enough: 'Не хватает жетонов: нужно {n}, есть {have}.',
    buy_failed: 'Не получилось купить. Проверьте связь и попробуйте ещё раз.',
    toast: '+{n} {w}', days: '{n} д.', hours: '{n} ч',
  },
  en: {
    title: 'TICKETS',
    tab_how: 'How to get', tab_history: 'History', tab_shop: 'Shop',
    close: 'Close', loading: 'Loading…',
    offline: 'The server is not reachable right now. Try again later.',
    moved: 'server moved — reopen',
    moved_long: 'The server restarted at a new address, and the game was opened by an old link.',
    reopen: 'Open the game again',
    balance: 'Balance: {n}',
    today: 'Today: {n} of {cap}. Days in a row: {streak}.',
    how_ach: 'Achievement — {n} (each one once)',
    how_record: 'Personal best in Hop-Skip — {n}, once a day',
    how_daily: 'First game of the day — {base}, +{step} for every day in a row, up to {max}',
    how_invite: 'A friend from your link plays {games} games — {inviter} for you, {newcomer} for them',
    how_week: 'Weekly results: prizes for places in the Hop-Skip table and overall, {pool} in total',
    how_ends: 'The week ends in {left} (Monday 00:00 UTC)',
    how_cap: 'At most {cap} a day, weekly prizes aside.',
    how_note: 'Tickets are given by the server for results it has checked.',
    invite: 'Invite a friend',
    invite_text: 'Want to play? Retro games right in Telegram.',
    no_history: 'Nothing here yet. Play a game to get your first tickets.',
    r_achievement: 'Achievement', r_record: 'Personal best', r_daily: 'Game of the day',
    r_invite: 'Invite', r_prize: 'Weekly prize', r_shop: 'Purchase', r_annul: 'Cancelled by admin',
    prize_place: 'place {place} ({board})', board_mario: 'Hop-Skip', board_overall: 'overall',
    shop_note: 'What you buy is switched on in the game\'s Looks.',
    buy: 'Buy', bought: 'Bought',
    confirm: 'Buy «{name}» for {n} {w}?',
    not_enough: 'Not enough tickets: {n} needed, you have {have}.',
    buy_failed: 'Could not buy. Check the connection and try again.',
    toast: '+{n} {w}', days: '{n} d', hours: '{n} h',
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

const request = (method, path, body) => server.request(method, '/api/wallet' + path, body);

function keepOwned(list) {
  owned = list.slice();
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned)); } catch (e) { /* private mode */ }
}

// One refresh at a time: opening tabs quickly does not pile up requests.
let loading = null;
function refresh() {
  if (!enabled) return Promise.resolve(null);
  if (loading) return loading;
  loading = Promise.all([info ? info : request('GET', '/info'), request('GET', '/me')]).then(([i, m]) => {
    info = i;
    me = m;
    keepOwned(m.owned || []);
    badge();
    return m;
  }).finally(() => { loading = null; });
  return loading;
}

// ---------- Balance in the menu ----------
let badgeEl = null;
function badge() {
  // Only the collection's menu (with its game list); a game page keeps its own screen.
  const menu = document.getElementById('menuList') && document.getElementById('menu');
  if (!enabled || !menu) return;
  if (!badgeEl) {
    badgeEl = document.createElement('button');
    badgeEl.id = 'walletBadge';
    badgeEl.addEventListener('click', () => (server.online === false ? reopen() : open('how')));
    const h1 = menu.querySelector('h1');
    if (h1) h1.insertAdjacentElement('afterend', badgeEl); else menu.prepend(badgeEl);
  }
  badgeEl.textContent = '◆ ' + (me ? me.balance + ' ' + word(me.balance)
    : server.online === false ? T('moved') : T('title').toLowerCase());
}

// ---------- Toasts after a game result ----------
function grants(w) {
  if (!w || !Array.isArray(w.grants)) return;
  if (me && typeof w.balance === 'number') { me.balance = w.balance; badge(); }
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

// ---------- Panel ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const itemName = (id) => {
  const it = info && info.shop.find((x) => x.id === id);
  return it ? it[lang] : id;
};
function left(ms) {
  const h = Math.max(0, Math.floor(ms / 3600000));
  return h >= 48 ? T('days', { n: Math.floor(h / 24) }) : T('hours', { n: h });
}

let panel = null;
let current = 'how';

function render(body) {
  const note = (t) => `<p class="wNote">${esc(t)}</p>`;
  if (current === 'how') {
    const r = info;
    const rows = [
      T('how_ach', { n: r.achievement }),
      T('how_record', { n: r.record }),
      T('how_daily', { base: r.daily.base, step: r.daily.perStreakDay, max: r.daily.max }),
      T('how_invite', { games: r.invite.gamesNeeded, inviter: r.invite.inviter, newcomer: r.invite.newcomer }),
      T('how_week', { pool: r.season.pool }),
    ];
    body.innerHTML = `<p class="wBig">${esc(T('balance', { n: me.balance }))}</p>` +
      note(T('today', { n: me.today, cap: me.dailyCap, streak: me.streak })) +
      '<ul class="wList">' + rows.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' +
      note(T('how_ends', { left: left(me.seasonEndsAt - Date.now()) })) + note(T('how_cap', { cap: r.dailyCap })) +
      note(T('how_note')) + (botName && myId ? `<button class="wAct" data-act="invite">${esc(T('invite'))}</button>` : '');
  } else if (current === 'history') {
    if (!me.history.length) { body.innerHTML = note(T('no_history')); return; }
    body.innerHTML = '<ul class="wHist">' + me.history.map((h) => {
      let what = T('r_' + h.reason);
      if (h.reason === 'shop') what += ': ' + itemName(h.event);
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
    body.innerHTML = `<p class="wBig">${esc(T('balance', { n: me.balance }))}</p>` + note(T('shop_note')) +
      '<ul class="wShop">' + info.shop.map((it) => {
        const has = owned.includes(it.id);
        return `<li><span>${esc(it[lang])}</span>` + (has ? `<i>${esc(T('bought'))}</i>`
          : `<button class="wAct" data-act="buy" data-id="${esc(it.id)}">◆ ${it.price}</button>`) + '</li>';
      }).join('') + '</ul>';
  }
}

function show(tab) {
  current = tab;
  panel.querySelectorAll('.wTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const body = panel.querySelector('.wBody');
  if (me && info) render(body);
  else body.innerHTML = `<p class="wNote">${esc(T('loading'))}</p>`;
  refresh().then(() => { if (panel && current === tab) render(body); })
    .catch(() => {
      if (!panel || me) return;
      body.innerHTML = server.online === false && botName
        ? `<p class="wNote">${esc(T('moved_long'))}</p><button class="wAct" data-act="reopen">${esc(T('reopen'))}</button>`
        : `<p class="wNote">${esc(T('offline'))}</p>`;
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

function open(tab) {
  if (!enabled) return;
  close();
  panel = document.createElement('div');
  panel.className = 'wallet';
  panel.innerHTML = `<h1>◆ ${esc(T('title'))}</h1><div class="wTabs">` +
    ['how', 'history', 'shop'].map((t) => `<button data-tab="${t}">${esc(T('tab_' + t))}</button>`).join('') +
    `</div><div class="wBody"></div><button class="wClose">${esc(T('close'))}</button>`;
  panel.querySelector('.wTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) show(b.dataset.tab);
  });
  panel.querySelector('.wClose').addEventListener('click', close);
  panel.querySelector('.wBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'buy') buy(b.dataset.id).then((ok) => { if (ok && panel) show('shop'); });
    if (b.dataset.act === 'invite') invite();
    if (b.dataset.act === 'reopen') reopen();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(panel);
  show(tab || 'how');
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

function buy(id) {
  if (!enabled) return Promise.resolve(false);
  return (info && me ? Promise.resolve() : refresh()).then(() => {
    const it = info.shop.find((x) => x.id === id);
    if (!it) return false;
    if (owned.includes(id)) return true;
    if (me.balance < it.price) { tell(T('not_enough', { n: it.price, have: me.balance })); return false; }
    return ask(T('confirm', { name: it[lang], n: it.price })).then((yes) => {
      if (!yes) return false;
      return request('POST', '/buy', { item: id }).then((r) => {
        keepOwned(r.owned || owned.concat(id));
        if (me) me.balance = r.balance;
        badge();
        try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* ignore */ }
        return true;
      });
    });
  }).catch(() => { tell(T('buy_failed')); return false; });
}

window.Wallet = {
  enabled,
  owns: (id) => owned.includes(id),
  price: (id) => { const it = info && info.shop.find((x) => x.id === id); return it ? it.price : null; },
  buy,
  grants,
  open,
  refresh,
};

if (enabled) {
  badge();
  refresh().catch(() => badge());
}
})();
