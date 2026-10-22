import { createReplayResults } from "./tanks-results.js";
import { replay } from "./range-replay.js";

// Итоги «Тира»: билет с зерном от сервера, повтор записи выстрелов (range-replay.js),
// как у «Танкодрома» и «Бомбодрома». Игра только одиночная.
export const createRangeResults = (store, opts = {}) =>
  createReplayResults(store, { ...opts, tickets: "range_tickets", runs: "range_runs", replay });
