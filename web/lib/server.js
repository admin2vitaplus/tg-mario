// The score server's address and every request to it, shared by the menu, the
// games, scores, statistics and жетоны.
//
// The server lives behind a free tunnel whose address changes on every restart
// of the bot, so a remembered address can be dead. Candidates, best first:
//   1. ?api= in the launch link (the bot's buttons always carry the fresh one);
//   2. the address that answered last time (localStorage);
//   3. the tunnel name after «__» in startapp (a shared link, maybe days old).
// All are checked at once and the first one that answers /api/health wins and is
// remembered. A just-started tunnel can take a few seconds to become reachable,
// so the check is retried before giving up.
// The check costs a round trip over the tunnel, so while it runs, requests go straight
// to the address from the launch link; if it does not answer, they wait for the check.
//
//   Server.base            -> '' until known, then 'https://…'
//   Server.ready           -> Promise<boolean>: true when a server answered
//   Server.online          -> null while checking, then true / false
//   Server.request(method, path, body, { keepalive, timeout }) -> Promise<json>; times out
//                             (10 s, or `timeout` ms); a GET is
//                             retried once on a network error or a tunnel error page;
//                             keepalive — the request outlives the page (a game sent on leaving)
(() => {
'use strict';

const KEY = 'prygskok_api';
const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';

function origin(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? u.origin : '';
  } catch (e) { return ''; }
}

const params = new URLSearchParams(location.search);
// The bot's buttons carry the live address: it is used before the check is done.
const fromLink = origin(params.get('api') || '');

function candidates() {
  const list = [];
  list.push(params.get('api'));
  try { list.push(localStorage.getItem(KEY)); } catch (e) { /* private mode */ }
  const start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || params.get('tgWebAppStartParam') || '';
  const m = /__([a-z0-9-]{1,63})$/.exec(start);
  if (m) list.push('https://' + m[1] + '.trycloudflare.com');
  return [...new Set(list.map(origin).filter(Boolean))];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchTimeout(url, opts, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctl ? ctl.signal : undefined }))
    .finally(() => clearTimeout(timer));
}

// A dead tunnel answers with Cloudflare's HTML error page (status 530 and others),
// so only a JSON { ok: true } counts.
function healthy(base) {
  return fetchTimeout(base + '/api/health', { cache: 'no-store' }, 5000)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => !!(j && j.ok))
    .catch(() => false);
}

// The first address that answers wins: there is one server, so any live address leads to it,
// and an old dead one (it can hang until the timeout) is not waited for.
function first(list) {
  return new Promise((resolve) => {
    let left = list.length;
    list.forEach((base) => healthy(base).then((ok) => {
      if (ok) resolve(base);
      else if (--left === 0) resolve('');
    }));
  });
}

// Up to three rounds, with pauses for a tunnel that is still starting.
async function pick(list) {
  for (const pause of [0, 2000, 5000]) {
    if (pause) await wait(pause);
    const base = await first(list);
    if (base) return base;
  }
  return '';
}

const list = candidates();
const api = { base: '', online: list.length ? null : false, ready: null, request, hasServer: list.length > 0 };
// Until the check is done, the first candidate stands in, so code that only
// needs to know "is there a server at all" keeps working.
api.base = list[0] || '';
api.ready = !list.length ? Promise.resolve(false) : pick(list).then((base) => {
  api.online = !!base;
  if (base) {
    api.base = base;
    try { localStorage.setItem(KEY, base); } catch (e) { /* private mode */ }
  }
  return api.online;
});

const RETRY = new Set([0, 502, 503, 504, 520, 521, 522, 523, 524, 530]);

// JSON in and out with the player's Telegram signature. Rejects with an Error
// whose .status is the HTTP status (0 for no answer) and .body the server's JSON.
// Browsers take keepalive bodies up to 64 KB.
const KEEPALIVE_MAX = 60000;
function request(method, path, body, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (initData) headers.Authorization = 'tma ' + initData;
  const json = body ? JSON.stringify(body) : undefined;
  const keepalive = !!(opts && opts.keepalive && json && json.length < KEEPALIVE_MAX);
  const once = (base) => fetchTimeout(base + path, { method, headers, body: json, keepalive }, (opts && opts.timeout) || 10000)
    .then((r) => r.json().catch(() => null).then((j) => {
      if (r.ok && j) return j;
      if (r.ok && r.status === 204) return {};
      // No JSON: an error page of the tunnel, the server itself did not get the request.
      throw Object.assign(new Error((j && j.error) || 'HTTP ' + r.status), { status: j ? r.status : (r.status || 0), body: j, unreached: !j });
    }), (e) => {
      // A timeout may have reached the server; a refused connection or an unknown name did not.
      throw Object.assign(new Error('network'), { status: 0, cause: e, unreached: !(e && e.name === 'AbortError') });
    });
  const checked = () => api.ready.then((ok) => {
    if (!ok) throw Object.assign(new Error('offline'), { status: 0, offline: true });
    // Only reads are repeated: a game result that did reach the server would come
    // back as a rejected duplicate.
    return once(api.base).catch((e) => (method === 'GET' && RETRY.has(e.status) ? wait(1500).then(() => once(api.base)) : Promise.reject(e)));
  });
  // The check is still running: go straight to the address from the launch link. If it did
  // not answer (an old link, a tunnel still starting), the request waits for the check;
  // a write is sent again only when it surely did not reach the server.
  if (api.online === null && fromLink) {
    return once(fromLink).catch((e) => (e.unreached ? checked() : Promise.reject(e)));
  }
  return checked();
}

window.Server = api;
})();
