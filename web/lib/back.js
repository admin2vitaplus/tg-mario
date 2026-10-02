// «Назад» for every game: Telegram's own back button in the header plus an
// on-screen ← in the corner, both calling the game's handler. Back.toMenu()
// returns to the collection's menu, keeping the launch parameters.
//
//   Back.attach(onBack, { menu: '../' })   // menu: path to the menu page, './' by default
//   Back.toMenu()
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
let menuPath = './';

function toMenu() {
  // The menu must not follow the launch link (an invite to a room) a second time.
  try { sessionStorage.setItem('cartridge_start_done', '1'); } catch (e) { /* ignore */ }
  const params = new URLSearchParams(location.search);
  params.delete('room');
  const q = params.toString();
  location.replace(menuPath + (q ? '?' + q : ''));
}

function attach(onBack, opts) {
  if (opts && opts.menu) menuPath = opts.menu;
  const handler = () => (onBack || toMenu)();
  const btn = document.createElement('button');
  btn.id = 'backBtn';
  btn.type = 'button';
  btn.textContent = '←';
  btn.setAttribute('aria-label', (opts && opts.label) || 'Назад');
  btn.addEventListener('click', handler);
  document.body.classList.add('withBack');
  (document.getElementById('app') || document.body).append(btn);
  try {
    if (tg && tg.isVersionAtLeast('6.1')) {
      tg.BackButton.onClick(handler);
      tg.BackButton.show();
    }
  } catch (e) { /* old Telegram */ }
}

window.Back = { attach, toMenu };
})();
