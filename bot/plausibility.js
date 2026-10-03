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

// Время на таймере у каждого уровня по мирам (web/levels.js и web/worlds.js, тест сверяет).
// Уровень в отчётах и в базе — сквозной номер: (мир − 1) × 4 + уровень в мире, 0…15.
export const WORLD_TIMES = [
  [400, 400, 300, 300],
  [400, 400, 300, 300],
  [300, 400, 300, 300],
  [400, 400, 300, 400],
];
export const PER_WORLD = 4;
export const LAST_LEVEL = WORLD_TIMES.length * PER_WORLD - 1;
export const LEVEL_GAIN = 30_000;
export const MIN_LEVEL_TICKS = 25;
const TICK_MS = 400;
const REAL_TIME_SHARE = 0.7; // запас на неточность таймера и сети
export const SEQUENCE_TTL_MS = 3 * 60 * 60 * 1000;

const reject = (why) => ({ ok: false, why });
const OK = { ok: true };
const timeOf = (abs) => (WORLD_TIMES[Math.floor(abs / PER_WORLD)] || [])[abs % PER_WORLD];

// Следующий уровень той же игры: соседний или, через трубу-переход из 1-2, первый уровень
// одного из следующих миров; счёт при этом не уменьшается.
const follows = (prev, e) => e.score >= prev.score &&
  (e.level === prev.level + 1 || (e.level > prev.level + 1 && e.level % PER_WORLD === 0));

// Отчёты текущей игры: с последнего «начала» — уровня, который не продолжает предыдущий.
// Игра начинается с первого уровня любого мира («Продолжить с мира N»).
export function currentGame(rows) {
  let start = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (i > 0 && follows(rows[i - 1], rows[i])) continue;
    start = rows[i].level % PER_WORLD === 0 ? i : -1;
    break;
  }
  return start < 0 ? [] : rows.slice(start);
}

// e.level — сквозной номер; seq — отчёты текущей игры по порядку: [{ level, score, timeLeft, at }]
export function checkLevel(e, seq, now) {
  const limit = timeOf(e.level);
  if (limit === undefined) return reject("unknown level");
  if (e.timeLeft > limit - MIN_LEVEL_TICKS) return reject("level too fast");
  const prev = seq[seq.length - 1];
  // Счёт меньше прошлого на первом уровне мира — это новая игра с этого мира, а не продолжение.
  const restart = e.level % PER_WORLD === 0 && prev && e.score < prev.score;
  if (prev && !restart && (e.level === prev.level + 1 || follows(prev, e))) {
    if (e.score < prev.score) return reject("score went down");
    // Через трубу-переход в отчёт попадает ещё и недопройденный уровень, где была труба.
    const gain = e.level === prev.level + 1 ? LEVEL_GAIN : 2 * LEVEL_GAIN;
    if (e.score - prev.score > prev.timeLeft * 50 + gain) return reject("score too high");
    const spentMs = (limit - e.timeLeft) * TICK_MS * REAL_TIME_SHARE;
    if (now - prev.at < spentMs) return reject("level too fast");
    return OK;
  }
  // Начало новой игры: первый уровень мира и счёт с нуля.
  if (e.level % PER_WORLD !== 0) return reject("levels out of order");
  return e.score <= LEVEL_GAIN ? OK : reject("score too high");
}

// e.levels — сколько уровней пройдено в этой игре; e.completed — пройден последний уровень последнего мира.
export function checkRun(e, seq) {
  if (e.score < e.coins * 200) return reject("coins do not match score");
  if (e.levels !== seq.length) return reject("levels do not match reports");
  const last = seq[seq.length - 1];
  if (e.completed && (!last || last.level !== LAST_LEVEL)) return reject("not all levels cleared");
  const cap = last ? last.score + last.timeLeft * 50 + LEVEL_GAIN : LEVEL_GAIN;
  if (e.score > cap) return reject("score too high");
  return OK;
}
