// Статистика игр (ТЗ P0-5): игра сообщает серверу о событиях — открыли, начали, доиграли, пригласили.
// Использование: GameEvents.send('game_start', 'tanks'), для комнаты — GameEvents.send('match_finished', 'tanks', '1234').
// Без адреса сервера (?api=) или вне Telegram ничего не отправляется; ошибки сети игре не мешают.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';
const base = (() => {
  let url = new URLSearchParams(location.search).get('api');
  try {
    if (!url) url = localStorage.getItem('prygskok_api');
  } catch (e) { /* ignore */ }
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.origin : '';
  } catch (e) {
    return '';
  }
})();

function send(type, game, ref) {
  if (!base || !initData) return;
  const body = { type, game };
  if (ref != null) body.ref = String(ref);
  try {
    fetch(base + '/api/events', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + initData },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}

window.GameEvents = { send };
})();
