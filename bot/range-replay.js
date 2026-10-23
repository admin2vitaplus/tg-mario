import "./range-sim.js";
import { MIN_QUIT_FRAMES } from "./tanks-replay.js";

// Проверка результата «Тира» повтором: правила игры детерминированы (range-sim.js — точная
// копия web/range/sim.js, это проверяет тест), поэтому сервер проигрывает записанные выстрелы
// с тем же зерном и сам считает очки и пройденные раунды. Как игрок навёл прицел (наклоном
// телефона, пальцем или мышью), правилам не важно: в записи только выстрелы.
//
// Запись (строка): выстрелы через запятую, «кадры.x.y» в base36 — через сколько кадров после
// предыдущего выстрела (от 1) и куда, в пикселях поля; последняя часть «e<кадры>» — сколько
// кадров прошло после последнего выстрела до конца игры или выхода.

const S = globalThis.RangeSim;

export const MAX_FRAMES = 60 * 60 * 60; // час игры
export const MAX_LOG = 200_000; // символов
export { MIN_QUIT_FRAMES };
// Попаданий раньше, чем через FAST кадров после появления мишени: человек так не успевает.
export const MAX_FAST_HITS = 4;

// Кодирование для тестов (web/range/range.js делает то же самое): [{ wait, x, y }], idle.
export function encode(shots, idle = 0) {
  const out = shots.map((s) => `${s.wait.toString(36)}.${s.x.toString(36)}.${s.y.toString(36)}`);
  if (idle > 0) out.push("e" + idle.toString(36));
  return out.join(",");
}

// → { ok, why?, scores: [score], stages, frames, phase, won, quit, stats: [stats] }
// stats — для достижений (achievements.js): выстрелы, попадания, лучшая серия попаданий подряд,
// раунды без промаха, золотые птицы, тарелочки, дуплеты.
// start — раунд, с которого начата игра (выбор пройденных уровней), stages — сколько раундов пройдено от него.
export function replay({ seed, players, log, start = 0 }) {
  const bad = (why) => ({ ok: false, why });
  if (!Number.isSafeInteger(seed) || seed <= 0) return bad("bad seed");
  if (players !== 1) return bad("bad players");
  if (typeof log !== "string" || !log.length || log.length > MAX_LOG) return bad("bad log");
  if (!Number.isSafeInteger(start) || start < 0 || start >= S.ROUNDS) return bad("bad start");
  const s = S.newGame(seed);
  if (start > 0) S.startRound(s, start); // так же делает игра (range.js)
  let frames = 0;
  const run = (n, shot) => {
    for (let i = 0; i < n; i++) {
      if (s.phase === "overDone") return false;
      S.step(s, i === n - 1 ? shot : null);
      s.events.length = 0;
    }
    return true;
  };
  const parts = log.split(",");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let n, shot = null;
    const end = /^e([0-9a-z]{1,6})$/.exec(part);
    if (end) {
      if (i !== parts.length - 1) return bad("bad step");
      n = parseInt(end[1], 36);
    } else {
      const m = /^([0-9a-z]{1,6})\.([0-9a-z]{1,2})\.([0-9a-z]{1,2})$/.exec(part);
      if (!m) return bad("bad step");
      n = parseInt(m[1], 36);
      shot = { x: parseInt(m[2], 36), y: parseInt(m[3], 36) };
      if (shot.x >= S.W || shot.y >= S.H) return bad("bad step");
    }
    if (n < 1) return bad("bad step");
    frames += n;
    if (frames > MAX_FRAMES) return bad("too long");
    if (!run(n, shot)) return bad("steps after the end");
  }
  if (s.stats.fast > MAX_FAST_HITS) return bad("too fast");
  const finished = s.phase === "overDone";
  if (!finished && frames < MIN_QUIT_FRAMES) return bad("game not finished");
  const { shots, hits, bestStreak, perfect, gold, discs, doubles } = s.stats;
  return {
    ok: true, scores: [s.score], stages: S.cleared(s) - start, frames, phase: s.phase, won: !!s.won, quit: !finished,
    stats: [{ shots, hits, bestStreak, perfect, gold, discs, doubles }],
  };
}
