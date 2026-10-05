/* =========================================================
   Cleaning Crush — game engine
   Board model: grid[r][c] = tile | null
   tile = { id, type (0..5 | RAINBOW), special: null|'h'|'v'|'bomb'|'color', r, c, el }
   ========================================================= */
(function () {
  'use strict';

  const SIZE = 8;
  const RAINBOW = -1;
  const TYPES = [
    { glyph: 'g-soap',   name: 'Soap',    color: '#ff9fbf', deep: '#e2668f' },
    { glyph: 'g-sponge', name: 'Sponge',  color: '#ffd66b', deep: '#d99a1f' },
    { glyph: 'g-spray',  name: 'Spray',   color: '#84dcb9', deep: '#33a27a' },
    { glyph: 'g-drop',   name: 'Droplet', color: '#8cc8f2', deep: '#3c88c4' },
    { glyph: 'g-star',   name: 'Sparkle', color: '#bba3f2', deep: '#7a5bcf' },
    { glyph: 'g-bucket', name: 'Bucket',  color: '#ffb486', deep: '#e0733a' },
  ];
  const PASTELS = TYPES.map(t => t.color).concat(['#ffffff', '#fff3b0']);
  const COMBO_WORDS = [null, null, ['Fresh!', '#7fcdb1'], ['Sparkling!', '#9fb4f5'], ['Spotless!', '#c27be8'], ['Squeaky Clean!', '#f27aa5']];
  const PTS = 20;
  const SPECIAL_BONUS = { h: 60, v: 60, bomb: 120, color: 250 };

  /* ---------- DOM ---------- */
  const $ = s => document.querySelector(s);
  const boardEl = $('#board');
  const boardWrap = $('#board-wrap');
  const tilesEl = $('#tiles');
  const cellsEl = $('#cells');
  const stainsEl = $('#stains');
  const fxEl = $('#board-fx');
  const bannerEl = $('#banner');
  const areaEl = $('#board-area');

  /* ---------- state ---------- */
  let grid = [];
  let stains = [];
  let stainEls = [];
  let level = null;
  let moves = 0;
  let score = 0;
  let shownScore = 0;
  let collected = [];
  let busy = false;
  let ended = true;
  let selected = null;
  let drag = null;
  let uid = 0;
  let cell = 44;
  let hintTimer = 0;
  let hintTiles = [];
  let deferredInstall = null;

  /* ---------- persistence ---------- */
  const save = (() => {
    let data = { unlocked: 1, stars: {}, best: {} };
    try { Object.assign(data, JSON.parse(localStorage.getItem('cc-save') || '{}')); } catch (e) { /* fresh */ }
    return {
      data,
      write() { try { localStorage.setItem('cc-save', JSON.stringify(data)); } catch (e) { /* ignore */ } },
    };
  })();

  /* ---------- helpers ---------- */
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const key = (r, c) => r * SIZE + c;
  const inB = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
  const rnd = n => Math.floor(Math.random() * n);
  const later = (ms, fn) => (ms <= 0 ? fn() : setTimeout(fn, ms));

  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* =========================================================
     Levels — generated deterministically from the level number
     ========================================================= */
  function buildLevel(n) {
    const rng = seeded(n * 7919 + 13);
    const L = { n, types: n <= 2 ? 5 : 6, moves: 20, goals: [], stains: [] };
    for (let r = 0; r < SIZE; r++) L.stains.push(new Array(SIZE).fill(0));

    const addStains = (count, doubleChance) => {
      const half = Math.ceil(count / 2);
      let placed = 0, guard = 0;
      while (placed < half && guard++ < 500) {
        // bias toward the middle and lower part of the board
        const r = Math.min(SIZE - 1, Math.floor(Math.sqrt(rng()) * SIZE));
        const c = Math.floor(rng() * (SIZE / 2));
        if (L.stains[r][c]) continue;
        const layers = rng() < doubleChance ? 2 : 1;
        L.stains[r][c] = layers;
        L.stains[r][SIZE - 1 - c] = layers;   // mirror for a tidy pattern
        placed++;
      }
    };
    const collectGoals = (count, amount) => {
      const picks = [];
      while (picks.length < count) {
        const t = Math.floor(rng() * L.types);
        if (!picks.includes(t)) picks.push(t);
      }
      picks.forEach(t => L.goals.push({ kind: 'collect', type: t, amount }));
    };

    const cycle = ['stains', 'collect', 'stains', 'mixed', 'collect'];
    const kind = n === 1 ? 'score' : n === 2 ? 'collect' : n === 3 ? 'stains' : cycle[(n - 4) % cycle.length];
    const dbl = n < 6 ? 0 : Math.min(0.6, (n - 5) * 0.07);

    if (kind === 'score') {
      L.moves = 18;
      L.goals.push({ kind: 'score', target: 1000 });
    } else if (kind === 'collect') {
      const k = n < 8 ? 2 : 3;
      collectGoals(k, Math.min(40, Math.round(10 + n * 1.3)));
      L.moves = 16 + k * 3;
    } else if (kind === 'stains') {
      const count = Math.min(44, 10 + n * 2);
      addStains(count, dbl);
      L.goals.push({ kind: 'stain' });
      L.moves = 16 + Math.ceil(count / 6);
    } else {
      const count = Math.min(30, 8 + n);
      addStains(count, dbl);
      L.goals.push({ kind: 'stain' });
      collectGoals(1, Math.min(30, 10 + n));
      L.moves = 20 + Math.ceil(count / 8);
    }
    const s1 = kind === 'score' ? 1000 : L.moves * 40;
    L.thresholds = [s1, Math.round(L.moves * 85 / 10) * 10 + (kind === 'score' ? 400 : 0), Math.round(L.moves * 130 / 10) * 10 + (kind === 'score' ? 600 : 0)];
    return L;
  }

  /* =========================================================
     Tiles & board rendering
     ========================================================= */
  function makeTile(type, r, c, special = null) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.innerHTML = '<div class="tile-body"><svg viewBox="0 0 24 24"><use/></svg></div>';
    const t = { id: ++uid, type, special, r, c, el };
    look(t);
    setPos(t, r, c, 0);
    tilesEl.appendChild(el);
    return t;
  }

  function look(t) {
    const { el } = t;
    if (t.type >= 0) el.dataset.t = t.type;
    else delete el.dataset.t;
    el.classList.toggle('sp-h', t.special === 'h');
    el.classList.toggle('sp-v', t.special === 'v');
    el.classList.toggle('sp-bomb', t.special === 'bomb');
    el.classList.toggle('sp-color', t.special === 'color');
    el.querySelector('use').setAttribute('href', '#' + (t.type === RAINBOW ? 'g-rainbow' : TYPES[t.type].glyph));
  }

  function setPos(t, r, c, dur = 200, ease = 'ease-in-out', delay = 0) {
    t.r = r;
    t.c = c;
    const s = t.el.style;
    s.setProperty('--dur', dur + 'ms');
    s.setProperty('--ease', ease);
    s.transitionDelay = delay ? delay + 'ms' : '';
    s.setProperty('--x', c);
    s.setProperty('--y', r);
  }

  function flash(t, cls, ms) {
    t.el.classList.remove(cls);
    void t.el.offsetWidth;
    t.el.classList.add(cls);
    setTimeout(() => t.el.classList.remove(cls), ms);
  }

  function renderCells() {
    cellsEl.innerHTML = '';
    stainsEl.innerHTML = '';
    stainEls = [];
    for (let r = 0; r < SIZE; r++) {
      stainEls.push([]);
      for (let c = 0; c < SIZE; c++) {
        const d = document.createElement('div');
        d.className = 'cell' + ((r + c) % 2 ? ' alt' : '');
        let s = null;
        if (stains[r][c]) {
          d.classList.add('dirty');
          if (stains[r][c] > 1) d.classList.add('l2');
          stainsEl.insertAdjacentHTML('beforeend',
            `<svg class="stain${stains[r][c] > 1 ? ' l2' : ''}" viewBox="0 0 40 40" style="--x:${c};--y:${r}"><use href="#g-stain" transform="rotate(${rnd(360)} 20 20)"/></svg>`);
          s = { svg: stainsEl.lastChild, cell: d };
        }
        stainEls[r].push(s);
        cellsEl.appendChild(d);
      }
    }
  }

  function typeGrid() {
    return grid.map(row => row.map(t => (t && t.type >= 0 ? t.type : -9 - Math.random())));
  }

  function fillBoard() {
    let T;
    for (let attempt = 0; attempt < 100; attempt++) {
      T = [];
      for (let r = 0; r < SIZE; r++) {
        T.push([]);
        for (let c = 0; c < SIZE; c++) {
          let t;
          do t = rnd(level.types);
          while ((c >= 2 && T[r][c - 1] === t && T[r][c - 2] === t) || (r >= 2 && T[r - 1][c] === t && T[r - 2][c] === t));
          T[r].push(t);
        }
      }
      if (findMove(T)) break;
    }
    tilesEl.innerHTML = '';
    grid = T.map((row, r) => row.map((t, c) => makeTile(t, r - SIZE - 1, c)));
    void tilesEl.offsetWidth;
    // playful drop-in, staggered by column then row
    let max = 0;
    grid.forEach((row, r) => row.forEach((t, c) => {
      const delay = c * 35 + (SIZE - r) * 25;
      max = Math.max(max, delay);
      setPos(t, r, c, 520, 'cubic-bezier(.45,.05,.5,1.25)', delay);
    }));
    return wait(max + 560);
  }

  /* =========================================================
     Match detection
     ========================================================= */
  const typeAt = (r, c) => {
    const t = grid[r] && grid[r][c];
    return t && t.type >= 0 ? t.type : null;
  };

  function findGroups() {
    const runs = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE;) {
        const t = typeAt(r, c);
        let len = 1;
        while (t !== null && c + len < SIZE && typeAt(r, c + len) === t) len++;
        if (t !== null && len >= 3) runs.push({ dir: 'h', type: t, cells: Array.from({ length: len }, (_, i) => [r, c + i]) });
        c += len;
      }
    }
    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r < SIZE;) {
        const t = typeAt(r, c);
        let len = 1;
        while (t !== null && r + len < SIZE && typeAt(r + len, c) === t) len++;
        if (t !== null && len >= 3) runs.push({ dir: 'v', type: t, cells: Array.from({ length: len }, (_, i) => [r + i, c]) });
        r += len;
      }
    }
    if (!runs.length) return [];

    // merge runs that share a cell (L, T and + shapes) with union-find
    const parent = runs.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map();
    runs.forEach((run, i) => run.cells.forEach(([r, c]) => {
      const k = key(r, c);
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }));
    const groups = new Map();
    runs.forEach((run, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, { runs: [], cells: new Map(), type: run.type });
      const g = groups.get(root);
      g.runs.push(run);
      run.cells.forEach(([r, c]) => g.cells.set(key(r, c), [r, c]));
    });
    return [...groups.values()];
  }

  function specialFor(g) {
    const maxLen = Math.max(...g.runs.map(r => r.cells.length));
    const hasH = g.runs.some(r => r.dir === 'h');
    const hasV = g.runs.some(r => r.dir === 'v');
    if (maxLen >= 5) return 'color';
    if (hasH && hasV) return 'bomb';
    if (maxLen === 4) return g.runs[0].dir === 'h' ? 'v' : 'h';
    return null;
  }

  function spawnCell(g, sp, swapKeys) {
    const ok = k => g.cells.has(k) && !grid[Math.floor(k / SIZE)][k % SIZE].special;
    if (swapKeys) for (const k of swapKeys) if (ok(k)) return g.cells.get(k);
    if (sp === 'bomb') {
      const h = g.runs.find(r => r.dir === 'h');
      const v = g.runs.find(r => r.dir === 'v');
      const hs = new Set(h.cells.map(([r, c]) => key(r, c)));
      const x = v.cells.find(([r, c]) => hs.has(key(r, c)));
      if (x && ok(key(x[0], x[1]))) return x;
    }
    const longest = g.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
    const mid = longest.cells[Math.floor((longest.cells.length - 1) / 2)];
    if (ok(key(mid[0], mid[1]))) return mid;
    for (const [k, rc] of g.cells) if (ok(k)) return rc;
    return null;
  }

  /** Looks for a legal move. Works on the live grid or on a plain type matrix. */
  function findMove(T, all = false) {
    const live = !T;
    if (live) T = typeGrid();
    const hits = [];
    const lineAt = (r, c) => {
      const t = T[r][c];
      let h = 1, v = 1;
      for (let i = c - 1; i >= 0 && T[r][i] === t; i--) h++;
      for (let i = c + 1; i < SIZE && T[r][i] === t; i++) h++;
      for (let i = r - 1; i >= 0 && T[i][c] === t; i--) v++;
      for (let i = r + 1; i < SIZE && T[i][c] === t; i++) v++;
      return h >= 3 || v >= 3;
    };
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const r2 = r + dr, c2 = c + dc;
          if (!inB(r2, c2)) continue;
          if (live) {
            const a = grid[r][c], b = grid[r2][c2];
            if (a.type === RAINBOW || b.type === RAINBOW || (a.special && b.special)) {
              hits.push([r, c, r2, c2]);
              if (!all) return hits[0];
              continue;
            }
          }
          [T[r][c], T[r2][c2]] = [T[r2][c2], T[r][c]];
          const ok = lineAt(r, c) || lineAt(r2, c2);
          [T[r][c], T[r2][c2]] = [T[r2][c2], T[r][c]];
          if (ok) {
            hits.push([r, c, r2, c2]);
            if (!all) return hits[0];
          }
        }
      }
    }
    return all ? hits : null;
  }

  /* =========================================================
     Board FX helpers
     ========================================================= */
  function pageXY(r, c) {
    const b = boardEl.getBoundingClientRect();
    return [b.left + (c + 0.5) * cell, b.top + (r + 0.5) * cell];
  }

  function beam(dir, idx, origin) {
    const d = document.createElement('div');
    d.className = 'beam ' + dir;
    if (dir === 'h') {
      d.style.top = idx * cell + 'px';
      d.style.transformOrigin = ((origin + 0.5) / SIZE) * 100 + '% 50%';
    } else {
      d.style.left = idx * cell + 'px';
      d.style.transformOrigin = '50% ' + ((origin + 0.5) / SIZE) * 100 + '%';
    }
    fxEl.appendChild(d);
    setTimeout(() => d.remove(), 600);
  }

  function ring(r, c, scale = 1.2) {
    const d = document.createElement('div');
    d.className = 'ring';
    d.style.left = (c + 0.5) * cell + 'px';
    d.style.top = (r + 0.5) * cell + 'px';
    d.style.setProperty('--rs', scale);
    fxEl.appendChild(d);
    setTimeout(() => d.remove(), 650);
  }

  function floatText(r, c, text, color) {
    const d = document.createElement('div');
    d.className = 'float-score';
    d.textContent = text;
    d.style.left = (c + 0.5) * cell + 'px';
    d.style.top = (r + 0.5) * cell + 'px';
    d.style.setProperty('--fc', color);
    fxEl.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  function banner(text, color = '#c27be8') {
    bannerEl.textContent = text;
    bannerEl.style.setProperty('--bc', color);
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
  }

  /* =========================================================
     Clearing — the heart of the game.
     `init` maps cell key -> { delay, src, conv }. Specials hit by a
     clear are chained breadth-first; `pre` holds ids already consumed.
     ========================================================= */
  async function clearCells(init, creations, combo, pre = new Set()) {
    const protect = new Set(creations.map(cr => key(cr.r, cr.c)));
    const toClear = new Map();
    const activated = new Set(pre);
    const queue = [];
    const sources = [];
    const ptsPer = PTS * combo;

    const add = (r, c, delay, src, conv = null) => {
      if (!inB(r, c)) return;
      const t = grid[r][c];
      const k = key(r, c);
      if (!t || protect.has(k) || toClear.has(k)) return;
      toClear.set(k, { t, r, c, delay, conv });
      if (src) src.count++;
      if (t.special && !activated.has(t.id)) {
        activated.add(t.id);
        queue.push({ t, r, c, delay });
      }
    };

    for (const [k, v] of init) add(Math.floor(k / SIZE), k % SIZE, v.delay || 0, v.src, v.conv);

    while (queue.length) {
      const { t, r, c, delay } = queue.shift();
      const src = { r, c, delay, count: 0, bonus: SPECIAL_BONUS[t.special], color: t.type >= 0 ? TYPES[t.type].deep : '#a77be0' };
      sources.push(src);
      if (t.special === 'h' || t.special === 'v') {
        const horiz = t.special === 'h';
        later(delay, () => { beam(horiz ? 'h' : 'v', horiz ? r : c, horiz ? c : r); Sound.zap(); FX.shake(boardWrap, 2); FX.vibrate(25); });
        for (let i = 0; i < SIZE; i++) {
          if (horiz) add(r, i, delay + 50 + Math.abs(i - c) * 28, src);
          else add(i, c, delay + 50 + Math.abs(i - r) * 28, src);
        }
      } else if (t.special === 'bomb') {
        later(delay, () => { ring(r, c, 1.5); Sound.boom(); FX.shake(boardWrap, 3); FX.vibrate(40); });
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const d = Math.abs(dr) + Math.abs(dc);
          if (d <= 2) add(r + dr, c + dc, delay + 60 + d * 35, src);
        }
      } else if (t.special === 'color') {
        add(r, c, delay, src);
        const counts = new Array(TYPES.length).fill(0);
        grid.forEach(row => row.forEach(x => { if (x && x.type >= 0 && !toClear.has(key(x.r, x.c))) counts[x.type]++; }));
        const target = counts.indexOf(Math.max(...counts));
        later(delay, () => { ring(r, c, 2.6); Sound.sparkle(); FX.shake(boardWrap, 2); });
        let i = 0;
        grid.forEach(row => row.forEach(x => { if (x && x.type === target) add(x.r, x.c, delay + 80 + i++ * 24, src); }));
      }
    }

    // ---- visuals, grouped per delay so sounds don't stack ----
    const byDelay = new Map();
    let maxDelay = 0;
    for (const v of toClear.values()) {
      if (!byDelay.has(v.delay)) byDelay.set(v.delay, []);
      byDelay.get(v.delay).push(v);
      maxDelay = Math.max(maxDelay, v.delay);
    }
    const pitch = 1 + Math.min(combo - 1, 6) * 0.1;
    for (const [delay, list] of byDelay) {
      later(delay, () => {
        Sound.pop(pitch + Math.random() * 0.06);
        for (const { t, r, c, conv } of list) {
          const [x, y] = pageXY(r, c);
          const color = t.type >= 0 ? TYPES[t.type].color : PASTELS[rnd(PASTELS.length)];
          FX.burst(x, y, color, cell, conv ? 0.6 : 1);
          if (conv) {
            t.el.classList.add('converge');
            setPos(t, conv[0], conv[1], 200, 'cubic-bezier(.6,0,.9,.5)');
          } else {
            t.el.classList.add('pop');
          }
          if (t.type >= 0) collected[t.type]++;
          scrub(r, c);
          addScore(ptsPer);
        }
        updateGoals();
      });
    }

    // ---- creations become specials once their group has converged ----
    for (const cr of creations) {
      const t = grid[cr.r][cr.c];
      t.special = cr.special;
      if (cr.special === 'color') t.type = RAINBOW;
      scrub(cr.r, cr.c);
      addScore(SPECIAL_BONUS[cr.special]);
      later(170, () => {
        look(t);
        flash(t, 'morph', 460);
        Sound.sparkle();
        const [x, y] = pageXY(cr.r, cr.c);
        FX.burst(x, y, '#ffffff', cell, 1.4);
      });
    }

    // ---- floating score labels ----
    const allSrc = new Set();
    for (const v of init.values()) if (v.src) allSrc.add(v.src);
    sources.forEach(s => allSrc.add(s));
    for (const s of allSrc) {
      if (!s.count && !s.bonus) continue;
      const pts = s.count * ptsPer + (s.bonus || 0);
      if (pts > 0) later(s.delay || 0, () => floatText(s.r, s.c, '+' + pts, s.color));
    }

    for (const { r, c } of toClear.values()) grid[r][c] = null;
    await wait(maxDelay + 330);
    for (const { t } of toClear.values()) t.el.remove();
  }

  function scrub(r, c) {
    if (!stains[r][c]) return;
    stains[r][c]--;
    const { svg, cell: cellDiv } = stainEls[r][c];
    const [x, y] = pageXY(r, c);
    FX.glint(x, y, cell);
    if (stains[r][c] === 0) {
      svg.classList.add('cleaning');
      cellDiv.classList.remove('dirty', 'l2');
      setTimeout(() => svg.remove(), 520);
      stainEls[r][c] = null;
    } else {
      svg.classList.remove('l2');
      cellDiv.classList.remove('l2');
    }
    updateGoals();
  }

  /** Normal matches: each group may leave a special behind. */
  async function resolveGroups(groups, swapKeys, combo) {
    const init = new Map();
    const creations = [];
    let biggest = 0;
    for (const g of groups) {
      const sp = specialFor(g);
      const spawn = sp ? spawnCell(g, sp, swapKeys) : null;
      const cells = [...g.cells.values()];
      biggest = Math.max(biggest, cells.length);
      const src = {
        r: cells.reduce((a, [r]) => a + r, 0) / cells.length,
        c: cells.reduce((a, [, c]) => a + c, 0) / cells.length,
        count: 0, bonus: sp && spawn ? SPECIAL_BONUS[sp] : 0, color: TYPES[g.type].deep,
      };
      if (spawn) creations.push({ r: spawn[0], c: spawn[1], special: sp });
      for (const [k, [r, c]] of g.cells) {
        if (spawn && k === key(spawn[0], spawn[1])) { src.count++; continue; }
        init.set(k, { delay: 0, src, conv: spawn });
      }
    }
    if (biggest >= 4) { FX.shake(boardWrap, biggest >= 5 ? 2 : 1); FX.vibrate(15); }
    await clearCells(init, creations, combo);
  }

  /** Gravity + refill. */
  async function collapse() {
    let maxT = 0;
    const fresh = [];
    const fall = 'cubic-bezier(.5,.08,.55,1.28)';
    for (let c = 0; c < SIZE; c++) {
      let write = SIZE - 1;
      for (let r = SIZE - 1; r >= 0; r--) {
        const t = grid[r][c];
        if (!t) continue;
        if (r !== write) {
          grid[write][c] = t;
          grid[r][c] = null;
          const dur = 150 + (write - r) * 55;
          t.el.classList.remove('converge', 'pop');
          setPos(t, write, c, dur, fall);
          later(dur, () => flash(t, 'spawn', 330));
          maxT = Math.max(maxT, dur);
        }
        write--;
      }
      const missing = write + 1;
      for (let r = write; r >= 0; r--) {
        const t = makeTile(rnd(level.types), r - missing, c);
        grid[r][c] = t;
        fresh.push([t, r, c, 150 + missing * 55 + c * 12]);
      }
    }
    if (fresh.length) {
      void tilesEl.offsetWidth;
      for (const [t, r, c, dur] of fresh) {
        setPos(t, r, c, dur, fall);
        later(dur, () => flash(t, 'spawn', 330));
        maxT = Math.max(maxT, dur);
      }
    }
    await wait(maxT + 40);
  }

  /** Repeats match → clear → collapse until the board settles. */
  async function cascade(combo, swapKeys) {
    for (;;) {
      const groups = findGroups();
      if (!groups.length) break;
      combo++;
      if (combo >= 2) {
        Sound.combo(combo);
        const w = COMBO_WORDS[Math.min(combo, COMBO_WORDS.length - 1)];
        banner(w[0], w[1]);
      }
      await resolveGroups(groups, swapKeys, combo);
      swapKeys = null;
      await collapse();
    }
    return combo;
  }

  /** Swapping two specials, or a Super Soap with anything. */
  async function specialSwap(a, b) {
    const init = new Map();
    const pre = new Set([a.id, b.id]);
    const { r, c } = a;
    const isRb = t => t.type === RAINBOW;
    const src = { r, c, count: 0, bonus: 0, color: '#a77be0' };
    const put = (rr, cc, d) => { if (inB(rr, cc)) init.set(key(rr, cc), { delay: d, src }); };

    if (isRb(a) && isRb(b)) {
      banner('Total Clean!', '#f27aa5');
      ring(r, c, 4); Sound.boom(); Sound.sparkle(); FX.shake(boardWrap, 3); FX.vibrate(60);
      src.bonus = 1000;
      for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) put(i, j, (Math.abs(i - r) + Math.abs(j - c)) * 35);
    } else if (isRb(a) || isRb(b)) {
      const rb = isRb(a) ? a : b;
      const other = rb === a ? b : a;
      const targets = [];
      grid.forEach(row => row.forEach(t => { if (t && t.type === other.type && t !== rb) targets.push(t); }));
      ring(rb.r, rb.c, 2.6);
      Sound.sparkle();
      if (other.special) {
        // every piece of that colour becomes a special, then they all go off
        banner(other.special === 'bomb' ? 'Fizz Frenzy!' : 'Squeegee Storm!', '#9fb4f5');
        targets.forEach((t, i) => later(i * 45, () => {
          t.special = other.special === 'bomb' ? 'bomb' : (Math.random() < 0.5 ? 'h' : 'v');
          look(t);
          flash(t, 'morph', 460);
          Sound.select();
        }));
        await wait(targets.length * 45 + 420);
        pre.delete(other.id);
        put(rb.r, rb.c, 0);
        targets.forEach((t, i) => put(t.r, t.c, 80 + i * 110));
      } else {
        put(rb.r, rb.c, 0);
        targets.forEach((t, i) => put(t.r, t.c, 60 + i * 30));
      }
      src.r = rb.r; src.c = rb.c; src.bonus = 300;
    } else {
      const s1 = a.special, s2 = b.special;
      const line = s => s === 'h' || s === 'v';
      put(a.r, a.c, 0); put(b.r, b.c, 0);
      if (line(s1) && line(s2)) {
        beam('h', r, c); beam('v', c, r); Sound.zap(); FX.shake(boardWrap, 2);
        for (let i = 0; i < SIZE; i++) { put(r, i, 40 + Math.abs(i - c) * 28); put(i, c, 40 + Math.abs(i - r) * 28); }
        src.bonus = 200;
      } else if (s1 === 'bomb' && s2 === 'bomb') {
        banner('Mega Fizz!', '#ffb486');
        ring(r, c, 3); Sound.boom(); FX.shake(boardWrap, 3); FX.vibrate(60);
        for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
          if (Math.abs(dr) + Math.abs(dc) <= 4) put(r + dr, c + dc, 60 + (Math.abs(dr) + Math.abs(dc)) * 40);
        }
        src.bonus = 400;
      } else {
        banner('Deep Clean!', '#7fcdb1');
        Sound.zap(); Sound.boom(); FX.shake(boardWrap, 3);
        for (let k = -1; k <= 1; k++) {
          if (inB(r + k, 0)) beam('h', r + k, c);
          if (inB(0, c + k)) beam('v', c + k, r);
          for (let i = 0; i < SIZE; i++) { put(r + k, i, 40 + Math.abs(i - c) * 28); put(i, c + k, 40 + Math.abs(i - r) * 28); }
        }
        src.bonus = 300;
      }
    }
    await clearCells(init, [], 1, pre);
    await collapse();
  }

  /* =========================================================
     Turn flow
     ========================================================= */
  async function trySwap(r1, c1, r2, c2) {
    if (busy || ended) return;
    const a = grid[r1][c1], b = grid[r2][c2];
    if (!a || !b) return;
    busy = true;
    clearHint();
    deselect();

    Sound.swoosh();
    a.el.classList.add('moving');
    setPos(a, r2, c2, 190, 'cubic-bezier(.4,0,.2,1.2)');
    setPos(b, r1, c1, 190, 'cubic-bezier(.4,0,.2,1.2)');
    grid[r2][c2] = a;
    grid[r1][c1] = b;
    await wait(200);
    a.el.classList.remove('moving');

    const special = a.type === RAINBOW || b.type === RAINBOW || (a.special && b.special);
    if (special) {
      useMove();
      await specialSwap(a, b);
      await cascade(1, null);
    } else if (findGroups().length) {
      useMove();
      await cascade(0, [key(r2, c2), key(r1, c1)]);
    } else {
      Sound.invalid();
      setPos(a, r1, c1, 190);
      setPos(b, r2, c2, 190);
      grid[r1][c1] = a;
      grid[r2][c2] = b;
      await wait(200);
      flash(a, 'nope', 330);
      flash(b, 'nope', 330);
      busy = false;
      scheduleHint();
      return;
    }
    await endTurn();
    busy = false;
    scheduleHint();
  }

  function useMove() {
    moves--;
    updateHUD(true);
  }

  async function endTurn() {
    if (goalsDone()) return victory();
    if (moves <= 0) return defeat();
    if (!findMove()) await shuffle();
  }

  async function shuffle() {
    banner('Tidy Up!', '#9fb4f5');
    Sound.shuffle();
    await wait(500);
    const tiles = grid.flat();
    for (let tries = 0; tries < 200; tries++) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = rnd(i + 1);
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      tiles.forEach((t, i) => { grid[Math.floor(i / SIZE)][i % SIZE] = t; });
      if (!findGroups().length && findMove()) break;
      if (tries === 199) tiles.forEach(t => { if (!t.special) { t.type = rnd(level.types); look(t); } });
    }
    grid.forEach((row, r) => row.forEach((t, c) => setPos(t, r, c, 480, 'cubic-bezier(.5,-.3,.5,1.3)', rnd(120))));
    await wait(650);
    if (findGroups().length) await cascade(0, null);
  }

  /* =========================================================
     Goals, HUD, scoring
     ========================================================= */
  const stainsLeft = () => stains.reduce((a, row) => a + row.filter(Boolean).length, 0);

  function goalLeft(g) {
    if (g.kind === 'stain') return stainsLeft();
    if (g.kind === 'collect') return Math.max(0, g.amount - collected[g.type]);
    return Math.max(0, g.target - score);
  }
  const goalsDone = () => level.goals.every(g => goalLeft(g) === 0);

  function goalChip(g, left) {
    let icon;
    if (g.kind === 'stain') icon = '<span class="gi mini-stain"><svg viewBox="0 0 40 40"><use href="#g-stain"/></svg></span>';
    else if (g.kind === 'collect') icon = `<span class="gi" data-t="${g.type}"><span class="tile-body"><svg viewBox="0 0 24 24"><use href="#${TYPES[g.type].glyph}"/></svg></span></span>`;
    else icon = '<span class="goal-label">Score</span>';
    const done = left === 0;
    return `<div class="goal${done ? ' done' : ''}">${icon}<span class="gc">${done ? '<svg width="20" height="20"><use href="#i-check"/></svg>' : left}</span></div>`;
  }

  let lastGoalLeft = [];
  function renderGoals() {
    lastGoalLeft = level.goals.map(goalLeft);
    $('#goals').innerHTML = level.goals.map((g, i) => goalChip(g, lastGoalLeft[i])).join('');
  }

  function updateGoals() {
    const chips = $('#goals').children;
    level.goals.forEach((g, i) => {
      const left = goalLeft(g);
      if (left === lastGoalLeft[i]) return;
      lastGoalLeft[i] = left;
      const tmp = document.createElement('div');
      tmp.innerHTML = goalChip(g, left);
      const chip = tmp.firstChild;
      chip.classList.add('tick');
      chips[i].replaceWith(chip);
    });
  }

  function addScore(n) {
    score += n;
    tweenScore();
    if (level.goals[0].kind === 'score') updateGoals();
  }

  let tweening = false;
  function tweenScore() {
    if (tweening) return;
    tweening = true;
    const step = () => {
      const diff = score - shownScore;
      shownScore += Math.max(1, Math.ceil(diff * 0.18));
      if (shownScore >= score) shownScore = score;
      $('#hud-score').textContent = shownScore.toLocaleString();
      updateBar();
      if (shownScore < score) requestAnimationFrame(step);
      else tweening = false;
    };
    requestAnimationFrame(step);
  }

  function updateBar() {
    const s3 = level.thresholds[2];
    $('#score-fill').style.width = Math.min(100, (shownScore / s3) * 100) + '%';
    document.querySelectorAll('.score-star').forEach((el, i) => {
      const on = shownScore >= level.thresholds[i];
      if (on && !el.classList.contains('on')) Sound.star(i);
      el.classList.toggle('on', on);
    });
  }

  function updateHUD(bump) {
    $('#hud-level').textContent = level.n;
    $('#hud-moves').textContent = moves;
    const mc = $('#hud-moves-card');
    mc.classList.toggle('low', moves <= 5 && !ended);
    if (bump) { mc.classList.remove('bump'); void mc.offsetWidth; mc.classList.add('bump'); }
  }

  const starsFor = s => (s >= level.thresholds[2] ? 3 : s >= level.thresholds[1] ? 2 : 1);

  /* =========================================================
     Level start / end
     ========================================================= */
  function goalText(L) {
    const g = L.goals[0];
    if (g.kind === 'score') return `Score ${g.target.toLocaleString()} points in ${L.moves} moves.`;
    if (L.goals.some(x => x.kind === 'stain') && L.goals.some(x => x.kind === 'collect')) return `Scrub every stain and collect the supplies in ${L.moves} moves.`;
    if (g.kind === 'stain') return `Scrub away every stain in ${L.moves} moves. Match on top of them!`;
    return `Collect the cleaning supplies in ${L.moves} moves.`;
  }

  function prepareLevel(n) {
    level = buildLevel(n);
    moves = level.moves;
    score = 0;
    shownScore = 0;
    collected = new Array(TYPES.length).fill(0);
    stains = level.stains.map(row => row.slice());
    selected = null;
    ended = true;
    tilesEl.innerHTML = '';
    fxEl.innerHTML = '';
    grid = [];
    $('#hud-score').textContent = '0';
    const [, , s3] = level.thresholds;
    document.querySelectorAll('.score-star').forEach((el, i) => {
      el.classList.remove('on');
      el.style.left = Math.min(94, (level.thresholds[i] / s3) * 100) + '%';
    });
    $('#score-fill').style.width = '0%';
    renderCells();
    renderGoals();
    updateHUD();
  }

  function startLevel(n) {
    showScreen('game');
    prepareLevel(n);
    const tmp = document.createElement('div');
    tmp.innerHTML = level.goals.map(g => goalChip(g, goalLeft(g))).join('');
    openModal({
      title: `Level ${n}`,
      text: goalText(level),
      goalsHTML: tmp.innerHTML,
      actions: [{ label: "Let's clean!", cls: 'btn-primary', onClick: async () => {
        closeModal();
        busy = true;
        Sound.swoosh();
        await fillBoard();
        ended = false;
        busy = false;
        scheduleHint();
      } }],
    });
  }

  async function victory() {
    ended = true;
    updateHUD();
    clearHint();
    await wait(300);
    if (moves > 0) {
      // "Clean Sweep": leftover moves turn into squeegees and go off
      banner('Clean Sweep!', '#7fcdb1');
      Sound.win();
      await wait(700);
      const pool = grid.flat().filter(t => t && !t.special && t.type >= 0);
      const n = Math.min(moves, pool.length, 12);
      for (let i = 0; i < n; i++) {
        const t = pool.splice(rnd(pool.length), 1)[0];
        t.special = Math.random() < 0.5 ? 'h' : 'v';
        look(t);
        flash(t, 'morph', 460);
        Sound.select();
        const [x, y] = pageXY(t.r, t.c);
        FX.burst(x, y, '#ffffff', cell, 0.8);
        moves--;
        addScore(150);
        updateHUD(true);
        await wait(120);
      }
      moves = 0;
      updateHUD();
    }
    for (let round = 0; round < 6; round++) {
      const specials = grid.flat().filter(t => t && t.special);
      if (!specials.length) break;
      const init = new Map();
      specials.forEach((t, i) => init.set(key(t.r, t.c), { delay: i * 140, src: null }));
      await clearCells(init, [], 1);
      await collapse();
      await cascade(1, null);
    }
    await wait(350);

    const stars = starsFor(score);
    const n = level.n;
    save.data.stars[n] = Math.max(save.data.stars[n] || 0, stars);
    save.data.best[n] = Math.max(save.data.best[n] || 0, score);
    save.data.unlocked = Math.max(save.data.unlocked, n + 1);
    save.write();

    Sound.win();
    FX.confetti(PASTELS);
    openModal({
      title: ['Tidy!', 'Sparkling!', 'Spotless!'][stars - 1],
      text: `Score ${score.toLocaleString()}${save.data.best[n] === score ? ' · New best!' : ''}`,
      stars,
      actions: [
        { label: 'Next level', cls: 'btn-primary', onClick: () => { closeModal(); startLevel(n + 1); } },
        { label: 'Replay', cls: 'btn-ghost', onClick: () => { closeModal(); startLevel(n); } },
        { label: 'Levels', cls: 'btn-ghost', onClick: () => { closeModal(); showLevels(); } },
      ],
    });
  }

  function defeat() {
    ended = true;
    updateHUD();
    clearHint();
    Sound.lose();
    const tmp = level.goals.map(g => goalChip(g, goalLeft(g))).join('');
    openModal({
      title: 'Out of moves',
      text: 'So close! There’s still a little mess left.',
      goalsHTML: tmp,
      actions: [
        { label: 'Try again', cls: 'btn-primary', onClick: () => { closeModal(); startLevel(level.n); } },
        { label: 'Levels', cls: 'btn-ghost', onClick: () => { closeModal(); showLevels(); } },
      ],
    });
  }

  /* =========================================================
     Hints
     ========================================================= */
  function scheduleHint() {
    clearTimeout(hintTimer);
    if (ended) return;
    hintTimer = setTimeout(showHint, 7000);
  }
  function showHint() {
    if (busy || ended) return;
    clearHint();
    const all = findMove(null, true);
    if (!all.length) return;
    const [r1, c1, r2, c2] = all[rnd(all.length)];
    hintTiles = [grid[r1][c1], grid[r2][c2]];
    hintTiles.forEach(t => t.el.classList.add('hint'));
  }
  function clearHint() {
    clearTimeout(hintTimer);
    hintTiles.forEach(t => t.el.classList.remove('hint'));
    hintTiles = [];
  }

  /* =========================================================
     Input — swipe or tap-tap, via pointer events
     ========================================================= */
  function cellFrom(e) {
    const b = boardEl.getBoundingClientRect();
    const c = Math.floor((e.clientX - b.left) / cell);
    const r = Math.floor((e.clientY - b.top) / cell);
    return inB(r, c) ? { r, c } : null;
  }

  function select(r, c) {
    deselect();
    selected = { r, c };
    grid[r][c].el.classList.add('selected');
    Sound.select();
  }
  function deselect() {
    if (selected && grid[selected.r] && grid[selected.r][selected.c]) grid[selected.r][selected.c].el.classList.remove('selected');
    selected = null;
  }

  boardEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    Sound.init();
    if (busy || ended) return;
    const p = cellFrom(e);
    if (!p || !grid[p.r][p.c]) return;
    clearHint();
    const prev = selected;
    drag = { ...p, x: e.clientX, y: e.clientY, prev };
    if (!prev) select(p.r, p.c);
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });

  boardEl.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.32) return;
    const [dr, dc] = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
    const { r, c } = drag;
    drag = null;
    if (inB(r + dr, c + dc)) trySwap(r, c, r + dr, c + dc);
    else deselect();
  });

  boardEl.addEventListener('pointerup', () => {
    if (!drag) return;
    const { r, c, prev } = drag;
    drag = null;
    if (!prev) return;                                   // first tap just selected
    if (prev.r === r && prev.c === c) { deselect(); scheduleHint(); return; }
    if (Math.abs(prev.r - r) + Math.abs(prev.c - c) === 1) trySwap(prev.r, prev.c, r, c);
    else select(r, c);
  });
  boardEl.addEventListener('pointercancel', () => { drag = null; });
  boardEl.addEventListener('contextmenu', e => e.preventDefault());

  // stop the page from scrolling / zooming while playing
  document.addEventListener('touchmove', e => {
    if (!e.target.closest('.levels-grid')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  /* =========================================================
     Layout — size the board to the space available
     ========================================================= */
  function layout() {
    const w = areaEl.clientWidth, h = areaEl.clientHeight;
    if (!w || !h) return;
    const next = Math.max(16, Math.min(84, Math.floor(Math.min(w, h) / (SIZE + 0.4))));
    if (next === cell) return;
    cell = next;
    tilesEl.classList.add('no-anim');
    document.documentElement.style.setProperty('--cell', cell + 'px');
    requestAnimationFrame(() => requestAnimationFrame(() => tilesEl.classList.remove('no-anim')));
  }
  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(areaEl);
  window.addEventListener('resize', layout);

  /* =========================================================
     Screens, modal, menus
     ========================================================= */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.dataset.screen !== name; });
    if (name === 'game') layout();
    if (name === 'title') $('#play-level').textContent = save.data.unlocked > 1 ? `· Lv ${save.data.unlocked}` : '';
  }

  function openModal({ title, text = '', stars = null, goalsHTML = '', actions = [] }) {
    const starsEl = $('#modal-stars');
    starsEl.innerHTML = '';
    if (stars !== null) {
      for (let i = 0; i < 3; i++) {
        const on = i < stars;
        starsEl.insertAdjacentHTML('beforeend', `<svg class="${on ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.28}s"><use href="#i-starf"/></svg>`);
        if (on) setTimeout(() => Sound.star(i), 250 + i * 280);
      }
    }
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal-goals').innerHTML = goalsHTML;
    const act = $('#modal-actions');
    act.innerHTML = '';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn ' + a.cls;
      b.textContent = a.label;
      b.addEventListener('click', () => { Sound.init(); Sound.select(); a.onClick(); });
      act.appendChild(b);
    });
    $('#modal').hidden = false;
    const first = act.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  const closeModal = () => { $('#modal').hidden = true; };

  function showLevels() {
    showScreen('levels');
    const gridEl = $('#levels-grid');
    const u = save.data.unlocked;
    const count = Math.max(24, Math.ceil((u + 8) / 4) * 4);
    let html = '';
    let total = 0;
    for (let i = 1; i <= count; i++) {
      const s = save.data.stars[i] || 0;
      total += s;
      if (i > u) {
        html += `<button class="lvl locked" disabled aria-label="Level ${i} locked"><svg><use href="#i-lock"/></svg></button>`;
      } else {
        const st = [0, 1, 2].map(k => `<svg class="${k < s ? 'on' : ''}"><use href="#i-starf"/></svg>`).join('');
        html += `<button class="lvl${i === u ? ' current' : ''}" data-level="${i}">${i}<span class="ls">${st}</span></button>`;
      }
    }
    gridEl.innerHTML = html;
    $('#levels-stars').innerHTML = `<svg><use href="#i-starf"/></svg>${total}`;
    const cur = gridEl.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  $('#levels-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    Sound.select();
    startLevel(+b.dataset.level);
  });
  $('#btn-play').addEventListener('click', () => { Sound.init(); startLevel(save.data.unlocked); });
  $('#btn-levels').addEventListener('click', () => { Sound.init(); Sound.select(); showLevels(); });
  $('#btn-levels-back').addEventListener('click', () => { Sound.select(); showScreen('title'); });

  $('#btn-pause').addEventListener('click', () => {
    if (busy || ended) return;
    Sound.select();
    clearHint();
    openModal({
      title: 'Paused',
      text: `Level ${level.n} · ${moves} moves left`,
      actions: [
        { label: 'Resume', cls: 'btn-primary', onClick: () => { closeModal(); scheduleHint(); } },
        { label: 'Restart', cls: 'btn-ghost', onClick: () => { closeModal(); startLevel(level.n); } },
        { label: 'Home', cls: 'btn-ghost', onClick: () => { closeModal(); ended = true; showScreen('title'); } },
      ],
    });
  });
  $('#btn-hint').addEventListener('click', () => { Sound.select(); showHint(); });

  const soundBtn = $('#btn-sound');
  const syncSoundBtn = () => soundBtn.querySelector('use').setAttribute('href', Sound.muted ? '#i-mute' : '#i-sound');
  soundBtn.addEventListener('click', () => {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    syncSoundBtn();
    Sound.select();
  });
  syncSoundBtn();

  /* =========================================================
     PWA: service worker + install prompt
     ========================================================= */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    $('#btn-install').hidden = false;
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $('#btn-install').hidden = true;
  });

  showScreen('title');

  // tiny debug/automation hook
  window.CleaningCrush = { get state() { return { level: level && level.n, moves, score, busy, ended }; }, findMove: () => findMove(null), trySwap, startLevel, grid: () => grid, look };
})();
