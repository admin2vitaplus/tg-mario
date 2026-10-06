// Собирает списки допустимых попыток «Слова дня» (word/ru-allowed.txt, word/en-allowed.txt)
// из словарей Hunspell: все слова и их формы из 5 букв в нижнем регистре, ё → е.
// Сервер этот скрипт не запускает; он нужен, только чтобы пересобрать списки.
//
//   npm pack dictionary-ru@3.0.0 dictionary-en@4.0.0   (в любой временной папке)
//   tar xzf dictionary-ru-3.0.0.tgz -C ru && tar xzf dictionary-en-4.0.0.tgz -C en
//   node scripts/word-dict.mjs <папка>/ru/package <папка>/en/package
//
// Слова дня (word/*-answers.txt) — своя подборка проекта, их этот скрипт не трогает.
import fs from "node:fs";

// Простое раскрытие правил SFX/PFX: каждое правило применяется к основе по одному разу.
function expand(dir, re, norm = (s) => s) {
  const rules = {};
  for (const l of fs.readFileSync(`${dir}/index.aff`, "utf8").split("\n")) {
    const p = l.trim().split(/\s+/);
    if ((p[0] === "SFX" || p[0] === "PFX") && p.length >= 5) {
      const [type, flag, strip, add, cond] = p;
      const c = cond === "." ? "" : cond;
      (rules[flag] ||= []).push({
        type, strip: strip === "0" ? "" : strip, add: (add === "0" ? "" : add).split("/")[0],
        cond: new RegExp(type === "SFX" ? `${c}$` : `^${c}`),
      });
    }
  }
  const out = new Set();
  const put = (w) => { w = norm(w); if (re.test(w)) out.add(w); };
  for (const line of fs.readFileSync(`${dir}/index.dic`, "utf8").split("\n").slice(1)) {
    const [w, f = ""] = line.trim().split("/");
    if (!w || w !== w.toLowerCase()) continue; // имена собственные и сокращения не берём
    put(w);
    for (const flag of f) {
      for (const r of rules[flag] || []) {
        if (!r.cond.test(w)) continue;
        if (r.type === "SFX") { if (w.endsWith(r.strip)) put(w.slice(0, w.length - r.strip.length) + r.add); }
        else if (w.startsWith(r.strip)) put(r.add + w.slice(r.strip.length));
      }
    }
  }
  return [...out].sort();
}

const [ruDir, enDir] = process.argv.slice(2);
if (!ruDir || !enDir) {
  console.error("Использование: node scripts/word-dict.mjs <dictionary-ru>/package <dictionary-en>/package");
  process.exit(1);
}
const roman = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
const ru = expand(ruDir, /^[а-я]{5}$/, (s) => s.replace(/ё/g, "е"));
const en = expand(enDir, /^[a-z]{5}$/).filter((w) => !roman.test(w));
const out = new URL("../word/", import.meta.url);
fs.writeFileSync(new URL("ru-allowed.txt", out), [
  "# Допустимые слова из 5 букв (русский). ИЗМЕНЁННАЯ ВЕРСИЯ словаря ru_RU для Hunspell",
  "# (c) 1997-2008 Alexander I. Lebedev, лицензия BSD-3-Clause, текст в LICENSE-ru.txt.",
  "# Изменения: оставлены только слова и формы из 5 букв в нижнем регистре, ё заменена на е",
  "# (bot/scripts/word-dict.mjs, пакет npm dictionary-ru 3.0.0).",
  ...ru, ""].join("\n"));
fs.writeFileSync(new URL("en-allowed.txt", out), [
  "# Allowed 5-letter words (English), derived from the en_US Hunspell dictionary based on SCOWL",
  "# (npm package dictionary-en 4.0.0); its copyright and license are in LICENSE-en.txt.",
  "# Changes: only lowercase words and forms of 5 letters are kept (bot/scripts/word-dict.mjs).",
  ...en, ""].join("\n"));
console.log(`ru: ${ru.length}, en: ${en.length}`);
