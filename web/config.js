// Settings of the collection: which games are on and what each one loads.
// Turning a game off (enabled: false) removes it from the menu; nothing else
// has to change. No addresses live here or anywhere in web/: every path is
// relative, the score server comes from ?api= in the launch link, so the
// folder works from any host.
(() => {
'use strict';

const config = {
  // The bot that invite and "open again" links point to; ?bot= overrides it.
  bot: 'yellow_cartridge_bot',
  // Menu lines; unused lines show «СКОРО», like empty slots on a cartridge.
  slots: 5,
  games: [
    {
      id: 'pryg-skok',
      title: 'ПРЫГ-СКОК',
      enabled: true,
      // Uses the score server (its tables and tasks are in «◆ Жетоны»).
      scores: true,
      // Loaded on this page only when the game is chosen, in this order.
      styles: ['lib/looks.css'],
      scripts: ['lib/phaser.min.js', 'lib/looks.js', 'lib/back.js', 'levels.js', 'worlds.js', 'game.js'],
    },
    {
      id: 'tanks',
      title: 'ТАНКОДРОМ',
      enabled: true,
      // A game with its own page, relative to the menu.
      url: 'tanks/',
    },
    {
      id: 'word',
      title: 'СЛОВО ДНЯ',
      // Hidden 2026-10-06 (owner): the collection is classic cartridge games.
      // Code and server data stay; enabled: true brings it back.
      enabled: false,
      // Its own page without the game engine. A t.me/<bot>?startapp=word link (or ref_<id>-word,
      // a shared result) opens it straight from the menu, see menu.js.
      url: 'word/',
      start: 'word',
    },
  ],
};

const games = () => config.games.filter((g) => g.enabled);

window.CARTRIDGE = Object.assign(config, {
  enabledGames: games,
  isEnabled: (id) => games().some((g) => g.id === id),
  game: (id) => config.games.find((g) => g.id === id) || null,
});
})();
