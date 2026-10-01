#!/usr/bin/env bash
# Устанавливает бота «Прыг-Скок» на чистый VPS (Ubuntu/Debian, x64 или arm64) как службу systemd.
#
# Если бот уже работает на этом сервере (любая другая служба с этим ботом), скрипт
# откажется ставить второй экземпляр: два бота с одним токеном мешают друг другу.
#
# Запуск: скачайте скрипт, прочитайте его и запустите от root:
#   curl -fsSLo install.sh https://raw.githubusercontent.com/admin2vitaplus/tg-mario/main/bot/deploy/install.sh
#   less install.sh
#   sudo bash install.sh
# Повторный запуск обновляет код этой же установки; токен спрашивается только в первый раз.
#
# Переменные: BRANCH (по умолчанию main), BOT_TOKEN, WEBAPP_URL, CPU_QUOTA (по умолчанию 50%),
#   PUBLIC_API_URL — свой https-адрес сервера (если есть домен); без него ставится
#   бесплатный туннель Cloudflare, и адрес выдаётся автоматически при каждом запуске.
set -euo pipefail

REPO_URL="https://github.com/admin2vitaplus/tg-mario.git"
BRANCH="${BRANCH:-main}"
APP_DIR="/opt/tg-mario"
DATA_DIR="$APP_DIR/data"
SERVICE="prygskok-bot"
APP_USER="prygskok"
PORT="${API_PORT:-8080}"
NODE_MAJOR=22

die() { echo "Ошибка: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите от root (через sudo)."

# ---------- Не ставим второй экземпляр ----------
ours_active=0
systemctl is-active -q "$SERVICE" 2>/dev/null && ours_active=1
for unit in $(systemctl list-units --type=service --all --no-legend --plain 2>/dev/null | awk '{print $1}'); do
  [ "$unit" = "$SERVICE.service" ] && continue
  if systemctl cat "$unit" 2>/dev/null | grep -qiE 'tg-?mario|prygskok|bot/index\.js'; then
    die "похоже, бот уже запущен службой $unit. Второй экземпляр с тем же токеном ставить нельзя."
  fi
done
if [ "$ours_active" -eq 0 ] && command -v ss >/dev/null && ss -ltnH "sport = :$PORT" | grep -q .; then
  die "порт $PORT уже занят другой программой. Остановите её или задайте другой API_PORT."
fi
if [ "$ours_active" -eq 0 ] && pgrep -f 'node .*index\.js' >/dev/null; then
  die "на сервере уже работает какой-то node index.js (возможно, бот, запущенный вручную или через pm2). Остановите его."
fi

apt-get update -qq
apt-get install -y -qq git curl ca-certificates xz-utils iproute2 >/dev/null

case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64; CF_ARCH=amd64 ;;
  arm64) NODE_ARCH=arm64; CF_ARCH=arm64 ;;
  *) die "поддерживаются только amd64 и arm64." ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------- Node.js с проверкой контрольной суммы ----------
node_ok() {
  command -v node >/dev/null && node -e '
    const [a, b] = process.versions.node.split(".").map(Number);
    process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'
}
if ! node_ok; then
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL -o "$TMP/SHASUMS256.txt" "$base/SHASUMS256.txt"
  file="$(grep -oE "node-v[0-9.]+-linux-${NODE_ARCH}\.tar\.xz" "$TMP/SHASUMS256.txt" | head -1)"
  [ -n "$file" ] || die "не нашёл сборку Node.js для linux-${NODE_ARCH}."
  dir="/opt/${file%.tar.xz}"
  if [ ! -x "$dir/bin/node" ]; then
    echo "Устанавливаю ${file%.tar.xz}…"
    curl -fsSL -o "$TMP/$file" "$base/$file"
    (cd "$TMP" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "контрольная сумма Node.js не совпала."
    mkdir -p "$dir.tmp"
    tar -xJf "$TMP/$file" -C "$dir.tmp" --strip-components=1
    mv "$dir.tmp" "$dir"
  fi
  # Каждая версия в своей папке; переключаем только ссылки, чужие файлы не трогаем.
  ln -sfn "$dir" /opt/node-current
  ln -sf /opt/node-current/bin/node /usr/local/bin/node
  ln -sf /opt/node-current/bin/npm /usr/local/bin/npm
  hash -r
fi
node_ok || die "не удалось поставить Node.js 22.13+."
NODE_BIN="$(readlink -f "$(command -v node)")"
echo "Node.js $(node -v)"

# ---------- cloudflared с проверкой контрольной суммы ----------
if [ -z "${PUBLIC_API_URL:-}" ] && ! command -v cloudflared >/dev/null; then
  echo "Устанавливаю cloudflared…"
  asset="cloudflared-linux-${CF_ARCH}.deb"
  curl -fsSL -o "$TMP/release.json" https://api.github.com/repos/cloudflare/cloudflared/releases/latest
  read -r url sum < <(node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const a = r.assets.find((x) => x.name === process.argv[2]);
    if (!a) process.exit(1);
    // Сумма из поля digest, а в старых ответах API — из текста релиза («имя: sha256»).
    let sum = /^sha256:([0-9a-f]{64})$/.exec(a.digest || "");
    sum = sum ? sum[1] : (new RegExp(a.name.replace(/\./g, "\\.") + "\\s*:\\s*([0-9a-f]{64})").exec(r.body || "") || [])[1];
    if (!sum) process.exit(1);
    console.log(a.browser_download_url, sum);' "$TMP/release.json" "$asset") \
    || die "не нашёл $asset с контрольной суммой в последнем релизе cloudflared."
  curl -fsSL -o "$TMP/$asset" "$url"
  echo "$sum  $TMP/$asset" | sha256sum -c --quiet - || die "контрольная сумма cloudflared не совпала."
  dpkg -i "$TMP/$asset" >/dev/null
fi
command -v cloudflared >/dev/null && cloudflared --version

# ---------- Код ----------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_DIR" "$@"; }

if [ -d "$APP_DIR/src/.git" ]; then
  as_app git -C "$APP_DIR/src" fetch -q origin "$BRANCH"
  as_app git -C "$APP_DIR/src" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  as_app git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR/src"
fi

cd "$APP_DIR/src/bot"
# Без root и без скриптов пакетов: зависимостям бота они не нужны.
# Тесты ниже идут от пользователя службы, но вне песочницы systemd: это наш код из репозитория.
as_app env PATH="$(dirname "$NODE_BIN"):$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund
as_app env PATH="$(dirname "$NODE_BIN"):$PATH" npm test >/dev/null || die "тесты бота не прошли, служба не перезапущена."

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  token="${BOT_TOKEN:-}"
  while [ -z "$token" ]; do
    read -r -s -p "Токен бота от @BotFather: " token </dev/tty
    echo
  done
  umask 077
  {
    echo "BOT_TOKEN=$token"
    echo "WEBAPP_URL=${WEBAPP_URL:-https://admin2vitaplus.github.io/tg-mario/}"
    echo "API_PORT=$PORT"
    echo "DB_FILE=$DATA_DIR/scores.db"
  } > "$ENV_FILE"
fi
if [ -n "${PUBLIC_API_URL:-}" ]; then
  sed -i '/^PUBLIC_API_URL=/d' "$ENV_FILE"
  echo "PUBLIC_API_URL=$PUBLIC_API_URL" >> "$ENV_FILE"
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# ---------- Служба ----------
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=Telegram bot Prygskok (scores API, Tanks rooms)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/src/bot
EnvironmentFile=$ENV_FILE
Environment=HOME=$DATA_DIR
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning index.js
Restart=always
RestartSec=5

MemoryMax=300M
CPUQuota=${CPU_QUOTA:-50%}
TasksMax=64
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"
sleep 10
journalctl -u "$SERVICE" -n 12 --no-pager
echo
echo "Готово. Логи: journalctl -u $SERVICE -f   Статус: systemctl status $SERVICE"
echo "База очков: $DATA_DIR/scores.db"
