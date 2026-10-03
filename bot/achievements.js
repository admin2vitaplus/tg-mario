// Достижения. check получает итог (уровня или всей игры) и статистику игрока после его учёта.
export const ACHIEVEMENTS = [
  { code: "first_level", icon: "🚩", title: "Первый флаг", text: "Пройти уровень 1-1",
    check: (e) => e.type === "level" && e.level === 0 },
  { code: "underground", icon: "⛏️", title: "Диггер", text: "Пройти подземелье 1-2",
    check: (e) => e.type === "level" && e.level === 1 },
  { code: "treetops", icon: "🌳", title: "Верхолаз", text: "Пройти верхушки деревьев 1-3",
    check: (e) => e.type === "level" && e.level === 2 },
  { code: "world_clear", icon: "🏰", title: "Хозяин замка", text: "Пройти весь мир 1",
    check: (e) => e.type === "level" && e.level === 3 },
  { code: "boss_fire", icon: "🔥", title: "Огнемёт", text: "Победить жука-босса огнём",
    check: (e) => e.type === "run" && e.bossFire },
  { code: "no_death_level", icon: "🛡️", title: "Без царапины", text: "Пройти уровень, не потеряв жизнь",
    check: (e) => e.type === "level" && e.deaths === 0 },
  { code: "no_death_world", icon: "👑", title: "Легенда", text: "Пройти все миры, не потеряв ни одной жизни",
    check: (e) => e.type === "run" && e.completed && e.deaths === 0 },
  { code: "speedrun", icon: "⚡", title: "Спидраннер", text: "Пройти уровень, когда на таймере осталось 200 и больше",
    check: (e) => e.type === "level" && e.timeLeft >= 200 },
  { code: "coins_run_50", icon: "💰", title: "Копилка", text: "Собрать 50 монет за одну игру",
    check: (e) => e.type === "run" && e.coins >= 50 },
  { code: "coins_total_500", icon: "🏦", title: "Банкир", text: "Собрать 500 монет за всё время",
    check: (_e, p) => p.total_coins >= 500 },
  { code: "score_50k", icon: "🎯", title: "50 000", text: "Набрать 50 000 очков за одну игру",
    check: (e) => e.type === "run" && e.score >= 50000 },
  { code: "games_10", icon: "🎮", title: "Завсегдатай", text: "Сыграть 10 игр",
    check: (_e, p) => p.games >= 10 },
];

export const publicList = () => ACHIEVEMENTS.map(({ code, icon, title, text }) => ({ code, icon, title, text }));
