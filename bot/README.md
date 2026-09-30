# Бот «Прыг-Скок»

Небольшой бот на Node.js + [grammY](https://grammy.dev). Он отвечает на `/start` кнопкой «Играть»,
которая открывает игру как Telegram Mini App, и ставит такую же кнопку в меню чата.

## Настройка

1. Node.js 20.12 или новее.
2. `cp .env.example .env` и впишите в `.env` токен от @BotFather (`BOT_TOKEN`).
   `WEBAPP_URL` — адрес игры, по умолчанию `https://admin2vitaplus.github.io/sklad/`.
3. `npm install`
4. `npm start`

Файл `.env` в git не попадает. Никогда не публикуйте токен; если он где-то засветился,
получите новый в @BotFather командой `/revoke`.

## Где держать бота круглосуточно

Бот работает через long polling, поэтому ему не нужен домен и https, только постоянно запущенный процесс.

- **Любой VPS** (самый простой и надёжный вариант, от ~200 ₽/мес):
  ```sh
  git clone https://github.com/admin2vitaplus/sklad && cd sklad/bot
  npm install && cp .env.example .env && nano .env
  npx pm2 start index.js --name prygskok --node-args="--env-file=.env"
  npx pm2 save
  ```
- **Railway / Render / Fly.io**: корень сервиса — папка `bot`, команда запуска `npm start`,
  переменные `BOT_TOKEN` и `WEBAPP_URL` задаются в настройках сервиса (не в файлах).
  На Render нужен тип сервиса Background Worker.

## Без сервера вообще

Если нужна только кнопка запуска игры, бота можно не запускать: в @BotFather →
`/mybots` → бот → Bot Settings → Menu Button укажите адрес игры. Код бота понадобится,
когда появятся приветствие, рекорды, рассылки или платежи.
