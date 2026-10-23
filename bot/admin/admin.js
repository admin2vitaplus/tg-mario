// Панель владельца (bot/admin.js на сервере). Вход по логину и паролю; ключ сессии хранится
// до закрытия вкладки (sessionStorage) и уходит в каждый запрос.
// Внешних скриптов нет; имена игроков вставляются только как текст.
(function () {
  'use strict';

  var DICT = {
    ru: {
      title: '◆ Панель', login: 'Логин', password: 'Пароль', sign_in: 'Войти', sign_out: 'Выйти',
      wrong: 'Неверный логин или пароль.', locked: 'Слишком много попыток. Попробуйте через {n} мин.',
      disabled: 'Вход в панель не настроен на сервере.', error: 'Ошибка: ', loading: 'Загрузка…',
      tab_overview: 'Сводка', tab_players: 'Игроки', tab_economy: 'Жетоны', tab_stars: 'Звёзды', tab_server: 'Сервер',
      today: 'сегодня', yesterday: 'вчера', week: '7 дней', month: '30 дней', total: 'всего',
      players: 'Игроки', new_players: 'новые', games_done: 'игр', matches: 'матчи',
      by_day: 'По дням (Москва), 30 дней', retention: 'Удержание', d1: 'день 1', d7: 'день 7',
      kfactor: 'K-фактор', sources: 'Новые по источникам', src_direct: 'сами', src_ref: 'по ссылке друга', src_room: 'в комнату',
      by_game: 'По играм за 7 дней', g_mario: 'Прыг-Скок', g_tanks: 'Танкодром', g_bombs: 'Бомбодром', g_range: 'Тир', g_word: 'Слово дня',
      opens: 'открыли', starts: 'начали', finishes: 'доиграли', invites: 'приглашений', joined: 'пришли по приглашению',
      search: 'id, имя или @username', find: 'Найти', recent: 'Недавно активные', nothing: 'Ничего не найдено.',
      back: '← Назад', balance: 'Баланс', flagged: 'Помечен', not_flagged: 'Не помечен', record: 'рекорд', place: 'место',
      achievements: 'достижений', source: 'Пришёл', invited: 'Позвал друзей', last_active: 'Был активен', first_seen: 'Впервые',
      history: 'Журнал жетонов', purchases: 'Покупки за звёзды', refunded: 'возвращено', refund: 'Вернуть',
      adjust: 'Начислить или списать', amount: 'сколько, например 100 или -50', note: 'причина (видна только вам)', apply: 'Применить',
      flag: 'Пометить', unflag: 'Снять пометку', annul: 'Аннулировать неделю', why: 'причина пометки',
      sure_adjust: 'Изменить баланс игрока на {n}?', sure_annul: 'Снять всё, что игрок получил за эту неделю?',
      sure_refund: 'Вернуть {n} ⭐? Товар у игрока пропадёт.', done: 'Готово', not_enough: 'У игрока меньше жетонов, чем списывается.',
      week_now: 'Эта неделя', week_prev: 'Прошлая неделя', issued: 'выдано', spent: 'потрачено', annulled: 'аннулировано',
      manual: 'вручную', on_hand: 'На руках у игроков', top_got: 'Больше всех получили', flagged_list: 'Помеченные',
      ends: 'Неделя закончится', stars_all: 'Всего оплат', stars_sum: 'сумма', stars_refunded: 'возвращено',
      stars_items: 'По товарам', stars_recent: 'Последние оплаты', life: 'жизнь в «Прыг-Скоке»',
      commit: 'Версия', uptime: 'Работает', memory: 'Память', cpu: 'CPU', load: 'Нагрузка', db: 'База', live: 'Онлайн-комнаты',
      limit_mem: 'предел 256 МБ', limit_cpu: 'предел 40 %', h: 'ч', m: 'мин', none: 'нет',
      r_achievement: 'достижение', r_record: 'рекорд', r_daily: 'вход за день', r_task: 'задание', r_invite: 'приглашение',
      r_prize: 'приз недели', r_shop: 'покупка', r_annul: 'аннулировано', r_admin: 'вручную',
      tab_notices: 'Уведомления', n_new: 'Новое уведомление', n_kind: 'Что это', k_update: 'Обновление', k_news: 'Новость',
      k_personal: 'Личное', n_to: 'Кому', n_all: 'Всем игрокам', n_one: 'Одному игроку', n_player: 'id игрока',
      n_title: 'Заголовок', n_body: 'Текст', n_en: 'По-английски (для игроков с английским Telegram; можно не заполнять)',
      n_title_en: 'Title', n_body_en: 'Text', n_tg: 'Отправить и сообщением бота в Telegram', n_send: 'Опубликовать',
      sure_all: 'Опубликовать уведомление для всех игроков?', sure_one: 'Отправить уведомление игроку {n}?',
      n_sent: 'Опубликовано.', tg_sent: 'Сообщение в Telegram отправлено.', tg_failed: 'В Telegram не ушло (игрок мог остановить бота), но в игре уведомление есть.',
      n_list: 'Опубликованные', n_hide: 'Убрать', sure_hide: 'Убрать это уведомление у игроков?', n_hidden: 'убрано',
      n_read: 'прочитано', n_unread: 'не прочитано', n_everyone: 'всем', n_empty: 'Нужен заголовок или текст.',
      no_player: 'Игрока с таким id нет.', to_player: '🔔 Уведомление игроку',
    },
    en: {
      title: '◆ Dashboard', login: 'Login', password: 'Password', sign_in: 'Sign in', sign_out: 'Sign out',
      wrong: 'Wrong login or password.', locked: 'Too many attempts. Try again in {n} min.',
      disabled: 'Sign-in is not set up on the server.', error: 'Error: ', loading: 'Loading…',
      tab_overview: 'Overview', tab_players: 'Players', tab_economy: 'Tickets', tab_stars: 'Stars', tab_server: 'Server',
      today: 'today', yesterday: 'yesterday', week: '7 days', month: '30 days', total: 'total',
      players: 'Players', new_players: 'new', games_done: 'games', matches: 'matches',
      by_day: 'By day (Moscow time), 30 days', retention: 'Retention', d1: 'day 1', d7: 'day 7',
      kfactor: 'K-factor', sources: 'New players by source', src_direct: 'direct', src_ref: 'friend link', src_room: 'room link',
      by_game: 'By game, 7 days', g_mario: 'Hop-Skip', g_tanks: 'Tank Field', g_bombs: 'Bomb Field', g_range: 'Shooting Range', g_word: 'Word of the Day',
      opens: 'opened', starts: 'started', finishes: 'finished', invites: 'invites', joined: 'joined by invite',
      search: 'id, name or @username', find: 'Find', recent: 'Recently active', nothing: 'Nothing found.',
      back: '← Back', balance: 'Balance', flagged: 'Flagged', not_flagged: 'Not flagged', record: 'best', place: 'place',
      achievements: 'achievements', source: 'Came from', invited: 'Invited friends', last_active: 'Last active', first_seen: 'First seen',
      history: 'Ticket log', purchases: 'Stars purchases', refunded: 'refunded', refund: 'Refund',
      adjust: 'Add or remove tickets', amount: 'amount, e.g. 100 or -50', note: 'reason (only you see it)', apply: 'Apply',
      flag: 'Flag', unflag: 'Remove flag', annul: 'Cancel this week', why: 'flag reason',
      sure_adjust: 'Change the player balance by {n}?', sure_annul: 'Remove everything the player got this week?',
      sure_refund: 'Refund {n} ⭐? The player loses the item.', done: 'Done', not_enough: 'The player has fewer tickets than that.',
      week_now: 'This week', week_prev: 'Last week', issued: 'issued', spent: 'spent', annulled: 'cancelled',
      manual: 'manual', on_hand: 'Held by players', top_got: 'Top earners', flagged_list: 'Flagged players',
      ends: 'Week ends', stars_all: 'All payments', stars_sum: 'total', stars_refunded: 'refunded',
      stars_items: 'By item', stars_recent: 'Latest payments', life: 'Hop-Skip life',
      commit: 'Version', uptime: 'Uptime', memory: 'Memory', cpu: 'CPU', load: 'Load', db: 'Database', live: 'Online rooms',
      limit_mem: 'limit 256 MB', limit_cpu: 'limit 40%', h: 'h', m: 'min', none: 'none',
      r_achievement: 'achievement', r_record: 'record', r_daily: 'daily visit', r_task: 'task', r_invite: 'invite',
      r_prize: 'weekly prize', r_shop: 'purchase', r_annul: 'cancelled', r_admin: 'manual',
      tab_notices: 'Notifications', n_new: 'New notification', n_kind: 'Kind', k_update: 'Update', k_news: 'News',
      k_personal: 'Personal', n_to: 'To', n_all: 'All players', n_one: 'One player', n_player: 'player id',
      n_title: 'Title', n_body: 'Text', n_en: 'In English (for players with English Telegram; optional)',
      n_title_en: 'Title', n_body_en: 'Text', n_tg: 'Also send as a bot message in Telegram', n_send: 'Publish',
      sure_all: 'Publish the notification to all players?', sure_one: 'Send the notification to player {n}?',
      n_sent: 'Published.', tg_sent: 'The Telegram message was sent.', tg_failed: 'Telegram did not deliver it (the player may have stopped the bot), but it is in the game.',
      n_list: 'Published', n_hide: 'Remove', sure_hide: 'Remove this notification for players?', n_hidden: 'removed',
      n_read: 'read', n_unread: 'not read', n_everyone: 'everyone', n_empty: 'A title or a text is needed.',
      no_player: 'No player with this id.', to_player: '🔔 Notify the player',
    },
  };

  // ---------- Сессия ----------
  var token = '';
  try { token = sessionStorage.getItem('admin-token') || ''; } catch (e) { /* без хранилища — до перезагрузки */ }
  function setToken(t) {
    token = t;
    try {
      if (t) sessionStorage.setItem('admin-token', t);
      else { sessionStorage.removeItem('admin-token'); sessionStorage.removeItem('admin-overview'); }
    } catch (e) { /* ничего */ }
  }
  var lang = /^(ru|uk|be|kk)/i.test(navigator.language || 'ru') ? 'ru' : 'en';
  document.documentElement.lang = lang;
  function T(key, vars) {
    var s = DICT[lang][key] || DICT.ru[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  // ---------- Мелочи ----------
  var main = document.getElementById('main');
  var locale = lang === 'en' ? 'en-GB' : 'ru-RU';
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { el.addEventListener(ev, attrs.on[ev]); });
      else el.setAttribute(k, attrs[k]);
    });
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c);
        else el.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
    })([].slice.call(arguments, 2));
    return el;
  }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString(locale); }
  function pct(r) { return r && r.rate != null ? Math.round(r.rate * 100) + '% (' + r.returned + '/' + r.cohort + ')' : '—'; }
  function when(ms) { return ms ? new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function dayLabel(day) { return new Date(day * 86400000).toISOString().slice(8, 10) + '.' + new Date(day * 86400000).toISOString().slice(5, 7); }
  function mb(b) { return b == null ? '—' : (b / 1048576).toFixed(1) + ' MB'; }
  function dur(sec) { var hh = Math.floor(sec / 3600); return hh + ' ' + T('h') + ' ' + Math.floor((sec % 3600) / 60) + ' ' + T('m'); }
  function name(p) { return (p.name || '?') + (p.username ? ' @' + p.username : ''); }
  function card(title) { return h('section', { class: 'card' }, title ? h('h2', { text: title }) : null, [].slice.call(arguments, 1)); }
  function kv(label, value) { return h('div', { class: 'kv' }, h('span', { text: label }), h('b', { text: value })); }
  function note(t) { return h('p', { class: 'note', text: t }); }
  function key() { var a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }

  // ---------- Сервер ----------
  function NeedLogin() {}
  function api(method, path, body) {
    return fetch('api/admin/' + path, {
      method: method,
      headers: Object.assign(token ? { Authorization: 'Admin ' + token } : {}, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (res.status === 401 && path !== 'login') { setToken(''); throw new NeedLogin(); }
        if (!res.ok && !(res.status === 409 && json && json.error)) {
          var err = new Error(T('error') + (json.detail || json.error || res.status));
          err.status = res.status; err.json = json;
          throw err;
        }
        return json;
      });
    });
  }
  function fail(err) {
    if (err instanceof NeedLogin) return loginForm('');
    main.replaceChildren(note(err.message || String(err)));
  }

  function loginForm(message) {
    document.getElementById('tabs').replaceChildren();
    out.hidden = true;
    var user = h('input', { type: 'text', autocomplete: 'username', placeholder: T('login'), autocapitalize: 'none' });
    var pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: T('password') });
    var msg = h('p', { class: 'msg', text: message || '' });
    var btn = h('button', { type: 'submit', text: T('sign_in') });
    var form = h('form', { class: 'card login', on: { submit: function (e) {
      e.preventDefault();
      btn.disabled = true;
      api('POST', 'login', { login: user.value, password: pass.value }).then(function (r) {
        setToken(r.token);
        start();
      }).catch(function (err) {
        btn.disabled = false;
        pass.value = '';
        var st = err.status;
        msg.textContent = st === 404 ? T('disabled') : st === 429 ? T('locked', { n: Math.ceil(((err.json && err.json.retryAfter) || 900) / 60) })
          : st === 401 ? T('wrong') : err.message;
      });
    } } }, user, pass, btn, msg);
    main.replaceChildren(form);
    user.focus();
  }

  // ---------- Вкладки ----------
  var TABS = ['overview', 'players', 'notices', 'economy', 'stars', 'server'];
  var current = 'overview';
  var overview = null;
  function tabs() {
    var nav = document.getElementById('tabs');
    nav.replaceChildren.apply(nav, TABS.map(function (t) {
      return h('button', { type: 'button', class: t === current ? 'on' : '', on: { click: function () { show(t); } } }, T('tab_' + t));
    }));
  }
  function show(tab, force) {
    current = tab;
    tabs();
    if (tab === 'players') return players('');
    if (tab === 'notices') return notices(null);
    if (overview && !force) return render();
    // Пока свежая сводка идёт через туннель, показываем прошлую из этой вкладки (если есть).
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('admin-overview') || 'null'); } catch (e) { saved = null; }
    if (saved && !overview) { overview = saved; render(); } else if (!overview) main.replaceChildren(note(T('loading')));
    api('GET', 'overview').then(function (o) {
      overview = o;
      try { sessionStorage.setItem('admin-overview', JSON.stringify(o)); } catch (e) { /* без хранилища */ }
      out.hidden = false;
      if (current !== 'players' && current !== 'notices') render();
    }).catch(fail);
  }
  function render() {
    var view = { overview: viewOverview, economy: viewEconomy, stars: viewStars, server: viewServer }[current];
    main.replaceChildren.apply(main, view(overview));
  }

  // Столбики по дням: высота — значение, подпись — день.
  function bars(days, field, cls) {
    var max = Math.max.apply(null, days.map(function (d) { return d[field]; }).concat([1]));
    return h('div', { class: 'bars ' + (cls || '') }, days.map(function (d) {
      var bar = h('i', { title: dayLabel(d.day) + ': ' + d[field] });
      bar.style.height = Math.max(2, Math.round((d[field] / max) * 100)) + '%';
      return bar;
    }));
  }

  function viewOverview(o) {
    var p = o.players;
    var last = o.days.slice(-7).reverse();
    return [
      card(T('players'),
        h('div', { class: 'tiles' },
          tile(T('today'), p.today), tile(T('yesterday'), p.yesterday), tile(T('week'), p.week),
          tile(T('month'), p.month), tile(T('total'), p.total))),
      card(T('by_day'),
        h('div', { class: 'legend' }, h('span', { class: 'a', text: T('players') }), h('span', { class: 'b', text: T('new_players') })),
        bars(o.days, 'players', 'a'), bars(o.days, 'newPlayers', 'b'),
        h('div', { class: 'axis' }, h('span', { text: dayLabel(o.days[0].day) }), h('span', { text: dayLabel(o.days[o.days.length - 1].day) })),
        h('table', null, h('tr', null, h('th'), h('th', { text: T('players') }), h('th', { text: T('new_players') }),
          h('th', { text: T('games_done') }), h('th', { text: T('matches') })),
        last.map(function (d) {
          return h('tr', null, h('td', { text: dayLabel(d.day) }), h('td', { text: num(d.players) }), h('td', { text: num(d.newPlayers) }),
            h('td', { text: num(d.games) }), h('td', { text: num(d.matches) }));
        }))),
      card(T('retention'), kv(T('d1'), pct(o.retention.d1)), kv(T('d7'), pct(o.retention.d7)),
        kv(T('kfactor') + ', ' + T('week'), o.k.week.k == null ? '—' : o.k.week.k.toFixed(2) + ' (' + o.k.week.invited + '/' + o.k.week.inviters + ')'),
        kv(T('kfactor') + ', ' + T('month'), o.k.month.k == null ? '—' : o.k.month.k.toFixed(2) + ' (' + o.k.month.invited + '/' + o.k.month.inviters + ')')),
      card(T('sources'), h('h3', { text: T('week') }), sources(o.newBySource.week), h('h3', { text: T('month') }), sources(o.newBySource.month)),
      card(T('by_game'), o.games.map(function (g) {
        return h('div', { class: 'game' }, h('b', { text: T('g_' + g.game) + ' · ' + num(g.players) }),
          h('small', { text: [T('opens') + ' ' + g.opens, T('starts') + ' ' + g.starts, T('finishes') + ' ' + g.finishes,
            T('matches') + ' ' + g.matches, T('invites') + ' ' + g.invites, T('joined') + ' ' + g.joined].join(' · ') }));
      })),
    ];
  }
  function tile(label, n) { return h('div', { class: 'tile' }, h('b', { text: num(n) }), h('span', { text: label })); }
  function sources(list) {
    if (!list.length) return note(T('none'));
    return list.map(function (s) { return kv(DICT[lang]['src_' + s.source] || s.source, num(s.n)); });
  }

  function viewEconomy(o) {
    var e = o.economy;
    if (!e) return [note(T('none'))];
    function week(w, title) {
      return card(title + ' · ' + w.label,
        kv(T('issued'), num(w.issued) + ' · ' + num(w.players) + ' ' + T('players').toLowerCase()),
        kv(T('spent'), num(w.spent)), kv(T('annulled'), num(w.annulled)), kv(T('manual'), num(w.admin)),
        kv(T('stars_all'), num(w.stars.n) + ' · ' + num(w.stars.sum) + ' ⭐'),
        w.byReason.length ? h('p', { class: 'small', text: w.byReason.map(function (r) { return T('r_' + r.reason) + ' ' + num(r.n); }).join(' · ') }) : null);
    }
    return [
      card(null, kv(T('on_hand'), num(e.balance)), kv(T('ends'), when(e.seasonEndsAt))),
      week(e.week, T('week_now')),
      card(T('top_got'), e.week.top.length ? e.week.top.map(function (t) { return playerRow({ id: t.id, name: t.name }, num(t.n)); }) : note(T('none'))),
      week(e.prev, T('week_prev')),
      card(T('flagged_list') + ' · ' + e.flaggedCount, e.flagged.length ? e.flagged.map(function (f) {
        return playerRow({ id: f.id, name: f.name }, f.why);
      }) : note(T('none'))),
    ];
  }

  function itemName(item) { return item === 'life' || /^life:/.test(item) ? T('life') : item; }
  function viewStars(o) {
    var s = o.stars;
    return [
      card(null, kv(T('stars_all'), num(s.n)), kv(T('stars_sum'), num(s.sum) + ' ⭐'), kv(T('stars_refunded'), num(s.refunded) + ' ⭐')),
      card(T('stars_items'), s.items.length ? s.items.map(function (i) { return kv(itemName(i.item) + ' × ' + i.n, num(i.sum) + ' ⭐'); }) : note(T('none'))),
      card(T('stars_recent'), s.recent.length ? s.recent.map(function (p) {
        return playerRow({ id: p.player_id, name: p.name }, p.stars + ' ⭐ ' + itemName(p.item) + (p.refunded_at ? ' (' + T('refunded') + ')' : ''), when(p.at));
      }) : note(T('none'))),
    ];
  }

  function viewServer(o) {
    var s = o.server;
    return [card(null,
      kv(T('commit'), s.commit), kv(T('uptime'), dur(s.uptime)),
      kv(T('memory'), mb(s.rss) + ' (' + T('limit_mem') + ')'),
      kv(T('cpu'), (s.cpu == null ? '—' : s.cpu + ' %') + ' (' + T('limit_cpu') + ')'),
      kv(T('load'), s.load.toFixed(2)), kv(T('db'), mb(s.dbSize)),
      kv(T('live'), s.live ? s.live.rooms + ' / ' + s.live.sockets : '—'), kv('Node', s.node))];
  }

  // ---------- Игроки ----------
  function playerRow(p, right, sub) {
    return h('button', { type: 'button', class: 'row', on: { click: function () { player(p.id); } } },
      h('span', null, h('b', { text: name(p) }), h('small', { text: ' ' + p.id + (sub ? ' · ' + sub : '') })),
      right != null ? h('span', { class: 'right', text: right }) : null);
  }

  function players(q) {
    var input = h('input', { type: 'search', placeholder: T('search'), value: q, enterkeyhint: 'search' });
    var list = h('div', null, note(T('loading')));
    var form = h('form', { class: 'search', on: { submit: function (e) { e.preventDefault(); players(input.value.trim()); } } },
      input, h('button', { type: 'submit', text: T('find') }));
    main.replaceChildren(form, card(q ? null : T('recent'), list));
    api('GET', 'players?q=' + encodeURIComponent(q)).then(function (rows) {
      list.replaceChildren.apply(list, rows.length ? rows.map(function (p) {
        return playerRow(p, (p.flagged ? '⚠️ ' : '') + '◆ ' + num(p.balance || 0), p.lastActive ? when(p.lastActive) : null);
      }) : [note(T('nothing'))]);
    }).catch(fail);
  }

  function player(id) {
    if (current !== 'players') { current = 'players'; tabs(); }
    main.replaceChildren(note(T('loading')));
    api('GET', 'player?id=' + id).then(function (p) { main.replaceChildren.apply(main, viewPlayer(p)); }).catch(fail);
  }

  function viewPlayer(p) {
    var w = p.wallet || { balance: 0 };
    var msg = h('p', { class: 'msg' });
    function act(path, body, sure) {
      if (sure && !confirm(sure)) return;
      api('POST', path, body).then(function (r) {
        if (r.ok === false) { msg.textContent = r.error === 'not enough' ? T('not_enough') : T('error') + r.error; return; }
        overview = null;
        player(p.id);
      }).catch(function (err) { msg.textContent = err.message; });
    }
    var amount = h('input', { type: 'number', inputmode: 'numeric', placeholder: T('amount'), step: '1' });
    var reason = h('input', { type: 'text', maxlength: '60', placeholder: T('note') });
    var why = h('input', { type: 'text', maxlength: '100', placeholder: T('why') });
    var adjustKey = key();
    var games = [
      T('g_mario') + ': ' + T('games_done') + ' ' + p.mario.games + ', ' + T('record') + ' ' + num(p.mario.best) +
        (p.mario.rank ? ', ' + T('place') + ' ' + p.mario.rank : '') + ', ' + T('achievements') + ' ' + p.mario.achievements,
      T('g_tanks') + ': ' + T('games_done') + ' ' + p.tanks.games + ', ' + T('record') + ' ' + num(p.tanks.best),
      p.bombs ? T('g_bombs') + ': ' + T('games_done') + ' ' + p.bombs.games + ', ' + T('record') + ' ' + num(p.bombs.best) : '',
      p.range ? T('g_range') + ': ' + T('games_done') + ' ' + p.range.games + ', ' + T('record') + ' ' + num(p.range.best) : '',
      T('g_word') + ': ' + T('games_done') + ' ' + p.word.games,
    ].filter(Boolean);
    return [
      h('button', { type: 'button', class: 'ghost', on: { click: function () { players(''); } } }, T('back')),
      card(name(p),
        kv('id', String(p.id)),
        kv(T('balance'), '◆ ' + num(w.balance)),
        kv(T('flagged'), w.flagged ? '⚠️ ' + w.flagged : T('not_flagged')),
        kv(T('first_seen'), when(p.seen ? p.seen.at : p.createdAt)),
        kv(T('source'), p.seen ? (DICT[lang]['src_' + p.seen.source] || p.seen.source) + (p.seen.inviter ? ' ← ' + p.seen.inviter : '') : '—'),
        kv(T('last_active'), when(p.lastActive)),
        kv(T('invited'), num(p.invited)),
        games.map(function (g) { return h('p', { class: 'small', text: g }); })),
      overview && overview.economy === null ? null : card(T('adjust'),
        amount, reason,
        h('button', { type: 'button', on: { click: function () {
          var n = Math.trunc(Number(amount.value));
          if (!n) return;
          act('adjust', { id: p.id, amount: n, note: reason.value, key: adjustKey }, T('sure_adjust', { n: (n > 0 ? '+' : '') + n }));
        } } }, T('apply')),
        h('div', { class: 'actions' },
          w.flagged
            ? h('button', { type: 'button', on: { click: function () { act('flag', { id: p.id, on: false }); } } }, T('unflag'))
            : h('span', { class: 'inline' }, why, h('button', { type: 'button', on: { click: function () { act('flag', { id: p.id, why: why.value }); } } }, T('flag'))),
          h('button', { type: 'button', class: 'danger', on: { click: function () { act('annul', { id: p.id }, T('sure_annul')); } } }, T('annul'))),
        msg),
      h('button', { type: 'button', on: { click: function () { notices(p.id); } } }, T('to_player')),
      card(T('purchases'), p.purchases.length ? p.purchases.map(function (u) {
        return h('div', { class: 'kv' },
          h('span', { text: when(u.at) + ' · ' + itemName(u.item) }),
          h('b', null, u.stars + ' ⭐ ', u.refunded_at ? h('small', { text: T('refunded') })
            : h('button', { type: 'button', class: 'mini', on: { click: function () {
              act('refund', { id: p.id, charge: u.charge_id }, T('sure_refund', { n: u.stars }));
            } } }, T('refund'))));
      }) : note(T('none'))),
      card(T('history'), p.history.length ? p.history.map(function (r) {
        return h('div', { class: 'kv' }, h('span', { text: when(r.at) + ' · ' + T('r_' + r.reason) + ' · ' + r.event }),
          h('b', { class: r.amount < 0 ? 'neg' : 'pos', text: (r.amount > 0 ? '+' : '') + r.amount }));
      }) : note(T('none'))),
    ];
  }

  // ---------- Уведомления ----------
  // Форма: обновление или новость всем, или личное одному игроку (forPlayer — id из карточки игрока).
  function notices(forPlayer) {
    if (current !== 'notices') { current = 'notices'; tabs(); }
    var formKey = key();
    var kind = h('select', null, h('option', { value: 'update', text: T('k_update') }), h('option', { value: 'news', text: T('k_news') }));
    var to = h('select', null, h('option', { value: 'all', text: T('n_all') }), h('option', { value: 'one', text: T('n_one') }));
    var pid = h('input', { type: 'number', inputmode: 'numeric', placeholder: T('n_player'), step: '1' });
    var title = h('input', { type: 'text', maxlength: '80', placeholder: T('n_title') });
    var body = h('textarea', { rows: '5', maxlength: '2000', placeholder: T('n_body') });
    var titleEn = h('input', { type: 'text', maxlength: '80', placeholder: T('n_title_en') });
    var bodyEn = h('textarea', { rows: '3', maxlength: '2000', placeholder: T('n_body_en') });
    var tg = h('input', { type: 'checkbox' });
    var tgRow = h('label', { class: 'check' }, tg, ' ' + T('n_tg'));
    var msg = h('p', { class: 'msg' });
    var list = h('div', null, note(T('loading')));
    if (forPlayer) { to.value = 'one'; pid.value = String(forPlayer); }
    function sync() {
      var one = to.value === 'one';
      pid.hidden = !one;
      kind.disabled = one;
      tgRow.hidden = !one;
    }
    to.addEventListener('change', sync);
    sync();
    var send = h('button', { type: 'button', on: { click: function () {
      var one = to.value === 'one';
      var n = Math.trunc(Number(pid.value));
      msg.className = 'msg';
      if (!title.value.trim() && !body.value.trim()) { msg.textContent = T('n_empty'); return; }
      if (one && !(n > 0)) { msg.textContent = T('no_player'); return; }
      if (!confirm(one ? T('sure_one', { n: n }) : T('sure_all'))) return;
      send.disabled = true;
      api('POST', 'notice', {
        kind: kind.value, player: one ? n : null, title: title.value, body: body.value,
        titleEn: titleEn.value, bodyEn: bodyEn.value, telegram: one && tg.checked, key: formKey,
      }).then(function (r) {
        msg.className = 'msg ok';
        msg.textContent = T('n_sent') + (r.telegram === 'sent' ? ' ' + T('tg_sent') : r.telegram === 'failed' ? ' ' + T('tg_failed') : '');
        formKey = key();
        title.value = body.value = titleEn.value = bodyEn.value = '';
        load();
      }).catch(function (err) {
        if (err instanceof NeedLogin) return fail(err);
        msg.textContent = err.status === 404 ? T('no_player') : err.message;
      }).then(function () { send.disabled = false; });
    } } }, T('n_send'));
    function load() {
      api('GET', 'notices').then(function (r) {
        tg.disabled = !r.telegram;
        list.replaceChildren.apply(list, r.items.length ? r.items.map(noticeRow) : [note(T('none'))]);
      }).catch(fail);
    }
    function noticeRow(n) {
      var who = n.playerId ? name({ name: n.name || '?', username: n.username }) + ' · ' + n.playerId + ' · ' + T(n.read ? 'n_read' : 'n_unread') : T('n_everyone');
      return h('div', { class: 'notice' + (n.hiddenAt ? ' gone' : '') },
        h('div', { class: 'small' }, when(n.at) + ' · ' + T('k_' + n.kind) + ' · ' + who + (n.hiddenAt ? ' · ' + T('n_hidden') : '')),
        n.title ? h('b', { text: n.title }) : null,
        n.body ? h('p', { class: 'body', text: n.body }) : null,
        n.titleEn || n.bodyEn ? h('p', { class: 'small', text: 'EN: ' + [n.titleEn, n.bodyEn].filter(Boolean).join(' — ') }) : null,
        n.hiddenAt ? null : h('button', { type: 'button', class: 'mini', on: { click: function () {
          if (!confirm(T('sure_hide'))) return;
          api('POST', 'notice/hide', { id: n.id }).then(load).catch(fail);
        } } }, T('n_hide')));
    }
    main.replaceChildren(
      card(T('n_new'),
        h('div', { class: 'inline' }, to, kind), pid, title, body,
        h('p', { class: 'small', text: T('n_en') }), titleEn, bodyEn, tgRow, send, msg),
      card(T('n_list'), list));
    load();
  }

  // ---------- Старт ----------
  var out = h('button', { type: 'button', class: 'ghost', hidden: '', on: { click: function () {
    api('POST', 'logout', {}).catch(function () {}).then(function () {
      setToken(''); overview = null;
      try { sessionStorage.removeItem('admin-overview'); } catch (e) { /* ничего */ }
      loginForm('');
    });
  } } }, T('sign_out'));
  document.querySelector('.top').insertBefore(out, document.getElementById('reload'));
  function start() {
    if (!token) {
      return api('GET', 'status').then(function (r) { loginForm(r.enabled ? '' : T('disabled')); })
        .catch(function () { loginForm(''); });
    }
    // Сразу сводка: без отдельной проверки входа (лишний запрос через туннель); 401 вернёт к форме входа.
    show('overview', true);
  }
  document.getElementById('title').textContent = T('title');
  document.title = T('title').replace('◆ ', '');
  document.getElementById('reload').addEventListener('click', function () {
    if (!token) return;
    if (current === 'players') players('');
    else if (current === 'notices') notices(null);
    else show(current, true);
  });
  start();
})();
