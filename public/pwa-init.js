// Vesk PWA — service-worker registration (external, CSP-safe)
(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }
})();
