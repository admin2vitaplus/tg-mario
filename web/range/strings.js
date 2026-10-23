// Тир: every line the player reads, in Russian and English.
// The language follows Telegram (or the browser outside it). {name} marks a value
// filled in by the game; both languages must have the same keys and the same marks
// (strings.test.mjs checks it).
(function (root, factory) {
  const strings = factory();
  if (typeof module === 'object' && module.exports) module.exports = strings;
  else root.RangeStrings = strings;
})(typeof self !== 'undefined' ? self : this, () => {
'use strict';

const ru = {
  title: 'ТИР',
  intro: 'Сбивай птиц и тарелочки. На каждую волну три выстрела.<br>Сбей нужное число мишеней из десяти, чтобы пройти раунд.',
  best: 'Рекорд: {n}',
  disabled: 'Игра отключена.',
  back: '← Все игры',
  back_label: 'Назад',
  hud_score: 'СЧЁТ',
  hud_round: 'РАУНД',
  hud_need: 'НУЖНО',
  hud_best: 'РЕКОРД',
  menu_play: 'Играть',
  menu_pick: '▦ Выбрать раунд',
  menu_aim: '⚙ Прицел',
  menu_look: '🎨 Внешний вид',
  hint_gyro: 'Наклоняйте телефон, чтобы вести прицел. Огонь — тап по экрану или кнопка «ОГОНЬ».',
  hint_touch: 'Тапните по мишени, чтобы выстрелить. На компьютере — щелчок мышью.',
  btn_fire: 'ОГОНЬ',
  btn_center: '⊕',
  center_label: 'Прицел по центру',
  btn_continue: 'Продолжить',
  btn_again: 'Ещё раз',
  btn_share: 'Поделиться итогом',
  btn_all_games: '← Все игры',
  btn_done: 'Готово',
  pause_title: 'ПАУЗА',
  pause_text: 'Игра на паузе.',
  // Calibration and settings of the sight.
  calib_title: 'ПРИЦЕЛ',
  calib_text: 'Держите телефон так, как вам удобно целиться, и нажмите «Прицел по центру».<br>Наклон влево и вправо ведёт прицел по горизонтали, к себе и от себя — по вертикали.<br>Сбился — кнопка ⊕ внизу.',
  calib_btn: 'Прицел по центру',
  calib_touch: 'Целиться пальцем',
  aim_title: 'ПРИЦЕЛ',
  aim_mode: 'Чем целиться',
  aim_gyro: '📱 Наклоном телефона',
  aim_touch: '👆 Пальцем или мышью',
  aim_speed: 'Чувствительность: {n}%',
  aim_invert_x: 'Наоборот по горизонтали',
  aim_invert_y: 'Наоборот по вертикали',
  aim_status_on: 'Датчики телефона работают.',
  aim_status_wait: 'Включаем датчики телефона…',
  aim_status_off: 'Датчики движения недоступны: целиться можно пальцем или мышью.',
  aim_status_denied: 'Доступ к датчикам движения не разрешён. Разрешите его в настройках или целитесь пальцем.',
  aim_status_touch: 'Прицел ведётся пальцем или мышью.',
  aim_fallback: 'Датчики недоступны — целимся пальцем',
  // During the game.
  banner_round: 'РАУНД {n}',
  banner_need: 'нужно {n} из 10',
  banner_perfect: '10 ИЗ 10! +{n}',
  banner_pass: 'РАУНД ПРОЙДЕН',
  banner_short: 'МАЛО ПОПАДАНИЙ',
  banner_double: 'ДУПЛЕТ!',
  game_over: 'ИГРА ОКОНЧЕНА',
  you_won: 'ВСЕ РАУНДЫ ПРОЙДЕНЫ!',
  round_line: 'Раунд: {n}',
  hits_line: 'Попаданий: {hits} из {shots} выстрелов',
  score_line: 'Очки: {n}',
  best_line: 'Рекорд: {n}',
  share_text: 'Я прошёл {n} раундов в «Тире» и набрал {score} очков. Попробуй больше!',
  link_copied: 'Ссылка скопирована',
  // Looks.
  look_title: 'ВНЕШНИЙ ВИД',
  look_done: 'Готово',
  cat_sight: 'Прицел',
  cat_birds: 'Мишени',
  cat_scene: 'Место',
  sight_cross: 'Крест',
  sight_ring: 'Кольцо',
  sight_frame: 'Рамка',
  sight_laser: 'Лазер',
  birds_tin: 'Жестянки',
  birds_wood: 'Деревянные',
  birds_paper: 'Бумажные',
  birds_robot: 'Роботы',
  scene_day: 'День',
  scene_sunset: 'Закат',
  scene_night: 'Ночь',
  scene_winter: 'Зима',
};

const en = {
  title: 'SHOOTING RANGE',
  intro: 'Hit the birds and the clay discs. Three shots for each wave.<br>Hit enough of the ten targets to clear the round.',
  best: 'Best: {n}',
  disabled: 'The game is switched off.',
  back: '← All games',
  back_label: 'Back',
  hud_score: 'SCORE',
  hud_round: 'ROUND',
  hud_need: 'NEED',
  hud_best: 'BEST',
  menu_play: 'Play',
  menu_pick: '▦ Choose a round',
  menu_aim: '⚙ Sight',
  menu_look: '🎨 Looks',
  hint_gyro: 'Tilt the phone to move the sight. Fire: tap the screen or the «FIRE» button.',
  hint_touch: 'Tap a target to shoot it. On a computer, click with the mouse.',
  btn_fire: 'FIRE',
  btn_center: '⊕',
  center_label: 'Centre the sight',
  btn_continue: 'Continue',
  btn_again: 'Again',
  btn_share: 'Share the result',
  btn_all_games: '← All games',
  btn_done: 'Done',
  pause_title: 'PAUSE',
  pause_text: 'The game is paused.',
  calib_title: 'SIGHT',
  calib_text: 'Hold the phone the way you like to aim and tap «Centre the sight».<br>Tilting left and right moves the sight across, towards you and away moves it up and down.<br>Lost it? The ⊕ button below.',
  calib_btn: 'Centre the sight',
  calib_touch: 'Aim with a finger',
  aim_title: 'SIGHT',
  aim_mode: 'How to aim',
  aim_gyro: '📱 By tilting the phone',
  aim_touch: '👆 With a finger or mouse',
  aim_speed: 'Sensitivity: {n}%',
  aim_invert_x: 'Reverse left and right',
  aim_invert_y: 'Reverse up and down',
  aim_status_on: 'The phone\'s sensors are working.',
  aim_status_wait: 'Switching the phone\'s sensors on…',
  aim_status_off: 'Motion sensors are not available: aim with a finger or mouse.',
  aim_status_denied: 'Access to motion sensors is not allowed. Allow it in the settings or aim with a finger.',
  aim_status_touch: 'The sight follows a finger or the mouse.',
  aim_fallback: 'No sensors: aiming with a finger',
  banner_round: 'ROUND {n}',
  banner_need: '{n} of 10 needed',
  banner_perfect: '10 OF 10! +{n}',
  banner_pass: 'ROUND CLEAR',
  banner_short: 'NOT ENOUGH HITS',
  banner_double: 'DOUBLE!',
  game_over: 'GAME OVER',
  you_won: 'ALL ROUNDS CLEAR!',
  round_line: 'Round: {n}',
  hits_line: 'Hits: {hits} of {shots} shots',
  score_line: 'Score: {n}',
  best_line: 'Best: {n}',
  share_text: 'I cleared {n} rounds in «Shooting Range» and scored {score}. Can you do better?',
  link_copied: 'Link copied',
  look_title: 'LOOKS',
  look_done: 'Done',
  cat_sight: 'Sight',
  cat_birds: 'Targets',
  cat_scene: 'Place',
  sight_cross: 'Cross',
  sight_ring: 'Ring',
  sight_frame: 'Frame',
  sight_laser: 'Laser',
  birds_tin: 'Tin',
  birds_wood: 'Wooden',
  birds_paper: 'Paper',
  birds_robot: 'Robots',
  scene_day: 'Day',
  scene_sunset: 'Sunset',
  scene_night: 'Night',
  scene_winter: 'Winter',
};

// Russian for Russian and neighbouring Telegram languages, English for everyone else.
function pickLang(code) {
  return /^(ru|uk|be|kk)\b/i.test(code || '') ? 'ru' : 'en';
}

function make(lang) {
  const dict = lang === 'en' ? en : ru;
  return (key, vars) => {
    let text = key in dict ? dict[key] : (key in ru ? ru[key] : key);
    if (vars) text = text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return text;
  };
}

return { ru, en, pickLang, make };
});
