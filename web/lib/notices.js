// «🔔 Уведомления» in the collection's menu: updates and news for everyone and personal
// messages to the player, written by the owner in the panel (bot/notices.js, bot/admin.js).
// A button under the «◆ Жетоны» banner shows how many are unread; opening the list marks
// them read on the server. Works only when the game was opened through the bot, like жетоны.
// Texts come from the server and go on the page only as text.
//
//   Notices.open()     -> the list
//   Notices.refresh()  -> asks the server again
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';
const myId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
const lang = /^(ru|uk|be|kk)\b/i.test((tg && tg.initDataUnsafe && tg.initDataUnsafe.user &&
  tg.initDataUnsafe.user.language_code) || navigator.language || '') ? 'ru' : 'en';

const STR = {
  ru: {
    title: 'УВЕДОМЛЕНИЯ', button: '🔔 Уведомления', sub_none: 'Новостей пока нет', sub_new: 'Новых: {n}', sub_read: 'Всё прочитано',
    tab_all: 'Все', tab_update: 'Обновления', tab_news: 'Новости', tab_personal: 'Личные',
    kind_update: 'Крупное обновление', kind_minor: 'Небольшое обновление', kind_news: 'Новость',
    size_all: 'Все', size_major: 'Крупные', size_minor: 'Небольшие', kind_personal: 'Лично вам', fresh: 'новое',
    empty: 'Здесь будут обновления игр, новости и сообщения лично вам.', empty_tab: 'В этом разделе пока ничего нет.',
    loading: 'Загрузка…', offline: 'Сервер сейчас недоступен. Показано то, что было загружено раньше.', close: 'Закрыть',
  },
  en: {
    title: 'NOTIFICATIONS', button: '🔔 Notifications', sub_none: 'No news yet', sub_new: 'New: {n}', sub_read: 'All read',
    tab_all: 'All', tab_update: 'Updates', tab_news: 'News', tab_personal: 'Personal',
    kind_update: 'Major update', kind_minor: 'Minor update', kind_news: 'News',
    size_all: 'All', size_major: 'Major', size_minor: 'Minor', kind_personal: 'For you', fresh: 'new',
    empty: 'Game updates, news and messages for you will show up here.', empty_tab: 'Nothing in this section yet.',
    loading: 'Loading…', offline: 'The server is not reachable right now. Showing what was loaded before.', close: 'Close',
  },
};
const T = (key, vars) => {
  let s = STR[lang][key] || STR.ru[key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
};

const server = window.Server || { hasServer: false };
const enabled = !!(server.hasServer && initData);
const TABS = ['all', 'update', 'news', 'personal'];

// The last list is kept on the phone: the count shows at once, the server catches up.
const CACHE_KEY = 'notices_cache_' + (myId || 0);
let state = null; // { items, seen, unread }
let at = 0;       // when `state` came from the server
let off = false;  // the server does not know notices (an older version)
try {
  const c = JSON.parse(localStorage.getItem(CACHE_KEY));
  if (c && Array.isArray(c.items)) state = c;
} catch (e) { /* nothing saved */ }
const save = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } };

// ---------- The button in the menu ----------
let btn = null;
// The newest unread notice's title next to the count, so the menu already says what is new.
const newest = () => {
  const n = state.items.find((x) => x.id > state.seen);
  return (n && (n.title || n.body)) || T('sub_new', { n: state.unread });
};
function button() {
  const menu = document.getElementById('menuList') && document.getElementById('menu');
  if (!enabled || !menu) return;
  if (off) { if (btn) btn.remove(); btn = null; return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'noticeBtn';
    btn.innerHTML = '<span class="nbLabel"></span><span class="nbSub"></span><b class="nbCount"></b><i>›</i>';
    btn.addEventListener('click', open);
    // Under the жетоны banner (lib/wallet.js), or under the title if there is none.
    const after = document.getElementById('walletBanner') || menu.querySelector('h1');
    if (after) after.insertAdjacentElement('afterend', btn); else menu.prepend(btn);
  }
  const unread = state ? state.unread : 0;
  btn.querySelector('.nbLabel').textContent = T('button');
  btn.querySelector('.nbSub').textContent = !state ? T('loading')
    : unread ? newest() : state.items.length ? T('sub_read') : T('sub_none');
  const count = btn.querySelector('.nbCount');
  count.textContent = unread > 99 ? '99+' : String(unread);
  count.hidden = !unread;
  btn.classList.toggle('fresh', unread > 0);
}

let loading = null;
function refresh() {
  if (!enabled || off) return Promise.resolve(state);
  if (loading) return loading;
  loading = server.request('GET', '/api/notices?lang=' + lang).then((r) => {
    state = { items: r.items || [], seen: r.seen || 0, unread: r.unread || 0 };
    at = Date.now();
    save();
    button();
    if (panel) render();
    return state;
  }, (e) => {
    // An older server: no notices yet, the button goes away until it is updated.
    if (e && e.status === 404) { off = true; button(); close(); }
    throw e;
  }).finally(() => { loading = null; });
  return loading;
}

// ---------- The list ----------
let panel = null;
let tab = 'all';
let size = 'all'; // in «Обновления»: all, major (update) or minor
let shownSeen = 0; // what was read before this opening: newer items stay lit while the list is open

const date = (ms) => {
  try {
    return new Date(ms).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return ''; }
};
const shortDate = (ms) => {
  const d = new Date(ms);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
};
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function render() {
  const body = panel.querySelector('.wBody');
  panel.querySelectorAll('.wTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  body.replaceChildren();
  if (!state) { body.append(el('p', 'wNote', T('loading'))); return; }
  if (!at && server.online === false) body.append(el('p', 'wNote wWarn', T('offline')));
  // Updates are major (kind update) and minor ones; the updates tab can show one size only.
  if (tab === 'update') {
    const sizes = el('div', 'wTabs wPeriod nSizes');
    for (const z of ['all', 'major', 'minor']) {
      const b = el('button', z === size ? 'on' : null, T('size_' + z));
      b.dataset.size = z;
      sizes.append(b);
    }
    body.append(sizes);
  }
  const isUpdate = (n) => n.kind === 'update' || n.kind === 'minor';
  const items = state.items.filter((n) => tab === 'all' || (tab === 'update' ? isUpdate(n) &&
    (size === 'all' || (size === 'major') === (n.kind === 'update')) : n.kind === tab));
  if (!items.length) { body.append(el('p', 'wNote', T(state.items.length ? 'empty_tab' : 'empty'))); return; }
  // A major update is a full card; a minor one is a short line.
  const list = el('ul', 'nList');
  for (const n of items) {
    const li = el('li', 'nItem n-' + n.kind + (n.id > shownSeen ? ' unread' : ''));
    const head = el('div', 'nHead');
    // A minor one keeps its head on one line: a short date (23.10).
    head.append(el('span', 'nKind', T('kind_' + n.kind)), el('span', 'nDate', n.kind === 'minor' ? shortDate(n.at) : date(n.at)));
    if (n.id > shownSeen) head.append(el('span', 'nNew', T('fresh')));
    li.append(head);
    if (n.title) li.append(el('b', 'nTitle', n.title));
    if (n.body) li.append(el('p', 'nBody', n.body));
    list.append(li);
  }
  body.append(list);
}

// Everything on the screen is read: the server remembers the newest id, the count goes to 0.
function markRead() {
  if (!state || !state.items.length) return;
  const top = Math.max(...state.items.map((n) => n.id));
  if (top <= state.seen) return;
  state.seen = top;
  state.unread = 0;
  save();
  button();
  server.request('POST', '/api/notices/read', { upTo: top }).then((r) => {
    if (state && typeof r.unread === 'number') { state.unread = r.unread; save(); button(); }
  }).catch(() => {});
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
  tab = 'all';
  shownSeen = state ? state.seen : 0;
  // The full-screen panel of lib/wallet.css, with its title, tabs and close button.
  panel = el('div', 'wallet notices');
  const tabs = el('div', 'wTabs wMain');
  for (const t of TABS) {
    const b = el('button', null, T('tab_' + t));
    b.dataset.tab = t;
    tabs.append(b);
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { tab = b.dataset.tab; size = 'all'; render(); }
  });
  const shut = el('button', 'wClose', T('close'));
  shut.addEventListener('click', close);
  const list = el('div', 'wBody');
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (b) { size = b.dataset.size; render(); }
  });
  panel.append(el('h1', null, '🔔 ' + T('title')), tabs, list, shut);
  document.addEventListener('keydown', onKey, true);
  document.body.append(panel);
  render();
  markRead();
  refresh().then(() => { if (panel) markRead(); }).catch(() => { if (panel) render(); });
}

// Coming back to the game after a while: new notices may have arrived.
const AGAIN_MS = 60000;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && enabled && Date.now() - at > AGAIN_MS) refresh().catch(() => {});
});

window.Notices = { enabled, open, refresh };

if (enabled) {
  button();
  refresh().catch(() => {});
}
})();
