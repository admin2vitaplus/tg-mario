// «Внешний вид»: a shared look picker for every game in the collection.
// A game describes its groups (hero, weather, enemies...) and gets a full
// screen panel with previews; the choice is saved in localStorage.
//
// Every item has a `stars` field (0 everywhere now); an item with stars > 0 and no shop id
// stays locked until Looks.unlock, see Looks.setStars.
//
// An item with `shop: '<id>'` is sold for жетоны (lib/wallet.js, docs/TZ.md P1-7): it stays
// locked until Wallet says it is bought; tapping it offers to buy it for жетоны or Telegram Stars. `tokens` is the price
// shown before the shop list has loaded.
//
// Only the first item of every group is free. Items with `legacy: true` used to be free: the
// server keeps them open for everyone who played before (bot/economy.js), and this phone keeps the
// one already chosen in each group, so nobody loses a look they had while the server is not reached.
//
//   Looks.load(key, groups)             -> { groupId: itemId }
//   Looks.open({ key, title, doneText, groups, onChange(sel, groupId), onClose(sel, changed) })
//   title and doneText default to «ВНЕШНИЙ ВИД» and «Готово».
//   group: { id, title, items: [{ id, name, stars, draw(ctx, size) }] }
(() => {
'use strict';

const OWNED_KEY = 'looks_owned';
let starsBalance = 0;

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
}

function unlocked(key, item) {
  if (item.shop) {
    if (window.Wallet && window.Wallet.owns(item.shop)) return true;
    const owned = item.legacy && read(OWNED_KEY, {});
    return !!(owned && owned[key] && owned[key].includes(item.id));
  }
  if (!(item.stars > 0)) return true;
  const owned = read(OWNED_KEY, {});
  return !!(owned[key] && owned[key].includes(item.id));
}

// The saved choice, with the first item of a group when nothing valid is saved.
// Once on every phone: a former free look chosen before it was sold stays with the player.
const KEPT_KEY = 'looks_kept';
function keepChosen(key, groups, saved) {
  const kept = read(KEPT_KEY, {});
  if (kept[key]) return;
  kept[key] = 1;
  const owned = read(OWNED_KEY, {});
  for (const g of groups) {
    const it = g.items.find((i) => i.id === saved[g.id]);
    if (it && it.legacy) owned[key] = [...new Set([...(owned[key] || []), it.id])];
  }
  write(OWNED_KEY, owned);
  write(KEPT_KEY, kept);
}

function load(key, groups) {
  const saved = read(key, {});
  keepChosen(key, groups, saved);
  const sel = {};
  for (const g of groups) {
    const item = g.items.find((it) => it.id === saved[g.id] && unlocked(key, it));
    sel[g.id] = (item || g.items[0]).id;
  }
  return sel;
}

function item(groups, sel, groupId) {
  const g = groups.find((gr) => gr.id === groupId);
  return g.items.find((it) => it.id === sel[groupId]) || g.items[0];
}

let panel = null;
let detach = null; // removes the open panel's key handler

function open(opts) {
  const { key, groups } = opts;
  const sel = load(key, groups);
  let changed = false;
  if (panel) panel.remove();
  if (detach) detach();
  panel = document.createElement('div');
  const mine = panel;
  panel.className = 'looks';
  panel.innerHTML = '<h1></h1><div class="looksBody"></div><button class="looksDone"></button>';
  panel.querySelector('h1').textContent = opts.title || 'ВНЕШНИЙ ВИД';
  panel.querySelector('.looksDone').textContent = opts.doneText || 'Готово';
  const body = panel.querySelector('.looksBody');
  // Previews can depend on other choices (a backdrop at night), so all are redrawn on a change.
  const previews = [];
  const paint = ([cv, it]) => {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    try { it.draw(ctx, cv.width); } catch (e) { /* preview is optional */ }
  };

  groups.forEach((g, n) => {
    const sec = document.createElement('section');
    sec.innerHTML = `<h2>${n + 1}. ${g.title}</h2><div class="looksRow"></div>`;
    const row = sec.querySelector('.looksRow');
    for (const it of g.items) {
      const open = unlocked(key, it);
      const b = document.createElement('button');
      b.className = 'looksItem' + (sel[g.id] === it.id ? ' on' : '') + (open ? '' : ' locked');
      const cv = document.createElement('canvas');
      cv.width = 48;
      cv.height = 48;
      previews.push([cv, it]);
      paint([cv, it]);
      const name = document.createElement('span');
      name.textContent = it.name;
      b.append(cv, name);
      if (!open) {
        const price = document.createElement('i');
        const st = it.shop && window.Wallet && window.Wallet.stars(it.shop);
        price.textContent = it.shop ? '◆ ' + ((window.Wallet && window.Wallet.price(it.shop)) || it.tokens || '') : '★ ' + it.stars;
        if (st) {
          const star = document.createElement('b');
          star.textContent = ' ⭐' + st;
          price.append(star);
        }
        b.append(price);
      }
      b.addEventListener('click', () => {
        if (!open && it.shop && window.Wallet) {
          // Bought: the panel opens again with the item available.
          // At once a sign that the tap was heard: the item dims until the purchase is settled.
          if (b.classList.contains('busy')) return;
          b.classList.add('busy');
          window.Wallet.buy(it.shop).then((ok) => {
            b.classList.remove('busy');
            if (ok && panel === mine) window.Looks.open(opts);
          });
          return;
        }
        if (!open || sel[g.id] === it.id) return;
        sel[g.id] = it.id;
        changed = true;
        write(key, sel);
        for (const el of row.children) el.classList.toggle('on', el === b);
        if (opts.onChange) opts.onChange(sel, g.id);
        previews.forEach(paint);
      });
      row.append(b);
    }
    body.append(sec);
  });

  // The server can take a purchase back (wallet.js tells the player why): redraw the items.
  const onOwned = () => { if (panel === mine) window.Looks.open(opts); };
  window.addEventListener('wallet:owned', onOwned);
  const close = () => {
    if (panel !== mine) return;
    window.removeEventListener('wallet:owned', onOwned);
    document.removeEventListener('keydown', onKey, true);
    detach = null;
    panel.remove();
    panel = null;
    if (opts.onClose) opts.onClose(sel, changed);
  };
  const onKey = (e) => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  panel.querySelector('.looksDone').addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  detach = () => {
    window.removeEventListener('wallet:owned', onOwned);
    document.removeEventListener('keydown', onKey, true);
    detach = null;
  };
  document.body.append(panel);
}

window.Looks = {
  load,
  item,
  open,
  stars: () => starsBalance,
  setStars(n) { starsBalance = n; },
  unlock(key, id) {
    const owned = read(OWNED_KEY, {});
    owned[key] = [...new Set([...(owned[key] || []), id])];
    write(OWNED_KEY, owned);
  },
};
})();
