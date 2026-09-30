# Бот «Прыг-Скок»

Небольшой бот на Node.js + [grammY](https://grammy.dev). Он отвечает на `/start` кнопкой «Играть»,
которая открывает игру как Telegram Mini App, и ставит такую же кнопку в меню чата.

## Настройка

1. Node.js 20.12 или новее.
2. `cp .env.example .env` и впишите в `.env` токен от @BotFather (`BOT_TOKEN`).
   `WEBAPP_URL` — адрес игры, по умолчанию `https://admin2vitaplus.github.io/tg-mario/`.
3. `npm install`
4. `npm start`

Файл `.env` в git не попадает. Никогда не публикуйте токен; если он где-то засветился,
получите новый в @BotFather командой `/revoke`.

## Где держать бота круглосуточно

Бот работает через long polling, поэтому ему не нужен домен и https, только постоянно запущенный процесс.

- **Любой VPS** (самый простой и надёжный вариант, от ~200 ₽/мес). На сервере с Ubuntu/Debian
  выполните одну команду: скрипт поставит Node.js, скачает код, спросит токен и запустит бота
  как службу systemd (сама перезапускается после сбоев и перезагрузки сервера):
  ```sh
  curl -fsSL https://raw.githubusercontent.com/admin2vitaplus/tg-mario/main/bot/deploy/install.sh | sudo bash
  ```
  Повторный запуск той же команды обновляет бота. Логи: `journalctl -u prygskok-bot -f`.
- **Railway / Render / Fly.io**: корень сервиса — папка `bot`, команда запуска `npm start`,
  переменные `BOT_TOKEN` и `WEBAPP_URL` задаются в настройках сервиса (не в файлах).
  На Render нужен тип сервиса Background Worker.

## Без сервера вообще

Если нужна только кнопка запуска игры, бота можно не запускать: в @BotFather →
`/mybots` → бот → Bot Settings → Menu Button укажите адрес игры. Код бота понадобится,
когда появятся приветствие, рекорды, рассылки или платежи.
