/* =========================================================
   Sound — tiny Web Audio synth.
   Every sound is generated in code so the game ships with zero
   audio files. To swap in real samples later, put a URL in
   SAMPLE_URLS and it will be used instead of the synth voice.
   ========================================================= */
(function () {
  'use strict';

  const SAMPLE_URLS = {
    pop: null,      // e.g. 'audio/pop.mp3'
    swoosh: null,
    combo: null,
  };

  // C-major pentatonic, two octaves — combos climb this ladder
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  const samples = {};

  try { muted = localStorage.getItem('cc-muted') === '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    Object.entries(SAMPLE_URLS).forEach(([name, url]) => {
      if (!url) return;
      fetch(url)
        .then(r => r.arrayBuffer())
        .then(b => ctx.decodeAudioData(b))
        .then(buf => { samples[name] = buf; })
        .catch(() => {});
    });
  }

  // Unlock audio on the first user gesture (autoplay policies)
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, init, { once: false, passive: true }));

  const ready = () => ctx && !muted && ctx.state === 'running';

  function playSample(name, rate = 1) {
    const s = ctx.createBufferSource();
    s.buffer = samples[name];
    s.playbackRate.value = rate;
    s.connect(master);
    s.start();
  }

  function tone({ freq, to, type = 'sine', dur = 0.15, vol = 0.4, attack = 0.005, when = 0, dest = master }) {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise({ dur = 0.2, vol = 0.3, type = 'bandpass', f0 = 800, f1 = 3000, q = 1.2, when = 0 }) {
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  let lastPop = 0;

  const Sound = {
    init,
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('cc-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
    },

    /** Bubble pop. `pitch` rises with combo level. */
    pop(pitch = 1) {
      if (!ready()) return;
      // throttle: big clears trigger dozens of pops in the same frame
      const now = ctx.currentTime;
      if (now - lastPop < 0.025) return;
      lastPop = now;
      if (samples.pop) return playSample('pop', pitch);
      const f = (520 + Math.random() * 160) * pitch;
      tone({ freq: f, to: f * 0.35, type: 'sine', dur: 0.12, vol: 0.32 });
      tone({ freq: f * 2.02, to: f * 0.9, type: 'triangle', dur: 0.05, vol: 0.08 });
      noise({ dur: 0.04, vol: 0.06, type: 'highpass', f0: 3000, f1: 6000, q: 0.7 });
    },

    /** Swap swoosh — filtered noise sweep. */
    swoosh() {
      if (!ready()) return;
      if (samples.swoosh) return playSample('swoosh');
      noise({ dur: 0.2, vol: 0.22, type: 'bandpass', f0: 500, f1: 2600, q: 1.6 });
    },

    /** Combo arpeggio — climbs higher on each cascade step. */
    combo(level = 1) {
      if (!ready()) return;
      if (samples.combo) return playSample('combo', 1 + level * 0.08);
      const base = Math.min(level - 1, SCALE.length - 3);
      [0, 1, 2].forEach((k, i) =>
        tone({ freq: SCALE[base + k], type: 'triangle', dur: 0.22, vol: 0.18, when: i * 0.06 }));
      tone({ freq: SCALE[base + 2] * 2, type: 'sine', dur: 0.35, vol: 0.06, when: 0.12 });
    },

    select() {
      if (!ready()) return;
      tone({ freq: 880, to: 1320, type: 'sine', dur: 0.07, vol: 0.12 });
    },

    invalid() {
      if (!ready()) return;
      tone({ freq: 240, to: 200, type: 'triangle', dur: 0.1, vol: 0.22 });
      tone({ freq: 200, to: 160, type: 'triangle', dur: 0.12, vol: 0.2, when: 0.1 });
    },

    /** A special piece being created. */
    sparkle() {
      if (!ready()) return;
      [0, 1, 2, 3].forEach(i =>
        tone({ freq: 1318 + i * 330, type: 'sine', dur: 0.18, vol: 0.09, when: i * 0.045 }));
    },

    /** Squeegee line clear. */
    zap() {
      if (!ready()) return;
      tone({ freq: 300, to: 1800, type: 'sawtooth', dur: 0.18, vol: 0.07 });
      noise({ dur: 0.3, vol: 0.2, type: 'bandpass', f0: 1200, f1: 5000, q: 0.8 });
    },

    /** Fizz bomb / big blast. */
    boom() {
      if (!ready()) return;
      tone({ freq: 170, to: 40, type: 'sine', dur: 0.4, vol: 0.5 });
      noise({ dur: 0.45, vol: 0.3, type: 'lowpass', f0: 2400, f1: 200, q: 0.5 });
      noise({ dur: 0.3, vol: 0.1, type: 'highpass', f0: 4000, f1: 8000, q: 0.5, when: 0.04 });
    },

    shuffle() {
      if (!ready()) return;
      for (let i = 0; i < 5; i++) noise({ dur: 0.08, vol: 0.12, f0: 800 + i * 300, f1: 2400, when: i * 0.06 });
    },

    win() {
      if (!ready()) return;
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.4, vol: 0.2, when: i * 0.11 }));
      tone({ freq: 1567.98, type: 'sine', dur: 0.9, vol: 0.12, when: 0.55 });
    },

    lose() {
      if (!ready()) return;
      [392, 349.23, 311.13, 261.63].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.35, vol: 0.18, when: i * 0.16 }));
    },

    star(i = 0) {
      if (!ready()) return;
      tone({ freq: SCALE[3 + i * 2], type: 'sine', dur: 0.3, vol: 0.18 });
      tone({ freq: SCALE[3 + i * 2] * 2, type: 'sine', dur: 0.25, vol: 0.06, when: 0.03 });
    },
  };

  window.Sound = Sound;
})();
