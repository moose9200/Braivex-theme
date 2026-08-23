/*!
 * Braivex — Contour Face (bx-face.js)
 * A luminous wireframe head drawn from flowing contour lines — the same
 * visual language as the neural hero. Interactive: the head turns toward the
 * pointer, contours brighten and swell near it, a click/tap ripples a wave
 * across the mask. Original parametric construction (no model file).
 *
 *   window.BxFace.boot(root?)   scan for [data-bx-face] hosts
 *   window.BxFace.init(el)      mount one host → { destroy }
 */
(function (w, d) {
  'use strict';
  var THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var reduce = w.matchMedia ? w.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  function isMobile() { return w.matchMedia ? w.matchMedia('(max-width: 767px)').matches : w.innerWidth < 768; }
  function cssVar(el, n, f) { var v = (w.getComputedStyle(el).getPropertyValue(n) || '').trim(); return v || f; }
  function hasGL() {
    try { var c = d.createElement('canvas'); return !!(w.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); }
    catch (e) { return false; }
  }
  function sprite(THREE) {
    var s = 64, c = d.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }

  function init(host) {
    if (!host || host.__bxFace) return host && host.__bxFace;
    var THREE = w.THREE, canvas = host.querySelector('canvas');
    if (!THREE || !canvas || !hasGL()) { host.classList.add('is-nogl'); return null; }

    var mob = isMobile(), animate = !reduce;
    var cNode = new THREE.Color(cssVar(host, '--bx-node', '#00f0ff'));
    var cEdge = new THREE.Color(cssVar(host, '--bx-edge', '#0091ff'));

    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !mob, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { host.classList.add('is-nogl'); return null; }
    renderer.setPixelRatio(Math.min(w.devicePixelRatio || 1, mob ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 1, 1200);
    camera.position.set(0, 0, 372);
    var grp = new THREE.Group();
    scene.add(grp);

    /* --- parametric head: sphere → proportions → facial displacements --- */
    var NU = mob ? 40 : 56, NV = mob ? 30 : 44, N = NU * NV;
    var SZ = 96;
    /* Midline profile control rows — an actual human profile, not bumps on a
       sphere: [y, front depth, nose extra, back depth, half width]. The nose
       term gets a much tighter lateral falloff than the broad profile. */
    var P = [
      [ 1.06, 0.16, 0,    0.16, 0.30],   // crown
      [ 0.94, 0.44, 0,    0.52, 0.52],
      [ 0.76, 0.64, 0,    0.70, 0.68],
      [ 0.55, 0.76, 0,    0.76, 0.76],   // forehead
      [ 0.38, 0.85, 0,    0.76, 0.77],   // brow ridge
      [ 0.27, 0.75, 0.02, 0.75, 0.76],   // glabella notch
      [ 0.12, 0.77, 0.08, 0.73, 0.74],   // nose bridge
      [-0.04, 0.78, 0.19, 0.71, 0.72],
      [-0.15, 0.78, 0.30, 0.69, 0.70],   // nose tip
      [-0.21, 0.74, 0.06, 0.68, 0.68],   // philtrum
      [-0.30, 0.85, 0,    0.66, 0.66],   // upper lip
      [-0.38, 0.76, 0,    0.64, 0.63],   // lip seam
      [-0.46, 0.84, 0,    0.62, 0.60],   // lower lip
      [-0.55, 0.72, 0,    0.60, 0.55],   // chin crease
      [-0.68, 0.84, 0,    0.56, 0.46],   // chin
      [-0.82, 0.62, 0,    0.50, 0.36],   // jawline / under-chin
      [-1.06, 0.34, 0,    0.42, 0.30]    // throat
    ];
    function prof(Y) {
      if (Y >= P[0][0]) return P[0];
      var LAST = P[P.length - 1];
      if (Y <= LAST[0]) return LAST;
      for (var r = 0; r < P.length - 1; r++) {
        var Ar = P[r], Br = P[r + 1];
        if (Y <= Ar[0] && Y >= Br[0]) {
          var fq = (Ar[0] - Y) / (Ar[0] - Br[0] || 1);
          fq = fq * fq * (3 - 2 * fq);
          return [Y, Ar[1] + (Br[1] - Ar[1]) * fq, Ar[2] + (Br[2] - Ar[2]) * fq,
                  Ar[3] + (Br[3] - Ar[3]) * fq, Ar[4] + (Br[4] - Ar[4]) * fq];
        }
      }
      return P[0];
    }
    var base = new Float32Array(N * 3), bright = new Float32Array(N);
    function G(x, s) { return Math.exp(-(x * x) / (2 * s * s)); }
    var u, v, i;
    for (v = 0; v < NV; v++) {
      var fv = v / (NV - 1);
      var Y = 1.06 - fv * 2.12;
      var pr = prof(Y);
      var broad = pr[1], nose = pr[2], backD = pr[3], hw = pr[4];
      var pr2 = prof(Y - 0.05);
      var slope = Math.abs((pr2[1] + pr2[2]) - (broad + nose)) * 5;  // profile curvature catchlight
      for (u = 0; u < NU; u++) {
        var fu = u / (NU - 1);
        var th = (fu - 0.5) * Math.PI * 1.3;
        var c = Math.cos(th), s = Math.sin(th);
        var cf = c > 0 ? c : 0;
        var Fb = Math.pow(cf, 1.7);                    // broad front blend
        var x = hw * s;
        var z = backD * c + (broad - backD) * Fb + nose * Math.pow(cf, 8);
        var socket = (G(x - 0.30, 0.13) + G(x + 0.30, 0.13)) * G(Y - 0.26, 0.11) * Fb;
        var cheek = (G(x - 0.26, 0.14) + G(x + 0.26, 0.14)) * G(Y + 0.14, 0.13) * Fb;
        z += -0.12 * socket + 0.05 * cheek;
        i = v * NU + u;
        base[i * 3] = x * SZ * 0.98;
        base[i * 3 + 1] = Y * SZ * 0.99;
        base[i * 3 + 2] = z * SZ * 0.94;
        var rim = Math.pow(1 - cf, 1.7);
        var b0 = 0.12 + 0.3 * rim + 0.3 * Fb + (slope * 2.6 + nose * 5.5 + 0.9 * cheek) * Fb;
        b0 *= 1 - 0.72 * socket;                        // eye sockets read as dark hollows
        bright[i] = b0 < 0.06 ? 0.06 : b0;
      }
    }

    /* --- geometry: live verts (points) + contour segments (lines) ------- */
    var pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    var pairs = [];
    for (v = 0; v < NV; v++) for (u = 0; u < NU - 1; u++) pairs.push(v * NU + u, v * NU + u + 1);          // flow lines
    for (u = 0; u < NU; u += 4) for (v = 0; v < NV - 1; v++) pairs.push(v * NU + u, (v + 1) * NU + u);     // sparse meridians
    var M = pairs.length / 2;
    var lPos = new Float32Array(M * 6), lCol = new Float32Array(M * 6);

    var ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ptGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var pts = new THREE.Points(ptGeo, new THREE.PointsMaterial({
      map: sprite(THREE), size: SZ * 0.027, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    var lnGeo = new THREE.BufferGeometry();
    lnGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
    lnGeo.setAttribute('color', new THREE.BufferAttribute(lCol, 3));
    var lns = new THREE.LineSegments(lnGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    grp.add(lns); grp.add(pts);

    /* --- state ----------------------------------------------------------- */
    var yaw = -0.14, pitch = 0, raf = 0, last = 0, running = false, inView = true;
    var ptr = { x: 0, y: 0, in: false };
    var waves = [];
    var rayO = new THREE.Vector3(), rayD = new THREE.Vector3(), tmp = new THREE.Vector3(), inv = new THREE.Matrix4();

    function resize() {
      var wd = host.clientWidth || 1, ht = host.clientHeight || 1;
      renderer.setSize(wd, ht, false);
      camera.aspect = wd / ht;
      camera.updateProjectionMatrix();
    }
    resize();
    var lastW = 0, roRaf = 0, ro = null;
    function onRO() {
      if (roRaf) return;
      roRaf = requestAnimationFrame(function () {
        roRaf = 0;
        if (host.clientWidth === lastW) return;
        lastW = host.clientWidth;
        resize();
        if (!animate) frame(0.016, 1);
      });
    }
    if (w.ResizeObserver) { ro = new ResizeObserver(onRO); ro.observe(host); }
    else w.addEventListener('resize', onRO);

    function onMove(e) {
      var r = host.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      ptr.in = true;
    }
    function onLeave() { ptr.in = false; }
    function pointerRay() {
      tmp.set(ptr.x, ptr.y, 0.5).unproject(camera);
      rayO.copy(camera.position);
      rayD.copy(tmp).sub(camera.position).normalize();
      inv.copy(grp.matrixWorld).invert();
      rayO.applyMatrix4(inv);
      rayD.transformDirection(inv);
    }
    function onDown(e) {
      onMove(e);
      if (waves.length >= 3) return;
      pointerRay();
      // wave origin: the vertex nearest the pointer ray
      var best = 0, bd = Infinity;
      for (var k = 0; k < N; k++) {
        var wx = base[k * 3] - rayO.x, wy = base[k * 3 + 1] - rayO.y, wz = base[k * 3 + 2] - rayO.z;
        var pr = wx * rayD.x + wy * rayD.y + wz * rayD.z;
        var qx = wx - rayD.x * pr, qy = wy - rayD.y * pr, qz = wz - rayD.z * pr;
        var dd = qx * qx + qy * qy + qz * qz;
        if (dd < bd) { bd = dd; best = k; }
      }
      waves.push({ cx: base[best * 3], cy: base[best * 3 + 1], cz: base[best * 3 + 2], r: 0 });
    }
    if (animate) {
      host.addEventListener('pointermove', onMove, { passive: true });
      host.addEventListener('pointerleave', onLeave, { passive: true });
      host.addEventListener('pointerdown', onDown, { passive: true });
    }

    function frame(dt, t) {
      // orientation: idle drift + pointer follow
      var yawT = -0.44 + Math.sin(t * 0.19) * 0.1 + (ptr.in ? ptr.x * 0.55 : 0);   // rest at 3/4 profile
      var pitchT = Math.sin(t * 0.26) * 0.03 + (ptr.in ? -ptr.y * 0.22 : 0);
      yaw += (yawT - yaw) * Math.min(1, dt * 3);
      pitch += (pitchT - pitch) * Math.min(1, dt * 3);
      grp.rotation.set(pitch, yaw, 0);
      grp.updateMatrixWorld();

      var Rf = 0;
      if (animate && ptr.in && !mob) { pointerRay(); Rf = SZ * 0.36; }

      var nw = 0, k, wv;
      for (k = 0; k < waves.length; k++) {
        wv = waves[k];
        wv.r += dt * SZ * 2.4;
        if (wv.r < SZ * 2.8) waves[nw++] = wv;
      }
      waves.length = nw;

      var breathe = 1 + 0.011 * Math.sin(t * 0.7);
      var bw = SZ * 0.26;
      for (k = 0; k < N; k++) {
        var o = k * 3;
        var bx = base[o] * breathe, by = base[o + 1] * breathe, bz = base[o + 2] * breathe;
        var il = 1 / (Math.sqrt(bx * bx + by * by + bz * bz) || 1);
        var nx = bx * il, ny = by * il, nz = bz * il;
        var e = 0;
        for (var q = 0; q < nw; q++) {
          wv = waves[q];
          var dx = bx - wv.cx, dy = by - wv.cy, dz2 = bz - wv.cz;
          var dd2 = Math.sqrt(dx * dx + dy * dy + dz2 * dz2);
          var band = 1 - Math.abs(dd2 - wv.r) / bw;
          if (band > 0) {
            var a = band * band * (1 - wv.r / (SZ * 2.8));
            if (a > e) e = a;
            var push = a * SZ * 0.1;
            bx += nx * push; by += ny * push; bz += nz * push;
          }
        }
        if (Rf > 0) {
          var wx2 = bx - rayO.x, wy2 = by - rayO.y, wz2 = bz - rayO.z;
          var pr2 = wx2 * rayD.x + wy2 * rayD.y + wz2 * rayD.z;
          var qx2 = wx2 - rayD.x * pr2, qy2 = wy2 - rayD.y * pr2, qz2 = wz2 - rayD.z * pr2;
          var d2 = qx2 * qx2 + qy2 * qy2 + qz2 * qz2;
          if (d2 < Rf * Rf) {
            var f = 1 - Math.sqrt(d2) / Rf;
            f = f * f * (3 - 2 * f);
            if (f > e) e = f;
            var push2 = f * SZ * 0.05;
            bx += nx * push2; by += ny * push2; bz += nz * push2;
          }
        }
        pos[o] = bx; pos[o + 1] = by; pos[o + 2] = bz;
        var b = bright[k] * (0.75 + e * 2.2);
        col[o] = Math.min(1.6, cNode.r * b + e * 0.5);
        col[o + 1] = Math.min(1.6, cNode.g * b + e * 0.5);
        col[o + 2] = Math.min(1.6, cNode.b * b + e * 0.5);
      }
      ptGeo.attributes.position.needsUpdate = true;
      ptGeo.attributes.color.needsUpdate = true;

      for (k = 0; k < M; k++) {
        var a3 = pairs[k * 2] * 3, b3 = pairs[k * 2 + 1] * 3, o6 = k * 6;
        lPos[o6] = pos[a3]; lPos[o6 + 1] = pos[a3 + 1]; lPos[o6 + 2] = pos[a3 + 2];
        lPos[o6 + 3] = pos[b3]; lPos[o6 + 4] = pos[b3 + 1]; lPos[o6 + 5] = pos[b3 + 2];
        lCol[o6] = col[a3] * 0.62; lCol[o6 + 1] = col[a3 + 1] * 0.62; lCol[o6 + 2] = col[a3 + 2] * 0.62;
        lCol[o6 + 3] = col[b3] * 0.62; lCol[o6 + 4] = col[b3 + 1] * 0.62; lCol[o6 + 5] = col[b3 + 2] * 0.62;
      }
      lnGeo.attributes.position.needsUpdate = true;
      lnGeo.attributes.color.needsUpdate = true;

      renderer.render(scene, camera);
    }

    function step(now) {
      raf = requestAnimationFrame(step);
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      frame(dt, now / 1000);
    }
    function start() { if (running || !animate) return; running = true; last = 0; raf = requestAnimationFrame(step); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    var io = null;
    if (w.IntersectionObserver) {
      io = new IntersectionObserver(function (en) {
        inView = en[0].isIntersecting;
        if (inView && !d.hidden) start(); else stop();
      }, { threshold: 0 });
      io.observe(host);
    }
    function onVis() { if (!d.hidden && inView) start(); else stop(); }
    d.addEventListener('visibilitychange', onVis);

    if (animate) start(); else frame(0.016, 1);   // reduced motion: one static frame

    var api = {
      destroy: function () {
        stop();
        d.removeEventListener('visibilitychange', onVis);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
        host.removeEventListener('pointerdown', onDown);
        if (io) io.disconnect();
        if (ro) ro.disconnect(); else w.removeEventListener('resize', onRO);
        if (roRaf) cancelAnimationFrame(roRaf);
        ptGeo.dispose(); lnGeo.dispose();
        if (pts.material.map) pts.material.map.dispose();
        pts.material.dispose(); lns.material.dispose();
        renderer.dispose();
        host.__bxFace = null;
      }
    };
    host.__bxFace = api;
    return api;
  }

  function bootAll(root) {
    var hosts = (root || d).querySelectorAll('[data-bx-face]');
    for (var i = 0; i < hosts.length; i++) init(hosts[i]);
  }
  function boot(root) {
    if (w.THREE) return bootAll(root);
    var waited = 0;
    var timer = setInterval(function () {
      waited += 100;
      if (w.THREE) { clearInterval(timer); bootAll(root); return; }
      if (waited >= 1500) {
        clearInterval(timer);
        var s = d.createElement('script');
        s.src = THREE_SRC;
        s.onload = function () { bootAll(root); };
        s.onerror = function () { bootAll(root); };
        d.head.appendChild(s);
      }
    }, 100);
  }
  w.BxFace = { boot: boot, init: init };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { boot(); });
  else boot();

  d.addEventListener('shopify:section:load', function (e) {
    if (e.target && e.target.querySelector) bootAll(e.target);
  });
  d.addEventListener('shopify:section:unload', function (e) {
    var hosts = e.target && e.target.querySelectorAll ? e.target.querySelectorAll('[data-bx-face]') : [];
    for (var i = 0; i < hosts.length; i++) if (hosts[i].__bxFace) hosts[i].__bxFace.destroy();
  });
})(window, document);
