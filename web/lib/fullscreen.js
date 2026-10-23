// «На весь экран» for the menu and every game: a small ⛶ button in the top-right
// corner. Inside Telegram (8.0+) it asks for the full-screen mini app, which hides
// the Telegram header; in a browser it uses the Fullscreen API. Where neither works
// (old Telegram, iPhone Safari) the button is not shown.
//
// Telegram keeps its own close and menu buttons over a full-screen app, so the page
// moves down by the safe area it reports (body.tgFull, see ui.css).
// The choice is remembered, and the next page of the collection asks again.
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const KEY = 'cartridge_fullscreen';
const en = /^en/i.test((tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code)
  || document.documentElement.lang || navigator.language || '');

let inTg = false;
try { inTg = !!(tg && tg.initData && tg.isVersionAtLeast('8.0') && tg.requestFullscreen); } catch (e) { /* old Telegram */ }
const doc = document.documentElement;
const pageFs = !inTg && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
if (!inTg && !pageFs) return;

const remember = (on) => { try { localStorage.setItem(KEY, on ? '1' : ''); } catch (e) { /* ignore */ } };
const wanted = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };

function isOn() {
  if (inTg) return !!tg.isFullscreen;
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function enter() {
  try {
    if (inTg) tg.requestFullscreen();
    else if (doc.requestFullscreen) doc.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else if (doc.webkitRequestFullscreen) doc.webkitRequestFullscreen();
  } catch (e) { /* refused */ }
}

function leave() {
  try {
    if (inTg) tg.exitFullscreen();
    else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (e) { /* ignore */ }
}

const btn = document.createElement('button');
btn.id = 'fsBtn';
btn.type = 'button';

function show() {
  const on = isOn();
  document.body.classList.toggle('tgFull', inTg && on);
  btn.textContent = on ? '⤡' : '⛶';
  const label = on ? (en ? 'Exit full screen' : 'Выйти из полного экрана') : (en ? 'Full screen' : 'На весь экран');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  // Games size their field from the page; a resize event makes them fit again.
  window.dispatchEvent(new Event('resize'));
}

btn.addEventListener('click', () => {
  const on = !isOn();
  remember(on);
  if (on) enter(); else leave();
});

function mount() {
  document.body.classList.add('withFs');
  (document.getElementById('app') || document.body).append(btn);
  if (inTg) {
    tg.onEvent('fullscreenChanged', () => { remember(isOn()); show(); });
    tg.onEvent('fullscreenFailed', () => { remember(false); show(); });
    tg.onEvent('safeAreaChanged', show);
    tg.onEvent('contentSafeAreaChanged', show);
    // Telegram keeps the full screen between pages of the app; if it did not, ask again.
    if (wanted() && !isOn()) enter();
  } else {
    document.addEventListener('fullscreenchange', show);
    document.addEventListener('webkitfullscreenchange', show);
  }
  show();
}

if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
