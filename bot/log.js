// Логи без секретов: токен бота, подписи Telegram (initData) и заголовки авторизации
// вырезаются из всего, что пишется через console, даже из текста ошибок библиотек.

const secrets = new Set();

export function addSecret(value) {
  if (value && String(value).length >= 8) secrets.add(String(value));
}

export function redact(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join("***");
  return out
    .replace(/tma\s+[^\s"']+/gi, "tma ***")
    .replace(/(^|[?&#\s"'])(tgWebAppData|initData)=[^\s"'&#]+/gi, "$1$2=***")
    .replace(/(^|[?&\s"'])(hash|signature)=[0-9a-f]{32,}/gi, "$1$2=***")
    .replace(/(^|[?&\s"'])user=%7B[^\s"'&]*/gi, "$1user=***")
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/g, "/bot***");
}

const fmt = (a) => {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === "object" && a !== null) {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
};

let installed = false;
export function installSafeConsole() {
  if (installed) return;
  installed = true;
  for (const level of ["log", "info", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => orig(redact(args.map(fmt).join(" ")));
  }
}
