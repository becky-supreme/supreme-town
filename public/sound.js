// Sounds for Supreme Town, all made in the browser: no audio files.
// Short effects (footsteps, hopping on a ride, picking things up, the arcade) and
// an original looping beat for the dance floor, louder the closer you are.
//
// Browsers only allow sound after someone clicks or presses a key, so start()
// is called when you enter the town.

let ctx = null;
let master = null; // everything
let fx = null; // effects
let musicBus = null; // dance floor music
let muted = false;
try { muted = localStorage.getItem('hq.muted') === '1'; } catch { /* private window */ }

export function start() {
  if (ctx) { ctx.resume?.(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);
  fx = ctx.createGain(); fx.gain.value = 0.55; fx.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
}
export const isMuted = () => muted;
export function setMuted(on) {
  muted = !!on;
  try { localStorage.setItem('hq.muted', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
}

// ---------- building blocks ----------
function tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, at = 0, attack = 0.005, out = fx }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuffer = null;
function noise({ dur = 0.1, vol = 0.2, at = 0, filter = 2000, type = 'bandpass', q = 1, out = fx, when = null }) {
  if (!ctx || muted) return;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = when ?? ctx.currentTime + at;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuffer;
  f.type = type; f.frequency.value = filter; f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

// ---------- effects ----------
let stepFlip = false;
const SOUNDS = {
  step: () => { stepFlip = !stepFlip; noise({ dur: 0.05, vol: 0.05, filter: stepFlip ? 900 : 1100, q: 0.8 }); },
  hop: () => { tone({ freq: 220, to: 660, type: 'triangle', dur: 0.18, vol: 0.25 }); noise({ dur: 0.2, vol: 0.06, filter: 3000, at: 0.02 }); },
  hopOff: () => tone({ freq: 520, to: 200, type: 'triangle', dur: 0.16, vol: 0.2 }),
  engine: () => tone({ freq: 70, to: 95, type: 'sawtooth', dur: 0.35, vol: 0.06 }),
  pickup: () => { tone({ freq: 660, type: 'sine', dur: 0.08, vol: 0.25 }); tone({ freq: 990, type: 'sine', dur: 0.12, vol: 0.2, at: 0.07 }); },
  drink: () => { tone({ freq: 1500, type: 'sine', dur: 0.06, vol: 0.15 }); tone({ freq: 1900, type: 'sine', dur: 0.1, vol: 0.12, at: 0.06 }); },
  sit: () => noise({ dur: 0.12, vol: 0.08, filter: 400, type: 'lowpass' }),
  chime: () => { tone({ freq: 784, dur: 0.35, vol: 0.12 }); tone({ freq: 1047, dur: 0.5, vol: 0.1, at: 0.12 }); },
  chat: () => tone({ freq: 880, to: 1100, type: 'sine', dur: 0.08, vol: 0.1 }),
  click: () => tone({ freq: 600, type: 'square', dur: 0.03, vol: 0.05 }),
  blip: () => tone({ freq: 520, type: 'square', dur: 0.05, vol: 0.12 }),
  wall: () => tone({ freq: 300, type: 'square', dur: 0.04, vol: 0.08 }),
  score: () => { tone({ freq: 523, type: 'square', dur: 0.1, vol: 0.12 }); tone({ freq: 784, type: 'square', dur: 0.16, vol: 0.12, at: 0.1 }); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.18, vol: 0.12, at: i * 0.12 })),
  magic: () => [880, 1175, 1397, 1760, 2093].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.4, vol: 0.08, at: i * 0.07 })),
  dance: () => tone({ freq: 392, to: 784, type: 'triangle', dur: 0.2, vol: 0.15 }),
};
export function play(name) { start(); SOUNDS[name]?.(); }

// ---------- dance floor music: an original four-chord loop ----------
const BPM = 118;
const STEP = 60 / BPM / 4; // sixteenth notes
// Roots of the four chords (A minor, F, C, G), two bars each.
const ROOTS = [57, 53, 60, 55];
const CHORDS = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
const BASS = [0, null, 0, null, 12, null, 0, 7, 0, null, 0, null, 10, null, 7, null];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
let step = 0, nextTime = 0, timer = null, level = 0;

function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.32);
}
function note(n, t, dur, type, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = type; o.frequency.value = midi(n);
  f.type = 'lowpass'; f.frequency.value = type === 'sawtooth' ? 1400 : 3000;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(musicBus);
  o.start(t); o.stop(t + dur + 0.02);
}
function scheduleStep(s, t) {
  const bar = Math.floor(s / 16) % 8, i = s % 16;
  const chord = Math.floor(bar / 2);
  const root = ROOTS[chord];
  if (i % 4 === 0) kick(t);
  if (i % 4 === 2) noise({ dur: 0.04, vol: 0.18, filter: 8000, type: 'highpass', out: musicBus, when: t });
  if (i === 4 || i === 12) noise({ dur: 0.14, vol: 0.3, filter: 1800, q: 0.6, out: musicBus, when: t });
  const b = BASS[i];
  if (b !== null) note(root - 24 + b, t, STEP * 1.6, 'sawtooth', 0.28);
  if (i === 2 || i === 10) for (const c of CHORDS[chord]) note(root + c, t, STEP * 1.5, 'square', 0.045);
  if (bar % 2 === 1 && (i === 6 || i === 14)) note(root + 12 + CHORDS[chord][(i >> 3) + 1], t, STEP * 2, 'triangle', 0.08);
}
function scheduler() {
  while (nextTime < ctx.currentTime + 0.15) { scheduleStep(step++, nextTime); nextTime += STEP; }
}
// 0 = silent, 1 = right in the middle of the dance floor.
export function setMusicLevel(v) {
  if (!ctx) return;
  const want = Math.max(0, Math.min(1, v));
  if (want > 0 && !timer) { nextTime = ctx.currentTime + 0.05; timer = setInterval(scheduler, 40); }
  if (Math.abs(want - level) > 0.01) musicBus.gain.setTargetAtTime(want * 0.5, ctx.currentTime, 0.3);
  level = want;
  if (want === 0 && timer && musicBus.gain.value < 0.005) { clearInterval(timer); timer = null; }
}
