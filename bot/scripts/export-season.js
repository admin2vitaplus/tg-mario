import { writeFileSync } from "node:fs";
import { openDb } from "../db.js";
import { exportSeason, seasonLabel, seasonOf } from "../economy.js";

// Экспорт сезона жетонов (ТЗ P1-7): npm run export:season -- <номер сезона> [файл]
// Без номера — последний закрытый (прошлая неделя). Пишет CSV «player_id,amount,balance»:
// amount — изменение баланса игрока за сезон (включая призы недели), balance — баланс на конец сезона.
// Сумма amount по файлу сверяется с суммой по журналу; при расхождении — код выхода 1.

const [arg, out] = process.argv.slice(2);
const season = arg ? Number(arg) : seasonOf(Date.now()) - 1;
if (!Number.isSafeInteger(season) || season < 0) {
  console.error("Формат: npm run export:season -- <номер сезона> [файл.csv]");
  process.exit(2);
}
const store = openDb(process.env.DB_FILE || "scores.db");
try {
  const r = exportSeason(store.db, season);
  const file = out || `season-${season}.csv`;
  writeFileSync(file, r.csv);
  console.log(`Сезон ${season} (${seasonLabel(season)}), состояние: ${r.state === "done" ? "закрыт" : r.state}`);
  console.log(`Игроков: ${r.rows.length}, сумма по файлу: ${r.total}, по журналу: ${r.ledgerTotal}`);
  console.log(`Файл: ${file}`);
  if (r.state !== "done") console.warn("Внимание: сезон ещё не закрыт, призы недели могут быть не начислены.");
  if (r.total !== r.ledgerTotal) {
    console.error("Суммы не сходятся!");
    process.exitCode = 1;
  }
} finally {
  store.close();
}
