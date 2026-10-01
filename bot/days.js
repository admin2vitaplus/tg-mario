// Дни для статистики считаются по Москве (UTC+3, без перехода на летнее время).
export const DAY_MS = 86_400_000;
const MSK_MS = 3 * 3_600_000;

export const dayOf = (ms) => Math.floor((ms + MSK_MS) / DAY_MS);
// Номер дня → «ММ-ДД».
export const dayLabel = (day) => new Date(day * DAY_MS).toISOString().slice(5, 10);
