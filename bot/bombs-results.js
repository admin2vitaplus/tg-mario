import { createReplayResults } from "./tanks-results.js";
import { replay } from "./bombs-replay.js";

// Итоги «Бомбодрома»: билет с зерном от сервера, повтор записи нажатий (bombs-replay.js),
// онлайн-дуэль присылает хозяин, сервер засчитывает каждому его очки (как у «Танкодрома»).
export const createBombsResults = (store, opts = {}) =>
  createReplayResults(store, { ...opts, tickets: "bombs_tickets", runs: "bombs_runs", replay });
