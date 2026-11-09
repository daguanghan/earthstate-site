// EarthState — small progressive enhancements. Every page works without this file.
(function () {
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('site-nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Load an interactive 3D view only when asked, so pages stay light on phones.
  document.querySelectorAll('[data-viewer]').forEach(function (shell) {
    var play = shell.querySelector('.play');
    if (!play) return;
    play.addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.src = shell.getAttribute('data-viewer');
      frame.title = shell.getAttribute('data-title') || 'Interactive 3D view';
      frame.allow = 'fullscreen; xr-spatial-tracking';
      frame.loading = 'eager';
      play.remove();
      shell.appendChild(frame);
    });
  });

  // The mark: a point-cloud earth that turns slowly. Static when reduced motion is preferred.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('svg[data-spin]').forEach(function (svg) {
    if (reduce) return;
    var NS = 'http://www.w3.org/2000/svg', N = 120, GA = Math.PI * (3 - Math.sqrt(5)), tilt = 0.41;
    var base = [];
    for (var i = 0; i < N; i++) {
      var y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), th = GA * i;
      base.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    var mark = [0.31, 0.19, 0.93];                       // the amber point, a fixed place on the sphere
    var dots = [], g = document.createElementNS(NS, 'g');
    for (var k = 0; k < N; k++) { var c = document.createElementNS(NS, 'circle'); c.setAttribute('fill', 'currentColor'); g.appendChild(c); dots.push(c); }
    var am = document.createElementNS(NS, 'circle'); am.setAttribute('fill', '#c2711c'); g.appendChild(am);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.appendChild(g);
    function place(p, a) {
      var x = p[0] * Math.cos(a) + p[2] * Math.sin(a), z = -p[0] * Math.sin(a) + p[2] * Math.cos(a), y = p[1];
      var y2 = y * Math.cos(tilt) - z * Math.sin(tilt), z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      return [32 + 26 * x, 32 - 26 * y2, z2];
    }
    function frame(t) {
      var a = t / 6400;                                   // about 40 s per turn
      for (var k = 0; k < N; k++) {
        var q = place(base[k], a);
        dots[k].setAttribute('cx', q[0].toFixed(2)); dots[k].setAttribute('cy', q[1].toFixed(2));
        dots[k].setAttribute('r', q[2] < -0.05 ? 0 : (0.9 * (1 + 0.9 * q[2])).toFixed(2));
      }
      var m = place(mark, a);
      am.setAttribute('cx', m[0].toFixed(2)); am.setAttribute('cy', m[1].toFixed(2));
      am.setAttribute('r', m[2] < -0.05 ? 0 : (3.6 * (0.55 + 0.45 * m[2])).toFixed(2));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
