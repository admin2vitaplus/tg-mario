import { spawn } from "node:child_process";

// Запускает бесплатный туннель Cloudflare (без регистрации) и возвращает его https-адрес.
// Адрес случайный и меняется при каждом запуске, бот сам обновляет кнопку игры.
export function startTunnel(port, bin = "cloudflared") {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("туннель не ответил за 30 секунд")), 30_000);
    const onData = (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new Error("не найдена программа cloudflared") : err);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      console.error(`Туннель cloudflared остановился (код ${code}), игра не сможет сохранять очки.`);
      reject(new Error(`cloudflared завершился с кодом ${code}`));
    });
    process.on("exit", () => proc.kill());
  });
}
