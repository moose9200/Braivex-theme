/*!
 * Braivex — shared theme behaviour
 * assets/braivex.js
 * Sticky-header state, mobile drawer, catalogue tabs, scroll reveal.
 * Vanilla, idempotent, safe to run on every section:load in the theme editor.
 */
(function (w, d) {
  'use strict';

  var reduce = w.matchMedia ? w.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

  /* ---------- sticky header ------------------------------------------- */
  function initHeader(root) {
    var header = root.querySelector('.bvx-header') || (root.classList && root.classList.contains('bvx-header') ? root : null);
    if (!header || header.__bvx) return;
    header.__bvx = true;

    var onScroll = function () {
      header.classList.toggle('is-stuck', (w.scrollY || d.documentElement.scrollTop) > 8);
    };
    onScroll();
    w.addEventListener('scroll', onScroll, { passive: true });

    var burger = header.querySelector('.bvx-burger');
    var drawer = header.querySelector('.bvx-drawer');
    if (burger && drawer) {
      burger.addEventListener('click', function () {
        var open = drawer.classList.toggle('is-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      drawer.addEventListener('click', function (e) {
        if (e.target.closest('a')) {
          drawer.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  /* ---------- catalogue tabs ------------------------------------------ */
  function initTabs(root) {
    var groups = root.querySelectorAll('[data-bvx-tabs]');
    for (var i = 0; i < groups.length; i++) {
      (function (group) {
        if (group.__bvx) return;
        group.__bvx = true;
        var tabs = group.querySelectorAll('.bvx-tab');
        var panels = group.querySelectorAll('.bvx-panel');
        group.addEventListener('click', function (e) {
          var tab = e.target.closest('.bvx-tab');
          if (!tab) return;
          var target = tab.getAttribute('data-target');
          for (var j = 0; j < tabs.length; j++) {
            tabs[j].setAttribute('aria-selected', tabs[j] === tab ? 'true' : 'false');
          }
          for (var k = 0; k < panels.length; k++) {
            var match = panels[k].getAttribute('data-panel') === target;
            panels[k].setAttribute('data-active', match ? 'true' : 'false');
          }
        });
        // keyboard: left/right move between tabs
        group.addEventListener('keydown', function (e) {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          var list = Array.prototype.slice.call(tabs);
          var at = list.indexOf(d.activeElement);
          if (at < 0) return;
          var next = list[(at + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
          next.focus();
          next.click();
        });
      })(groups[i]);
    }
  }

  /* ---------- scroll reveal ------------------------------------------- */
  var io = null;
  function initReveal(root) {
    var items = root.querySelectorAll('.bvx-reveal:not(.is-in)');
    if (!items.length) return;
    if (reduce || !w.IntersectionObserver) {
      for (var i = 0; i < items.length; i++) items[i].classList.add('is-in');
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        for (var n = 0; n < entries.length; n++) {
          if (entries[n].isIntersecting) {
            entries[n].target.classList.add('is-in');
            io.unobserve(entries[n].target);
          }
        }
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    }
    // Anything already on screen is revealed synchronously — no frame needed.
    var vh = w.innerHeight || 800, pending = [];
    for (var j = 0; j < items.length; j++) {
      if (items[j].getBoundingClientRect().top < vh * 0.95) items[j].classList.add('is-in');
      else { pending.push(items[j]); io.observe(items[j]); }
    }
    // Failsafe: if the observer never delivers (starved frames), show everything
    // rather than leave the page blank.
    if (pending.length) {
      setTimeout(function () {
        if (d.querySelectorAll('.bvx-reveal.is-in').length) return;
        for (var p = 0; p < pending.length; p++) pending[p].classList.add('is-in');
      }, 1500);
    }
  }

  /* ---------- in-page anchor scrolling -------------------------------
     Header tabs pointing at "/#section" scroll smoothly, offset by the live
     height of the fixed header. scrollIntoView is deliberately not used. */
  function headerH() {
    var h = d.querySelector('.bvx-header');
    return h ? h.getBoundingClientRect().height : 0;
  }

  function publishHeaderH() {
    var h = headerH();
    if (h) d.documentElement.style.setProperty('--bvx-header-h', Math.round(h) + 'px');
  }
  function scrollToTarget(el, instant) {
    var top = el.getBoundingClientRect().top + (w.scrollY || d.documentElement.scrollTop || 0) - headerH() - 14;
    var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
    w.scrollTo({ top: Math.max(0, top), behavior: instant || reduce ? 'auto' : 'smooth' });
  }
  function hashOf(a) {
    var href = a.getAttribute('href') || '';
    var i = href.indexOf('#');
    if (i < 0) return '';
    var path = href.slice(0, i);
    // same-document links only — leave real page navigation alone
    if (path && path !== '/' && path !== './' && path !== d.location.pathname) return '';
    return href.slice(i + 1);
  }

  function initAnchors() {
    if (d.__bvxAnchors) return;
    d.__bvxAnchors = true;

    d.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href*="#"]') : null;
      if (!a) return;
      var id = hashOf(a);
      if (!id) return;
      var target = d.getElementById(id);
      if (!target) return;
      e.preventDefault();
      var drawer = d.querySelector('.bvx-drawer.is-open');
      if (drawer) {
        drawer.classList.remove('is-open');
        var burger = d.querySelector('.bvx-burger');
        if (burger) burger.setAttribute('aria-expanded', 'false');
      }
      scrollToTarget(target);
      if (d.location.hash !== '#' + id && w.history && w.history.replaceState) {
        w.history.replaceState(null, '', '#' + id);
      }
    });

    // Scroll-spy: light the tab whose section is in view.
    var spyRaf = 0;
    function spy() {
      spyRaf = 0;
      var links = d.querySelectorAll('.bvx-nav__link, .bvx-drawer__link');
      var cut = headerH() + 24, bestId = '', bestTop = -Infinity, i;
      for (i = 0; i < links.length; i++) {
        var id = hashOf(links[i]);
        if (!id) continue;
        var t = d.getElementById(id);
        if (!t) continue;
        var top = t.getBoundingClientRect().top - cut;
        if (top <= 0 && top > bestTop) { bestTop = top; bestId = id; }
      }
      for (i = 0; i < links.length; i++) {
        var lid = hashOf(links[i]);
        links[i].classList.toggle('is-active', !!lid && lid === bestId);
      }
    }
    w.addEventListener('scroll', function () {
      if (!spyRaf) spyRaf = requestAnimationFrame(spy);
    }, { passive: true });
    spy();

    // Arriving with a hash already in the URL.
    if (d.location.hash.length > 1) {
      var deep = d.getElementById(d.location.hash.slice(1));
      if (deep) setTimeout(function () { scrollToTarget(deep, true); }, 140);
    }
  }

  /* ---------- marquee ---------------------------------------------------
     A single set of logos is narrower than the viewport, so cloning it once
     and shifting 50% scrolls a void through the strip. Instead: repeat the
     set until one run overflows the container, clone that run, and shift by
     exactly one run + one gap — seamless at any width or logo count. */
  function initMarquee(root) {
    var tracks = root.querySelectorAll('.bvx-marquee__track');
    for (var i = 0; i < tracks.length; i++) layoutMarquee(tracks[i]);
  }

  var SPEED = 44;   // px per second

  function gapOf(track) {
    var cs = w.getComputedStyle(track);
    return parseFloat(cs.columnGap || cs.gap) || 0;
  }

  /* Measurement note: each .bvx-logo cell is a fixed CSS width, so one set's
     period is known from layout alone — no image decode race, and the shift
     is always an exact multiple of the set. */
  function layoutMarquee(track) {
    var frame = track.parentNode;
    if (!frame) return;

    var gap = gapOf(track);

    // Capture the authored set once. The originals are left in place — wiping
    // them aborts in-flight image loads and leaves permanently empty cells.
    if (!track.__bvxSet) {
      track.__bvxSet = Array.prototype.slice.call(track.children).map(function (el) {
        return el.cloneNode(true);
      });
    }
    var set = track.__bvxSet;
    if (!set.length) return;

    var n = set.length;
    var built = !!track.__bvxPeriod;

    // One authored set, measured from the live DOM's first n cells.
    var setW = 0;
    for (var m = 0; m < n && m < track.children.length; m++) {
      setW += track.children[m].getBoundingClientRect().width;
    }
    setW += gap * (n - 1);
    if (!setW) return;
    var period = setW + gap;

    var reps = Math.max(1, Math.ceil((frame.clientWidth + gap) / period));
    if (built && reps === track.__bvxReps) return;   // existing shift still exact

    track.style.animation = 'none';
    if (built) {
      // Rebuild: images are cached by now, so re-creating them is cheap.
      track.innerHTML = '';
      for (var s = 0; s < n; s++) track.appendChild(set[s].cloneNode(true));
    } else {
      // First pass: keep the authored cells, drop anything beyond them.
      while (track.children.length > n) track.removeChild(track.lastChild);
    }

    for (var r = 1; r < reps; r++) {
      for (var k = 0; k < n; k++) {
        var extra = set[k].cloneNode(true);
        extra.setAttribute('aria-hidden', 'true');
        track.appendChild(extra);
      }
    }

    // Duplicate the run: the copy fills the frame as the original exits.
    var unit = Array.prototype.slice.call(track.children);
    for (var u = 0; u < unit.length; u++) {
      var c = unit[u].cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
    }

    var shift = reps * period;   // exact multiple of the set — cannot jump
    track.__bvxPeriod = period;
    track.__bvxReps = reps;
    track.style.setProperty('--bvx-shift', shift.toFixed(2) + 'px');
    track.style.animation = '';
    track.style.animationDuration = (shift / SPEED).toFixed(2) + 's';
  }

  function initMarqueeResize(root) {
    if (!w.ResizeObserver) return;
    var tracks = root.querySelectorAll('.bvx-marquee__track');
    for (var i = 0; i < tracks.length; i++) {
      (function (track) {
        if (track.__bvxRO) return;
        var raf = 0, lastW = track.parentNode ? track.parentNode.clientWidth : 0;
        track.__bvxRO = new ResizeObserver(function () {
          if (raf) return;
          raf = requestAnimationFrame(function () {
            raf = 0;
            var frame = track.parentNode;
            if (!frame) return;
            var cw = frame.clientWidth;
            if (cw === lastW) return;
            lastW = cw;
            // Only rebuild when the frame needs a different repeat count —
            // otherwise the existing shift is still exact.
            if (track.__bvxPeriod) {
              var need = Math.max(1, Math.ceil((cw + gapOf(track)) / track.__bvxPeriod));
              if (need === track.__bvxReps) return;
            }
            layoutMarquee(track);
          });
        });
        track.__bvxRO.observe(track.parentNode);
      })(tracks[i]);
    }
  }

  function initMarqueeWhenReady(root) {
    initMarquee(root);
    initMarqueeResize(root);
  }

  /* ---------- reading rail --------------------------------------------
     A synapse-styled table of contents for long articles: nodes are the
     article's own headings, the spine charges as you read, and each node
     scrolls to its section. Built from the DOM so editors never maintain
     a second copy of the outline. */
  function slugify(text, used) {
    var base = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
    var id = base, n = 2;
    while (used[id]) { id = base + '-' + n; n++; }
    used[id] = true;
    return id;
  }

  function buildRail(rail) {
    if (rail.__bvxRail) rail.__bvxRail.destroy();

    var prose = d.querySelector(rail.getAttribute('data-bvx-rail-target') || '.bvx-prose');
    var levels = rail.getAttribute('data-bvx-rail-levels') === 'h2h3' ? 'h2, h3' : 'h2';
    var heads = prose ? Array.prototype.slice.call(prose.querySelectorAll(levels)) : [];

    // Two nodes is the minimum where an outline tells the reader anything.
    if (heads.length < 2) { rail.hidden = true; return; }
    rail.hidden = false;

    var used = {}, i;
    for (i = 0; i < heads.length; i++) {
      if (!heads[i].id) heads[i].id = slugify(heads[i].textContent, used);
      else used[heads[i].id] = true;
    }

    var words = (prose.textContent || '').trim().split(/\s+/).length;
    var totalMin = Math.max(1, Math.round(words / 220));
    var showTime = rail.getAttribute('data-bvx-rail-time') !== 'false';
    var label = rail.getAttribute('data-bvx-rail-label') || 'Signal path';

    var html = '' +
      '<div class="bvx-rail__inner">' +
        '<div class="bvx-rail__meter">' +
          '<svg class="bvx-rail__ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">' +
            '<circle class="bvx-rail__ring-track" cx="22" cy="22" r="19"></circle>' +
            '<circle class="bvx-rail__ring-fill" cx="22" cy="22" r="19"></circle>' +
          '</svg>' +
          '<p class="bvx-rail__meta">' +
            '<span class="bvx-rail__pct">0%</span>' +
            (showTime ? '<span class="bvx-rail__time">' + totalMin + ' min read</span>' : '') +
          '</p>' +
        '</div>' +
        (label ? '<p class="bvx-rail__label">' + label + '</p>' : '') +
        '<nav class="bvx-rail__nav" aria-label="Article sections">' +
          '<span class="bvx-rail__spine" aria-hidden="true">' +
            '<span class="bvx-rail__charge"></span>' +
            '<span class="bvx-rail__spark"></span>' +
          '</span>' +
          '<ol class="bvx-rail__list"></ol>' +
        '</nav>' +
      '</div>' +
      '<span class="bvx-rail__bar" aria-hidden="true"></span>';
    rail.innerHTML = html;

    var list = rail.querySelector('.bvx-rail__list');
    var nodes = [];
    for (i = 0; i < heads.length; i++) {
      var li = d.createElement('li');
      li.className = 'bvx-rail__item' + (heads[i].tagName === 'H3' ? ' bvx-rail__item--sub' : '');
      var btn = d.createElement('button');
      btn.type = 'button';
      btn.className = 'bvx-rail__node';
      btn.innerHTML = '<span class="bvx-rail__dot"></span><span class="bvx-rail__text"></span>';
      btn.querySelector('.bvx-rail__text').textContent = heads[i].textContent;
      (function (target) {
        btn.addEventListener('click', function () { scrollToTarget(target); });
      })(heads[i]);
      li.appendChild(btn);
      list.appendChild(li);
      nodes.push(btn);
    }

    var pct = rail.querySelector('.bvx-rail__pct');
    var time = rail.querySelector('.bvx-rail__time');
    var nav = rail.querySelector('.bvx-rail__nav');
    var dots = rail.querySelectorAll('.bvx-rail__dot');
    var active = -1, ticking = false;

    // Dot centre, measured from the top of the nav.
    function dotCentre(i) {
      var r = dots[i].getBoundingClientRect();
      return r.top + r.height / 2 - nav.getBoundingClientRect().top;
    }

    // Run the spine between the first and last dot so it has no dangling
    // head or tail beyond the outline itself.
    function measureSpine() {
      var top = dotCentre(0);
      rail.style.setProperty('--bvx-rail-spine-top', top + 'px');
      rail.style.setProperty('--bvx-rail-spine-h', Math.max(1, dotCentre(dots.length - 1) - top) + 'px');
    }

    function update() {
      ticking = false;
      var y = w.scrollY || d.documentElement.scrollTop || 0;
      var vh = w.innerHeight || 800;
      var box = prose.getBoundingClientRect();
      var top = box.top + y;
      var height = Math.max(1, box.height - vh * 0.4);
      var p = Math.min(1, Math.max(0, (y + headerH() + 24 - top) / height));

      // Reading line: the last heading that has passed under the header.
      var line = headerH() + 96, at = 0;
      for (var k = 0; k < heads.length; k++) {
        if (heads[k].getBoundingClientRect().top <= line) at = k; else break;
      }

      // Charge tracks node positions so the lit spine always matches the lit
      // nodes, even though sections differ wildly in length.
      var here = heads[at].getBoundingClientRect().top;
      // The final section ends at the bottom of the prose, not at a next
      // heading — without that boundary the charge runs past 1 and the spark
      // escapes the panel.
      var until = heads[at + 1] ? heads[at + 1].getBoundingClientRect().top : box.bottom;
      var within = Math.min(1, Math.max(0, (line - here) / Math.max(1, until - here)));

      // Interpolate between real dot positions rather than even fractions:
      // wrapped two-line items make the nodes unevenly spaced, and an even
      // split would drift the spark off the dots.
      var spineTop = dotCentre(0);
      var span = Math.max(1, dotCentre(nodes.length - 1) - spineTop);
      var from = dotCentre(at) - spineTop;
      var to = (at + 1 < nodes.length ? dotCentre(at + 1) - spineTop : from);
      var charge = Math.min(1, Math.max(0, (from + (to - from) * within) / span));

      rail.style.setProperty('--bvx-rail-p', charge.toFixed(4));
      rail.style.setProperty('--bvx-rail-read', p.toFixed(4));
      if (pct) pct.textContent = Math.round(p * 100) + '%';
      if (time) {
        var left = Math.ceil(totalMin * (1 - p));
        time.textContent = p >= 0.995 || left <= 0 ? 'Complete' : left + ' min left';
      }

      if (at !== active) {
        for (var j = 0; j < nodes.length; j++) {
          nodes[j].classList.toggle('is-active', j === at);
          nodes[j].classList.toggle('is-read', j < at);
          if (j === at) nodes[j].setAttribute('aria-current', 'true');
          else nodes[j].removeAttribute('aria-current');
        }
        active = at;
      }
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      w.requestAnimationFrame(update);
    }
    function onResize() {
      measureSpine();                       // item wrapping changes dot spacing
      onScroll();
    }

    w.addEventListener('scroll', onScroll, { passive: true });
    w.addEventListener('resize', onResize);
    measureSpine();
    update();

    rail.__bvxRail = {
      destroy: function () {
        w.removeEventListener('scroll', onScroll);
        w.removeEventListener('resize', onResize);
        rail.__bvxRail = null;
      }
    };
  }

  function initReadingRail(root) {
    var rails = root.querySelectorAll ? root.querySelectorAll('[data-bvx-rail]') : [];
    for (var i = 0; i < rails.length; i++) buildRail(rails[i]);
  }

  function boot(root) {
    root = root || d;
    initHeader(root);
    publishHeaderH();
    if (w.ResizeObserver && d.querySelector('.bvx-header') && !d.__bvxHdrRO) {
      d.__bvxHdrRO = new ResizeObserver(publishHeaderH);
      d.__bvxHdrRO.observe(d.querySelector('.bvx-header'));
    }
    initAnchors();
    initTabs(root);
    initMarqueeWhenReady(root);
    initReveal(root);
    initReadingRail(root);
  }

  w.Braivex = { boot: boot };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { boot(d); });
  else boot(d);

  d.addEventListener('shopify:section:load', function (e) { boot(e.target); });
})(window, document);
