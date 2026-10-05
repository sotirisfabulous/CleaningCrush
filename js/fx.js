/* =========================================================
   FX — canvas particle system (soap bubbles, sparkles, confetti)
   and DOM screen shake. Runs its rAF loop only while particles
   are alive, so it costs nothing when the board is idle.
   ========================================================= */
(function () {
  'use strict';

  const canvas = document.getElementById('fx-canvas');
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX = reduced ? 250 : 900;
  let parts = [];
  let running = false;
  let last = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  const rand = (a, b) => a + Math.random() * (b - a);

  function add(p) {
    if (parts.length >= MAX) parts.shift();
    parts.push(p);
    if (!running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function starPath(r, inner) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 === 0 ? r : r * inner;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  function draw(p, t) {
    const a = Math.max(0, 1 - t);
    ctx.save();
    ctx.translate(p.x, p.y);
    switch (p.kind) {
      case 'bubble': {
        const r = p.size * (0.6 + t * 0.7);
        ctx.globalAlpha = a * 0.95;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + '33';
        ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.14);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();
        break;
      }
      case 'sparkle': {
        ctx.globalAlpha = a;
        ctx.rotate(p.rot);
        const s = p.size * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) * 0.6);
        starPath(s, 0.32);
        ctx.fillStyle = p.color;
        ctx.fill();
        starPath(s * 0.5, 0.32);
        ctx.fillStyle = '#fff';
        ctx.fill();
        break;
      }
      case 'dot': {
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        break;
      }
      case 'confetti': {
        ctx.globalAlpha = Math.min(1, a * 3);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        break;
      }
    }
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const keep = [];
    for (const p of parts) {
      p.age += dt;
      if (p.age < 0) { keep.push(p); continue; }   // delayed spawn
      const t = p.age / p.life;
      if (t >= 1) continue;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.flip !== undefined) p.flip += p.vf * dt;
      if (p.wobble) p.x += Math.sin(p.age * 9 + p.seed) * p.wobble * dt;
      draw(p, t);
      keep.push(p);
    }
    parts = keep;
    if (parts.length) requestAnimationFrame(loop);
    else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  const FX = {
    /** Soap bubbles + sparkles bursting out of (x, y) in page coords. */
    burst(x, y, color, size = 40, power = 1, delay = 0) {
      const n = Math.round((reduced ? 3 : 7) * power);
      for (let i = 0; i < n; i++) {
        const ang = rand(0, Math.PI * 2);
        const sp = rand(60, 200) * (0.7 + power * 0.3);
        const isBubble = i % 3 !== 0;
        add({
          kind: isBubble ? 'bubble' : 'sparkle',
          x: x + rand(-size * 0.15, size * 0.15),
          y: y + rand(-size * 0.15, size * 0.15),
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - (isBubble ? 40 : 0),
          grav: isBubble ? -60 : 120,
          drag: isBubble ? 0.93 : 0.9,
          size: isBubble ? rand(size * 0.08, size * 0.2) : rand(size * 0.12, size * 0.24),
          color,
          rot: rand(0, Math.PI),
          vr: rand(-6, 6),
          life: rand(0.45, 0.85),
          age: -delay,
          wobble: isBubble ? 30 : 0,
          seed: Math.random() * 10,
        });
      }
      // a few tiny white glints
      for (let i = 0; i < (reduced ? 1 : 3); i++) {
        const ang = rand(0, Math.PI * 2);
        add({
          kind: 'dot', x, y,
          vx: Math.cos(ang) * rand(120, 280), vy: Math.sin(ang) * rand(120, 280),
          grav: 0, drag: 0.88, size: rand(1.5, 3), color: '#ffffff',
          rot: 0, vr: 0, life: rand(0.3, 0.5), age: -delay,
        });
      }
    },

    /** Gentle sparkle shower used when a stain gets scrubbed clean. */
    glint(x, y, size = 40, delay = 0) {
      for (let i = 0; i < (reduced ? 2 : 5); i++) {
        add({
          kind: 'sparkle',
          x: x + rand(-size * 0.35, size * 0.35),
          y: y + rand(-size * 0.35, size * 0.35),
          vx: rand(-30, 30), vy: rand(-90, -30),
          grav: 0, drag: 0.95, size: rand(size * 0.1, size * 0.2),
          color: '#fff6c8', rot: rand(0, 3), vr: rand(-4, 4),
          life: rand(0.5, 0.9), age: -delay - i * 0.04,
        });
      }
    },

    /** Celebration confetti across the whole screen. */
    confetti(colors, count = 140) {
      const n = reduced ? Math.round(count / 4) : count;
      for (let i = 0; i < n; i++) {
        add({
          kind: 'confetti',
          x: rand(0, innerWidth),
          y: rand(-innerHeight * 0.3, -10),
          vx: rand(-60, 60), vy: rand(120, 320),
          grav: 140, drag: 0.985,
          size: rand(8, 14),
          color: colors[i % colors.length],
          rot: rand(0, Math.PI), vr: rand(-5, 5),
          flip: rand(0, Math.PI), vf: rand(4, 10),
          life: rand(2.2, 3.4), age: -rand(0, 0.8),
        });
      }
    },

    /** Restartable CSS screen shake. level: 1..3 */
    shake(el, level = 1) {
      if (reduced) return;
      el.classList.remove('shake-1', 'shake-2', 'shake-3');
      void el.offsetWidth; // restart animation
      el.classList.add('shake-' + Math.min(3, Math.max(1, level)));
    },

    vibrate(ms) {
      if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
    },
  };

  window.FX = FX;
})();
