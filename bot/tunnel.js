import { spawn } from "node:child_process";

// Запускает бесплатный туннель Cloudflare (без регистрации) и возвращает его https-адрес.
// Адрес случайный и меняется при каждом запуске, бот сам обновляет кнопку игры.
// Если туннель упадёт уже после запуска, вызывается onDown (по умолчанию бот завершается,
// и systemd перезапускает его вместе с новым туннелем: без туннеля игра до сервера не достучится).
// Возвращает { url, stop }; stop() гасит туннель при штатной остановке бота.
export function startTunnel(port, bin = "cloudflared", onDown = defaultOnDown) {
  let up = false;
  let stopping = false;
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("туннель не ответил за 30 секунд")), 30_000);
    const onData = (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !up) {
        up = true;
        clearTimeout(timer);
        resolve({
          url: m[0],
          stop: () => new Promise((done) => {
            stopping = true;
            if (proc.exitCode !== null || proc.signalCode) return done();
            proc.once("exit", () => done());
            proc.kill("SIGTERM");
            setTimeout(() => proc.kill("SIGKILL"), 3000).unref();
          }),
        });
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
      if (up) { if (!stopping) onDown(code); }
      else reject(new Error(`cloudflared завершился с кодом ${code}`));
    });
    process.on("exit", () => { if (proc.exitCode === null) proc.kill(); });
  });
}

function defaultOnDown(code) {
  console.error(`Туннель cloudflared остановился (код ${code}). Перезапускаю бота, чтобы поднять новый туннель.`);
  process.exit(1);
}
