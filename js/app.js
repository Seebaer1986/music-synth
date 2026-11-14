import { Engine, ALGOS, PRESETS, DRUMS, scheduleStep, patternAt, swingOffset, renderWav } from './audio.js';

const STORE = 'fmloops.project.v1';
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = {
  'Minor': [0, 2, 3, 5, 7, 8, 10], 'Major': [0, 2, 4, 5, 7, 9, 11],
  'Minor pentatonic': [0, 3, 5, 7, 10], 'Major pentatonic': [0, 2, 4, 7, 9],
  'Dorian': [0, 2, 3, 5, 7, 9, 10], 'Phrygian': [0, 1, 3, 5, 7, 8, 10], 'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'Blues': [0, 3, 5, 6, 7, 10],
};
const COLORS = ['#ff7a59', '#4fc3f7', '#ffd54f', '#b388ff', '#69f0ae', '#f48fb1', '#ffab40', '#80cbc4'];
const NPAT = 8, CW = 28, SONG_CELL = 36;
const LO = 24, HI = 84; // C1..C6

const $ = s => document.querySelector(s);
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 9);

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  return e;
}

// ---------- project model ----------

function newTrack(type, index, preset = 'E-Piano') {
  return {
    id: uid(), type, name: type === 'drums' ? 'Drums' : preset, color: COLORS[index % COLORS.length],
    vol: 0.8, pan: 0, dly: 0, rev: 0, mute: false, solo: false, active: 0,
    patterns: Array.from({ length: NPAT }, () => ({ bars: 1, notes: [] })),
    song: [], preset, patch: clone(PRESETS[preset]),
  };
}

function normalize(p) {
  p.songBars = Math.max(1, Math.min(128, p.songBars || 16));
  for (const t of p.tracks) {
    t.song = Array.from({ length: p.songBars }, (_, i) => (t.song && t.song[i] != null ? t.song[i] : -1));
    t.active = Math.min(t.active || 0, NPAT - 1);
  }
  return p;
}

function blankProject() {
  return normalize({ bpm: 110, swing: 0, key: 9, scale: 'Minor', songBars: 16, tracks: [newTrack('drums', 0), newTrack('synth', 1, 'Bass'), newTrack('synth', 2, 'E-Piano')] });
}

function demoProject() {
  const p = blankProject();
  const N = (s, pch, l = 1, v = 0.8) => ({ s, p: pch, l, v });
  const [drums, bass, keys] = p.tracks;
  const lead = newTrack('synth', 3, 'Pluck');
  p.tracks.push(lead);
  const four = [0, 4, 8, 12].map(s => N(s, 0));
  drums.patterns[0].notes = [...four, N(4, 2), N(12, 2), ...[0, 4, 8, 12].map(s => N(s, 6, 1, 0.35)), ...[2, 6, 10].map(s => N(s, 6)), N(14, 7)];
  drums.patterns[1].notes = [...four, N(4, 2), ...[2, 6].map(s => N(s, 6)), N(10, 1, 1, 0.5), N(12, 1), N(13, 1, 1, 0.5), N(14, 1), N(15, 1), N(14, 4), N(15, 3)];
  bass.patterns[0] = { bars: 2, notes: [N(0, 33, 2), N(3, 33), N(6, 45, 2), N(10, 33, 2), N(14, 36, 2), N(16, 29, 2), N(19, 29), N(22, 41, 2), N(24, 31, 2), N(27, 31), N(30, 43, 2)] };
  const chord = (s, l, ps) => ps.map(x => N(s, x, l, 0.7));
  keys.patterns[0] = { bars: 2, notes: [...chord(0, 4, [57, 60, 64]), ...chord(6, 2, [57, 60, 64]), ...chord(10, 4, [57, 60, 64]), ...chord(16, 6, [53, 57, 60]), ...chord(24, 6, [55, 59, 62])] };
  keys.rev = 0.35;
  lead.patterns[0] = { bars: 2, notes: [N(0, 69, 2), N(2, 72, 2), N(4, 76, 3), N(8, 74, 2), N(10, 72, 2), N(12, 69, 4), N(16, 67, 2), N(18, 69, 2), N(20, 72, 3), N(24, 76, 2), N(26, 79, 2), N(28, 76, 4)] };
  lead.dly = 0.35; lead.rev = 0.2; lead.vol = 0.6;
  for (let b = 0; b < 16; b++) {
    keys.song[b] = 0;
    if (b >= 4) { bass.song[b] = 0; drums.song[b] = b === 15 ? 1 : 0; }
    if (b >= 8) lead.song[b] = 0;
  }
  drums.song[3] = 1;
  return normalize(p);
}

let P;
try { P = normalize(JSON.parse(localStorage.getItem(STORE))); } catch { P = null; }
if (!P || !P.tracks || !P.tracks.length) P = demoProject();

const ui = { track: 0, tab: 'pattern', mode: 'loop', noteLen: 2, fold: true, clip: null };
const T = () => P.tracks[ui.track];
const pat = () => T().patterns[T().active];

// ---------- undo + persistence ----------

let saved = JSON.stringify(P);
const undoStack = [];
function commit() {
  const now = JSON.stringify(P);
  if (now === saved) return;
  undoStack.push(saved);
  if (undoStack.length > 60) undoStack.shift();
  saved = now;
  try { localStorage.setItem(STORE, now); } catch { /* storage full or blocked */ }
}
function replaceProject(p, keepUndo = true) {
  P = normalize(p);
  ui.track = Math.min(ui.track, P.tracks.length - 1);
  if (keepUndo) commit(); else { saved = JSON.stringify(P); localStorage.setItem(STORE, saved); }
  syncAll();
  renderAll();
}
function undo() {
  if (!undoStack.length) return;
  P = JSON.parse(undoStack.pop());
  saved = JSON.stringify(P);
  localStorage.setItem(STORE, saved);
  ui.track = Math.min(ui.track, P.tracks.length - 1);
  syncAll();
  renderAll();
}

// ---------- audio + transport ----------

let ctx = null, engine = null, playing = false, timer = 0, nextStep = 0, nextTime = 0, queue = [], curStep = -1;

function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    engine = new Engine(ctx);
    syncAll();
  }
  if (ctx.state !== 'running') ctx.resume();
}
function syncAll() {
  if (!engine) return;
  engine.setBpm(P.bpm);
  P.tracks.forEach(t => engine.syncTrack(t));
}
function audition(track, pitch) {
  ensureAudio();
  if (track.type === 'drums') engine.drum(track, pitch, ctx.currentTime);
  else engine.note(track, pitch, ctx.currentTime, 0.25);
}

function tick() {
  const sd = 60 / P.bpm / 4;
  while (nextTime < ctx.currentTime + 0.15) {
    const t = nextTime + swingOffset(P, nextStep);
    scheduleStep(engine, P, ui.mode, nextStep, t);
    queue.push([nextStep, t]);
    nextTime += sd;
    nextStep++;
    if (ui.mode === 'song' && nextStep >= P.songBars * 16) nextStep = 0;
  }
}
function play() {
  ensureAudio();
  playing = true;
  nextStep = 0; queue = []; nextTime = ctx.currentTime + 0.08;
  timer = setInterval(tick, 25);
  tick();
  requestAnimationFrame(frame);
  updateTransport();
}
function stop() {
  playing = false;
  clearInterval(timer);
  curStep = -1; queue = [];
  updateTransport();
  updatePlayheads();
}
function frame() {
  if (!playing) return;
  while (queue.length && queue[0][1] <= ctx.currentTime) curStep = queue.shift()[0];
  updatePlayheads();
  requestAnimationFrame(frame);
}
function updateTransport() {
  const b = $('#play');
  b.textContent = playing ? '■ Stop' : '▶ Play';
  b.classList.toggle('on', playing);
}

// ---------- top bar ----------

function seg(options, get, set) {
  const box = h('span', { class: 'seg' });
  const paint = () => [...box.children].forEach((b, i) => b.classList.toggle('on', options[i][0] === get()));
  options.forEach(([val, label]) => box.append(h('button', { onclick: () => { set(val); paint(); } }, label)));
  paint();
  return box;
}
const field = (label, ...kids) => h('label', { class: 'field' }, h('span', {}, label), ...kids);

function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function renderTop() {
  const top = $('#top');
  top.replaceChildren(
    h('button', { id: 'play', class: 'big', onclick: () => (playing ? stop() : play()) }, '▶ Play'),
    seg([['loop', 'Loop'], ['song', 'Song']], () => ui.mode, v => { ui.mode = v; nextStep = 0; updatePlayheads(); }),
    field('BPM', h('input', {
      type: 'number', min: 40, max: 240, value: P.bpm,
      onchange: e => { P.bpm = Math.max(40, Math.min(240, +e.target.value || 110)); e.target.value = P.bpm; syncAll(); commit(); },
    })),
    field('Swing', h('input', { type: 'range', min: 0, max: 0.7, step: 0.05, value: P.swing, oninput: e => { P.swing = +e.target.value; }, onchange: commit })),
    field('Key', h('select', { value: String(P.key), onchange: e => { P.key = +e.target.value; commit(); renderPanel(); } },
      NOTE_NAMES.map((n, i) => h('option', { value: String(i) }, n)))),
    field('Scale', h('select', { value: P.scale, onchange: e => { P.scale = e.target.value; commit(); renderPanel(); } },
      Object.keys(SCALES).map(n => h('option', { value: n }, n)))),
    h('button', { onclick: undo, title: 'Undo' }, '↶ Undo'),
    h('details', { class: 'menu' }, h('summary', {}, 'File'),
      h('div', { class: 'menu-items' },
        h('button', { onclick: () => confirm('Start a new empty project?') && replaceProject(blankProject()) }, 'New project'),
        h('button', { onclick: () => confirm('Replace the current project with the demo?') && replaceProject(demoProject()) }, 'Load demo'),
        h('button', { onclick: () => download(new Blob([JSON.stringify(P)], { type: 'application/json' }), 'project.fmloops.json') }, 'Save to file'),
        h('label', { class: 'btn' }, 'Open file', h('input', {
          type: 'file', accept: '.json,application/json', hidden: true,
          onchange: async e => {
            try {
              const p = JSON.parse(await e.target.files[0].text());
              if (!Array.isArray(p.tracks) || !p.tracks.length) throw new Error('no tracks');
              replaceProject(p);
            } catch (err) { alert('Could not open that file: ' + err.message); }
            e.target.value = '';
          },
        })),
        h('button', {
          onclick: async e => {
            const b = e.target; b.disabled = true; b.textContent = 'Rendering…';
            try { download(await renderWav(P, ui.mode), ui.mode === 'song' ? 'song.wav' : 'loop.wav'); }
            catch (err) { alert('Export failed: ' + err.message); }
            b.disabled = false; b.textContent = 'Export WAV';
          },
        }, 'Export WAV'))),
  );
  updateTransport();
}

// ---------- track list ----------

function selectTrack(i) { ui.track = i; renderTracks(); renderPanel(); }

function renderTracks() {
  const rows = P.tracks.map((t, i) => h('div', { class: 'track' + (i === ui.track ? ' sel' : ''), style: `--c:${t.color}` },
    h('button', { class: 'tname', onclick: () => selectTrack(i) }, t.name),
    h('button', { class: 'ms' + (t.mute ? ' on' : ''), title: 'Mute', onclick: () => { t.mute = !t.mute; commit(); renderTracks(); } }, 'M'),
    h('button', { class: 'ms solo' + (t.solo ? ' on' : ''), title: 'Solo', onclick: () => { t.solo = !t.solo; commit(); renderTracks(); } }, 'S'),
    h('span', { class: 'pats' }, t.patterns.map((p, pi) => h('button', {
      class: 'pat' + (pi === t.active ? ' on' : '') + (p.notes.length ? ' has' : ''),
      title: 'Pattern ' + (pi + 1),
      onclick: () => { t.active = pi; commit(); selectTrack(i); },
    }, String(pi + 1)))),
  ));
  const add = type => {
    if (P.tracks.length >= 12) return alert('12 tracks is the limit.');
    P.tracks.push(newTrack(type, P.tracks.length));
    normalize(P); commit(); syncAll();
    selectTrack(P.tracks.length - 1);
  };
  $('#tracks').replaceChildren(...rows, h('div', { class: 'addrow' },
    h('button', { onclick: () => add('synth') }, '+ Synth track'),
    h('button', { onclick: () => add('drums') }, '+ Drum track')));
}

// ---------- tabs + panels ----------

let updatePlayheads = () => {};

function renderPanel() {
  $('#tabs').replaceChildren(...[['pattern', 'Pattern'], ['sound', 'Sound'], ['song', 'Song']].map(([id, label]) =>
    h('button', { class: ui.tab === id ? 'on' : '', onclick: () => { ui.tab = id; renderPanel(); } }, label)));
  updatePlayheads = () => {};
  const panel = $('#panel');
  panel.replaceChildren();
  ({ pattern: patternPanel, sound: soundPanel, song: songPanel })[ui.tab](panel);
  updatePlayheads();
}
function renderAll() { renderTop(); renderTracks(); renderPanel(); }

const noteName = m => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

function patternPanel(panel) {
  const t = T(), p = pat(), isDrums = t.type === 'drums';
  const RH = isDrums ? 34 : 22, KEYW = isDrums ? 66 : 46;
  const scale = SCALES[P.scale] || SCALES.Minor;
  const inScale = m => scale.includes((m - P.key + 120) % 12);
  let rows;
  if (isDrums) rows = DRUMS.map((_, i) => i).reverse();
  else {
    const used = new Set(p.notes.map(n => n.p));
    rows = [];
    for (let m = HI; m >= LO; m--) if (!ui.fold || inScale(m) || used.has(m)) rows.push(m);
  }
  const steps = p.bars * 16;

  const keys = h('canvas', { class: 'keys' }), grid = h('canvas', { class: 'grid' });
  const head = h('div', { class: 'playhead', style: `background:${t.color}` });
  const roll = h('div', { class: 'roll' }, keys, h('div', { class: 'gridwrap' }, grid, head));

  function draw() {
    const w = steps * CW, hgt = rows.length * RH;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * hgt * dpr * dpr > 12e6) dpr = 1;
    for (const [cv, cw] of [[grid, w], [keys, KEYW]]) {
      cv.width = cw * dpr; cv.height = hgt * dpr;
      cv.style.width = cw + 'px'; cv.style.height = hgt + 'px';
    }
    const g = grid.getContext('2d'), k = keys.getContext('2d');
    g.scale(dpr, dpr); k.scale(dpr, dpr);
    k.font = '11px system-ui, sans-serif'; k.textBaseline = 'middle';
    rows.forEach((m, r) => {
      const y = r * RH;
      const black = !isDrums && NOTE_NAMES[m % 12].includes('#');
      const root = !isDrums && (m - P.key + 120) % 12 === 0;
      g.fillStyle = isDrums ? (r % 2 ? '#1c2027' : '#20242c') : root ? '#2b3242' : black ? '#191c22' : inScale(m) ? '#20242c' : '#1c1f26';
      g.fillRect(0, y, w, RH);
      g.fillStyle = '#14161b'; g.fillRect(0, y + RH - 1, w, 1);
      k.fillStyle = isDrums ? '#2a2f3a' : black ? '#15171c' : root ? '#cfd8ea' : '#aab2c0';
      k.fillRect(0, y, KEYW, RH - 1);
      k.fillStyle = isDrums || black ? '#c9d1dd' : '#15171c';
      k.fillText(isDrums ? DRUMS[m] : noteName(m), 5, y + RH / 2);
    });
    for (let s = 0; s <= steps; s++) {
      g.fillStyle = s % 16 === 0 ? '#6b7488' : s % 4 === 0 ? '#3b4252' : '#2a2e38';
      g.fillRect(s * CW, 0, 1, hgt);
    }
    for (const n of p.notes) {
      const r = rows.indexOf(n.p);
      if (r < 0 || n.s >= steps) continue;
      const x = n.s * CW + 2, y = r * RH + 2, nw = Math.min(n.l, steps - n.s) * CW - 3, nh = RH - 5;
      g.globalAlpha = 0.45 + 0.55 * n.v;
      g.fillStyle = t.color;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, nw, nh, 4); else g.rect(x, y, nw, nh);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  const cellAt = e => {
    const b = grid.getBoundingClientRect();
    const step = Math.max(0, Math.min(steps - 1, Math.floor((e.clientX - b.left) / CW)));
    const row = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - b.top) / RH)));
    return { step, pitch: rows[row] };
  };
  const findNote = c => p.notes.find(n => n.p === c.pitch && c.step >= n.s && c.step < n.s + n.l);
  const addNote = c => {
    const n = { s: c.step, p: c.pitch, l: isDrums ? 1 : Math.min(ui.noteLen, steps - c.step), v: 0.8 };
    p.notes.push(n);
    audition(t, c.pitch);
    return n;
  };
  const finish = () => { commit(); draw(); renderTracks(); };

  // Mouse: click adds (drag to stretch), click on a note removes it.
  // Touch: a tap toggles; drags are left to the browser for scrolling.
  let drag = null;
  grid.addEventListener('pointerdown', e => {
    const c = cellAt(e), hit = findNote(c);
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      grid.setPointerCapture(e.pointerId);
      drag = hit ? { del: hit } : { note: addNote(c) };
      draw();
    } else drag = { tap: c, hit, x: e.clientX, y: e.clientY };
  });
  grid.addEventListener('pointermove', e => {
    if (!drag || !drag.note || isDrums) return;
    const c = cellAt(e);
    if (c.step === drag.note.s && !drag.moved) return;
    drag.moved = true;
    drag.note.l = Math.max(1, c.step - drag.note.s + 1);
    draw();
  });
  grid.addEventListener('pointerup', e => {
    if (!drag) return;
    if (drag.del) p.notes.splice(p.notes.indexOf(drag.del), 1);
    else if (drag.tap && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 10) {
      if (drag.hit) p.notes.splice(p.notes.indexOf(drag.hit), 1); else addNote(drag.tap);
    }
    drag = null;
    finish();
  });
  grid.addEventListener('pointercancel', () => { drag = null; });
  keys.addEventListener('pointerdown', e => {
    const row = Math.floor((e.clientY - keys.getBoundingClientRect().top) / RH);
    if (rows[row] != null) audition(t, rows[row]);
  });

  const lens = [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, '1 bar']];
  panel.append(
    h('div', { class: 'toolbar' },
      field('Length', seg([[1, '1 bar'], [2, '2 bars'], [4, '4 bars']], () => p.bars, v => { p.bars = v; commit(); renderPanel(); })),
      !isDrums && field('Note', seg(lens, () => ui.noteLen, v => { ui.noteLen = v; })),
      !isDrums && field('Scale only', h('input', { type: 'checkbox', checked: ui.fold, onchange: e => { ui.fold = e.target.checked; renderPanel(); } })),
      h('button', { onclick: () => { ui.clip = { type: t.type, pattern: clone(p) }; renderPanel(); } }, 'Copy'),
      h('button', {
        disabled: !ui.clip || ui.clip.type !== t.type,
        onclick: () => { t.patterns[t.active] = clone(ui.clip.pattern); commit(); renderTracks(); renderPanel(); },
      }, 'Paste'),
      !isDrums && h('button', { onclick: () => { p.notes.forEach(n => { if (n.p + 12 <= HI) n.p += 12; }); commit(); renderPanel(); } }, 'Oct +'),
      !isDrums && h('button', { onclick: () => { p.notes.forEach(n => { if (n.p - 12 >= LO) n.p -= 12; }); commit(); renderPanel(); } }, 'Oct −'),
      h('button', { onclick: () => { p.notes = []; commit(); renderTracks(); renderPanel(); } }, 'Clear')),
    roll,
    h('p', { class: 'hint' }, `${t.name} · pattern ${t.active + 1}. Tap the grid to add a note, tap a note to remove it. With a mouse, drag to stretch a note.`));
  draw();

  if (!isDrums) {
    const center = p.notes.length ? p.notes.reduce((a, n) => a + n.p, 0) / p.notes.length : 60;
    let r = rows.findIndex(m => m <= center);
    if (r < 0) r = rows.length / 2;
    roll.scrollTop = Math.max(0, r * RH - roll.clientHeight / 2);
  }

  updatePlayheads = () => {
    const r = playing && curStep >= 0 ? patternAt(t, P, ui.mode, curStep) : null;
    if (r && r[0] === p) {
      head.style.display = 'block';
      head.style.transform = `translateX(${r[1] * CW}px)`;
    } else head.style.display = 'none';
  };
}

function slider(label, obj, key, min, max, step, after) {
  const out = h('output', {}, String(obj[key]));
  return h('label', { class: 'slider' }, h('span', {}, label),
    h('input', {
      type: 'range', min, max, step, value: obj[key],
      oninput: e => { obj[key] = +e.target.value; out.textContent = String(obj[key]); if (after) after(); },
      onchange: commit,
    }), out);
}

function soundPanel(panel) {
  const t = T(), sync = () => engine && engine.syncTrack(t);
  panel.append(h('div', { class: 'toolbar' },
    field('Name', h('input', { type: 'text', value: t.name, maxLength: 16, onchange: e => { t.name = e.target.value.trim() || t.name; commit(); renderTracks(); } })),
    t.type === 'synth' && field('Preset', h('select', {
      value: t.preset,
      onchange: e => {
        if (t.name === t.preset) t.name = e.target.value;
        t.preset = e.target.value; t.patch = clone(PRESETS[t.preset]);
        commit(); renderTracks(); renderPanel();
      },
    }, Object.keys(PRESETS).map(n => h('option', { value: n }, n)))),
    t.type === 'synth' && field('Algorithm', h('select', {
      value: String(t.patch.algo), onchange: e => { t.patch.algo = +e.target.value; commit(); renderPanel(); },
    }, ALGOS.map((a, i) => h('option', { value: String(i) }, a.name)))),
    h('button', {
      class: 'danger',
      onclick: () => {
        if (P.tracks.length < 2) return alert('A project needs at least one track.');
        if (!confirm(`Delete track "${t.name}"?`)) return;
        P.tracks.splice(ui.track, 1);
        ui.track = Math.max(0, ui.track - 1);
        commit(); renderTracks(); renderPanel();
      },
    }, 'Delete track')));

  panel.append(h('div', { class: 'card' }, h('h3', {}, 'Mix'),
    slider('Volume', t, 'vol', 0, 1, 0.01, sync), slider('Pan', t, 'pan', -1, 1, 0.05, sync),
    slider('Delay', t, 'dly', 0, 1, 0.01, sync), slider('Reverb', t, 'rev', 0, 1, 0.01, sync)));

  if (t.type === 'drums') {
    panel.append(h('div', { class: 'tryrow' }, h('span', {}, 'Try:'), DRUMS.map((d, i) => h('button', { onpointerdown: () => audition(t, i) }, d))));
    return;
  }
  const scale = SCALES[P.scale] || SCALES.Minor;
  const tryNotes = [...scale, 12].map(d => 48 + P.key + d);
  panel.append(h('div', { class: 'tryrow' }, h('span', {}, 'Try:'), tryNotes.map(m => h('button', { onpointerdown: () => audition(t, m) }, noteName(m)))));

  const algo = ALGOS[t.patch.algo];
  panel.append(h('div', { class: 'ops' }, t.patch.ops.map((o, i) => {
    const role = algo.carriers.includes(i) ? 'carrier' : algo.mods.some(m => m[0] === i) ? 'modulator' : 'unused';
    return h('div', { class: 'card op ' + role }, h('h3', {}, `Operator ${i + 1} `, h('small', {}, role)),
      slider('Ratio', o, 'ratio', 0.5, 16, 0.5), slider('Fine', o, 'dt', -50, 50, 1),
      slider(role === 'carrier' ? 'Level' : 'Amount', o, 'level', 0, 1, 0.01),
      slider('Attack', o, 'a', 0.001, 2, 0.001), slider('Decay', o, 'd', 0.01, 4, 0.01),
      slider('Sustain', o, 's', 0, 1, 0.01), slider('Release', o, 'r', 0.01, 3, 0.01));
  })));
  panel.append(h('p', { class: 'hint' }, 'Carriers are the operators you hear. Modulators change a carrier\'s timbre: raise "Amount" for a brighter, harsher tone, and use the modulator\'s envelope to make that brightness fade or swell.'));
}

function songPanel(panel) {
  const setBars = n => { P.songBars = n; normalize(P); commit(); renderPanel(); };
  panel.append(h('div', { class: 'toolbar' },
    field('Song length', h('button', { onclick: () => setBars(P.songBars - 4) }, '−4'), h('b', {}, ` ${P.songBars} bars `), h('button', { onclick: () => setBars(P.songBars + 4) }, '+4')),
    h('button', { onclick: () => { if (confirm('Clear the whole arrangement?')) { P.tracks.forEach(t => t.song.fill(-1)); commit(); renderPanel(); } } }, 'Clear song')));

  const heads = [];
  const gridEl = h('div', { class: 'song', style: `grid-template-columns:90px repeat(${P.songBars}, ${SONG_CELL}px)` });
  gridEl.append(h('div', { class: 'slabel' }));
  for (let b = 0; b < P.songBars; b++) { const hd = h('div', { class: 'shead' + (b % 4 === 0 ? ' four' : '') }, String(b + 1)); heads.push(hd); gridEl.append(hd); }
  P.tracks.forEach((t, ti) => {
    gridEl.append(h('button', { class: 'slabel' + (ti === ui.track ? ' sel' : ''), style: `--c:${t.color}`, onclick: () => { ui.track = ti; renderTracks(); renderPanel(); } }, `${t.name} · ${t.active + 1}`));
    t.song.forEach((pi, b) => {
      const cell = h('button', { class: 'scell' + (pi >= 0 ? ' on' : ''), style: `--c:${t.color}` }, pi >= 0 ? String(pi + 1) : '');
      cell.addEventListener('click', () => {
        t.song[b] = t.song[b] === t.active ? -1 : t.active;
        cell.textContent = t.song[b] >= 0 ? String(t.song[b] + 1) : '';
        cell.classList.toggle('on', t.song[b] >= 0);
        commit();
      });
      gridEl.append(cell);
    });
  });
  panel.append(h('div', { class: 'songwrap' }, gridEl),
    h('p', { class: 'hint' }, 'Each column is one bar. Tap a cell to place that track\'s currently selected pattern there (the number after the track name); tap again to clear it. Paint a 2- or 4-bar pattern across consecutive bars to play it in full. Switch the transport to "Song" to hear the arrangement.'));

  let last = -1;
  updatePlayheads = () => {
    const bar = playing && ui.mode === 'song' && curStep >= 0 ? Math.floor(curStep / 16) : -1;
    if (bar === last) return;
    if (heads[last]) heads[last].classList.remove('now');
    if (heads[bar]) heads[bar].classList.add('now');
    last = bar;
  };
}

// ---------- boot ----------

document.addEventListener('keydown', e => {
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY)$/.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); playing ? stop() : play(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
});
renderAll();
