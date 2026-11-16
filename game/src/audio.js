// Synthesised sound effects: every sound is built from oscillators and filtered noise, so
// the game ships no audio files and makes no network request. One AudioContext, created on
// the first user gesture; every effect is a short node graph that frees itself.
export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') void context.resume();
      return true;
    }
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return false;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
    return true;
  }

  function noiseBuffer(seconds) {
    const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * seconds)), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ seconds, filter, freq, gain, at = 0, type = 'lowpass', q = 1 }) {
    if (!context || muted) return;
    const t = context.currentTime + at;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(seconds);
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = freq;
    node.Q.value = q;
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    source.connect(node).connect(amp).connect(master);
    source.start(t);
    source.stop(t + seconds + 0.02);
  }

  function tone({ freq, end, seconds, gain, at = 0, type = 'sine' }) {
    if (!context || muted) return;
    const t = context.currentTime + at;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + seconds);
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  // distance in metres: shots from far away arrive softer and duller.
  function shot(distance = 0, big = false) {
    if (!ensure()) return;
    const near = Math.max(0, 1 - distance / 70);
    burst({ seconds: big ? 0.22 : 0.11, filter: null, freq: big ? 900 : 2400, gain: (big ? 0.9 : 0.55) * (0.25 + 0.75 * near) });
    tone({ freq: big ? 130 : 190, end: 55, seconds: big ? 0.2 : 0.09, gain: 0.5 * (0.3 + 0.7 * near), type: 'triangle' });
  }

  function dryFire() {
    if (!ensure()) return;
    tone({ freq: 1400, seconds: 0.03, gain: 0.12, type: 'square' });
  }

  function reload() {
    if (!ensure()) return;
    tone({ freq: 900, seconds: 0.03, gain: 0.15, type: 'square' });
    tone({ freq: 600, seconds: 0.03, gain: 0.15, type: 'square', at: 0.18 });
    tone({ freq: 1100, seconds: 0.04, gain: 0.2, type: 'square', at: 0.55 });
  }

  function hit(kill) {
    if (!ensure()) return;
    tone({ freq: kill ? 1560 : 1180, seconds: 0.07, gain: 0.25, type: 'sine' });
    if (kill) tone({ freq: 2090, seconds: 0.12, gain: 0.2, type: 'sine', at: 0.07 });
  }

  function hurt() {
    if (!ensure()) return;
    tone({ freq: 220, end: 90, seconds: 0.16, gain: 0.4, type: 'sawtooth' });
  }

  function beep(final = false) {
    if (!ensure()) return;
    tone({ freq: final ? 1900 : 1250, seconds: final ? 0.3 : 0.09, gain: 0.22, type: 'sine' });
  }

  function explosion() {
    if (!ensure()) return;
    burst({ seconds: 1.1, filter: null, freq: 420, gain: 1.0 });
    tone({ freq: 90, end: 28, seconds: 0.9, gain: 0.9, type: 'sine' });
  }

  function bounce() {
    if (!ensure()) return;
    tone({ freq: 700, end: 300, seconds: 0.06, gain: 0.15, type: 'triangle' });
  }

  function step() {
    if (!ensure()) return;
    burst({ seconds: 0.05, filter: null, freq: 500, gain: 0.06 });
  }

  function buy() {
    if (!ensure()) return;
    tone({ freq: 880, seconds: 0.06, gain: 0.18, type: 'sine' });
    tone({ freq: 1320, seconds: 0.09, gain: 0.18, type: 'sine', at: 0.06 });
  }

  function sting(win) {
    if (!ensure()) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((freq, i) => tone({ freq, seconds: 0.28, gain: 0.22, type: 'triangle', at: i * 0.13 }));
  }

  function denied() {
    if (!ensure()) return;
    tone({ freq: 220, seconds: 0.1, gain: 0.2, type: 'square' });
  }

  return {
    unlock: ensure,
    shot,
    dryFire,
    reload,
    hit,
    hurt,
    beep,
    explosion,
    bounce,
    step,
    buy,
    sting,
    denied,
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
