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
  }

  w.Braivex = { boot: boot };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { boot(d); });
  else boot(d);

  d.addEventListener('shopify:section:load', function (e) { boot(e.target); });
})(window, document);
