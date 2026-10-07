import "./bombs-sim.js";

// Проверка результата «Бомбодрома» повтором: правила игры детерминированы (bombs-sim.js —
// точная копия web/bombs/sim.js, это проверяет тест), поэтому сервер проигрывает записанные
// нажатия с тем же зерном и сам считает очки и пройденные этапы.
//
// Запись (строка): шаги через запятую. Шаг — код нажатий в base36, при повторе «код x число»
// (число тоже в base36); «n» — переход на следующий этап после экрана «этап пройден».
// Код игрока: (направление + 1) × 4 + A × 2 + B, 0…19 (A — бомба, B — взорвать пультом).
// Для дуэли: код1 × 20 + код2, 0…399.

const S = globalThis.BombSim;

export const MAX_FRAMES = 60 * 60 * 60; // час игры
export const MAX_LOG = 400_000; // символов

const inputOf = (code) => ({ dir: Math.floor(code / 4) - 1, a: (code & 2) > 0, b: (code & 1) > 0 });

export { encode } from "./tanks-replay.js";

// → { ok, why?, scores: [p0, p1?], stages, frames, phase }
export function replay({ seed, players, log }) {
  const bad = (why) => ({ ok: false, why });
  if (!Number.isSafeInteger(seed) || seed <= 0) return bad("bad seed");
  if (players !== 1 && players !== 2) return bad("bad players");
  if (typeof log !== "string" || !log.length || log.length > MAX_LOG) return bad("bad log");
  const maxCode = players === 1 ? 19 : 399;
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
    const inputs = players === 1 ? [inputOf(code)] : [inputOf(Math.floor(code / 20)), inputOf(code % 20)];
    for (let i = 0; i < n; i++) {
      if (s.phase === "clearDone" || s.phase === "overDone") return bad("steps after the end");
      S.step(s, inputs);
      s.events.length = 0;
    }
  }
  if (s.phase !== "overDone" && s.phase !== "clearDone") return bad("game not finished");
  // Пройденные этапы: текущий засчитывается, если из него вышли (или пройдена вся игра).
  const stages = s.stage + (s.phase === "clearDone" || s.won ? 1 : 0);
  return { ok: true, scores: s.players.map((p) => p.score), stages, frames, phase: s.phase };
}
