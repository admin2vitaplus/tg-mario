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
      // Uses the score server (the «Рекорды» button).
      scores: true,
      // Loaded on this page only when the game is chosen, in this order.
      styles: ['lib/looks.css'],
      scripts: ['lib/phaser.min.js', 'lib/looks.js', 'lib/back.js', 'game.js'],
    },
    {
      id: 'tanks',
      title: 'ТАНКОДРОМ',
      enabled: true,
      // A game with its own page, relative to the menu.
      url: 'tanks/',
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
