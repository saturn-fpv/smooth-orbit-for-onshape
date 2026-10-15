/*
  Smooth Orbit for Onshape - page script (runs in the page's MAIN world)

  Onshape rounds mouse positions to whole pixels and rotates the camera by a
  fixed angle per pixel (about 0.6 deg on a ~1700 px wide viewport), so even
  a very slow orbit moves in visible steps.

  This script patches Onshape's view manipulator class (the one with onDrag,
  rotateAbout, isRotating). During an orbit it collects the integer pixel
  deltas and replays them every animation frame as small fractional deltas
  through an exponential smoother. Onshape's own rotation code turns those
  into sub-degree camera rotations. Pan, zoom and selection are untouched.

  Settings arrive from bridge.js (extension storage) via DOM events.
  F8 toggles smoothing on/off for quick before/after comparison.
*/
(() => {
  'use strict';
  if (window.__smoothOrbitLoaded) return;
  window.__smoothOrbitLoaded = true;

  const TAG = '[SmoothOrbit]';
  const cfg = { enabled: true, tau: 35, gain: 1 };
  let patched = false;

  // ---- Bridge communication -----------------------------------------------
  const emit = (name, data) =>
    document.dispatchEvent(new CustomEvent('smooth-orbit:' + name, { detail: JSON.stringify(data) }));

  document.addEventListener('smooth-orbit:config', (e) => {
    try {
      const c = JSON.parse(e.detail);
      if (typeof c.enabled === 'boolean') cfg.enabled = c.enabled;
      if (Number.isFinite(c.tau)) cfg.tau = Math.max(0, Math.min(300, c.tau));
      if (Number.isFinite(c.gain)) cfg.gain = Math.max(0.1, Math.min(3, c.gain));
    } catch (_) {}
  });
  document.addEventListener('smooth-orbit:status-request', () =>
    emit('status', { patched, enabled: cfg.enabled }));
  emit('request', {});

  // ---- Locate Onshape's view manipulator via webpack ----------------------
  function getRequire() {
    const chunk = window.webpackChunkNewton;
    if (!chunk || !chunk.push) return null;
    let req = null;
    try { chunk.push([[Symbol('smooth-orbit')], {}, (r) => { req = r; }]); } catch (_) {}
    return req;
  }

  const scanned = new Set();
  function findManipulatorClass(req) {
    if (!req || !req.m) return null;
    for (const id of Object.keys(req.m)) {
      if (scanned.has(id)) continue;
      scanned.add(id);
      let src = '';
      try { src = Function.prototype.toString.call(req.m[id]); } catch (_) { continue; }
      if (!src.includes('ROTATION_CYCLES_PER_SCREEN') || !src.includes('rotateAbout')) continue;
      let exp;
      try { exp = req(id); } catch (_) { continue; }
      if (!exp || typeof exp !== 'object') continue;
      for (const key of Object.keys(exp)) {
        let v;
        try { v = exp[key]; } catch (_) { continue; }
        const p = typeof v === 'function' && v.prototype;
        if (p && typeof p.onDrag === 'function' && typeof p.onDragStop === 'function' &&
            typeof p.rotateAbout === 'function' && typeof p.isRotating === 'function' &&
            typeof p.isAxisRotating === 'function' && typeof p.updateManipulationMode === 'function') {
          return v;
        }
      }
    }
    return null;
  }

  // ---- The patch -----------------------------------------------------------
  const st = { inst: null, args: null, tx: 0, ty: 0, cx: 0, cy: 0, raf: 0, lastT: 0 };

  function patch(Cls) {
    const P = Cls.prototype;
    if (P.__smoothOrbit) return;
    P.__smoothOrbit = true;
    const origDrag = P.onDrag;
    const origStop = P.onDragStop;

    function tick(t) {
      const d = st;
      if (!d.inst) { d.raf = 0; return; }
      const dt = d.lastT ? Math.min(t - d.lastT, 50) : 16;
      d.lastT = t;
      const a = cfg.tau > 0 ? 1 - Math.exp(-dt / cfg.tau) : 1;
      let sx = (d.tx - d.cx) * a;
      let sy = (d.ty - d.cy) * a;
      if (Math.abs(d.tx - d.cx - sx) < 0.005) sx = d.tx - d.cx;
      if (Math.abs(d.ty - d.cy - sy) < 0.005) sy = d.ty - d.cy;
      d.cx += sx; d.cy += sy;
      if (sx || sy) {
        const [e, b, s, r] = d.args;
        try { origDrag.call(d.inst, e, b, sx, sy, s, r); } catch (err) { console.warn(TAG, err); }
      }
      d.raf = (d.cx !== d.tx || d.cy !== d.ty) ? requestAnimationFrame(tick) : 0;
    }

    P.onDrag = function (e, t, i, n, s, r) {
      if (!cfg.enabled) return origDrag.call(this, e, t, i, n, s, r);
      // Mirror Onshape's own mode update so we know what this drag is doing.
      try { if (this.forcedManipulationMode === 'none') this.updateManipulationMode(e, t); } catch (_) {}
      let orbiting = false;
      try { orbiting = this.isRotating() || this.isAxisRotating(); } catch (_) {}
      if (!orbiting) return origDrag.call(this, e, t, i, n, s, r);

      if (st.inst !== this) { st.tx = st.ty = st.cx = st.cy = 0; }
      st.inst = this;
      st.args = [e, t, s, r];
      st.tx += i * cfg.gain;
      st.ty += n * cfg.gain;
      if (!st.raf) { st.lastT = 0; st.raf = requestAnimationFrame(tick); }
    };

    P.onDragStop = function (...a) {
      if (st.inst === this) {
        if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
        const rx = st.tx - st.cx, ry = st.ty - st.cy;
        if (rx || ry) {
          // Flush the remainder, but keep Onshape's release-inertia speed
          // based on the smoothed motion, not on this catch-up step.
          const vx = this.rotationSpeedX, vy = this.rotationSpeedY;
          const [e, b, s, r] = st.args;
          try { origDrag.call(this, e, b, rx, ry, s, r); } catch (err) { console.warn(TAG, err); }
          if (vx !== undefined) this.rotationSpeedX = vx;
          if (vy !== undefined) this.rotationSpeedY = vy;
        }
        st.inst = null; st.args = null;
        st.tx = st.ty = st.cx = st.cy = 0;
      }
      return origStop.apply(this, a);
    };

    patched = true;
    console.info(TAG, 'patched view manipulator');
    emit('status', { patched, enabled: cfg.enabled });
  }

  // Wait until a document with a 3D view is open and its canvas has existed
  // for a moment. By then Onshape has run its own viewer code, so we never
  // trigger it early ourselves, which could break Onshape's startup.
  // Onshape is a single-page app (documents list -> document without a
  // reload), so this keeps polling quietly on non-document pages.
  let tries = 0;
  let canvasTicks = 0;
  const inDocument = () => /^\/documents\/[0-9a-f]+\/[wvm]\//.test(location.pathname);
  const timer = setInterval(() => {
    const canvas = document.getElementById('canvas');
    canvasTicks = inDocument() && canvas && canvas.width > 0 ? canvasTicks + 1 : 0;
    if (canvasTicks < 3) return;
    if (++tries > 60) {
      clearInterval(timer);
      console.warn(TAG, 'view manipulator not found, Onshape may have changed');
      return;
    }
    const req = getRequire();
    const Cls = req && findManipulatorClass(req);
    if (Cls) { clearInterval(timer); patch(Cls); }
  }, 500);

  // ---- F8 quick toggle + toast ---------------------------------------------
  let toastEl, toastTimer;
  function toast(msg) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(20,20,20,.88)', color: '#fff', font: '12px system-ui, sans-serif',
        padding: '6px 10px', borderRadius: '6px', zIndex: 2147483647, pointerEvents: 'none',
        transition: 'opacity .3s', opacity: '0',
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1400);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F8' || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cfg.enabled = !cfg.enabled;
    emit('set', { enabled: cfg.enabled });
    toast('Smooth orbit ' + (cfg.enabled ? 'ON' : 'OFF'));
  }, true);
})();
