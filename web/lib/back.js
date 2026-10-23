// «Назад» for every game: Telegram's own back button in the header plus an
// on-screen ← in the corner, both calling the game's handler. Back.toMenu()
// returns to the collection's menu, keeping the launch parameters.
// A full-screen panel (◆ Жетоны, уведомления, «Внешний вид») is closed first, and on
// the menu page, which has no «Назад» of its own, Telegram's back button shows only
// while such a panel is open.
//
//   Back.attach(onBack, { menu: '../' })   // menu: path to the menu page, './' by default
//   Back.toMenu()
//   Back.guard(true)   // a game is on: closing the mini app asks first; guard(false) when it ends
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
let menuPath = './';
let onBack = null; // the game's handler, once attached

// Telegram's «Закрыть» (the cross, a swipe down) asks before closing while a game is on,
// so a stray swipe does not lose it. Menus and result screens close at once.
function guard(on) {
  try {
    if (!tg || !tg.isVersionAtLeast('6.2')) return;
    if (on) tg.enableClosingConfirmation(); else tg.disableClosingConfirmation();
  } catch (e) { /* old Telegram */ }
}

function toMenu() {
  guard(false);
  // The menu must not follow the launch link (an invite to a room) a second time.
  try { sessionStorage.setItem('cartridge_start_done', '1'); } catch (e) { /* ignore */ }
  const params = new URLSearchParams(location.search);
  params.delete('room');
  const q = params.toString();
  location.replace(menuPath + (q ? '?' + q : ''));
}

const PANEL_CLOSE = '.wallet .wClose, .looks .looksDone';

// True when it closed an open panel instead of going back.
function closePanel() {
  const b = document.querySelector(PANEL_CLOSE);
  if (!b) return false;
  b.click();
  return true;
}

function handler() {
  if (closePanel()) return;
  (onBack || toMenu)();
}

const tgBack = (() => {
  try { return tg && tg.isVersionAtLeast('6.1') ? tg.BackButton : null; } catch (e) { return null; }
})();
if (tgBack) tgBack.onClick(handler);

// Telegram's back button: always in a game, on the menu only over a panel.
function syncTgBack() {
  if (!tgBack) return;
  if (onBack || document.querySelector(PANEL_CLOSE)) tgBack.show(); else tgBack.hide();
}
if (tgBack && window.MutationObserver) {
  const watch = () => new MutationObserver(syncTgBack).observe(document.body, { childList: true, subtree: true });
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
}

function attach(fn, opts) {
  if (opts && opts.menu) menuPath = opts.menu;
  onBack = fn || toMenu;
  const btn = document.createElement('button');
  btn.id = 'backBtn';
  btn.type = 'button';
  btn.textContent = '←';
  btn.setAttribute('aria-label', (opts && opts.label) || 'Назад');
  btn.addEventListener('click', handler);
  document.body.classList.add('withBack');
  (document.getElementById('app') || document.body).append(btn);
  syncTgBack();
}

window.Back = { attach, toMenu, guard };
})();
