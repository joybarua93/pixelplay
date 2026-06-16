// Redirect ← PixelPlay buttons to app.html when running inside Capacitor
(function() {
  function fixHomeLinks() {
    var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (!isCapacitor) return;
    document.querySelectorAll('a[href="../index.html"], a[href*="index.html"]').forEach(function(el) {
      el.href = el.href.replace('index.html', 'app.html');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixHomeLinks);
  } else {
    fixHomeLinks();
  }
})();
