import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SEC = 24 * 60 * 60;

// Проверяет строку initData, которую Telegram отдаёт Mini App.
// Подпись делается токеном бота, поэтому подделать игрока без токена нельзя.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, botToken, nowMs = Date.now()) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  // Старше суток — отказ; «из будущего» больше чем на 5 минут — тоже (часы клиента тут ни при чём,
  // дату ставит Telegram).
  const age = nowMs / 1000 - authDate;
  if (!authDate || age > MAX_AGE_SEC || age < -300) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !Number.isSafeInteger(user.id)) return null;
    return user;
  } catch {
    return null;
  }
}
