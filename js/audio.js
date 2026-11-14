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
const OFF = () => op(1, 0, 0.01, 0.3, 0, 0.1);

export const PRESETS = {
  'E-Piano': { algo: 3, ops: [op(1, 0.9, 0.002, 1.4, 0, 0.3), op(14, 0.25, 0.001, 0.15, 0, 0.1), op(1, 0.7, 0.002, 1.8, 0, 0.3, 4), op(1, 0.35, 0.002, 0.8, 0, 0.2)] },
  'Bass': { algo: 2, ops: [op(1, 1, 0.002, 0.3, 0.6, 0.08), op(1, 0.55, 0.001, 0.15, 0.2, 0.08), op(2, 0.3, 0.001, 0.08, 0, 0.05), OFF()] },
  'Pluck': { algo: 2, ops: [op(1, 0.9, 0.001, 0.3, 0, 0.2), op(3, 0.45, 0.001, 0.1, 0, 0.1), op(1, 0.3, 0.001, 0.2, 0, 0.1), OFF()] },
  'Bell': { algo: 3, ops: [op(1, 0.8, 0.001, 2.5, 0, 1.5), op(3.5, 0.5, 0.001, 2, 0, 1.5), op(1, 0.5, 0.001, 3, 0, 1.5, 7), op(7, 0.4, 0.001, 1.2, 0, 1)] },
  'Brass': { algo: 2, ops: [op(1, 0.9, 0.05, 0.3, 0.8, 0.15), op(1, 0.5, 0.08, 0.4, 0.6, 0.15), op(2, 0.25, 0.1, 0.3, 0.4, 0.15), OFF()] },
  'Pad': { algo: 3, ops: [op(1, 0.7, 0.4, 1, 0.8, 1.2), op(2, 0.3, 0.6, 1.5, 0.5, 1.2), op(1, 0.7, 0.5, 1, 0.8, 1.2, 9), op(3, 0.22, 0.8, 2, 0.4, 1.2)] },
  'Lead': { algo: 0, ops: [op(1, 0.9, 0.005, 0.2, 0.8, 0.12), op(2, 0.5, 0.005, 0.4, 0.5, 0.12), op(1, 0.4, 0.005, 0.3, 0.3, 0.12), OFF()] },
  'Organ': { algo: 5, ops: [op(0.5, 0.7, 0.005, 0.1, 1, 0.06), op(1, 0.8, 0.005, 0.1, 1, 0.06), op(2, 0.5, 0.005, 0.1, 1, 0.06), op(3, 0.3, 0.005, 0.1, 1, 0.06)] },
};

// Drum rows; index is stored as the note pitch on drum tracks.
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
    out.connect(this.channel(track).in);
    const oscs = [], gains = [];
    let end = t;
    p.ops.forEach((o, i) => {
      const isCar = algo.carriers.includes(i);
      if (!(isCar || algo.mods.some(m => m[0] === i)) || o.level <= 0) { oscs.push(null); gains.push(null); return; }
      const osc = ctx.createOscillator(), g = ctx.createGain(), fo = f * o.ratio;
      osc.frequency.value = fo;
      osc.detune.value = o.dt || 0;
      osc.connect(g);
      // Carriers output audio; modulators output Hz of deviation (index * freq).
      end = Math.max(end, env(g.gain, t, dur, isCar ? o.level : o.level * o.level * 12 * fo, o));
      oscs.push(osc); gains.push(g);
    });
    algo.carriers.forEach(i => gains[i] && gains[i].connect(out));
    algo.mods.forEach(([m, c]) => { if (gains[m] && oscs[c]) gains[m].connect(oscs[c].frequency); });
    const live = oscs.filter(Boolean);
    live.forEach(o => { o.start(t); o.stop(end + 0.02); });
    if (live[0]) live[0].onended = () => out.disconnect();
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
    switch (row) {
      case 0: tone('sine', 150, 45, 0.12, 0.4, 1.1); break;
      case 1: tone('triangle', 200, 140, 0.08, 0.12, 0.5); noise('highpass', 1800, 0.7, 0.18, 0.6); break;
      case 2: noise('bandpass', 1300, 1.2, 0.2, 0.9, 3); break;
      case 3: tone('sine', 120, 70, 0.2, 0.3, 0.8); break;
      case 4: tone('sine', 200, 125, 0.2, 0.25, 0.7); break;
      case 5: tone('square', 540, 540, 0.1, 0.18, 0.18); tone('square', 800, 800, 0.1, 0.18, 0.18); break;
      case 6: noise('highpass', 7500, 0.7, 0.045, 0.45); break;
      case 7: noise('highpass', 7000, 0.7, 0.32, 0.4); break;
    }
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
