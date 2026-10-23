// Screen effects for the canvas games: sparks and debris, short screen shakes and score popups.
// Only the picture uses them: the game state, its replays and the server never see them.
// Usage: Fx.burst(x, y, opts), Fx.shake(px, ms), Fx.popup(x, y, text), then once per drawn frame
// const [dx, dy] = Fx.offset() to move the picture, and Fx.draw(ctx) after the scene is drawn.
// Fx.digits(ctx, text, x, y, col) writes points in a small pixel font (the platformer uses it too).
(() => {
  'use strict';

  const parts = [];
  const pops = [];
  let shakeUntil = 0;
  let shakeLen = 1;
  let shakePx = 0;
  let last = 0;
  const now = () => (window.performance ? performance.now() : Date.now());
  // Someone who asked the system for less motion gets no shaking.
  let calm = false;
  try { calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browser */ }

  // n pieces fly out from x, y. speed in px/s, life in ms, grav in px/s², size in px.
  function burst(x, y, o = {}) {
    const n = o.n || 8;
    const colors = o.colors || ['#fff8c0', '#f8a800', '#e83800'];
    const speed = o.speed || 60;
    const life = o.life || 400;
    for (let i = 0; i < n && parts.length < 300; i++) {
      const a = (o.angle != null ? o.angle : 0) + (o.spread != null ? (Math.random() - 0.5) * o.spread : Math.random() * Math.PI * 2);
      const v = speed * (0.4 + Math.random() * 0.8);
      parts.push({
        x, y,
        vx: Math.cos(a) * v + (o.vx || 0),
        vy: Math.sin(a) * v + (o.vy || 0),
        g: o.grav || 0,
        t: 0,
        life: life * (0.6 + Math.random() * 0.6),
        col: colors[i % colors.length],
        size: o.size || (Math.random() < 0.5 ? 2 : 1),
      });
    }
  }

  function shake(px, ms = 200) {
    if (calm) return;
    const t = now();
    if (t < shakeUntil && px < shakePx) return;
    shakePx = px;
    shakeLen = ms;
    shakeUntil = t + ms;
  }

  // A 3x5 pixel font for points: sharp at any scale, unlike a system font at 8 px.
  const GLYPHS = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
    '+': '000010111010000', x: '000101010101000',
  };

  // Draws text centered on x, y with a dark outline; characters the font lacks are skipped.
  function digits(ctx, text, x, y, col = '#ffffff') {
    const chars = String(text).split('').filter((c) => GLYPHS[c]);
    const w = chars.length * 4 - 1;
    const x0 = Math.round(x - w / 2), y0 = Math.round(y - 2);
    for (const [dx, dy, c] of [[-1, 0, '#000'], [1, 0, '#000'], [0, -1, '#000'], [0, 1, '#000'], [0, 0, col]]) {
      ctx.fillStyle = c;
      chars.forEach((ch, i) => {
        const g = GLYPHS[ch];
        for (let k = 0; k < 15; k++) if (g[k] === '1') ctx.fillRect(x0 + i * 4 + (k % 3) + dx, y0 + Math.floor(k / 3) + dy, 1, 1);
      });
    }
  }

  function popup(x, y, text, col = '#ffffff') {
    pops.push({ x, y, text: String(text), col, t: 0 });
    if (pops.length > 12) pops.shift();
  }

  // Whole-pixel offset of the picture for this frame; fades out over the shake.
  function offset() {
    const t = now();
    if (t >= shakeUntil) return [0, 0];
    const k = (shakeUntil - t) / shakeLen;
    const r = Math.max(1, Math.round(shakePx * k));
    return [Math.round((Math.random() * 2 - 1) * r), Math.round((Math.random() * 2 - 1) * r)];
  }

  function step() {
    const t = now();
    const dt = Math.min(50, last ? t - last : 16);
    last = t;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t >= p.life) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt / 1000;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].t += dt;
      if (pops[i].t > 700) pops.splice(i, 1);
    }
  }

  // Draws in the coordinates of the scene; call it with the same transform as the sprites.
  function draw(ctx) {
    step();
    for (const p of parts) {
      // Pieces blink in their last third instead of fading: crisp pixels, as on the console.
      if (p.t > p.life * 0.66 && Math.floor(p.t / 50) % 2) continue;
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    for (const p of pops) {
      // Rises for the first half, then blinks out.
      if (p.t > 450 && Math.floor(p.t / 60) % 2) continue;
      digits(ctx, p.text, p.x, p.y - Math.min(14, p.t / 25), p.col);
    }
  }

  function clear() {
    parts.length = 0;
    pops.length = 0;
    shakeUntil = 0;
  }

  window.Fx = { burst, shake, popup, offset, draw, clear, digits };
})();
