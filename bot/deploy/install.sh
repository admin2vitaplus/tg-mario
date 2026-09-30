#!/usr/bin/env bash
# Устанавливает бота «Прыг-Скок» на VPS (Ubuntu/Debian) как службу systemd.
# Запуск от root:
#   curl -fsSL https://raw.githubusercontent.com/admin2vitaplus/tg-mario/main/bot/deploy/install.sh | sudo bash
# Повторный запуск обновляет код и перезапускает бота; токен спрашивается только в первый раз.
# Переменные: BRANCH (ветка, по умолчанию main), BOT_TOKEN, WEBAPP_URL,
#   PUBLIC_API_URL — свой https-адрес сервера (если есть домен); без него ставится
#   бесплатный туннель Cloudflare и адрес выдаётся автоматически.
set -euo pipefail

REPO_URL="https://github.com/admin2vitaplus/tg-mario.git"
BRANCH="${BRANCH:-main}"
APP_DIR="/opt/tg-mario"
SERVICE="prygskok-bot"
APP_USER="prygskok"

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите от root (через sudo)." >&2
  exit 1
fi

apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null

node_ok() {
  command -v node >/dev/null && node -e '
    const [a, b] = process.versions.node.split(".").map(Number);
    process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'
}
if ! node_ok; then
  echo "Устанавливаю Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node.js $(node -v)"

# Туннель Cloudflare даёт серверу очков и сетевой игре https-адрес без домена.
if [ -z "${PUBLIC_API_URL:-}" ] && ! command -v cloudflared >/dev/null; then
  echo "Устанавливаю cloudflared…"
  arch="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
  dpkg -i /tmp/cloudflared.deb >/dev/null
  rm -f /tmp/cloudflared.deb
fi
command -v cloudflared >/dev/null && echo "$(cloudflared --version)"

id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

if [ -d "$APP_DIR/.git" ]; then
  git -c safe.directory="$APP_DIR" -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -c safe.directory="$APP_DIR" -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR/bot"
npm ci --omit=dev --no-audit --no-fund

if [ ! -f .env ]; then
  token="${BOT_TOKEN:-}"
  while [ -z "$token" ]; do
    read -r -p "Токен бота от @BotFather: " token </dev/tty
  done
  {
    echo "BOT_TOKEN=$token"
    echo "WEBAPP_URL=${WEBAPP_URL:-https://admin2vitaplus.github.io/tg-mario/}"
  } > .env
fi
if [ -n "${PUBLIC_API_URL:-}" ]; then
  sed -i '/^PUBLIC_API_URL=/d' .env
  echo "PUBLIC_API_URL=$PUBLIC_API_URL" >> .env
fi
chmod 600 .env
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=Telegram bot Prygskok
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/bot
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning --env-file=.env index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"
sleep 8
journalctl -u "$SERVICE" -n 12 --no-pager
echo
echo "Готово. Логи: journalctl -u $SERVICE -f   Статус: systemctl status $SERVICE"
