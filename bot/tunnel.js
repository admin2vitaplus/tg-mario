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

// ---------- Туннель отдельной службой (TUNNEL_METRICS) ----------
// cloudflared запущен своей службой systemd с --metrics 127.0.0.1:<порт>, поэтому перезапуск
// и автообновление бота адрес не меняют. Бот берёт адрес из http://<метрики>/quicktunnel
// ({"hostname":"…trycloudflare.com"}) и раз в минуту сверяет его. Если служба туннеля
// перезапустилась и адрес сменился, вызывается onChange (по умолчанию бот завершается,
// systemd поднимает его снова, и кнопка игры получает новый адрес).
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export async function readTunnelUrl(metrics, fetchFn = fetch) {
  const base = /^https?:\/\//.test(metrics) ? metrics : `http://${metrics}`;
  const res = await fetchFn(new URL("/quicktunnel", base), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`метрики cloudflared ответили ${res.status}`);
  const { hostname } = await res.json();
  if (typeof hostname !== "string" || !HOSTNAME.test(hostname)) throw new Error("cloudflared ещё не получил адрес");
  return `https://${hostname}`;
}

export function watchTunnel(metrics, {
  fetchFn = fetch, intervalMs = 60_000, retryMs = 2000, waitMs = 60_000, onChange = defaultOnChange,
} = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + waitMs;
    let timer = null;
    const first = async () => {
      try {
        const url = await readTunnelUrl(metrics, fetchFn);
        let failing = false;
        const check = async () => {
          try {
            const now = await readTunnelUrl(metrics, fetchFn);
            if (failing) console.log("Служба туннеля снова отвечает.");
            failing = false;
            if (now !== url) { clearInterval(timer); onChange(now, url); }
          } catch (err) {
            // Служба туннеля перезапускается: ждём, сменился ли адрес, когда она вернётся.
            if (!failing) console.warn(`Служба туннеля не отвечает: ${err.message}`);
            failing = true;
          }
        };
        timer = setInterval(check, intervalMs);
        timer.unref();
        resolve({ url, stop: async () => clearInterval(timer) });
      } catch (err) {
        if (Date.now() + retryMs > deadline) {
          reject(new Error(`нет адреса от службы туннеля (${metrics}): ${err.message}`));
        } else {
          setTimeout(first, retryMs).unref();
        }
      }
    };
    first();
  });
}

function defaultOnChange(now, was) {
  console.error(`Адрес туннеля сменился (${was} → ${now}). Перезапускаю бота, чтобы обновить кнопку игры.`);
  process.exit(1);
}
