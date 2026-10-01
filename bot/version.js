import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Коммит, из которого запущен бот: из переменной GIT_COMMIT, из файла bot/.commit
// (его может записать автообновлятор сервера) или из git, если папка — клон репозитория.
export function currentCommit(env = process.env) {
  const clean = (s) => (String(s || "").trim().match(/^[0-9a-f]{7,40}$/i) || [""])[0];
  const fromEnv = clean(env.GIT_COMMIT);
  if (fromEnv) return fromEnv;
  try {
    const fromFile = clean(readFileSync(join(here, ".commit"), "utf8"));
    if (fromFile) return fromFile;
  } catch { /* нет файла */ }
  try {
    return clean(execFileSync("git", ["rev-parse", "HEAD"], { cwd: here, stdio: ["ignore", "pipe", "ignore"], timeout: 2000 })) || "unknown";
  } catch {
    return "unknown";
  }
}
