// Тир: the sight driven by the phone's motion sensors.
//
// The phone's gyroscope says how fast it turns (around its own axes, radians a second),
// and the accelerometer where «down» is. Turning about the vertical line (left / right,
// however the phone is held) moves the sight across; tilting about the phone's own
// left-right axis (towards you / away) moves it up and down. The sight is the sum of
// those turns since «Прицел по центру» (recenter), like an air mouse: it never jumps
// when the phone is held at a strange angle, and a small drift is fixed with ⊕.
//
// Sensors, best first: Telegram's own (Bot API 8.0: Gyroscope + Accelerometer), then the
// browser's devicemotion (iOS asks for permission on a tap: start() must run from one).
//
//   RangeAim.create({ width, height, onStatus(status) }) -> aim
//   aim.start() -> Promise<'on' | 'off' | 'denied'>     aim.stop()
//   aim.recenter()         aim.x, aim.y — the sight in field pixels
//   aim.speed = 1          aim.invertX / aim.invertY = false
//   aim.feed(gyro, t), aim.feedGravity(acc) — readings straight in (tests)
//   RangeAim.turn(gyro, down) -> { yaw, pitch } (radians a second), for tests
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RangeAim = api;
})(typeof self !== 'undefined' ? self : this, (root) => {
'use strict';

// Field pixels for one radian of turn at speed 1: about 40° of turn crosses the screen.
const PX_PER_RAD = 360;
const DEAD = 0.015;     // rad/s: slower turns are sensor noise (keeps the sight from creeping)
const RATE_MS = 20;     // Telegram's fastest refresh
const NO_DATA_MS = 1500;

// The phone's «up» from the accelerometer, a unit vector in the phone's axes. Phones and
// browsers disagree on the sign (and some give g, some m/s²), so the sign is chosen so that
// up points out of the screen and towards the top of the phone, as when it is held to aim.
function upOf(acc) {
  if (!acc) return [0, 1, 0];
  const [x, y, z] = acc;
  const len = Math.hypot(x, y, z);
  if (!(len > 0.5)) return [0, 1, 0]; // no gravity in the data: assume upright
  const k = (y + z >= 0 ? 1 : -1) / len;
  return [x * k, y * k, z * k];
}

// gyro: [x, y, z] rad/s; down: accelerometer [x, y, z] or null.
// yaw > 0 — the phone turns left (the sight goes left), pitch > 0 — its top goes back (up).
function turn(gyro, acc) {
  const u = upOf(acc);
  const yaw = gyro[0] * u[0] + gyro[1] * u[1] + gyro[2] * u[2];
  return { yaw, pitch: gyro[0] };
}

function create({ width, height, onStatus = () => {} }) {
  const tg = root.Telegram && root.Telegram.WebApp;
  const aim = {
    x: width / 2, y: height / 2, speed: 1, invertX: false, invertY: false,
    status: 'off', source: '',
  };
  let acc = null;          // smoothed accelerometer (gravity)
  let last = 0;            // time of the last gyroscope reading
  let rate = [0, 0];       // smoothed yaw, pitch
  let seen = 0;            // gyroscope readings since start
  let unbind = [];

  const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
  function onGyro(g, t) {
    seen++;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t;
    const { yaw, pitch } = turn(g, acc);
    rate = [rate[0] * 0.4 + yaw * 0.6, rate[1] * 0.4 + pitch * 0.6];
    const k = PX_PER_RAD * aim.speed * dt;
    const yw = Math.abs(rate[0]) < DEAD ? 0 : rate[0];
    const pt = Math.abs(rate[1]) < DEAD ? 0 : rate[1];
    aim.x = clamp(aim.x - yw * k * (aim.invertX ? -1 : 1), width);
    aim.y = clamp(aim.y - pt * k * (aim.invertY ? -1 : 1), height);
  }
  function onAcc(a) {
    acc = acc ? acc.map((v, i) => v * 0.8 + a[i] * 0.2) : a.slice();
  }
  const set = (s) => { aim.status = s; onStatus(s); return s; };

  function startTelegram() {
    return new Promise((done) => {
      const G = tg.Gyroscope, A = tg.Accelerometer;
      const g = () => onGyro([G.x || 0, G.y || 0, G.z || 0], performance.now());
      const a = () => onAcc([A.x || 0, A.y || 0, A.z || 0]);
      const failed = () => done('off');
      tg.onEvent('gyroscopeChanged', g);
      tg.onEvent('accelerometerChanged', a);
      tg.onEvent('gyroscopeFailed', failed);
      unbind.push(() => {
        tg.offEvent('gyroscopeChanged', g);
        tg.offEvent('accelerometerChanged', a);
        tg.offEvent('gyroscopeFailed', failed);
        try { G.stop(); A.stop(); } catch (e) { /* ignore */ }
      });
      try { A.start({ refresh_rate: RATE_MS * 2 }); } catch (e) { /* gravity is optional */ }
      try {
        G.start({ refresh_rate: RATE_MS }, (ok) => { if (!ok) done('off'); });
      } catch (e) { done('off'); return; }
      waitData(done);
    });
  }

  function startBrowser() {
    return new Promise((done) => {
      const ask = root.DeviceMotionEvent && root.DeviceMotionEvent.requestPermission;
      const go = () => {
        const DEG = Math.PI / 180;
        const h = (e) => {
          const r = e.rotationRate;
          if (r && (r.alpha != null || r.beta != null)) onGyro([(r.beta || 0) * DEG, (r.gamma || 0) * DEG, (r.alpha || 0) * DEG], performance.now());
          const a = e.accelerationIncludingGravity;
          if (a && a.x != null) onAcc([a.x || 0, a.y || 0, a.z || 0]);
        };
        root.addEventListener('devicemotion', h);
        unbind.push(() => root.removeEventListener('devicemotion', h));
        waitData(done);
      };
      if (typeof ask === 'function') {
        ask.call(root.DeviceMotionEvent).then((r) => (r === 'granted' ? go() : done('denied')), () => done('denied'));
      } else if (root.DeviceMotionEvent) go();
      else done('off');
    });
  }

  // Sensors that start but never send anything (a computer, an emulator) count as none.
  function waitData(done) {
    const t0 = Date.now();
    const check = () => {
      if (seen > 3) done('on');
      else if (Date.now() - t0 > NO_DATA_MS) done('off');
      else setTimeout(check, 100);
    };
    check();
  }

  aim.start = () => {
    aim.stop();
    set('wait');
    seen = 0;
    last = 0;
    const useTg = tg && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0') && tg.Gyroscope;
    aim.source = useTg ? 'telegram' : 'browser';
    const first = useTg ? startTelegram() : startBrowser();
    return first.then((s) => {
      // Telegram without sensors (a desktop app): maybe the browser has them.
      if (s === 'off' && useTg && root.DeviceMotionEvent) {
        aim.stop();
        aim.source = 'browser';
        return startBrowser();
      }
      return s;
    }).then((s) => { if (s !== 'on') aim.stop(); return set(s); });
  };
  aim.stop = () => {
    unbind.splice(0).forEach((f) => f());
    if (aim.status === 'on' || aim.status === 'wait') set('off');
  };
  // Readings straight in (tests): gyro [x, y, z] rad/s at time t ms, accelerometer [x, y, z].
  aim.feed = onGyro;
  aim.feedGravity = onAcc;
  aim.recenter = () => {
    aim.x = width / 2;
    aim.y = height / 2;
    rate = [0, 0];
  };
  return aim;
}

return { create, turn, upOf, PX_PER_RAD };
});
