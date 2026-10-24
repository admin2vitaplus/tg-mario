// «Побей мой счёт» (bot/beat.js): after a game alone the player sends a friend a link to the very
// same game (the same seed, rules, mode and first stage: the same enemies and targets in the same
// order). The friend's game is checked by the server too, but gives no жетоны: it is for fun.
// Names come from the server and go on the page only as text.
//
//   Beat.id                       -> the challenge in this page's link (?beat=…), or ''
//   Beat.enabled()                -> the server and Telegram are here, so a challenge can be made
//   Beat.create(game, run)        -> Promise<view>; run = { seed, log, rules, mode, start } of an accepted game
//   Beat.load(id)                 -> Promise<view>
//   Beat.send(id, log)            -> Promise<view with score>
//   Beat.share(game, view, link)  -> opens Telegram's «share» with the link
//   Beat.invite(view)             -> HTML: who challenges and with what score
//   Beat.result(view)             -> HTML: the friend's score against the challenge, and the table
//   Beat.T(key, vars)             -> the lines below, in the player's language
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const lang = /^(ru|uk|be|kk)\b/i.test((tg && tg.initDataUnsafe && tg.initDataUnsafe.user &&
  tg.initDataUnsafe.user.language_code) || navigator.language || '') ? 'ru' : 'en';

const STR = {
  ru: {
    btn: '⚔ Побей мой счёт', btn_accept: 'Принять вызов', btn_again: 'Ещё раз эту партию', btn_back: 'Не сейчас',
    title: 'ВЫЗОВ',
    share_tanks: '⚔ Побей мой счёт в «Танкодроме»: {score}. Те же враги, та же карта.',
    share_bombs: '⚔ Побей мой счёт в «Бомбодроме»: {score}. Те же враги, то же поле.',
    share_range: '⚔ Побей мой счёт в «Тире»: {score}. Те же мишени в том же порядке.',
    invite: '{name} вызывает вас: {score} очков.<br>Сыграйте ту же партию и наберите больше. Жетонов за неё нет, только честь.',
    invite_mine: 'Это ваш вызов: {score} очков. Перешлите ссылку другу.',
    won: 'Вызов выигран: {score} против {their} ({name})!',
    lost: 'Пока не вышло: {score} против {their} ({name}).',
    table: 'Таблица вызова:',
    row: '{place}. {name} — {score}',
    gone: 'Вызов не найден.',
    error: 'Не удалось связаться с сервером.',
  },
  en: {
    btn: '⚔ Beat my score', btn_accept: 'Accept the challenge', btn_again: 'Play this game again', btn_back: 'Not now',
    title: 'CHALLENGE',
    share_tanks: '⚔ Beat my Tank Field score: {score}. The same enemies on the same map.',
    share_bombs: '⚔ Beat my Bomb Field score: {score}. The same enemies on the same field.',
    share_range: '⚔ Beat my Shooting Range score: {score}. The same targets in the same order.',
    invite: '{name} challenges you: {score} points.<br>Play the very same game and score more. No tickets for it, just glory.',
    invite_mine: 'This is your challenge: {score} points. Send the link to a friend.',
    won: 'Challenge won: {score} against {their} ({name})!',
    lost: 'Not yet: {score} against {their} ({name}).',
    table: 'Challenge table:',
    row: '{place}. {name} — {score}',
    gone: 'Challenge not found.',
    error: 'Could not reach the server.',
  },
};
const T = (key, vars = {}) => String(STR[lang][key] || key).replace(/\{(\w+)\}/g, (_m, k) => (vars[k] == null ? '' : vars[k]));
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let id = '';
try { id = (new URLSearchParams(location.search).get('beat') || '').replace(/[^a-z0-9]/g, '').slice(0, 8); } catch (e) { /* old browser */ }

const server = () => window.Server;
const enabled = () => !!(server() && server().hasServer && tg && tg.initData);

function table(view) {
  if (!view.top || !view.top.length) return '';
  return '<br><br>' + T('table') + '<br>' + view.top.map((r, i) => {
    const line = esc(T('row', { place: i + 1, name: r.name, score: r.score }));
    return r.me ? '<b>' + line + '</b>' : line;
  }).join('<br>');
}

window.Beat = {
  id,
  enabled,
  T,
  create: (game, run) => server().request('POST', '/api/' + game + '/beat', run),
  load: (cid) => server().request('GET', '/api/beat?id=' + encodeURIComponent(cid)),
  send: (cid, log) => server().request('POST', '/api/beat/run', { id: cid, log }),
  share(game, view, link) {
    const text = T('share_' + game, { score: view.owner.score });
    try {
      if (tg && tg.openTelegramLink) {
        tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text));
        return;
      }
    } catch (e) { /* fall through */ }
    if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text + '\n' + link);
  },
  invite(view) {
    const vars = { name: esc(view.owner.name), score: view.owner.score };
    return (view.owner.me ? T('invite_mine', vars) : T('invite', vars)) + table(view);
  },
  result(view) {
    const vars = { name: esc(view.owner.name), score: view.score, their: view.owner.score };
    return (view.owner.me ? '' : (view.score > view.owner.score ? T('won', vars) : T('lost', vars))) + table(view);
  },
};
})();
