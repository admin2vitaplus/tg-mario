// Ограничение частоты: счётчик на ключ (IP или пользователь) в окне фиксированной длины.
// Память ограничена: устаревшие ключи убираются при каждой проверке пачками, а при
// переполнении самые старые записи вытесняются.
export function createRateLimiter({ limit, windowMs = 60_000, maxKeys = 20_000, now = Date.now }) {
  const hits = new Map(); // key -> { count, resetAt }; Map хранит порядок вставки

  const sweep = (t) => {
    for (const [k, v] of hits) {
      if (v.resetAt > t) break; // дальше только более свежие окна
      hits.delete(k);
    }
  };

  return {
    // true — можно, false — превышен лимит.
    take(key) {
      const t = now();
      sweep(t);
      let e = hits.get(key);
      if (!e || e.resetAt <= t) {
        if (e) hits.delete(key);
        e = { count: 0, resetAt: t + windowMs };
        hits.set(key, e);
        while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
      }
      e.count++;
      return e.count <= limit;
    },
    retryAfter(key) {
      const e = hits.get(key);
      return e ? Math.max(1, Math.ceil((e.resetAt - now()) / 1000)) : 1;
    },
    get size() { return hits.size; },
  };
}
