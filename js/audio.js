// FM synth engine + drum synth + step scheduling. Works on both a live
// AudioContext and an OfflineAudioContext (used for WAV export).

// Operators are indexed 0..3 (shown as 1..4). mods are [modulator, target].
export const ALGOS = [
  { name: '4→3→2→1', mods: [[3, 2], [2, 1], [1, 0]], carriers: [0] },
  { name: '(3+4)→2→1', mods: [[3, 1], [2, 1], [1, 0]], carriers: [0] },
  { name: '(2+3+4)→1', mods: [[1, 0], [2, 0], [3, 0]], carriers: [0] },
  { name: '2→1 + 4→3', mods: [[1, 0], [3, 2]], carriers: [0, 2] },
  { name: '1 + 2 + 4→3', mods: [[3, 2]], carriers: [0, 1, 2] },
  { name: '1+2+3+4 (additive)', mods: [], carriers: [0, 1, 2, 3] },
];

const op = (ratio, level, a, d, s, r, dt = 0) => ({ ratio, level, a, d, s, r, dt });
const wv = (o, wave) => ({ ...o, wave });
const OFF = () => op(1, 0, 0.01, 0.3, 0, 0.1);

export const PRESETS = {
  'E-Piano': { algo: 3, ops: [op(1, 0.9, 0.002, 1.4, 0, 0.3), op(14, 0.25, 0.001, 0.15, 0, 0.1), op(1, 0.7, 0.002, 1.8, 0, 0.3, 4), op(1, 0.35, 0.002, 0.8, 0, 0.2)] },
  'Bass': { algo: 2, ops: [op(1, 1, 0.002, 0.3, 0.6, 0.08), op(1, 0.55, 0.001, 0.15, 0.2, 0.08), op(2, 0.3, 0.001, 0.08, 0, 0.05), OFF()] },
  'Pluck': { algo: 2, ops: [op(1, 0.9, 0.001, 0.3, 0, 0.2), op(3, 0.45, 0.001, 0.1, 0, 0.1), op(1, 0.3, 0.001, 0.2, 0, 0.1), OFF()] },
  'Bell': { algo: 3, ops: [op(1, 0.8, 0.001, 2.5, 0, 1.5), op(3.5, 0.5, 0.001, 2, 0, 1.5), op(1, 0.5, 0.001, 3, 0, 1.5, 7), op(7, 0.4, 0.001, 1.2, 0, 1)] },
  'Brass': { algo: 2, ops: [op(1, 0.9, 0.05, 0.3, 0.8, 0.15), op(1, 0.5, 0.08, 0.4, 0.6, 0.15), op(2, 0.25, 0.1, 0.3, 0.4, 0.15), OFF()] },
  'Pad': { algo: 3, ops: [op(1, 0.7, 0.4, 1, 0.8, 1.2), op(2, 0.3, 0.6, 1.5, 0.5, 1.2), op(1, 0.7, 0.5, 1, 0.8, 1.2, 9), op(3, 0.22, 0.8, 2, 0.4, 1.2)] },
  'Lead': { algo: 0, ops: [op(1, 0.9, 0.005, 0.2, 0.8, 0.12), op(2, 0.5, 0.005, 0.4, 0.5, 0.12), op(1, 0.4, 0.005, 0.3, 0.3, 0.12), OFF()] },
  'Init': { algo: 2, ops: [op(1, 0.9, 0.005, 0.3, 0.7, 0.2), op(1, 0, 0.005, 0.3, 0.5, 0.2), OFF(), OFF()] },
  'Acid Saw (303 style)': { algo: 2, cut: 0.38, res: 12, fEnv: 0.42, fTime: 0.22, ops: [wv(op(1, 0.9, 0.002, 0.25, 0.55, 0.05), 'sawtooth'), OFF(), OFF(), OFF()] },
  'Acid Square (303 style)': { algo: 2, cut: 0.34, res: 10, fEnv: 0.5, fTime: 0.3, ops: [wv(op(1, 0.8, 0.002, 0.3, 0.5, 0.05), 'square'), OFF(), OFF(), OFF()] },
  'Sub Bass (808 style)': { algo: 2, pitchAmt: 12, pitchTime: 0.04, ops: [op(1, 1, 0.002, 1.6, 0, 0.25), op(1, 0.12, 0.001, 0.2, 0, 0.1), OFF(), OFF()] },
  'Mono Lead (SH style)': { algo: 5, cut: 0.72, res: 3, fEnv: 0.2, fTime: 0.4, vibDepth: 12, vibRate: 5.5, ops: [wv(op(1, 0.7, 0.01, 0.3, 0.8, 0.15), 'sawtooth'), wv(op(0.5, 0.45, 0.01, 0.3, 0.8, 0.15), 'square'), OFF(), OFF()] },
  'Poly Strings (Juno style)': { algo: 5, cut: 0.68, res: 1, ops: [wv(op(1, 0.6, 0.35, 1, 0.85, 0.9, -9), 'sawtooth'), wv(op(1, 0.6, 0.35, 1, 0.85, 0.9, 9), 'sawtooth'), wv(op(2, 0.2, 0.5, 1, 0.7, 0.9, 4), 'sawtooth'), OFF()] },
  'Brass Stab (Jupiter style)': { algo: 5, cut: 0.45, res: 2, fEnv: 0.4, fTime: 0.35, ops: [wv(op(1, 0.7, 0.02, 0.4, 0.7, 0.2, -7), 'sawtooth'), wv(op(1, 0.7, 0.02, 0.4, 0.7, 0.2, 7), 'sawtooth'), OFF(), OFF()] },
  'Harp': { algo: 3, ops: [op(1, 0.9, 0.001, 1.8, 0, 1.2), op(2, 0.33, 0.001, 0.14, 0, 0.1), op(2, 0.22, 0.001, 0.9, 0, 0.8, 3), op(3, 0.25, 0.001, 0.06, 0, 0.05)] },
  'Organ': { algo: 5, ops: [op(0.5, 0.7, 0.005, 0.1, 1, 0.06), op(1, 0.8, 0.005, 0.1, 1, 0.06), op(2, 0.5, 0.005, 0.1, 1, 0.06), op(3, 0.3, 0.005, 0.1, 1, 0.06)] },
};

export const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];

// Fills in voice settings that older saved patches do not have.
export function fillPatch(p) {
  p.ops.forEach(o => { if (!o.wave) o.wave = 'sine'; if (o.dt == null) o.dt = 0; });
  if (p.pitchAmt == null) p.pitchAmt = 0;   // semitones the note starts away from its pitch
  if (p.pitchTime == null) p.pitchTime = 0.1;
  if (p.vibRate == null) p.vibRate = 5;     // Hz
  if (p.vibDepth == null) p.vibDepth = 0;   // cents
  if (p.cut == null) p.cut = 1;             // 0..1, 1 = filter open
  if (p.res == null) p.res = 0.7;
  if (p.fEnv == null) p.fEnv = 0;           // how far above the cutoff each note starts (0..1)
  if (p.fTime == null) p.fTime = 0.2;
  return p;
}
Object.values(PRESETS).forEach(fillPatch);

// Drum rows; index is stored as the note pitch on drum tracks.
export const KITS = ['Classic', '808 style', '909 style', '606 style'];
export const DRUMS = ['Kick', 'Snare', 'Clap', 'Lo Tom', 'Hi Tom', 'Cowbell', 'Hat', 'Open Hat'];

// Schedules an ADSR on param with the release computed up front (no
// cancelAndHoldAtTime, which Firefox lacks). Returns the time it is silent.
function env(param, t, dur, peak, o) {
  const a = Math.max(o.a, 0.001), d = Math.max(o.d, 0.005), r = Math.max(o.r, 0.005);
  const sus = peak * o.s, tr = t + dur;
  param.setValueAtTime(0, t);
  if (dur <= a) {
    param.linearRampToValueAtTime(peak * dur / a, tr);
  } else {
    param.linearRampToValueAtTime(peak, t + a);
    param.setTargetAtTime(sus, t + a, d / 3);
    param.setValueAtTime(sus + (peak - sus) * Math.exp(-(dur - a) / (d / 3)), tr);
  }
  param.setTargetAtTime(0, tr, r / 3);
  return tr + r * 2;
}

export class Engine {
  constructor(ctx) {
    this.ctx = ctx;
    this.ch = new Map();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);

    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
    this.delay.connect(lp).connect(fb).connect(this.delay);
    this.delay.connect(this.master);

    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = ir.getChannelData(c);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.6;
    this.reverb.connect(wet).connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  setBpm(bpm) { this.delay.delayTime.value = 60 / bpm * 0.75; } // dotted eighth

  channel(track) {
    let c = this.ch.get(track.id);
    if (!c) {
      const ctx = this.ctx;
      c = { in: ctx.createGain(), pan: ctx.createStereoPanner(), dly: ctx.createGain(), rev: ctx.createGain() };
      c.in.connect(c.pan);
      c.pan.connect(this.master);
      c.pan.connect(c.dly).connect(this.delay);
      c.pan.connect(c.rev).connect(this.reverb);
      this.ch.set(track.id, c);
      this.syncTrack(track);
    }
    return c;
  }

  syncTrack(track) {
    const c = this.channel(track);
    c.in.gain.value = track.vol;
    c.pan.pan.value = track.pan;
    c.dly.gain.value = track.dly;
    c.rev.gain.value = track.rev;
  }

  note(track, midi, t, dur, vel = 0.8) {
    const ctx = this.ctx, p = track.patch, algo = ALGOS[p.algo] || ALGOS[0];
    const f = 440 * 2 ** ((midi - 69) / 12);
    t = Math.max(t, ctx.currentTime);
    const out = ctx.createGain();
    out.gain.value = vel * 0.3 / Math.sqrt(algo.carriers.length);
    let tail = out;
    if (p.cut != null && p.cut < 1) {
      tail = ctx.createBiquadFilter();
      tail.type = 'lowpass';
      tail.frequency.value = 80 * 2 ** (p.cut * 7.8);
      if (p.fEnv > 0) {
        tail.frequency.setValueAtTime(80 * 2 ** (Math.min(1, p.cut + p.fEnv) * 7.8), t);
        tail.frequency.setTargetAtTime(80 * 2 ** (p.cut * 7.8), t, Math.max(p.fTime || 0.2, 0.01) / 3);
      }
      tail.Q.value = p.res || 0.7;
      out.connect(tail);
    }
    tail.connect(this.channel(track).in);
    let lfoGain = null, lfo = null;
    if (p.vibDepth > 0) {
      lfo = ctx.createOscillator(); lfoGain = ctx.createGain();
      lfo.frequency.value = p.vibRate || 5;
      lfoGain.gain.value = p.vibDepth;
      lfo.connect(lfoGain);
    }
    const oscs = [], gains = [];
    let end = t;
    p.ops.forEach((o, i) => {
      const isCar = algo.carriers.includes(i);
      if (!(isCar || algo.mods.some(m => m[0] === i)) || o.level <= 0) { oscs.push(null); gains.push(null); return; }
      const osc = ctx.createOscillator(), g = ctx.createGain(), fo = f * o.ratio;
      osc.frequency.value = fo;
      osc.type = o.wave || 'sine';
      osc.detune.value = o.dt || 0;
      if (p.pitchAmt) {
        osc.detune.setValueAtTime((o.dt || 0) + p.pitchAmt * 100, t);
        osc.detune.setTargetAtTime(o.dt || 0, t, Math.max(p.pitchTime || 0.1, 0.005) / 3);
      }
      if (lfoGain) lfoGain.connect(osc.detune);
      osc.connect(g);
      // Carriers output audio; modulators output Hz of deviation (index * freq).
      end = Math.max(end, env(g.gain, t, dur, isCar ? o.level : o.level * o.level * 12 * fo, o));
      oscs.push(osc); gains.push(g);
    });
    algo.carriers.forEach(i => gains[i] && gains[i].connect(out));
    algo.mods.forEach(([m, c]) => { if (gains[m] && oscs[c]) gains[m].connect(oscs[c].frequency); });
    const live = oscs.filter(Boolean);
    live.forEach(o => { o.start(t); o.stop(end + 0.02); });
    if (lfo) { lfo.start(t); lfo.stop(end + 0.02); }
    if (live[0]) live[0].onended = () => { tail.disconnect(); if (lfoGain) lfoGain.disconnect(); };
  }

  drum(track, row, t, vel = 0.8) {
    const ctx = this.ctx, dest = this.channel(track).in;
    t = Math.max(t, ctx.currentTime);
    const tone = (type, f0, f1, pt, dec, lvl) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + pt);
      g.gain.setValueAtTime(lvl * vel, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + dec + 0.02);
      o.onended = () => g.disconnect();
    };
    const noise = (ftype, freq, q, dec, lvl, bursts = 0) => {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = this.noiseBuf; s.loop = true;
      fl.type = ftype; fl.frequency.value = freq; fl.Q.value = q;
      let t0 = t;
      for (let i = 0; i < bursts; i++) {
        g.gain.setValueAtTime(lvl * vel, t0);
        g.gain.exponentialRampToValueAtTime(lvl * vel * 0.2, t0 + 0.01);
        t0 += 0.012;
      }
      g.gain.setValueAtTime(lvl * vel, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dec);
      s.connect(fl).connect(g).connect(dest);
      s.start(t, Math.random() * 0.5); s.stop(t0 + dec + 0.02);
      s.onended = () => g.disconnect();
    };
    // Six detuned squares through a highpass: the metallic hat/cymbal recipe.
    const metal = (hp, dec, lvl) => {
      const f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'highpass'; f.frequency.value = hp;
      g.gain.setValueAtTime(lvl * vel, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      f.connect(g).connect(dest);
      [205.3, 304.4, 369.6, 522.7, 540, 800].forEach((fr, i) => {
        const o = ctx.createOscillator();
        o.type = 'square'; o.frequency.value = fr;
        o.connect(f); o.start(t); o.stop(t + dec + 0.02);
        if (i === 0) o.onended = () => g.disconnect();
      });
    };
    const kits = {
      'Classic': [
        () => tone('sine', 150, 45, 0.12, 0.4, 1.1),
        () => { tone('triangle', 200, 140, 0.08, 0.12, 0.5); noise('highpass', 1800, 0.7, 0.18, 0.6); },
        () => noise('bandpass', 1300, 1.2, 0.2, 0.9, 3),
        () => tone('sine', 120, 70, 0.2, 0.3, 0.8),
        () => tone('sine', 200, 125, 0.2, 0.25, 0.7),
        () => { tone('square', 540, 540, 0.1, 0.18, 0.18); tone('square', 800, 800, 0.1, 0.18, 0.18); },
        () => noise('highpass', 7500, 0.7, 0.045, 0.45),
        () => noise('highpass', 7000, 0.7, 0.32, 0.4),
      ],
      '808 style': [
        () => tone('sine', 130, 50, 0.05, 0.9, 1.1),
        () => { tone('sine', 240, 180, 0.03, 0.15, 0.45); tone('sine', 480, 330, 0.03, 0.08, 0.25); noise('highpass', 2500, 0.7, 0.2, 0.45); },
        () => noise('bandpass', 1000, 1.5, 0.35, 0.8, 3),
        () => tone('sine', 110, 80, 0.1, 0.5, 0.8),
        () => tone('sine', 190, 150, 0.1, 0.35, 0.7),
        () => { tone('square', 540, 540, 0.1, 0.4, 0.15); tone('square', 800, 800, 0.1, 0.4, 0.15); },
        () => metal(7000, 0.05, 0.22),
        () => metal(7000, 0.45, 0.2),
      ],
      '909 style': [
        () => { tone('sine', 240, 48, 0.06, 0.45, 1.15); noise('highpass', 2000, 0.7, 0.012, 0.3); },
        () => { tone('triangle', 280, 180, 0.04, 0.12, 0.55); noise('highpass', 1200, 0.7, 0.22, 0.7); },
        () => noise('bandpass', 1400, 1, 0.25, 0.9, 3),
        () => tone('sine', 160, 80, 0.12, 0.35, 0.9),
        () => tone('sine', 280, 150, 0.12, 0.3, 0.8),
        () => { tone('triangle', 1700, 1700, 0.01, 0.03, 0.5); tone('square', 480, 480, 0.01, 0.03, 0.2); },
        () => { noise('highpass', 8500, 0.7, 0.05, 0.4); metal(9000, 0.04, 0.25); },
        () => { noise('highpass', 8000, 0.7, 0.4, 0.35); metal(9000, 0.35, 0.2); },
      ],
      '606 style': [
        () => tone('sine', 140, 55, 0.04, 0.22, 1),
        () => { tone('triangle', 250, 200, 0.02, 0.07, 0.35); noise('highpass', 3000, 0.7, 0.11, 0.55); },
        () => noise('bandpass', 1800, 2, 0.12, 0.7, 2),
        () => tone('sine', 150, 110, 0.05, 0.2, 0.7),
        () => tone('sine', 230, 180, 0.05, 0.16, 0.65),
        () => metal(5000, 0.7, 0.14),
        () => metal(8000, 0.035, 0.24),
        () => metal(8000, 0.25, 0.2),
      ],
    };
    const hit = (kits[track.kit] || kits.Classic)[row];
    if (hit) hit();
  }
}

// Which pattern (and step within it) a track plays at global step gstep.
// Loop mode: the track's active pattern loops at its own length.
// Song mode: the arrangement cell for the bar; a multi-bar pattern advances
// through its bars across consecutive cells holding the same pattern.
export function patternAt(track, P, mode, gstep) {
  if (mode === 'loop') {
    const p = track.patterns[track.active];
    return [p, gstep % (p.bars * 16)];
  }
  const bar = Math.floor(gstep / 16) % P.songBars, pi = track.song[bar];
  if (pi == null || pi < 0) return null;
  let run = 0;
  while (bar - run - 1 >= 0 && track.song[bar - run - 1] === pi) run++;
  const p = track.patterns[pi];
  return [p, (run % p.bars) * 16 + gstep % 16];
}

export function scheduleStep(engine, P, mode, gstep, time) {
  const sd = 60 / P.bpm / 4, anySolo = P.tracks.some(t => t.solo);
  for (const tr of P.tracks) {
    if (tr.mute || (anySolo && !tr.solo)) continue;
    const r = patternAt(tr, P, mode, gstep);
    if (!r) continue;
    for (const n of r[0].notes) {
      if (n.s !== r[1]) continue;
      if (tr.type === 'drums') engine.drum(tr, n.p, time, n.v);
      else engine.note(tr, n.p, time, n.l * sd, n.v);
    }
  }
}

export const swingOffset = (P, gstep) => (gstep % 2 ? P.swing * (60 / P.bpm / 4) * 0.5 : 0);

// Renders the song (or two cycles of the current loop) to a 16-bit WAV blob.
export async function renderWav(P, mode) {
  const sd = 60 / P.bpm / 4, sr = 44100;
  const steps = mode === 'song'
    ? P.songBars * 16
    : Math.max(...P.tracks.map(t => t.patterns[t.active].bars)) * 32;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(2, Math.ceil((steps * sd + 2.5) * sr), sr);
  const engine = new Engine(ctx);
  engine.setBpm(P.bpm);
  for (let s = 0; s < steps; s++) scheduleStep(engine, P, mode, s, 0.05 + s * sd + swingOffset(P, s));
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length;
  const dv = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return new Blob([dv], { type: 'audio/wav' });
}
