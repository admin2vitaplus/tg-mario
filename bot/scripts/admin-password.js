import { hashPassword } from "../admin-auth.js";

// Хэш пароля для входа в панель владельца: npm run admin:password
// Печатает строку ADMIN_PASSWORD_HASH=… для .env. Сам пароль никуда не записывается.
// Пароль вводится без отображения на экране; можно и передать через stdin: echo -n 'пароль' | npm run -s admin:password

async function readPassword() {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += chunk;
    return data.replace(/\r?\n$/, "");
  }
  stderr.write("Пароль для панели (не отображается): ");
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  let pw = "";
  return new Promise((ok) => {
    stdin.on("data", (s) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") { stdin.setRawMode(false); stdin.pause(); stderr.write("\n"); return ok(pw); }
        if (ch === "\u0003") { stderr.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") pw = pw.slice(0, -1);
        else pw += ch;
      }
    });
  });
}

const password = await readPassword();
if (password.length < 10) {
  console.error("Пароль слишком короткий: нужно хотя бы 10 символов.");
  process.exit(2);
}
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
