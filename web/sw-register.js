// Registers the offline cache (sw.js) for the whole collection. Works from any
// page and any host: the worker's address is taken relative to this script.
(() => {
'use strict';
if (!('serviceWorker' in navigator)) return;
const me = document.currentScript && document.currentScript.src;
if (!me) return;
// While developing on this machine a cache only gets in the way; ?sw=1 turns it on.
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
if (local && !/[?&]sw=1/.test(location.search)) return;
const url = new URL('sw.js', me);
window.addEventListener('load', () => {
  navigator.serviceWorker.register(url.href, { scope: new URL('./', url).href }).catch(() => {});
});
})();
