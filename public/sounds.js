// Tiny WebAudio synth — no audio files needed.
let ctx = null;
let muted = localStorage.getItem('ludo-muted') === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture.
document.addEventListener('pointerdown', () => { try { ac(); } catch {} }, { once: true, capture: true });

function tone(freq, dur, { type = 'sine', vol = 0.18, when = 0, slide } = {}) {
  if (muted) return;
  const c = ac();
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function rattle(when) {
  if (muted) return;
  const c = ac();
  const t0 = c.currentTime + when;
  const len = Math.floor(c.sampleRate * 0.04);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = 0.12;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 1800;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
}

export const sound = {
  get muted() { return muted; },
  toggleMute() {
    muted = !muted;
    localStorage.setItem('ludo-muted', muted ? '1' : '0');
    return muted;
  },
  dice() { for (let i = 0; i < 6; i++) rattle(i * 0.075); },
  step() { tone(760, 0.06, { type: 'triangle', vol: 0.08 }); },
  enter() { tone(440, 0.15, { slide: 720, vol: 0.14 }); },
  capture() { tone(420, 0.3, { type: 'sawtooth', slide: 110, vol: 0.14 }); },
  finish() { [523, 659, 784].forEach((f, i) => tone(f, 0.14, { when: i * 0.09 })); },
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, { when: i * 0.13, vol: 0.2 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, { when: i * 0.18, type: 'triangle' })); },
  turn() { tone(587, 0.1); tone(880, 0.16, { when: 0.12 }); },
  chat() { tone(880, 0.09, { vol: 0.07 }); },
  click() { tone(660, 0.05, { type: 'square', vol: 0.05 }); },
};
