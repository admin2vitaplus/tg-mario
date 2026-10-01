// Статистика игр (ТЗ P0-5): игра сообщает серверу о событиях — открыли, начали, доиграли, пригласили.
// Использование: GameEvents.send('game_start', 'tanks'), для комнаты — GameEvents.send('match_finished', 'tanks', '1234').
// Без адреса сервера (?api=) или вне Telegram ничего не отправляется; ошибки сети игре не мешают.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';

// The address comes from lib/server.js; events wait until a server has answered.
function send(type, game, ref) {
  const server = window.Server;
  if (!server || !server.hasServer || !initData) return;
  const body = { type, game };
  if (ref != null) body.ref = String(ref);
  server.request('POST', '/api/events', body).catch(() => {});
}

window.GameEvents = { send };
})();
