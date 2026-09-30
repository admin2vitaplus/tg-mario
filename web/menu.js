// Cartridge-style game menu shown before anything else.
// Each game is a separate module: the built-in one lives on this page,
// later games get their own folder under games/<id>/ and an entry with `url`.
// An entry without `id` is a placeholder and cannot be chosen.
(() => {
'use strict';

const GAMES = [
  { id: 'pryg-skok', title: 'ПРЫГ-СКОК' },
  // When ready: { id: 'tanks', title: 'ТАНКИ', url: 'games/tanks/' }
  { title: 'ТАНКИ — СКОРО' },
  { title: 'СКОРО' },
  { title: 'СКОРО' },
  { title: 'СКОРО' },
];

const menu = document.getElementById('menu');
const list = document.getElementById('menuList');
let cursor = 0;

function render() {
  list.innerHTML = '';
  GAMES.forEach((g, i) => {
    const li = document.createElement('li');
    li.className = (i === cursor ? 'on ' : '') + (g.id ? '' : 'soon');
    li.textContent = `${i + 1}. ${g.title}`;
    li.addEventListener('click', () => { cursor = i; render(); choose(); });
    list.append(li);
  });
}

function choose() {
  const g = GAMES[cursor];
  if (!g.id) return;
  if (g.url) { location.href = g.url; return; }
  menu.classList.add('hidden');
  document.removeEventListener('keydown', onKey);
}

function move(d) {
  cursor = (cursor + d + GAMES.length) % GAMES.length;
  render();
}

function onKey(e) {
  if (e.key === 'ArrowDown') move(1);
  else if (e.key === 'ArrowUp') move(-1);
  else if (e.key === 'Enter' || e.key === 'z' || e.key === ' ') choose();
  else return;
  e.preventDefault();
  e.stopPropagation();
}

document.addEventListener('keydown', onKey, true);
render();
})();
