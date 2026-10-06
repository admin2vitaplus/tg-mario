// «Слово дня»: one 5-letter word a day for everyone, six tries, color hints.
// The server picks the word and checks every try (bot/word.js), so the page
// never knows the answer before the game is over. Days change at 00:00 UTC.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('6.1')) { tg.setHeaderColor('#000000'); tg.setBackgroundColor('#000000'); }
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
  } catch (e) { /* not inside Telegram */ }
}
const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
const uiLang = /^(ru|uk|be|kk)\b/i.test((user && user.language_code) || navigator.language || '') ? 'ru' : 'en';

const STR = {
  ru: {
    title: 'СЛОВО ДНЯ', title_n: 'СЛОВО ДНЯ №{n}',
    sub: 'Новое слово через {left}', sub_lang: 'Слово на русском',
    left_h: '{h} ч {m} мин', left_m: '{m} мин',
    loading: 'Загрузка…',
    need_bot: 'Слово дня проверяет сервер: откройте игру через бота в Telegram.',
    offline: 'Сервер сейчас недоступен. Попробуйте чуть позже.',
    moved: 'Сервер сменил адрес, а игра открыта по старой ссылке.',
    expired: 'Игра открыта слишком давно. Откройте её заново через бота.',
    reopen: 'Открыть заново',
    short: 'Мало букв', not_word: 'Такого слова нет в словаре', repeat: 'Это слово уже было',
    net_err: 'Нет связи с сервером, попробуйте ещё раз',
    new_day: 'Наступил новый день — новое слово!',
    won: 'Отгадано!', won_n: 'С {n}-й попытки: +{score} {pw}',
    lost: 'Не вышло', lost_n: 'Слово было:',
    streak: 'Дней подряд: {n} · рекорд: {best}',
    today: 'Сегодня отгадали {solved} из {players}',
    share: 'Поделиться', chat_btn: 'Таблица чата', next: 'Следующее слово через {left}',
    enter: 'ВВОД', del: '⌫',
    share_text: 'Слово дня №{n} · {score}', share_lost: 'X/6', share_call: 'Побей мой результат!',
    copied: 'Результат скопирован',
    rules_t: 'КАК ИГРАТЬ',
    rules: [
      'Отгадайте слово из 5 букв за 6 попыток. Слово одно на всех и меняется каждый день в 00:00 UTC.',
      'Каждая попытка — настоящее слово. После неё буквы подсвечиваются:',
      'зелёным — буква на своём месте; жёлтым — есть в слове, но в другом месте; серым — её нет.',
      'Очки дня: 6 с первой попытки, 5 со второй … 1 с шестой. Очки за неделю идут в таблицу игры и дают призы недели.',
      'Отправьте результат в чат друзей: квадратики без спойлера, а по ссылке друг сыграет то же слово. Кто открыл игру из этого чата, попадёт в его таблицу.',
      'Буква ё пишется как е. Кнопка RU/EN переключает язык слова.',
    ],
    rules_ex: 'книга', close: 'Закрыть',
    chat_t: 'ТАБЛИЦА ЧАТА', chat_today: 'Сегодня', chat_week: 'Очки за неделю',
    chat_none: 'Таблица чата появится, когда игру откроют по ссылке из группового чата. Отправьте свой результат в чат друзей — кто сыграет по ссылке, попадёт в таблицу.',
    chat_empty: 'Пока никто из этого чата не доиграл сегодня.',
    tries: '{n}/6', fail: 'X/6',
    looks_t: 'ВНЕШНИЙ ВИД', looks_done: 'Готово', looks_tiles: 'Плитки',
    look_classic: 'Обычные', look_sea: 'Море', look_candy: 'Карамель',
    back: 'Назад',
  },
  en: {
    title: 'WORD OF THE DAY', title_n: 'WORD OF THE DAY #{n}',
    sub: 'New word in {left}', sub_lang: 'Word in English',
    left_h: '{h} h {m} min', left_m: '{m} min',
    loading: 'Loading…',
    need_bot: 'The server checks the word of the day: open the game through the bot in Telegram.',
    offline: 'The server is not available right now. Try again a bit later.',
    moved: 'The server has a new address, and the game was opened by an old link.',
    expired: 'The game has been open for too long. Open it again through the bot.',
    reopen: 'Open again',
    short: 'Not enough letters', not_word: 'Not in the word list', repeat: 'You tried this word already',
    net_err: 'No connection to the server, try again',
    new_day: 'A new day — a new word!',
    won: 'Got it!', won_n: 'In {n}: +{score} {pw}',
    lost: 'Not this time', lost_n: 'The word was:',
    streak: 'Days in a row: {n} · best: {best}',
    today: '{solved} of {players} guessed it today',
    share: 'Share', chat_btn: 'Chat table', next: 'Next word in {left}',
    enter: 'ENTER', del: '⌫',
    share_text: 'Word of the Day #{n} · {score}', share_lost: 'X/6', share_call: 'Can you beat it?',
    copied: 'Result copied',
    rules_t: 'HOW TO PLAY',
    rules: [
      'Guess the 5-letter word in 6 tries. Everyone gets the same word; it changes every day at 00:00 UTC.',
      'Each try must be a real word. Then the letters light up:',
      'green — right letter, right place; yellow — in the word, another place; grey — not in the word.',
      'Points of the day: 6 for the first try, 5 for the second … 1 for the sixth. The week\'s points go to the game\'s table and win weekly prizes.',
      'Send your result to a friends\' chat: squares, no spoilers, and the link gives your friend the same word. Everyone who opens the game from that chat is in its table.',
      'The RU/EN button switches the language of the word.',
    ],
    rules_ex: 'crane', close: 'Close',
    chat_t: 'CHAT TABLE', chat_today: 'Today', chat_week: 'Points this week',
    chat_none: 'The chat table appears when the game is opened by a link in a group chat. Send your result to a friends\' chat: whoever plays by the link joins the table.',
    chat_empty: 'Nobody from this chat has finished today yet.',
    tries: '{n}/6', fail: 'X/6',
    looks_t: 'LOOKS', looks_done: 'Done', looks_tiles: 'Tiles',
    look_classic: 'Classic', look_sea: 'Sea', look_candy: 'Candy',
    back: 'Back',
  },
};
// Russian plural for «очко»: 1 очко, 2 очка, 5 очков.
function points(n) {
  if (uiLang !== 'ru') return n === 1 ? 'point' : 'points';
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return 'очков';
  return b === 1 ? 'очко' : b >= 2 && b <= 4 ? 'очка' : 'очков';
}
function T(key, vars) {
  let s = STR[uiLang][key];
  if (s === undefined) s = STR.ru[key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
const track = (type) => { try { if (window.GameEvents) window.GameEvents.send(type, 'word'); } catch (e) { /* ignore */ } };
const haptic = (kind) => {
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(kind); } catch (e) { /* ignore */ }
};

// ---------- Keyboards ----------
const LAYOUT = {
  ru: ['йцукенгшщзхъ', 'фывапролджэ', '<ячсмитьбю>'],
  en: ['qwertyuiop', 'asdfghjkl', '<zxcvbnm>'],
};
const LETTER = { ru: /^[а-яё]$/, en: /^[a-z]$/ };

// ---------- State ----------
const server = window.Server || { hasServer: false, request: () => Promise.reject(new Error('offline')) };
const initData = (tg && tg.initData) || '';
let lang = store.get('word_lang') === 'en' || store.get('word_lang') === 'ru' ? store.get('word_lang') : uiLang;
let game = null;   // the server's state of today's game
let typed = '';
let busy = false;
let fresh = -1;    // index of the row that has just been revealed (it flips)

// ---------- Looks: tile colors ----------
const THEMES = {
  classic: { hit: '#3a9d3a', near: '#c9a400', miss: '#3a3a3c' },
  sea: { hit: '#1f8fb3', near: '#e08b2e', miss: '#2d3a46' },
  candy: { hit: '#d6457f', near: '#8a5cd6', miss: '#3b3340' },
};
const LOOK_KEY = 'word_looks';
const tilePreview = (theme) => (ctx, size) => {
  const c = THEMES[theme];
  const s = Math.floor(size / 3);
  [c.hit, c.near, c.miss].forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(i * s + 1, Math.floor(size / 3), s - 2, s);
  });
};
const LOOK_GROUPS = [{
  id: 'tiles',
  title: T('looks_tiles'),
  items: [
    { id: 'classic', name: T('look_classic'), stars: 0, draw: tilePreview('classic') },
    { id: 'sea', name: T('look_sea'), shop: 'word-tiles-sea', tokens: 150, draw: tilePreview('sea') },
    { id: 'candy', name: T('look_candy'), shop: 'word-tiles-candy', tokens: 100, draw: tilePreview('candy') },
  ],
}];
function applyLooks() {
  const sel = window.Looks ? window.Looks.load(LOOK_KEY, LOOK_GROUPS) : { tiles: 'classic' };
  const c = THEMES[sel.tiles] || THEMES.classic;
  const root = document.documentElement.style;
  root.setProperty('--hit', c.hit);
  root.setProperty('--near', c.near);
  root.setProperty('--miss', c.miss);
}

// ---------- Drawing ----------
function fit() {
  // Six rows of tiles plus the keyboard on the smallest phone screen.
  const w = Math.min(window.innerWidth, 520) - 16;
  const h = window.innerHeight - 330;
  const size = Math.max(34, Math.min(58, Math.floor((w - 24) / 5), Math.floor((h - 30) / 6)));
  document.documentElement.style.setProperty('--tile', size + 'px');
}

function letterMarks() {
  const best = {};
  if (!game) return best;
  for (const g of game.guesses) {
    [...g.word].forEach((ch, i) => {
      const m = Number(g.marks[i]);
      if (!(ch in best) || m > best[ch]) best[ch] = m;
    });
  }
  return best;
}

function renderBoard() {
  const board = $('board');
  board.innerHTML = '';
  const tries = game ? game.tries : 6;
  for (let r = 0; r < tries; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    const g = game && game.guesses[r];
    const current = game && game.state === 'play' && r === game.guesses.length;
    for (let i = 0; i < 5; i++) {
      const t = document.createElement('div');
      t.className = 'tile';
      if (g) {
        t.textContent = [...g.word][i];
        t.className += ' m' + g.marks[i] + (r === fresh ? '' : ' old');
        if (r === fresh) t.style.animationDelay = (i * 0.12) + 's';
      } else if (current && typed[i]) {
        t.textContent = typed[i];
        t.className += ' typed';
      }
      row.append(t);
    }
    board.append(row);
  }
  fresh = -1;
}

function renderKeys() {
  const box = $('keys');
  box.innerHTML = '';
  if (game && game.state !== 'play') return;
  const marks = letterMarks();
  for (const line of LAYOUT[lang]) {
    const row = document.createElement('div');
    row.className = 'krow';
    for (const ch of line) {
      const b = document.createElement('button');
      b.type = 'button';
      if (ch === '<') { b.className = 'key wide'; b.textContent = T('enter'); b.dataset.k = 'enter'; }
      else if (ch === '>') { b.className = 'key wide'; b.textContent = T('del'); b.dataset.k = 'del'; }
      else {
        b.className = 'key' + (ch in marks ? ' m' + marks[ch] : '');
        b.textContent = ch;
        b.dataset.k = ch;
      }
      row.append(b);
    }
    box.append(row);
  }
}

function leftText(ms) {
  const min = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? T('left_h', { h, m: min % 60 }) : T('left_m', { m: min });
}

function renderTop() {
  $('title').textContent = game ? T('title_n', { n: game.number }) : T('title');
  $('btnLang').textContent = lang.toUpperCase();
  $('sub').textContent = game ? T('sub', { left: leftText(game.nextAt - Date.now()) }) : '';
}

function renderResult() {
  const box = $('result');
  if (!game || game.state === 'play') { box.classList.add('hidden'); return; }
  const won = game.state === 'won';
  const n = game.guesses.length;
  box.innerHTML =
    `<h2>${esc(won ? T('won') : T('lost'))}</h2>` +
    (won ? `<p>${esc(T('won_n', { n, score: game.score, pw: points(game.score) }))}</p>`
      : `<p>${esc(T('lost_n'))}</p><p class="answer">${esc(game.answer || '')}</p>`) +
    `<p>${esc(T('streak', { n: game.streak, best: game.bestStreak }))}</p>` +
    (game.today.players > 1 ? `<p>${esc(T('today', { solved: game.today.solved, players: game.today.players }))}</p>` : '') +
    `<div class="acts"><button class="ui-btn primary" data-act="share">${esc(T('share'))}</button>` +
    `<button class="ui-btn" data-act="chat">${esc(T('chat_btn'))}</button></div>`;
  box.classList.remove('hidden');
}

function render() {
  renderTop();
  renderBoard();
  renderKeys();
  renderResult();
}

let msgTimer = null;
function say(text, ms = 1800) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  if (ms) msgTimer = setTimeout(() => { $('msg').textContent = ''; }, ms);
}
function shake() {
  const row = $('board').children[game ? game.guesses.length : 0];
  if (!row) return;
  row.classList.remove('shake');
  void row.offsetWidth; // restart the animation
  row.classList.add('shake');
  haptic('error');
}

// A problem that stops the game: no server, an old link, an old login.
function stop(e) {
  let text = T('offline');
  let reopen = false;
  if (!server.hasServer || !initData) { text = T('need_bot'); reopen = true; }
  else if (server.online === false) { text = T('moved'); reopen = true; }
  else if (e && e.status === 401) { text = T('expired'); reopen = true; }
  const box = $('result');
  box.innerHTML = `<p>${esc(text)}</p>` + (reopen && botName() ? `<div class="acts"><button class="ui-btn primary" data-act="reopen">${esc(T('reopen'))}</button></div>` : '');
  box.classList.remove('hidden');
  $('keys').innerHTML = '';
}

// ---------- Server ----------
function load() {
  if (!server.hasServer || !initData) { renderBoard(); stop(); return; }
  say(T('loading'), 0);
  server.request('GET', '/api/word/today?lang=' + lang).then((g) => {
    game = g;
    typed = '';
    say('', 1);
    render();
    if (store.get('word_rules') !== '1') { store.set('word_rules', '1'); rules(); }
  }, (e) => { say('', 1); renderBoard(); stop(e); });
}

function submit() {
  if (!game || game.state !== 'play' || busy) return;
  if ([...typed].length < 5) { say(T('short')); shake(); return; }
  busy = true;
  const first = game.guesses.length === 0;
  server.request('POST', '/api/word/guess', { lang, word: typed, day: game.day }).then((g) => {
    if (first) track('game_start');
    game = g;
    typed = '';
    fresh = g.guesses.length - 1;
    render();
    if (g.state !== 'play') {
      haptic(g.state === 'won' ? 'success' : 'warning');
      if (window.Wallet) window.Wallet.grants(g.wallet);
    }
  }, (e) => {
    const err = e && e.body && e.body.error;
    if (e && e.status === 422) { say(T(err === 'repeat' ? 'repeat' : 'not_word')); shake(); return; }
    if (e && e.status === 409 && err === 'new day') { say(T('new_day'), 3000); load(); return; }
    if (e && e.status === 409 && e.body && e.body.guesses) { game = e.body; typed = ''; render(); return; }
    if (e && (e.status === 401 || e.offline)) { stop(e); return; }
    say(T('net_err'), 2500);
  }).finally(() => { busy = false; });
}

function press(k) {
  if (!game || game.state !== 'play') return;
  if (k === 'enter') { submit(); return; }
  if (k === 'del') typed = [...typed].slice(0, -1).join('');
  else if ([...typed].length < 5) typed += k === 'ё' ? 'е' : k;
  renderBoard();
}

// ---------- Sharing: squares without spoilers and a link to the same word ----------
function botName() {
  let name = new URLSearchParams(location.search).get('bot');
  try {
    if (name) localStorage.setItem('prygskok_bot', name);
    else name = localStorage.getItem('prygskok_bot');
  } catch (e) { /* ignore */ }
  name = (name || '').replace(/[^A-Za-z0-9_]/g, '');
  return name || (window.CARTRIDGE && window.CARTRIDGE.bot) || '';
}
// t.me/<bot>?startapp=ref_<id>-word opens the collection straight in this game and counts the
// friend as invited; the server's tunnel name rides after «__» (see ../menu.js, ../lib/server.js).
function appLink() {
  let host = '';
  try { host = new URL(server.base).hostname; } catch (e) { /* no server */ }
  const m = /^([a-z0-9-]{1,63})\.trycloudflare\.com$/.exec(host);
  const label = (user && user.id ? 'ref_' + user.id + '-' : '') + 'word';
  return 'https://t.me/' + botName() + '?startapp=' + label + (m ? '__' + m[1] : '');
}
const SQUARE = ['⬛', '🟨', '🟩'];
function shareText() {
  const score = game.state === 'won' ? T('tries', { n: game.guesses.length }) : T('fail');
  const grid = game.guesses.map((g) => [...g.marks].map((m) => SQUARE[m]).join('')).join('\n');
  return T('share_text', { n: game.number, score }) + (lang !== uiLang ? ' (' + lang.toUpperCase() + ')' : '') +
    '\n' + grid + '\n' + T('share_call');
}
function share() {
  if (!game || game.state === 'play') return;
  track('share_clicked');
  track('invite_created');
  const text = shareText();
  const link = appLink();
  try {
    if (tg && tg.openTelegramLink && botName()) {
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text));
      return;
    }
  } catch (e) { /* fall through */ }
  if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text + '\n' + link).then(() => say(T('copied')));
}

function reopen() {
  const name = botName();
  if (!name) return;
  const link = 'https://t.me/' + name + '?start=play';
  try {
    if (tg && tg.openTelegramLink) { tg.openTelegramLink(link); tg.close(); return; }
  } catch (e) { /* fall through */ }
  location.href = link;
}

// ---------- Panels: rules and the chat table (the look of lib/wallet.css) ----------
let panel = null;
function closePanel() {
  if (!panel) return;
  panel.remove();
  panel = null;
}
function openPanel(title, html) {
  closePanel();
  panel = document.createElement('div');
  panel.className = 'wallet';
  panel.innerHTML = `<h1>${esc(title)}</h1><div class="wBody">${html}</div><button class="wClose">${esc(T('close'))}</button>`;
  panel.querySelector('.wClose').addEventListener('click', closePanel);
  document.body.append(panel);
  return panel.querySelector('.wBody');
}

function rules() {
  const ex = [...T('rules_ex')].map((ch, i) => `<div class="tile m${[2, 0, 1, 0, 0][i]} old">${esc(ch)}</div>`).join('');
  const r = STR[uiLang].rules;
  openPanel(T('rules_t'), `<div class="wRules"><p>${esc(r[0])}</p><p>${esc(r[1])}</p><div class="ex">${ex}</div>` +
    r.slice(2).map((p) => `<p>${esc(p)}</p>`).join('') + '</div>');
}

// The last answer is shown at once while the new one loads.
let lastChat = null;
function chatTable() {
  const body = openPanel(T('chat_t'), `<p class="wNote">${esc(T('loading'))}</p>`);
  const mine = panel;
  if (lastChat) drawChat(body, lastChat);
  server.request('GET', '/api/word/chat').then((t) => {
    lastChat = t;
    if (panel === mine) drawChat(body, t);
  }, () => { if (panel === mine && !lastChat) body.innerHTML = `<p class="wNote">${esc(T('offline'))}</p>`; });
}

function drawChat(body, t) {
  if (!t.chat) { body.innerHTML = `<p class="wNote">${esc(T('chat_none'))}</p>`; return; }
  const today = t.today.length ? '<ol class="wTop">' + t.today.map((p, i) =>
    `<li class="${p.me ? 'me' : ''}"><span>${i + 1}</span><span>${esc(p.name)}<small>${p.lang.toUpperCase()}</small></span>` +
    `<b>${esc(p.won ? T('tries', { n: p.tries }) : T('fail'))}</b></li>`).join('') + '</ol>'
    : `<p class="wNote">${esc(T('chat_empty'))}</p>`;
  const week = t.week.length ? '<ol class="wTop">' + t.week.map((p) =>
    `<li class="${p.me ? 'me' : ''}"><span>${p.place}</span><span>${esc(p.name)}</span><b>${p.value}</b></li>`).join('') + '</ol>' : '';
  body.innerHTML = `<h2 class="wSec">${esc(T('chat_today'))}</h2>${today}` +
    (week ? `<h2 class="wSec">${esc(T('chat_week'))}</h2>${week}` : '');
}

function looks() {
  if (!window.Looks) return;
  window.Looks.open({
    key: LOOK_KEY, title: T('looks_t'), doneText: T('looks_done'), groups: LOOK_GROUPS,
    onChange: applyLooks, onClose: applyLooks,
  });
}

// ---------- Input ----------
$('keys').addEventListener('click', (e) => {
  const b = e.target.closest('[data-k]');
  if (b) press(b.dataset.k);
});
$('result').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'share') share();
  if (b.dataset.act === 'chat') chatTable();
  if (b.dataset.act === 'reopen') reopen();
});
$('btnRules').addEventListener('click', rules);
$('btnChat').addEventListener('click', chatTable);
$('btnLooks').addEventListener('click', looks);
$('btnLang').addEventListener('click', () => {
  lang = lang === 'ru' ? 'en' : 'ru';
  store.set('word_lang', lang);
  game = null;
  typed = '';
  renderTop();
  load();
});
document.addEventListener('keydown', (e) => {
  if (panel || document.querySelector('.looks, .wallet')) {
    if (e.key === 'Escape') closePanel();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'enter') press('enter');
  else if (k === 'backspace') press('del');
  else if (LETTER[lang].test(k)) press(k);
  else return;
  e.preventDefault();
});
window.addEventListener('resize', fit);
// The countdown to the next word; a new day loads the new word.
setInterval(() => {
  if (!game) return;
  if (Date.now() >= game.nextAt) { say(T('new_day'), 3000); load(); } else renderTop();
}, 30000);

function back() {
  if (panel) { closePanel(); return; }
  if (window.Back) window.Back.toMenu(); else location.href = '../';
}
if (window.Back) window.Back.attach(back, { menu: '../', label: T('back') });

applyLooks();
fit();
renderTop();
track('game_open');
load();
})();
