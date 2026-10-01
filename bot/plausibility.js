// Проверка правдоподобия результатов «Прыг-Скока» (ТЗ, P0-4: сервер не верит клиенту на слово).
//
// Откуда берутся очки в игре: монета 200, жук 100, кирпич 50, ягода 1000, босс 5000 + 5000
// за мост, флаг до 6000, после уровня бонус за время timeLeft × 50. Таймер уровня тикает
// раз в 0,4 с. Поэтому:
//  • за один уровень без бонуса за время нельзя набрать больше LEVEL_GAIN;
//  • уровень нельзя пройти быстрее MIN_LEVEL_TICKS тиков таймера;
//  • между отчётами о соседних уровнях должно пройти реальное время, сравнимое с потраченными тиками;
//  • итог игры не больше последнего отчёта + бонус за время + один незаконченный уровень;
//  • счёт не меньше 200 × монеты (каждая монета даёт 200);
//  • число пройденных уровней в итоге совпадает с числом отчётов об уровнях этой игры.

export const LEVEL_TIME = [400, 400, 300, 300];
export const LEVEL_GAIN = 30_000;
export const MIN_LEVEL_TICKS = 25;
const TICK_MS = 400;
const REAL_TIME_SHARE = 0.7; // запас на неточность таймера и сети
export const SEQUENCE_TTL_MS = 3 * 60 * 60 * 1000;

const reject = (why) => ({ ok: false, why });
const OK = { ok: true };

// seq — отчёты об уровнях текущей игры по порядку: [{ level, score, timeLeft, at }]
export function checkLevel(e, seq, now) {
  const limit = LEVEL_TIME[e.level];
  if (limit === undefined) return reject("unknown level");
  if (e.timeLeft > limit - MIN_LEVEL_TICKS) return reject("level too fast");
  if (e.level === 0) {
    return e.score <= LEVEL_GAIN ? OK : reject("score too high");
  }
  const prev = seq[seq.length - 1];
  if (!prev || seq.length !== e.level || prev.level !== e.level - 1) return reject("levels out of order");
  if (e.score < prev.score) return reject("score went down");
  if (e.score - prev.score > prev.timeLeft * 50 + LEVEL_GAIN) return reject("score too high");
  const spentMs = (limit - e.timeLeft) * TICK_MS * REAL_TIME_SHARE;
  if (now - prev.at < spentMs) return reject("level too fast");
  return OK;
}

export function checkRun(e, seq) {
  if (e.score < e.coins * 200) return reject("coins do not match score");
  if (e.levels !== seq.length) return reject("levels do not match reports");
  if (e.completed && e.levels !== LEVEL_TIME.length) return reject("not all levels cleared");
  const last = seq[seq.length - 1];
  const cap = last ? last.score + last.timeLeft * 50 + LEVEL_GAIN : LEVEL_GAIN;
  if (e.score > cap) return reject("score too high");
  return OK;
}
