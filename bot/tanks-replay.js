import "./tanks-sim.js";

// Проверка результата «Танкодрома» повтором (ТЗ P0-4, P1-7): правила игры детерминированы
// (tanks-sim.js — точная копия web/tanks/sim.js, это проверяет тест), поэтому сервер
// проигрывает записанные нажатия с тем же зерном и сам считает очки. Клиенту на слово
// не верится ничего: ни очки, ни число уровней.
//
// Запись (строка): шаги через запятую. Шаг — код нажатий в base36, при повторе «код x число»
// (число тоже в base36); «n» — переход на следующий уровень после экрана «уровень пройден».
// Код игрока: (направление + 1) × 2 + огонь, 0…9. Для двоих: код1 × 10 + код2, 0…99.

const S = globalThis.TankSim;

export const MAX_FRAMES = 60 * 60 * 60; // час игры
export const MAX_LOG = 400_000; // символов

const inputOf = (code) => ({ dir: Math.floor(code / 2) - 1, fire: code % 2 === 1 });

// Кодирование для тестов и для сравнения с клиентом (web/tanks/tanks.js делает то же самое).
export function encode(steps) {
  const out = [];
  let prev = null, n = 0;
  const flush = () => { if (prev !== null) out.push(n > 1 ? `${prev.toString(36)}x${n.toString(36)}` : prev.toString(36)); };
  for (const s of steps) {
    if (s === "n") { flush(); prev = null; n = 0; out.push("n"); continue; }
    if (s === prev) { n++; continue; }
    flush();
    prev = s;
    n = 1;
  }
  flush();
  return out.join(",");
}

// → { ok, why?, scores: [p0, p1?], stages, frames, phase }
export function replay({ seed, players, log }) {
  const bad = (why) => ({ ok: false, why });
  if (!Number.isSafeInteger(seed) || seed <= 0) return bad("bad seed");
  if (players !== 1 && players !== 2) return bad("bad players");
  if (typeof log !== "string" || !log.length || log.length > MAX_LOG) return bad("bad log");
  const maxCode = players === 1 ? 9 : 99;
  const s = S.newGame(players, seed);
  let frames = 0;
  for (const part of log.split(",")) {
    if (part === "n") {
      if (s.phase !== "clearDone") return bad("next stage before clear");
      S.startStage(s, s.stage + 1);
      continue;
    }
    const m = /^([0-9a-z]{1,2})(?:x([0-9a-z]{1,6}))?$/.exec(part);
    if (!m) return bad("bad step");
    const code = parseInt(m[1], 36);
    const n = m[2] ? parseInt(m[2], 36) : 1;
    if (code > maxCode || n < 1) return bad("bad step");
    frames += n;
    if (frames > MAX_FRAMES) return bad("too long");
    const inputs = players === 1 ? [inputOf(code)] : [inputOf(Math.floor(code / 10)), inputOf(code % 10)];
    for (let i = 0; i < n; i++) {
      if (s.phase === "clearDone" || s.phase === "overDone") return bad("steps after the end");
      S.step(s, inputs);
      s.events.length = 0;
    }
  }
  if (s.phase !== "overDone" && s.phase !== "clearDone") return bad("game not finished");
  // Пройденные уровни: текущий засчитывается, если он пройден.
  const stages = s.stage + (s.phase === "clearDone" ? 1 : 0);
  return { ok: true, scores: s.players.map((p) => p.score), stages, frames, phase: s.phase };
}
