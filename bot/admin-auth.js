import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

// Вход в панель владельца по логину и паролю. Пароль нигде не хранится: в .env лежит только
// ADMIN_PASSWORD_HASH (scrypt с солью), его печатает `npm run admin:password`.
// После входа страница получает случайный ключ сессии и шлёт его в заголовке Authorization;
// сессии живут в памяти и пропадают при перезапуске бота — тогда нужно войти заново.

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;
export const SESSION_TTL_MS = 12 * 3600 * 1000;
const MAX_SESSIONS = 20;
// Защита от перебора: с одного адреса не больше IP_FAILS неудач за окно, со всех — GLOBAL_FAILS.
export const LOGIN_LIMITS = { ipFails: 5, globalFails: 30, windowMs: 15 * 60 * 1000 };

export function hashPassword(password, salt = randomBytes(16)) {
  const key = scryptSync(String(password).normalize("NFC"), salt, KEY_LEN, SCRYPT);
  return `scrypt:${salt.toString("base64")}:${key.toString("base64")}`;
}

export function checkPassword(password, stored) {
  const m = /^scrypt:([A-Za-z0-9+/=]{16,}):([A-Za-z0-9+/=]{40,})$/.exec(String(stored || "").trim());
  if (!m) return false;
  const want = Buffer.from(m[2], "base64");
  const got = scryptSync(String(password).normalize("NFC"), Buffer.from(m[1], "base64"), want.length, SCRYPT);
  return timingSafeEqual(got, want);
}

const digest = (s) => createHash("sha256").update(String(s)).digest();

// login и passwordHash из .env; без любого из них вход выключен (enabled = false).
export function createAdminAuth({ login, passwordHash, now = Date.now, limits = LOGIN_LIMITS } = {}) {
  const enabled = !!(login && passwordHash && /^scrypt:/.test(passwordHash));
  const sessions = new Map(); // ключ -> истекает
  const fails = new Map(); // адрес -> [время неудачи…]
  let globalFails = [];

  const fresh = (list, t) => list.filter((at) => t - at < limits.windowMs);
  const sweep = (t) => {
    for (const [k, until] of sessions) if (until <= t) sessions.delete(k);
    for (const [ip, list] of fails) { const f = fresh(list, t); if (f.length) fails.set(ip, f); else fails.delete(ip); }
    globalFails = fresh(globalFails, t);
  };

  return {
    enabled,
    // { ok, token, expiresAt } или { ok: false, error: "locked" | "wrong" | "disabled", retryAfter? }.
    login(ip, user, password) {
      if (!enabled) return { ok: false, error: "disabled" };
      const t = now();
      sweep(t);
      const mine = fails.get(ip) || [];
      if (mine.length >= limits.ipFails || globalFails.length >= limits.globalFails) {
        const first = Math.min(...(mine.length >= limits.ipFails ? mine : globalFails));
        return { ok: false, error: "locked", retryAfter: Math.ceil((first + limits.windowMs - t) / 1000) };
      }
      // Пароль проверяется всегда, даже при неверном логине: по времени ответа логин не угадать.
      const passOk = typeof password === "string" && password.length <= 200 && checkPassword(password, passwordHash);
      const userOk = typeof user === "string" && timingSafeEqual(digest(user.trim()), digest(login));
      if (!passOk || !userOk) {
        fails.set(ip, [...mine, t]);
        globalFails.push(t);
        return { ok: false, error: "wrong" };
      }
      fails.delete(ip);
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, t + SESSION_TTL_MS);
      return { ok: true, token, expiresAt: t + SESSION_TTL_MS };
    },
    // Ключ из заголовка «Authorization: Admin <ключ>» действителен?
    check(header) {
      if (!enabled) return false;
      const m = /^Admin ([A-Za-z0-9_-]{43})$/.exec(String(header || ""));
      if (!m) return false;
      const until = sessions.get(m[1]);
      if (!until) return false;
      if (until <= now()) { sessions.delete(m[1]); return false; }
      return true;
    },
    logout(header) {
      const m = /^Admin ([A-Za-z0-9_-]{43})$/.exec(String(header || ""));
      if (m) sessions.delete(m[1]);
    },
  };
}
