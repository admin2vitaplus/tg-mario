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
// Незаконченная игра (игрок вышел в меню) засчитывается, если в неё играли хотя бы 20 секунд.
export const MIN_QUIT_FRAMES = 20 * 60;

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

// Статистика игрока за игру для достижений (achievements.js): подбитые танки (броневики
// отдельно), подобранные бонусы, уровни без потери жизни.
const newStats = () => ({ kills: 0, armored: 0, picks: 0, clean: 0, deaths: 0 });

// → { ok, why?, scores: [p0, p1?], stages, frames, phase, quit, stats: [p0, p1?] }
// quit — игра не закончена (игрок вышел), но в неё играли не меньше MIN_QUIT_FRAMES.
export function replay({ seed, players, log }) {
  const bad = (why) => ({ ok: false, why });
  if (!Number.isSafeInteger(seed) || seed <= 0) return bad("bad seed");
  if (players !== 1 && players !== 2) return bad("bad players");
  if (typeof log !== "string" || !log.length || log.length > MAX_LOG) return bad("bad log");
  const maxCode = players === 1 ? 9 : 99;
  const s = S.newGame(players, seed);
  const stats = s.players.map(newStats);
  let stageDeaths = s.players.map(() => 0);
  const before = s.players.map(() => ({ lives: 0, score: 0, kills: [0, 0, 0, 0] }));
  let frames = 0;
  for (const part of log.split(",")) {
    if (part === "n") {
      if (s.phase !== "clearDone") return bad("next stage before clear");
      S.startStage(s, s.stage + 1);
      stageDeaths = s.players.map(() => 0);
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
      for (let k = 0; k < s.players.length; k++) {
        const p = s.players[k], b = before[k];
        b.lives = p.lives; b.score = p.score;
        for (let t = 0; t < 4; t++) b.kills[t] = p.kills[t];
      }
      const phase = s.phase;
      S.step(s, inputs);
      s.events.length = 0;
      for (let k = 0; k < s.players.length; k++) {
        const p = s.players[k], b = before[k], st = stats[k];
        let killScore = 0;
        for (let t = 0; t < 4; t++) {
          const d = p.kills[t] - b.kills[t];
          if (d <= 0) continue;
          st.kills += d;
          if (t === 3) st.armored += d;
          killScore += d * S.ENEMY[t].score;
        }
        // Кроме подбитых танков очки дают только бонусы, по 500.
        const picks = Math.round((p.score - b.score - killScore) / 500);
        if (picks > 0) st.picks += picks;
        if (p.lives < b.lives) { st.deaths += b.lives - p.lives; stageDeaths[k] += b.lives - p.lives; }
      }
      if (phase !== "clear" && s.phase === "clear") {
        s.players.forEach((p, k) => { if (p.lives > 0 && stageDeaths[k] === 0) stats[k].clean++; });
      }
    }
  }
  const finished = s.phase === "overDone" || s.phase === "clearDone";
  if (!finished && frames < MIN_QUIT_FRAMES) return bad("game not finished");
  // Пройденные уровни: текущий засчитывается, если он пройден.
  const stages = s.stage + (s.phase === "clearDone" || s.phase === "clear" ? 1 : 0);
  return { ok: true, scores: s.players.map((p) => p.score), stages, frames, phase: s.phase, quit: !finished, stats };
}
