/*!
 * Braivex — Neural Hero engine
 * three.js r128, no build step. Reads its config from data-* attributes and
 * CSS custom properties on the host element so Shopify settings drive it.
 *
 *   window.BxNeuralHero.boot()        scan the document for hosts
 *   window.BxNeuralHero.init(el)      mount one host, returns { destroy }
 */
(function (w, d) {
  'use strict';

  var THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var mounted = [];

  var reduceMotion = w.matchMedia ? w.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  function isMobile() {
    return w.matchMedia ? w.matchMedia('(max-width: 767px)').matches : w.innerWidth < 768;
  }

  /* ---------- small helpers ------------------------------------------- */
  function cssVar(el, name, fallback) {
    var v = (w.getComputedStyle(el).getPropertyValue(name) || '').trim();
    return v || fallback;
  }
  function attrNum(el, name, fallback) {
    var v = parseFloat(el.getAttribute(name));
    return isFinite(v) ? v : fallback;
  }
  function attrBool(el, name, fallback) {
    var v = el.getAttribute(name);
    if (v === null || v === '') return fallback;
    return !(v === 'false' || v === '0' || v === 'off');
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  // Seeded RNG — the silhouette is identical on every load.
  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hasWebGL() {
    try {
      var c = d.createElement('canvas');
      return !!(w.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  /* ---------- point sprites (white; hue comes from vertex colours) ----- */
  function makeSprite(THREE, tight) {
    var s = 64, c = d.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    if (tight) {
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.24, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.52, 'rgba(255,255,255,0.16)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      grd.addColorStop(0, 'rgba(255,255,255,0.72)');
      grd.addColorStop(0.32, 'rgba(255,255,255,0.28)');
      grd.addColorStop(0.66, 'rgba(255,255,255,0.07)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }

  /* ---------- 1. node cloud: two hemispheres + medial fissure ---------- */
  function buildBrain(n, S, rnd) {
    var base = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var px, py, pz, len;
      do {
        px = rnd() * 2 - 1; py = rnd() * 2 - 1; pz = rnd() * 2 - 1;
        len = Math.sqrt(px * px + py * py + pz * pz);
      } while (len > 1 || len < 1e-4);

      // Shell-weighted radius — mass sits toward the cortex, so the cloud
      // reads as a silhouette rather than a solid blob.
      var r = 0.66 + 0.34 * Math.cbrt(rnd());
      var ux = (px / len) * r, uy = (py / len) * r, uz = (pz / len) * r;

      // Fold across the medial plane: two lobes with a flat inner face.
      var side = rnd() < 0.5 ? -1 : 1;
      var x = side * (0.085 + Math.abs(ux) * 0.68);
      var y = uy * 0.56;
      var z = uz * 0.62;

      if (y < -0.30) y = -0.30 + (y + 0.30) * 0.55;          // flatter underside
      var taper = 1 - 0.16 * Math.max(0, z / 0.62);           // narrower frontal pole
      x *= taper; y *= taper;
      var fold = 1 + 0.045 * Math.sin(y * 26) * Math.cos(z * 18); // faint sulci

      base[i * 3] = x * S * fold;
      base[i * 3 + 1] = y * S * fold + S * 0.02;
      base[i * 3 + 2] = z * S * fold;
    }
    return base;
  }

  /* ---------- 2. edges: grid-hashed, nearest-first, degree-capped ------ */
  function buildEdges(base, n, radius, maxEdges, maxDeg) {
    var grid = Object.create(null), inv = 1 / radius, i, j, k;
    for (i = 0; i < n; i++) {
      var key = Math.floor(base[i * 3] * inv) + ',' + Math.floor(base[i * 3 + 1] * inv) + ',' + Math.floor(base[i * 3 + 2] * inv);
      (grid[key] || (grid[key] = [])).push(i);
    }
    var deg = new Uint8Array(n), pairs = [], r2 = radius * radius, cand = [];
    for (i = 0; i < n; i++) {
      if (deg[i] >= maxDeg) continue;
      var ax = base[i * 3], ay = base[i * 3 + 1], az = base[i * 3 + 2];
      var cx = Math.floor(ax * inv), cy = Math.floor(ay * inv), cz = Math.floor(az * inv);
      cand.length = 0;
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          for (var dz = -1; dz <= 1; dz++) {
            var bucket = grid[(cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)];
            if (!bucket) continue;
            for (k = 0; k < bucket.length; k++) {
              j = bucket[k];
              if (j <= i || deg[j] >= maxDeg) continue;
              var ex = base[j * 3] - ax, ey = base[j * 3 + 1] - ay, ez = base[j * 3 + 2] - az;
              var dd = ex * ex + ey * ey + ez * ez;
              if (dd < r2) cand.push([dd, j]);
            }
          }
        }
      }
      cand.sort(function (a, b) { return a[0] - b[0]; });
      for (k = 0; k < cand.length; k++) {
        if (deg[i] >= maxDeg || pairs.length / 2 >= maxEdges) break;
        j = cand[k][1];
        if (deg[j] >= maxDeg) continue;
        pairs.push(i, j); deg[i]++; deg[j]++;
      }
      if (pairs.length / 2 >= maxEdges) break;
    }
    return new Int32Array(pairs);
  }

  /* ---------- 3. adjacency (CSR) for pulse path-walking ---------------- */
  function buildAdjacency(pairs, n) {
    var m = pairs.length / 2, counts = new Uint16Array(n), i;
    for (i = 0; i < m; i++) { counts[pairs[i * 2]]++; counts[pairs[i * 2 + 1]]++; }
    var off = new Uint32Array(n + 1);
    for (i = 0; i < n; i++) off[i + 1] = off[i] + counts[i];
    var nb = new Int32Array(off[n]), cur = new Uint32Array(n);
    for (i = 0; i < n; i++) cur[i] = off[i];
    for (i = 0; i < m; i++) {
      var a = pairs[i * 2], b = pairs[i * 2 + 1];
      nb[cur[a]++] = b; nb[cur[b]++] = a;
    }
    return { off: off, nb: nb };
  }

  /* ==================================================================== */
  function init(host) {
    if (!host || host.__bxHero) return host && host.__bxHero;

    var canvas = host.querySelector('.bx-hero__canvas');
    var statsEl = host.querySelector('.bx-hero__stats');
    var THREE = w.THREE;

    // Graceful fallback: CSS gradient + copy, no errors.
    if (!THREE || !canvas || !hasWebGL()) {
      host.classList.add('is-nogl');
      reveal(host);
      return null;
    }

    var mob = isMobile();
    var animate = attrBool(host, 'data-bx-animate', true) && !reduceMotion;
    var morphOn = attrBool(host, 'data-bx-morph', true) && !reduceMotion;
    var pulsesOn = animate && !mob;          // ambient pulses: desktop only
    var repelOn = animate;                   // pointer + touch drag: both platforms
    var burstOn = animate;                   // click / tap shockwave: both platforms

    var NODES = clamp(Math.round(attrNum(host, 'data-bx-nodes', 1800)), 200, 4000);
    if (mob) NODES = Math.min(NODES, 600);                 // mobile budget
    var MAX_EDGES = 4000;
    var MAX_DEG = 5;
    var MAX_PULSES = 12;
    var MAX_WAVES = mob ? 2 : 3;            // concurrent click shockwaves
    var MAX_TAP_PULSES = mob ? 4 : MAX_PULSES;
    var S = 195;                                            // cloud scale (world units)

    var cBg = new THREE.Color(cssVar(host, '--bx-bg', '#06080b'));
    var cNode = new THREE.Color(cssVar(host, '--bx-node', '#00f0ff'));
    var cEdge = new THREE.Color(cssVar(host, '--bx-edge', '#00a8ff'));
    var cPulse = new THREE.Color(cssVar(host, '--bx-pulse', '#a8f6ff'));
    var cMascot = new THREE.Color(cssVar(host, '--bx-mascot', '#ff3ec9'));   // neon magenta rim

    /* --- renderer / scene ------------------------------------------- */
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !mob, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      host.classList.add('is-nogl');
      reveal(host);
      return null;
    }
    renderer.setPixelRatio(Math.min(w.devicePixelRatio || 1, mob ? 1.5 : 2));
    renderer.setClearColor(cBg, 1);

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(cBg.getHex(), 0.0016);    // far nodes sink into the background

    var camera = new THREE.PerspectiveCamera(42, 1, 1, 2000);
    camera.position.set(0, 0, 360);

    var group = new THREE.Group();
    scene.add(group);

    /* --- geometry --------------------------------------------------- */
    var rnd = mulberry32(0x8ea1);
    var base = buildBrain(NODES, S, rnd);
    var pos = new Float32Array(base);                        // live positions
    var bright = new Float32Array(NODES * 3);                // vertex brightness
    var drift = new Float32Array(NODES * 4);                 // 3 phases + amp
    var lattice = new Float32Array(NODES * 3);               // scroll-morph target
    var i, j;

    var LAT = S * 0.13;                                      // lattice pitch
    for (i = 0; i < NODES; i++) {
      drift[i * 4] = rnd() * 6.283;
      drift[i * 4 + 1] = rnd() * 6.283;
      drift[i * 4 + 2] = rnd() * 6.283;
      drift[i * 4 + 3] = (1.2 + rnd() * 2.6) * (S / 132);    // amplitude (world units)
      for (j = 0; j < 3; j++) {
        lattice[i * 3 + j] = Math.round((base[i * 3 + j] * 0.76) / LAT) * LAT;
      }
      bright[i * 3] = bright[i * 3 + 1] = bright[i * 3 + 2] = 1;
    }

    // Edge radius derived from node density, so 600 and 1800 nodes both
    // land near an average degree of ~4.
    var vol = 4.18879 * (0.755 * S) * (0.56 * S) * (0.62 * S);
    var radius = 1.9 * Math.cbrt(vol / NODES);
    var pairs = buildEdges(base, NODES, radius, MAX_EDGES, MAX_DEG);
    var EDGES = pairs.length / 2;

    var adj = buildAdjacency(pairs, NODES);

    var nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    nodeGeo.setAttribute('color', new THREE.BufferAttribute(bright, 3));

    var haloMat = new THREE.PointsMaterial({
      map: makeSprite(THREE, false), color: cNode, size: S * 0.05, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
    });
    var coreMat = new THREE.PointsMaterial({
      map: makeSprite(THREE, true), color: 0xffffff, size: S * 0.017, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
    });
    // Two draw calls, one shared geometry: cyan rim + cool-white core.
    var halo = new THREE.Points(nodeGeo, haloMat);
    var core = new THREE.Points(nodeGeo, coreMat);
    group.add(halo); group.add(core);

    var linePos = new Float32Array(EDGES * 6);
    var lineCol = new Float32Array(EDGES * 6);
    var edgeBase = new Float32Array(EDGES);                  // 8–15% resting alpha
    for (i = 0; i < EDGES; i++) edgeBase[i] = 0.1 + rnd() * 0.05;
    var lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    var lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    group.add(lines);

    // pulses: soft bloom + tight core, capacity-capped
    var pulsePos = new Float32Array(MAX_PULSES * 3);
    var pulseCol = new Float32Array(MAX_PULSES * 3);
    var pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseCol, 3));
    pulseGeo.setDrawRange(0, 0);
    var pulseBloom = new THREE.Points(pulseGeo, new THREE.PointsMaterial({
      map: makeSprite(THREE, false), color: cPulse, size: S * 0.14, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
    }));
    var pulseCore = new THREE.Points(pulseGeo, new THREE.PointsMaterial({
      map: makeSprite(THREE, true), color: 0xffffff, size: S * 0.036, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
    }));
    group.add(pulseBloom); group.add(pulseCore);

    /* --- state ------------------------------------------------------ */
    var pulses = [], spawnClock = 0;
    var morph = 0, morphTarget = 0, morphPin = null;
    var idleY = 0, parX = 0, parY = 0, parXT = 0, parYT = 0;
    var ptr = { x: 0, y: 0, inside: false };
    var infl = { x: 0, y: 0, on: 0 };        // lerped pointer — the cloud reacts with weight
    var energy = new Float32Array(NODES);    // pointer proximity + wave light, drives node + edge brightness
    var waves = [];                          // click shockwaves

    /* --- Signal Cascade -------------------------------------------------
       A click injects a signal at the nearest node; it propagates hop by hop
       along the real edges, lighting nodes as it goes. Clicking again while a
       cascade is live chains a combo, which widens reach. Every node the
       network has ever lit counts toward "network formed" — the cloud is a
       thing you switch on rather than a thing you watch. */
    var act = new Float32Array(NODES);       // activation, decays each frame
    var everAct = new Uint8Array(NODES);     // coverage bookkeeping
    var seenStamp = new Int32Array(NODES);   // per-cascade visited marker
    var stamp = 0, pending = [], formed = 0;
    var combo = 1, comboT = 0, formedFlash = 0, formedDone = false;
    var HOP = 0.055;
    var CASCADE_BUDGET = mob ? 280 : 900;
    var hud = null, hudPct = null, hudFill = null, hudFlash = null, hudHint = null, hudClock = 0;

    /* --- Network Walker --------------------------------------------------
       A glowing stick figure who lives in the graph: climbs edge to edge,
       and every node he reaches counts toward Network formed. Scrolling
       while he walks hurls him off the lattice — he tumbles stick-fight
       style, falls, and catches a node on the way down; falling out of the
       volume respawns him on a fresh node. Toggle: data-bx-walker. */
    var walkerOn = animate && attrBool(host, 'data-bx-walker', true);
    var wk = null, wkHeadGeo = null, wkHead = null, wkHalo = null, wkHeadPos = null;
    var wkCoreGeo = null, wkHaloGeo2 = null, wkJointGeo = null, wkCore = null, wkHaloM = null, wkJoints = null;
    var wkCorePos = null, wkHaloPos = null, wkJointPos = null, wkInv = null, wkCam = null;
    var FIG_H = S * 0.045 * clamp(attrNum(host, 'data-bx-mascot-scale', 1), 0.3, 4);   // theme-editor "Mascot size"
    var lastScrollY = null, throwCool = 0, juggle = 0;
    var GRAV = S * 1.6, CEIL = S * 0.58, WALL = S * 0.84, FLOOR = -S * 0.5;
    // Cap an upward impulse so the apex stays inside the canvas.
    function capUp(v) {
      var head = CEIL - wk.y;
      if (head <= FIG_H) return S * 0.08;
      var m = Math.sqrt(2 * GRAV * head);
      return v > m ? m : v;
    }
    // The direction the rotating cloud carries its nodes at his position.
    function tangent() {
      var tx = -wk.z, tz = wk.x, tl = Math.sqrt(tx * tx + tz * tz) || 1;
      return [tx / tl, tz / tl];
    }

    function wkNext(n, prev) {
      var s0 = adj.off[n], deg = adj.off[n + 1] - s0;
      if (!deg) return -1;
      var pick = adj.nb[s0 + Math.floor(rnd() * deg)], tries = 0;
      while (pick === prev && deg > 1 && tries < 5) { pick = adj.nb[s0 + Math.floor(rnd() * deg)]; tries++; }
      return pick;
    }
    function wkVisit(n) {
      act[n] = 1;
      if (!everAct[n]) { everAct[n] = 1; formed++; }
    }
    function wkSpawn(n) {
      var nx = wkNext(n, -1), guard = 0;
      while (nx < 0 && guard++ < 20) { n = Math.floor(rnd() * NODES); nx = wkNext(n, -1); }
      if (nx < 0) return;
      wk.mode = 'walk'; wk.a = n; wk.b = nx; wk.prev = -1; wk.u = 0;
      wk.tumble = 0; wk.spin = 0; wk.grabT = 0; wk.airT = 0;
      juggle = 0;
      wk.x = pos[n * 3]; wk.y = pos[n * 3 + 1]; wk.z = pos[n * 3 + 2];
      wk.sx = wk.x; wk.sy = wk.y; wk.sz = wk.z;
      wk.fx = pos[nx * 3] - wk.x; wk.fz = pos[nx * 3 + 2] - wk.z;
      wkVisit(n);
    }
    // Click anywhere on the network: he jumps, kicked away from the blast.
    function wkJump(ox, oy, oz) {
      if (wk.mode !== 'walk' || throwCool > 0) return;
      var dx = wk.x - ox, dy = wk.y - oy, dz = wk.z - oz;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var near = 1 / (1 + dl / (S * 0.5));           // closer blast → bigger kick
      var T = tangent();
      wk.mode = 'air'; wk.airT = 0;
      wk.vx = T[0] * S * (0.42 + near * 0.25) + (dx / dl) * S * 0.12;
      wk.vy = capUp(S * (0.7 + near * 0.5));
      wk.vz = T[1] * S * (0.42 + near * 0.25) + (dz / dl) * S * 0.12;
      wk.spin = (rnd() < 0.5 ? -1 : 1) * (4 + near * 8);
      throwCool = 1.2;
    }
    function wkAirJump(ox, oy, oz) {
      if (wk.mode !== 'air' || wk.airT < 0.12) return;   // tiny guard against double-fire
      var dx = wk.x - ox, dy = wk.y - oy, dz = wk.z - oz;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var near = 1 / (1 + dl / (S * 0.5));
      var T = tangent();
      wk.vy = capUp(S * (0.6 + near * 0.4));             // back UP, apex inside the canvas
      wk.vx = wk.vx * 0.4 + T[0] * S * 0.3 + (dx / dl) * S * 0.1;
      wk.vz = wk.vz * 0.4 + T[1] * S * 0.3 + (dz / dl) * S * 0.1;
      wk.spin = (rnd() < 0.5 ? -1 : 1) * (5 + rnd() * 4);
      wk.airT = 0.05;                                    // re-arms the catch guard
      juggle++;
      if (hudFlash) {
        hudFlash.textContent = 'Keep-up \u00d7' + juggle;
        hudFlash.style.opacity = '1';
      }
      comboT = 1.3;                                      // reuses the flash fade timer
    }
    function wkThrow() {
      wk.mode = 'air'; wk.airT = 0;
      var T = tangent();
      wk.vx = T[0] * S * 0.5 + (rnd() - 0.5) * S * 0.12;
      wk.vy = capUp(S * (1.0 + rnd() * 0.3));
      wk.vz = T[1] * S * 0.5 + (rnd() - 0.5) * S * 0.12;
      wk.spin = (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 5);
      throwCool = 2.4;
    }

    if (walkerOn) {
      // Limbs are camera-facing ribbons (two passes: white core + cyan halo),
      // so the figure has real screen thickness — LineSegments is always 1px.
      wkCorePos = new Float32Array(180);       // 10 segments × 6 verts
      wkHaloPos = new Float32Array(180);
      wkCoreGeo = new THREE.BufferGeometry();
      wkCoreGeo.setAttribute('position', new THREE.BufferAttribute(wkCorePos, 3));
      wkHaloGeo2 = new THREE.BufferGeometry();
      wkHaloGeo2.setAttribute('position', new THREE.BufferAttribute(wkHaloPos, 3));
      wkCore = new THREE.Mesh(wkCoreGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      }));
      wkHaloM = new THREE.Mesh(wkHaloGeo2, new THREE.MeshBasicMaterial({
        color: cMascot, transparent: true, opacity: 0.5, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      }));
      wkJointPos = new Float32Array(18);       // pelvis, hands, feet, head glow
      wkJointGeo = new THREE.BufferGeometry();
      wkJointGeo.setAttribute('position', new THREE.BufferAttribute(wkJointPos, 3));
      wkJoints = new THREE.Points(wkJointGeo, new THREE.PointsMaterial({
        map: makeSprite(THREE, true), color: 0xffffff, size: S * 0.012, sizeAttenuation: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      wkHeadPos = new Float32Array(3);
      wkHeadGeo = new THREE.BufferGeometry();
      wkHeadGeo.setAttribute('position', new THREE.BufferAttribute(wkHeadPos, 3));
      wkHead = new THREE.Points(wkHeadGeo, new THREE.PointsMaterial({
        map: makeSprite(THREE, true), color: 0xffffff, size: S * 0.03, sizeAttenuation: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      wkHalo = new THREE.Points(wkHeadGeo, new THREE.PointsMaterial({
        map: makeSprite(THREE, false), color: cMascot, size: S * 0.055, sizeAttenuation: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      group.add(wkHaloM); group.add(wkCore); group.add(wkJoints); group.add(wkHead); group.add(wkHalo);
      wkInv = new THREE.Matrix4(); wkCam = new THREE.Vector3();
      wk = { mode: 'walk', a: 0, b: 0, prev: -1, u: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sz: 0,
             vx: 0, vy: 0, vz: 0, fx: 1, fz: 0, phase: 0, tumble: 0, spin: 0, grabT: 0, airT: 0 };
      wkSpawn(Math.floor(rnd() * NODES));
    }

    function wkStep(dt) {
      // Scroll launches him — the stick-fight moment.
      var sy = w.scrollY || 0;
      if (lastScrollY === null) lastScrollY = sy;
      var sv = Math.abs(sy - lastScrollY) / Math.max(dt, 0.001);
      lastScrollY = sy;
      if (throwCool > 0) throwCool -= dt;
      if (wk.mode === 'walk' && sv > 380 && throwCool <= 0) wkThrow();

      var bx4, by4, bz4;
      if (wk.mode === 'walk') {
        wk.phase += dt * 7.5;
        var oa = wk.a * 3, ob = wk.b * 3;
        var ex4 = pos[ob] - pos[oa], ey4 = pos[ob + 1] - pos[oa + 1], ez4 = pos[ob + 2] - pos[oa + 2];
        var el4 = Math.sqrt(ex4 * ex4 + ey4 * ey4 + ez4 * ez4) || 1;
        wk.u += dt * (S * 0.15) / el4;          // constant ground speed
        if (wk.u >= 1) {
          wk.prev = wk.a; wk.a = wk.b; wk.u -= 1;
          wkVisit(wk.a);
          var nx4 = wkNext(wk.a, wk.prev);
          if (nx4 < 0) { wkSpawn(Math.floor(rnd() * NODES)); wkDraw(wk.sx, wk.sy, wk.sz); return; }
          wk.b = nx4;
          oa = wk.a * 3; ob = wk.b * 3;
          ex4 = pos[ob] - pos[oa]; ey4 = pos[ob + 1] - pos[oa + 1]; ez4 = pos[ob + 2] - pos[oa + 2];
          el4 = Math.sqrt(ex4 * ex4 + ey4 * ey4 + ez4 * ez4) || 1;
        }
        var wtx = pos[oa] + ex4 * wk.u, wty = pos[oa + 1] + ey4 * wk.u, wtz = pos[oa + 2] + ez4 * wk.u;
        wk.x = wtx; wk.y = wty; wk.z = wtz;
        var ks = 1 - Math.exp(-dt * 9);
        wk.sx += (wtx - wk.sx) * ks; wk.sy += (wty - wk.sy) * ks; wk.sz += (wtz - wk.sz) * ks;
        bx4 = wk.sx; by4 = wk.sy; bz4 = wk.sz;
        var k4 = Math.min(1, dt * 6);
        wk.fx += (ex4 / el4 - wk.fx) * k4;
        wk.fz += (ez4 / el4 - wk.fz) * k4;
        wk.tumble *= Math.exp(-dt * 6);
        if (wk.grabT > 0) wk.grabT -= dt;
      } else {
        wk.phase += dt * 16;                    // flail
        wk.airT += dt;
        wk.vy -= dt * GRAV;                     // floaty gravity — juggling is the game
        // carried by the flow: horizontal velocity settles onto the cloud's
        // rotation direction, so he sails with the nodes, never pogo-ing in place
        var T2 = tangent();
        wk.vx += (T2[0] * S * 0.3 - wk.vx) * Math.min(1, dt * 0.9);
        wk.vz += (T2[1] * S * 0.3 - wk.vz) * Math.min(1, dt * 0.9);
        wk.x += wk.vx * dt; wk.y += wk.vy * dt; wk.z += wk.vz * dt;
        wk.tumble += wk.spin * dt;
        wk.spin *= Math.exp(-dt * 0.35);
        if (wk.y > CEIL) { wk.y = CEIL; if (wk.vy > 0) wk.vy = 0; }          // soft ceiling
        var rr2 = Math.sqrt(wk.x * wk.x + wk.z * wk.z);
        if (rr2 > WALL) {                                                     // side walls
          var owx = wk.x / rr2, owz = wk.z / rr2;
          wk.x = owx * WALL; wk.z = owz * WALL;
          var vo = wk.vx * owx + wk.vz * owz;
          if (vo > 0) { wk.vx -= owx * vo * 1.5; wk.vz -= owz * vo * 1.5; }
        }
        if (wk.y < FLOOR) { wk.y = FLOOR; wk.vy = capUp(S * (1.05 + rnd() * 0.15)); } // floor bounce, back into the shell
        var vh2 = Math.sqrt(wk.vx * wk.vx + wk.vz * wk.vz);
        if (vh2 > 1) {                                                        // face where he sails
          var kf2 = Math.min(1, dt * 3);
          wk.fx += (wk.vx / vh2 - wk.fx) * kf2;
          wk.fz += (wk.vz / vh2 - wk.fz) * kf2;
        }
        wk.sx = wk.x; wk.sy = wk.y; wk.sz = wk.z;
        bx4 = wk.x; by4 = wk.y; bz4 = wk.z;
        if (wk.vy < 0 && wk.airT > 0.45) {
          // falling: catch the first node within reach
          var g2r = S * 0.09, bd4 = g2r * g2r, best4 = -1;
          for (var gi = 0; gi < NODES; gi++) {
            var go = gi * 3;
            var qx4 = pos[go] - bx4, qy4 = pos[go + 1] - by4, qz4 = pos[go + 2] - bz4;
            var dd4 = qx4 * qx4 + qy4 * qy4 + qz4 * qz4;
            if (dd4 < bd4) { bd4 = dd4; best4 = gi; }
          }
          if (best4 >= 0) {
            var tu = wk.tumble % 6.28318;
            if (tu > 3.14159) tu -= 6.28318;
            if (tu < -3.14159) tu += 6.28318;
            wk.tumble = tu; wk.grabT = 0.3;      // catch crouch, then unwind
            if (juggle >= 3 && hudFlash) {
              hudFlash.textContent = 'Caught after \u00d7' + juggle + ' keep-ups';
              hudFlash.style.opacity = '1';
              comboT = 2;
            }
            juggle = 0;
            var nb4 = wkNext(best4, -1);
            if (nb4 < 0) wkSpawn(Math.floor(rnd() * NODES));
            else { wk.mode = 'walk'; wk.a = best4; wk.b = nb4; wk.prev = -1; wk.u = 0; wkVisit(best4); }
          }
        }
      }
      wkDraw(bx4, by4, bz4);
    }

    function wkDraw(bx4, by4, bz4) {
      var air = wk.mode === 'air';
      var K = air ? 1.9 : 1;                    // limbs flail wider mid-air
      var fx4 = wk.fx, fz4 = wk.fz;
      var fl4 = Math.sqrt(fx4 * fx4 + fz4 * fz4) || 1; fx4 /= fl4; fz4 /= fl4;
      var ctu = Math.cos(wk.tumble), stu = Math.sin(wk.tumble);
      var ux4 = fx4 * stu, uy4 = ctu, uz4 = fz4 * stu;      // up, tumbled
      var gx4 = fx4 * ctu, gy4 = -stu, gz4 = fz4 * ctu;     // forward, tumbled
      var rx4 = -fz4, rz4 = fx4;                            // right (hinge axis)
      var H4 = FIG_H, leg4 = H4 * 0.46, tor4 = H4 * 0.36, arm4 = H4 * 0.30;
      var crouch = 0.92 - (wk.grabT > 0 ? wk.grabT : 0) * 0.9;
      var px4 = bx4 + ux4 * leg4 * crouch, py4 = by4 + uy4 * leg4 * crouch, pz4 = bz4 + uz4 * leg4 * crouch;
      var nx6 = px4 + ux4 * tor4, ny6 = py4 + uy4 * tor4, nz6 = pz4 + uz4 * tor4;
      var hx4 = nx6 + ux4 * H4 * 0.34, hy4 = ny6 + uy4 * H4 * 0.34, hz4 = nz6 + uz4 * H4 * 0.34;
      var s5 = Math.sin(wk.phase);
      var str4 = H4 * 0.32 * K, armA4 = H4 * 0.28 * K, sep4 = H4 * 0.17;
      var f1x = bx4 + gx4 * s5 * str4 + rx4 * sep4, f1y = by4 + gy4 * s5 * str4, f1z = bz4 + gz4 * s5 * str4 + rz4 * sep4;
      var f2x = bx4 - gx4 * s5 * str4 - rx4 * sep4, f2y = by4 - gy4 * s5 * str4, f2z = bz4 - gz4 * s5 * str4 - rz4 * sep4;
      var k1x = (px4 + f1x) / 2 + gx4 * H4 * 0.09, k1y = (py4 + f1y) / 2 + gy4 * H4 * 0.09, k1z = (pz4 + f1z) / 2 + gz4 * H4 * 0.09;
      var k2x = (px4 + f2x) / 2 + gx4 * H4 * 0.09, k2y = (py4 + f2y) / 2 + gy4 * H4 * 0.09, k2z = (pz4 + f2z) / 2 + gz4 * H4 * 0.09;
      var lift4 = air ? arm4 * 0.35 : -arm4 * 0.72;         // arms up when airborne
      var h1x = nx6 - gx4 * s5 * armA4 + rx4 * sep4 * 1.3 + ux4 * lift4, h1y = ny6 - gy4 * s5 * armA4 + uy4 * lift4, h1z = nz6 - gz4 * s5 * armA4 + rz4 * sep4 * 1.3 + uz4 * lift4;
      var h2x = nx6 + gx4 * s5 * armA4 - rx4 * sep4 * 1.3 + ux4 * lift4, h2y = ny6 + gy4 * s5 * armA4 + uy4 * lift4, h2z = nz6 + gz4 * s5 * armA4 - rz4 * sep4 * 1.3 + uz4 * lift4;
      var e1x = (nx6 + h1x) / 2 - gx4 * H4 * 0.05, e1y = (ny6 + h1y) / 2 - gy4 * H4 * 0.05, e1z = (nz6 + h1z) / 2 - gz4 * H4 * 0.05;
      var e2x = (nx6 + h2x) / 2 - gx4 * H4 * 0.05, e2y = (ny6 + h2y) / 2 - gy4 * H4 * 0.05, e2z = (nz6 + h2z) / 2 - gz4 * H4 * 0.05;
      wkInv.copy(group.matrixWorld).invert();
      wkCam.copy(camera.position).applyMatrix4(wkInv);
      var jc = 0, jh = 0;
      function rib(x1, y1, z1, x2, y2, z2) {
        var mx5 = (x1 + x2) * 0.5, my5 = (y1 + y2) * 0.5, mz5 = (z1 + z2) * 0.5;
        var dx5 = x2 - x1, dy5 = y2 - y1, dz5 = z2 - z1;
        var tx5 = wkCam.x - mx5, ty5 = wkCam.y - my5, tz5 = wkCam.z - mz5;
        var sx5 = dy5 * tz5 - dz5 * ty5, sy5 = dz5 * tx5 - dx5 * tz5, sz5 = dx5 * ty5 - dy5 * tx5;
        var sl5 = Math.sqrt(sx5 * sx5 + sy5 * sy5 + sz5 * sz5) || 1;
        sx5 /= sl5; sy5 /= sl5; sz5 /= sl5;
        var cw = H4 * 0.17, hw = H4 * 0.4;    // thick rounded tubes + magenta rim
        var cx5 = sx5 * cw, cy5 = sy5 * cw, cz5 = sz5 * cw;
        wkCorePos[jc++] = x1 + cx5; wkCorePos[jc++] = y1 + cy5; wkCorePos[jc++] = z1 + cz5;
        wkCorePos[jc++] = x1 - cx5; wkCorePos[jc++] = y1 - cy5; wkCorePos[jc++] = z1 - cz5;
        wkCorePos[jc++] = x2 + cx5; wkCorePos[jc++] = y2 + cy5; wkCorePos[jc++] = z2 + cz5;
        wkCorePos[jc++] = x1 - cx5; wkCorePos[jc++] = y1 - cy5; wkCorePos[jc++] = z1 - cz5;
        wkCorePos[jc++] = x2 - cx5; wkCorePos[jc++] = y2 - cy5; wkCorePos[jc++] = z2 - cz5;
        wkCorePos[jc++] = x2 + cx5; wkCorePos[jc++] = y2 + cy5; wkCorePos[jc++] = z2 + cz5;
        var hx5 = sx5 * hw, hy5 = sy5 * hw, hz5 = sz5 * hw;
        wkHaloPos[jh++] = x1 + hx5; wkHaloPos[jh++] = y1 + hy5; wkHaloPos[jh++] = z1 + hz5;
        wkHaloPos[jh++] = x1 - hx5; wkHaloPos[jh++] = y1 - hy5; wkHaloPos[jh++] = z1 - hz5;
        wkHaloPos[jh++] = x2 + hx5; wkHaloPos[jh++] = y2 + hy5; wkHaloPos[jh++] = z2 + hz5;
        wkHaloPos[jh++] = x1 - hx5; wkHaloPos[jh++] = y1 - hy5; wkHaloPos[jh++] = z1 - hz5;
        wkHaloPos[jh++] = x2 - hx5; wkHaloPos[jh++] = y2 - hy5; wkHaloPos[jh++] = z2 - hz5;
        wkHaloPos[jh++] = x2 + hx5; wkHaloPos[jh++] = y2 + hy5; wkHaloPos[jh++] = z2 + hz5;
      }
      rib(px4, py4, pz4, nx6, ny6, nz6);
      rib(nx6, ny6, nz6, hx4, hy4, hz4);
      rib(px4, py4, pz4, k1x, k1y, k1z); rib(k1x, k1y, k1z, f1x, f1y, f1z);
      rib(px4, py4, pz4, k2x, k2y, k2z); rib(k2x, k2y, k2z, f2x, f2y, f2z);
      rib(nx6, ny6, nz6, e1x, e1y, e1z); rib(e1x, e1y, e1z, h1x, h1y, h1z);
      rib(nx6, ny6, nz6, e2x, e2y, e2z); rib(e2x, e2y, e2z, h2x, h2y, h2z);
      wkCoreGeo.attributes.position.needsUpdate = true;
      wkHaloGeo2.attributes.position.needsUpdate = true;
      wkJointPos[0] = px4; wkJointPos[1] = py4; wkJointPos[2] = pz4;
      wkJointPos[3] = f1x; wkJointPos[4] = f1y; wkJointPos[5] = f1z;
      wkJointPos[6] = f2x; wkJointPos[7] = f2y; wkJointPos[8] = f2z;
      wkJointPos[9] = h1x; wkJointPos[10] = h1y; wkJointPos[11] = h1z;
      wkJointPos[12] = h2x; wkJointPos[13] = h2y; wkJointPos[14] = h2z;
      wkJointPos[15] = hx4; wkJointPos[16] = hy4; wkJointPos[17] = hz4;
      wkJointGeo.attributes.position.needsUpdate = true;
      wkHeadPos[0] = hx4; wkHeadPos[1] = hy4; wkHeadPos[2] = hz4;
      wkHeadGeo.attributes.position.needsUpdate = true;
    }
    var rayO = new THREE.Vector3(), rayD = new THREE.Vector3(), tmp = new THREE.Vector3();
    var wOrigin = new THREE.Vector3();
    var invMat = new THREE.Matrix4();
    var raf = 0, last = 0, running = false, inView = true, rayR = 0;
    var fpsAcc = 0, fpsFrames = 0, statClock = 0;

    /* --- sizing ----------------------------------------------------- */
    var lastW = 0, lastH = 0, roRaf = 0;
    function resize() {
      var wd = host.clientWidth || 1, ht = host.clientHeight || 1;
      lastW = wd; lastH = ht;
      renderer.setSize(wd, ht, false);
      camera.aspect = wd / ht;
      camera.updateProjectionMatrix();
    }
    resize();

    // Resizing the canvas mutates the observed subtree, so the callback is
    // deferred to the next frame and no-ops when the box is unchanged —
    // otherwise the observer re-fires itself and trips the RO loop guard.
    function onResizeObserved() {
      if (roRaf) return;
      roRaf = requestAnimationFrame(function () {
        roRaf = 0;
        if (host.clientWidth === lastW && host.clientHeight === lastH) return;
        resize();
      });
    }

    var ro = null;
    if (w.ResizeObserver) { ro = new ResizeObserver(onResizeObserved); ro.observe(host); }
    else w.addEventListener('resize', onResizeObserved);

    /* --- pointer ----------------------------------------------------
       A cursor glow is created here rather than in markup, so the engine
       owns it and no template/section needs to know about it. */
    var glow = null;
    if (animate) {
      glow = d.createElement('div');
      glow.setAttribute('aria-hidden', 'true');
      glow.style.cssText = 'position:absolute;left:0;top:0;width:90px;height:90px;margin:-45px 0 0 -45px;' +
        'z-index:1;pointer-events:none;opacity:0;will-change:transform,opacity;' +
        'transition:opacity .45s ease;border-radius:50%;' +
        'background:radial-gradient(circle,' + 'color-mix(in srgb,var(--bx-node) 11%,transparent)' + ' 0%,transparent 70%)';
      host.appendChild(glow);
    }

    if (animate) {
      hud = d.createElement('div');
      hud.setAttribute('aria-hidden', 'true');
      // Colour comes from the theme's dimmed-ink token, not a local rgba, so
      // the readout cannot drift below AA when the palette changes.
      hud.style.cssText = 'position:absolute;left:24px;bottom:22px;z-index:2;pointer-events:none;' +
        'display:flex;flex-direction:column;gap:7px;width:206px;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;letter-spacing:0.12em;' +
        'text-transform:uppercase;color:var(--bx-ink-dim,rgba(233,241,248,0.75))';
      hud.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
          '<span>Network formed</span>' +
          '<span data-pct style="color:var(--bx-node);font-variant-numeric:tabular-nums">0%</span>' +
        '</div>' +
        '<div style="height:1px;background:rgba(255,255,255,0.12)">' +
          '<div data-fill style="height:1px;width:0%;background:var(--bx-node);' +
            'box-shadow:0 0 8px var(--bx-node);transition:width .25s linear"></div>' +
        '</div>' +
        '<div data-flash style="height:15px;opacity:0;color:var(--bx-node);transition:opacity .25s ease"></div>' +
        '<div data-hint style="text-transform:none;letter-spacing:0.02em;' +
          'font-size:12px;transition:opacity .6s ease">' +
          (mob ? 'Tap to send a signal' : 'Click to send a signal') + '</div>';
      host.appendChild(hud);
      hudPct = hud.querySelector('[data-pct]');
      hudFill = hud.querySelector('[data-fill]');
      hudFlash = hud.querySelector('[data-flash]');
      hudHint = hud.querySelector('[data-hint]');
      setTimeout(function () { if (hudHint && !formed) hudHint.style.opacity = '0.75'; }, 9000);
    }

    // Inject a signal and let it walk the graph.
    function ignite(start, tNow) {
      combo = pending.length ? Math.min(5, combo + 1) : 1;
      comboT = 1.3;
      stamp++;
      var c = { s: stamp, fired: 0, budget: Math.round(CASCADE_BUDGET * (0.55 + combo * 0.45)), hops: 9 + combo * 2 };
      seenStamp[start] = stamp;
      pending.push({ n: start, t: tNow, hop: 0, c: c });
      if (hudFlash) {
        hudFlash.textContent = combo > 1 ? 'Signal chained \u00d7' + combo : 'Signal sent';
        hudFlash.style.opacity = '1';
      }
      if (hudHint) { hudHint.style.opacity = '0'; }
    }

    function onMove(e) {
      var r = host.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      ptr.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (ptr.inside) {
        ptr.px = e.clientX - r.left;
        ptr.py = e.clientY - r.top;
      }
      parXT = ptr.y * 0.0698;   // ±4deg
      parYT = ptr.x * 0.0698;
    }
    function onLeave(e) {
      if (e && e.relatedTarget) return;
      ptr.inside = false; parXT = 0; parYT = 0;
    }

    // Click / tap: a shockwave through the graph from the point clicked,
    // plus pulses fired from the node nearest that point.
    function onDown(e) {
      if (!burstOn) return;
      // Never hijack a CTA or link click.
      if (e.target && e.target.closest && e.target.closest('a,button,input,select,textarea')) return;
      onMove(e);
      if (!ptr.inside) return;
      pointerRay();
      var tNow = (w.performance ? w.performance.now() : Date.now()) / 1000;
      // Origin = the point on the pointer ray closest to the cloud centre,
      // so the burst detonates inside the volume rather than at the camera.
      var tt = -(rayO.x * rayD.x + rayO.y * rayD.y + rayO.z * rayD.z);
      wOrigin.copy(rayD).multiplyScalar(tt).add(rayO);
      if (waves.length < MAX_WAVES) {
        waves.push({ ox: wOrigin.x, oy: wOrigin.y, oz: wOrigin.z, t: 0, dur: 1.15 });
      }
      var near = nearestNode(wOrigin.x, wOrigin.y, wOrigin.z);
      ignite(near, tNow);
      if (wk) {
        if (wk.mode === 'air') wkAirJump(wOrigin.x, wOrigin.y, wOrigin.z);
        else wkJump(wOrigin.x, wOrigin.y, wOrigin.z);
      }
      for (var q = 0; q < 2; q++) {
        if (pulses.length < MAX_TAP_PULSES) spawnPulse(near);
      }
    }

    function nearestNode(x, y, z) {
      var best = 0, bd = Infinity;
      for (var i4 = 0; i4 < NODES; i4++) {
        var dx4 = pos[i4 * 3] - x, dy4 = pos[i4 * 3 + 1] - y, dz4 = pos[i4 * 3 + 2] - z;
        var dd4 = dx4 * dx4 + dy4 * dy4 + dz4 * dz4;
        if (dd4 < bd) { bd = dd4; best = i4; }
      }
      return best;
    }

    // Pointer ray in the cloud's local space (cheap, depth-agnostic).
    function pointerRay() {
      tmp.set(ptr.x, ptr.y, 0.5).unproject(camera);
      rayO.copy(camera.position);
      rayD.copy(tmp).sub(camera.position).normalize();
      invMat.copy(group.matrixWorld).invert();
      rayO.applyMatrix4(invMat);
      rayD.transformDirection(invMat);
    }

    if (animate) {
      w.addEventListener('pointermove', onMove, { passive: true });
      w.addEventListener('pointerout', onLeave, { passive: true });
      host.addEventListener('pointerdown', onDown, { passive: true });
    }

    /* --- scroll progress -------------------------------------------- */
    function scrollProgress() {
      var r = host.getBoundingClientRect();
      return clamp(-r.top / Math.max(1, r.height), 0, 1);
    }

    /* --- pulses ----------------------------------------------------- */
    function spawnPulse(from) {
      var start = from == null ? Math.floor(rnd() * NODES) : from, path = [start];
      var prev = -1, cur = start, hops = 3 + Math.floor(rnd() * 3);
      for (var h = 0; h < hops; h++) {
        var s = adj.off[cur], e = adj.off[cur + 1];
        if (e - s === 0) break;
        var pick = cur, tries = 0;
        do { pick = adj.nb[s + Math.floor(rnd() * (e - s))]; tries++; } while (pick === prev && tries < 4);
        prev = cur; cur = pick; path.push(cur);
      }
      if (path.length < 2) return;
      pulses.push({ p: path, t: 0, dur: 0.3 * (path.length - 1) + 0.3 });
    }

    /* --- frame ------------------------------------------------------ */
    function step(now) {
      raf = requestAnimationFrame(step);
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      var t = now / 1000;

      if (morphOn || morphPin !== null) {
        morphTarget = morphPin !== null ? morphPin : scrollProgress();
        morph += (morphTarget - morph) * Math.min(1, dt * 3.5);   // lerped, never snapped
      }

      idleY += dt * 0.042;
      parX += (parXT - parX) * Math.min(1, dt * 2.2);
      parY += (parYT - parY) * Math.min(1, dt * 2.2);
      group.rotation.set(parX, idleY + parY, 0);
      group.updateMatrixWorld();

      // Pointer influence eases in and out, so the cloud has weight.
      infl.on += ((repelOn && ptr.inside ? 1 : 0) - infl.on) * Math.min(1, dt * 5);
      var R = 0;
      if (infl.on > 0.01) {
        pointerRay();
        var worldPerPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z) / Math.max(1, host.clientHeight);
        R = 25 * worldPerPx * infl.on;                         // ~25px of influence
      }
      var R2 = R * R;
      rayR = R;

      if (glow) {
        glow.style.opacity = ptr.inside ? '1' : '0';
        if (ptr.px != null) glow.style.transform = 'translate3d(' + ptr.px + 'px,' + ptr.py + 'px,0)';
      }

      // Cascade: fire every hop whose time has come, then queue its neighbours.
      if (pending.length) {
        var keep = 0, add = [];
        for (var pi = 0; pi < pending.length; pi++) {
          var it = pending[pi];
          if (it.t > t) { pending[keep++] = it; continue; }
          var nn = it.n;
          act[nn] = 1;
          if (!everAct[nn]) { everAct[nn] = 1; formed++; }
          var s0 = adj.off[nn], deg = adj.off[nn + 1] - s0;
          if (deg && it.hop < it.c.hops && it.c.fired < it.c.budget) {
            var branch = deg < 4 ? deg : 4;
            for (var bi = 0; bi < branch; bi++) {
              var nb = adj.nb[s0 + bi];
              if (seenStamp[nb] === it.c.s) continue;
              seenStamp[nb] = it.c.s;
              it.c.fired++;
              add.push({ n: nb, t: t + HOP, hop: it.hop + 1, c: it.c });
            }
          }
        }
        pending.length = keep;
        for (var ai = 0; ai < add.length && pending.length < 1400; ai++) pending.push(add[ai]);
      }
      if (comboT > 0) {
        comboT -= dt;
        if (comboT <= 0) {
          combo = 1;
          if (hudFlash) hudFlash.style.opacity = '0';
        }
      }
      if (formedFlash > 0) formedFlash -= dt;
      var decay = Math.exp(-dt * 2.1);

      // Shockwaves: expanding shells that displace and light the nodes they cross.
      var nw = 0;
      for (var wi = 0; wi < waves.length; wi++) {
        var wv = waves[wi];
        wv.t += dt;
        if (wv.t >= wv.dur) continue;
        var wu = wv.t / wv.dur;
        wv.r = (1 - Math.pow(1 - wu, 2)) * S * 1.25;           // ease-out expansion
        wv.k = Math.pow(1 - wu, 1.6);                          // decay
        waves[nw++] = wv;
      }
      waves.length = nw;

      var scale = 1 - 0.1 * morph;                             // converge inward
      for (var i2 = 0; i2 < NODES; i2++) {
        var o = i2 * 3, o4 = i2 * 4, amp = drift[o4 + 3];
        var bx = base[o] + Math.sin(t * 0.28 + drift[o4]) * amp;
        var by = base[o + 1] + Math.sin(t * 0.33 + drift[o4 + 1]) * amp;
        var bz = base[o + 2] + Math.sin(t * 0.24 + drift[o4 + 2]) * amp;

        if (morph > 0.001) {
          bx += (lattice[o] - bx) * morph;
          by += (lattice[o + 1] - by) * morph;
          bz += (lattice[o + 2] - bz) * morph;
          bx *= scale; by *= scale; bz *= scale;
        }

        var p = 0;
        if (nw > 0) {
          for (var wj = 0; wj < nw; wj++) {
            var wq = waves[wj];
            var vx = bx - wq.ox, vy = by - wq.oy, vz = bz - wq.oz;
            var vd = Math.sqrt(vx * vx + vy * vy + vz * vz) || 0.0001;
            var band = 1 - Math.abs(vd - wq.r) / (S * 0.3);
            if (band > 0) {
              var amt = band * band * wq.k;
              var kick = amt * S * 0.1;
              bx += (vx / vd) * kick; by += (vy / vd) * kick; bz += (vz / vd) * kick;
              if (amt > p) p = amt;
            }
          }
        }
        if (R2 > 0) {
          var wx = bx - rayO.x, wy = by - rayO.y, wz = bz - rayO.z;
          var proj = wx * rayD.x + wy * rayD.y + wz * rayD.z;
          var qx = wx - rayD.x * proj, qy = wy - rayD.y * proj, qz = wz - rayD.z * proj;
          var d2 = qx * qx + qy * qy + qz * qz;
          if (d2 < R2) {
            var dist = Math.sqrt(d2) || 0.0001;
            var f = 1 - dist / R;
            f = f * f * (3 - 2 * f);                           // smoothstep falloff
            var push = f * R * 0.32;                           // nudge, not evacuate — keeps the circle filled
            bx += (qx / dist) * push; by += (qy / dist) * push; bz += (qz / dist) * push;
            if (f > p) p = f;
          }
        }
        energy[i2] = p;
        var av = (act[i2] *= decay);
        pos[o] = bx; pos[o + 1] = by; pos[o + 2] = bz;
        var b = 1 + p * 2.6 + av * 3.4;
        bright[o] = bright[o + 1] = bright[o + 2] = b;
      }
      nodeGeo.attributes.position.needsUpdate = true;
      nodeGeo.attributes.color.needsUpdate = true;

      // edges follow the nodes; brighten with pointer proximity
      var er = cEdge.r, eg = cEdge.g, eb = cEdge.b;
      for (var e2 = 0; e2 < EDGES; e2++) {
        var a = pairs[e2 * 2] * 3, b2 = pairs[e2 * 2 + 1] * 3, o6 = e2 * 6;
        linePos[o6] = pos[a]; linePos[o6 + 1] = pos[a + 1]; linePos[o6 + 2] = pos[a + 2];
        linePos[o6 + 3] = pos[b2]; linePos[o6 + 4] = pos[b2 + 1]; linePos[o6 + 5] = pos[b2 + 2];
        var ea = pairs[e2 * 2], eb2 = pairs[e2 * 2 + 1];
        var aa = act[ea], ab = act[eb2];
        var lit = aa > ab ? aa : ab;
        var g2 = edgeBase[e2] * (1 + 0.35 * morph + formedFlash * 0.9) +
          (energy[ea] > energy[eb2] ? energy[ea] : energy[eb2]) * 0.9 +
          lit * 1.5 + (aa > 0.05 && ab > 0.05 ? 0.5 : 0);
        var cr = er * g2, cg = eg * g2, cb = eb * g2;
        lineCol[o6] = cr; lineCol[o6 + 1] = cg; lineCol[o6 + 2] = cb;
        lineCol[o6 + 3] = cr; lineCol[o6 + 4] = cg; lineCol[o6 + 5] = cb;
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;

      // signal pulses along random edge paths
      if (pulsesOn || pulses.length) {
        if (pulsesOn) {
          spawnClock += dt;
          while (spawnClock >= 0.4) {
            spawnClock -= 0.4;
            if (pulses.length < MAX_PULSES) spawnPulse();
          }
        }
        var n2 = 0;
        for (var k2 = 0; k2 < pulses.length; k2++) {
          var pu = pulses[k2];
          pu.t += dt;
          var u = pu.t / pu.dur;
          if (u >= 1) continue;
          var eased = 1 - Math.pow(1 - u, 3);                  // ease-out
          var segs = pu.p.length - 1;
          var fseg = Math.min(eased * segs, segs - 0.0001);
          var si = Math.floor(fseg), f2 = fseg - si;
          var ai = pu.p[si] * 3, bi = pu.p[si + 1] * 3, po = n2 * 3;
          pulsePos[po] = pos[ai] + (pos[bi] - pos[ai]) * f2;
          pulsePos[po + 1] = pos[ai + 1] + (pos[bi + 1] - pos[ai + 1]) * f2;
          pulsePos[po + 2] = pos[ai + 2] + (pos[bi + 2] - pos[ai + 2]) * f2;
          var a2 = Math.pow(Math.sin(Math.PI * u), 0.7);
          pulseCol[po] = pulseCol[po + 1] = pulseCol[po + 2] = a2;
          pulses[n2++] = pu;
        }
        pulses.length = n2;
        pulseGeo.setDrawRange(0, n2);
        pulseGeo.attributes.position.needsUpdate = true;
        pulseGeo.attributes.color.needsUpdate = true;
      }

      if (walkerOn && wk) wkStep(dt);

      if (hud) {
        hudClock += dt;
        if (hudClock > 0.12) {
          hudClock = 0;
          var pct = formed / NODES;
          hudPct.textContent = Math.round(pct * 100) + '%';
          hudFill.style.width = (pct * 100).toFixed(1) + '%';
          if (!formedDone && pct >= 0.999) {
            formedDone = true;
            formedFlash = 1.4;
            hudFlash.textContent = 'Network formed';
            hudFlash.style.opacity = '1';
            comboT = 2.4;
          }
        }
      }

      renderer.render(scene, camera);

      if (statsEl && host.getAttribute('data-bx-stats') === 'true') {
        fpsAcc += dt; fpsFrames++; statClock += dt;
        if (statClock > 0.5) {
          statsEl.textContent = Math.round(fpsFrames / fpsAcc) + ' fps · ' + NODES + ' nodes · ' +
            EDGES + ' edges · ' + pulses.length + ' pulses · morph ' + morph.toFixed(2);
          fpsAcc = 0; fpsFrames = 0; statClock = 0;
        }
      }
    }

    function renderOnce() {
      var i3, o3;
      for (i3 = 0; i3 < NODES; i3++) { o3 = i3 * 3; pos[o3] = base[o3]; pos[o3 + 1] = base[o3 + 1]; pos[o3 + 2] = base[o3 + 2]; }
      for (var e3 = 0; e3 < EDGES; e3++) {
        var a3 = pairs[e3 * 2] * 3, b3 = pairs[e3 * 2 + 1] * 3, o6 = e3 * 6;
        linePos[o6] = pos[a3]; linePos[o6 + 1] = pos[a3 + 1]; linePos[o6 + 2] = pos[a3 + 2];
        linePos[o6 + 3] = pos[b3]; linePos[o6 + 4] = pos[b3 + 1]; linePos[o6 + 5] = pos[b3 + 2];
        var g3 = edgeBase[e3];
        lineCol[o6] = cEdge.r * g3; lineCol[o6 + 1] = cEdge.g * g3; lineCol[o6 + 2] = cEdge.b * g3;
        lineCol[o6 + 3] = lineCol[o6]; lineCol[o6 + 4] = lineCol[o6 + 1]; lineCol[o6 + 5] = lineCol[o6 + 2];
      }
      nodeGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
      group.rotation.set(0.06, -0.42, 0);
      renderer.render(scene, camera);
      if (statsEl) statsEl.textContent = 'static · ' + NODES + ' nodes · ' + EDGES + ' edges';
    }

    function start() {
      if (running || !animate) return;
      running = true; last = 0;
      raf = requestAnimationFrame(step);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    /* --- pause when off-screen or backgrounded ---------------------- */
    var io = null;
    if (w.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView && !d.hidden) start(); else stop();
      }, { threshold: 0 });
      io.observe(host);
    }
    function onVis() { if (!d.hidden && inView) start(); else stop(); }
    d.addEventListener('visibilitychange', onVis);

    if (animate) start(); else renderOnce();
    reveal(host);

    var api = {
      // Pin the scroll-morph for previewing the end state: setMorph(1), setMorph(null) to release.
      setMorph: function (v) { morphPin = v; },
      throwWalker: function () { if (wk && wk.mode === 'walk') wkThrow(); },
      walkerState: function () { return wk ? { mode: wk.mode, node: wk.a, u: +wk.u.toFixed(2), y: +wk.y.toFixed(1) } : null; },
      destroy: function () {
        stop();
        if (roRaf) cancelAnimationFrame(roRaf);
        d.removeEventListener('visibilitychange', onVis);
        w.removeEventListener('pointermove', onMove);
        w.removeEventListener('pointerout', onLeave);
        host.removeEventListener('pointerdown', onDown);
        if (glow && glow.parentNode) glow.parentNode.removeChild(glow);
        if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
        w.removeEventListener('resize', onResizeObserved);
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (wkCoreGeo) {
          [wkCoreGeo, wkHaloGeo2, wkJointGeo, wkHeadGeo].forEach(function (g) { g.dispose(); });
          [wkCore.material, wkHaloM.material, wkJoints.material, wkHead.material, wkHalo.material]
            .forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
        }
        [nodeGeo, lineGeo, pulseGeo].forEach(function (g) { g.dispose(); });
        [haloMat, coreMat, lines.material, pulseBloom.material, pulseCore.material].forEach(function (m) {
          if (m.map) m.map.dispose();
          m.dispose();
        });
        renderer.dispose();
        host.__bxHero = null;
        var ix = mounted.indexOf(api);
        if (ix > -1) mounted.splice(ix, 1);
      }
    };
    host.__bxHero = api;
    mounted.push(api);
    return api;
  }

  function reveal(host) {
    host.classList.add('is-armed');
    // setTimeout, not rAF: frame callbacks are starved in background/offscreen
    // frames, and copy must never stay hidden waiting for an animation frame.
    setTimeout(function () { host.classList.add('is-ready'); }, 60);
  }

  /* ---------- boot ----------------------------------------------------- */
  function bootAll() {
    var hosts = d.querySelectorAll('[data-bx-neural-hero]');
    for (var i = 0; i < hosts.length; i++) init(hosts[i]);
  }
  function boot() {
    if (w.THREE) return bootAll();
    // three.js may still be deferred in <head>; wait briefly, then load it.
    var waited = 0;
    var timer = setInterval(function () {
      waited += 100;
      if (w.THREE) { clearInterval(timer); bootAll(); return; }
      if (waited >= 1500) {
        clearInterval(timer);
        var s = d.createElement('script');
        s.src = THREE_SRC;
        s.onload = bootAll;
        s.onerror = bootAll;                                  // falls back to CSS gradient
        d.head.appendChild(s);
      }
    }, 100);
  }

  w.BxNeuralHero = { init: init, boot: boot, instances: mounted };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Shopify theme editor lifecycle
  d.addEventListener('shopify:section:load', function (e) {
    var host = e.target.querySelector ? e.target.querySelector('[data-bx-neural-hero]') : null;
    if (host) init(host);
  });
  d.addEventListener('shopify:section:unload', function (e) {
    var host = e.target.querySelector ? e.target.querySelector('[data-bx-neural-hero]') : null;
    if (host && host.__bxHero) host.__bxHero.destroy();
  });
})(window, document);
