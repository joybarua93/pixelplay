(function() {
  var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!isCapacitor) return;

  function fixHomeLinks() {
    document.querySelectorAll('a').forEach(function(el) {
      if (el.href && el.href.indexOf('index.html') !== -1) {
        el.href = el.href.replace('index.html', 'app.html');
      }
    });
  }

  // Run on load
  fixHomeLinks();
  document.addEventListener('DOMContentLoaded', fixHomeLinks);

  // Watch for dynamically shown elements (LittleJS menus, pp-back becoming visible)
  if (window.MutationObserver) {
    var obs = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          var el = m.target;
          if (el.tagName === 'A' && el.href && el.href.indexOf('index.html') !== -1) {
            el.href = el.href.replace('index.html', 'app.html');
          }
        }
        if (m.type === 'childList') fixHomeLinks();
      });
    });
    document.addEventListener('DOMContentLoaded', function() {
      obs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'href']
      });
    });
  }

  // Also intercept window.location.href assignments directly
  var origDescriptor = Object.getOwnPropertyDescriptor(window.location.__proto__, 'href') ||
                       Object.getOwnPropertyDescriptor(window.location, 'href');
  if (origDescriptor && origDescriptor.set) {
    var origSet = origDescriptor.set;
    Object.defineProperty(window.location, 'href', {
      set: function(val) {
        if (typeof val === 'string') val = val.replace(/index\.html/, 'app.html');
        origSet.call(window.location, val);
      },
      get: origDescriptor.get,
      configurable: true
    });
  }
})();
