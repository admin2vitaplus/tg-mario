// «Внешний вид»: a shared look picker for every game in the collection.
// A game describes its groups (hero, weather, enemies...) and gets a full
// screen panel with previews; the choice is saved in localStorage.
//
// Every item has a `stars` price. Right now everything is free (stars: 0);
// once stars are earned, an item with stars > 0 stays locked until it is
// bought, see Looks.setStars / Looks.unlock.
//
// An item with `shop: '<id>'` is sold for жетоны (lib/wallet.js, docs/TZ.md P1-7): it stays
// locked until Wallet says it is bought; tapping it offers to buy it. `tokens` is the price
// shown before the shop list has loaded.
//
//   Looks.load(key, groups)             -> { groupId: itemId }
//   Looks.open({ key, title, groups, onChange(sel, groupId), onClose(sel, changed) })
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
  if (item.shop) return !!(window.Wallet && window.Wallet.owns(item.shop));
  if (!(item.stars > 0)) return true;
  const owned = read(OWNED_KEY, {});
  return !!(owned[key] && owned[key].includes(item.id));
}

// The saved choice, with the first item of a group when nothing valid is saved.
function load(key, groups) {
  const saved = read(key, {});
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
  panel.innerHTML = `<h1>${opts.title || 'ВНЕШНИЙ ВИД'}</h1><div class="looksBody"></div>` +
    '<button class="looksDone">Готово</button>';
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
        price.textContent = it.shop ? '◆ ' + ((window.Wallet && window.Wallet.price(it.shop)) || it.tokens || '')
          : '★ ' + it.stars;
        b.append(price);
      }
      b.addEventListener('click', () => {
        if (!open && it.shop && window.Wallet && window.Wallet.enabled) {
          // Bought: the panel opens again with the item available.
          window.Wallet.buy(it.shop).then((ok) => { if (ok && panel === mine) window.Looks.open(opts); });
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

  const close = () => {
    if (panel !== mine) return;
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
  detach = () => { document.removeEventListener('keydown', onKey, true); detach = null; };
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
