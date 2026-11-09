// The install command points at the domain this page is served from, so it
// stays right on a Vercel preview URL and on the final domain alike.
(function () {
  var origin = /^https?:$/.test(location.protocol) ? location.origin : 'https://orbi.example';
  var command = 'irm ' + origin + '/install.ps1 | iex';

  var text = document.getElementById('cmd-text');
  var button = document.getElementById('copy');
  var label = document.getElementById('copy-label');
  text.textContent = command;

  function fallbackCopy() {
    var area = document.createElement('textarea');
    area.value = command;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  var timer;
  button.addEventListener('click', function () {
    var copy = navigator.clipboard && window.isSecureContext
      ? navigator.clipboard.writeText(command).catch(fallbackCopy)
      : fallbackCopy();
    copy.then(function () {
      button.classList.add('is-copied');
      label.textContent = 'Copiado!';
    }, function () {
      // Last resort: select the command so the visitor can copy it by hand.
      var range = document.createRange();
      range.selectNodeContents(text);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      label.textContent = 'Use Ctrl+C';
    });
    clearTimeout(timer);
    timer = setTimeout(function () {
      button.classList.remove('is-copied');
      label.textContent = 'Copiar comando';
    }, 2000);
  });

  // Demos play only while on screen, and never on their own with reduced motion.
  var videos = document.querySelectorAll('.demos video');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    videos.forEach(function (v) { v.controls = true; v.preload = 'metadata'; });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var v = entry.target;
      if (entry.isIntersecting) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { v.controls = true; });
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.35 });
  videos.forEach(function (v) { io.observe(v); });
})();
