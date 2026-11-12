// Background music, composed live with Web Audio (no audio files to download): a slow, magical loop in
// D minor (pads, bass, an arpeggio with an echo, and bells) that swells into a battle layer of war drums
// and driving strings whenever there's combat, then settles back. It follows the Sound switch.
const BPM = 84, BEAT = 60 / BPM, BAR = BEAT * 4;
const N = (name, oct) => 440 * 2 ** ((['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(name) - 9) / 12 + (oct - 4));
// Dm · B♭ · F · C · Dm · Gm · B♭ · A
const CHORDS = [['D', 'F', 'A'], ['A#', 'D', 'F'], ['F', 'A', 'C'], ['C', 'E', 'G'], ['D', 'F', 'A'], ['G', 'A#', 'D'], ['A#', 'D', 'F'], ['A', 'C#', 'E']];

let ctx = null, master = null, verb = null, echo = null, battleBus = null;
let timer = null, nextBar = 0, bar = 0, intensity = 0, battleUntil = 0;

function impulse(seconds = 2.8) {
  const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
  return buf;
}
function setup() {
  ctx = new AudioContext();
  master = ctx.createGain(); master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  verb = ctx.createConvolver(); verb.buffer = impulse();
  const wet = ctx.createGain(); wet.gain.value = 0.55;
  verb.connect(wet).connect(master);
  // A dotted-eighth echo for the arpeggio
  echo = ctx.createDelay(1); echo.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  const echoOut = ctx.createGain(); echoOut.gain.value = 0.35;
  echo.connect(fb).connect(echo); echo.connect(echoOut).connect(master); echoOut.connect(verb);
  battleBus = ctx.createGain(); battleBus.gain.value = 0;
  battleBus.connect(master); battleBus.connect(verb);
}

function voice(t, freq, dur, { type = 'triangle', gain = 0.1, attack = 0.02, release = 0.3, filter = 0, dest = master, toVerb = 0.3, toEcho = 0, detune = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  let node = o;
  if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; f.Q.value = 0.7; o.connect(f); node = f; }
  node.connect(g);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);
  if (toVerb) { const s = ctx.createGain(); s.gain.value = toVerb; g.connect(s).connect(verb); }
  if (toEcho) { const s = ctx.createGain(); s.gain.value = toEcho; g.connect(s).connect(echo); }
  o.start(t); o.stop(t + dur + 0.05);
}
function drum(t, { pitch = 70, gain = 0.5, noise = 0.25, dest = battleBus } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(pitch * 2.2, t); o.frequency.exponentialRampToValueAtTime(pitch, t + 0.12);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  o.connect(g).connect(dest); o.start(t); o.stop(t + 0.75);
  // The skin's slap
  const len = ctx.sampleRate * 0.12, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 900; ng.gain.value = noise;
  src.connect(f).connect(ng).connect(dest); src.start(t);
}

function scheduleBar(t, i) {
  const chord = CHORDS[i % CHORDS.length];
  const root = chord[0];
  // Pad: three slightly detuned voices per chord tone, softly filtered
  for (const n of chord) for (const dt of [-7, 0, 7]) voice(t, N(n, 3), BAR + 0.4, { type: 'sawtooth', gain: 0.012, attack: 0.9, release: 0.9, filter: 1100 + intensity * 900, detune: dt, toVerb: 0.6 });
  // Bass on beats 1 and 3
  for (const b of [0, 2]) voice(t + b * BEAT, N(root, 2), BEAT * 1.8, { type: 'sine', gain: 0.11, attack: 0.02, release: 0.5, toVerb: 0.05 });
  // Arpeggio up and down the chord (eighths), with echo
  const arp = [...chord.map(n => N(n, 4)), N(chord[0], 5), N(chord[2], 4), N(chord[1], 4)];
  for (let k = 0; k < 8; k++) voice(t + k * BEAT / 2, arp[k % arp.length] * (k % 4 === 3 ? 2 : 1), BEAT * 0.9, { type: 'triangle', gain: 0.03 + intensity * 0.015, attack: 0.005, release: 0.4, toVerb: 0.35, toEcho: 0.7 });
  // Bells every other bar
  if (i % 2 === 0) voice(t + BEAT * 2.5, N(chord[1], 6), BEAT * 3, { type: 'sine', gain: 0.025, attack: 0.003, release: 2.5, toVerb: 0.8 });
  // Battle layer: war drums and a string ostinato (faded in by the battle bus)
  if (intensity > 0.02) {
    for (const [b, p, gn] of [[0, 62, 0.55], [1.5, 80, 0.3], [2, 62, 0.45], [3, 95, 0.32], [3.5, 95, 0.25]]) drum(t + b * BEAT, { pitch: p, gain: gn });
    for (let k = 0; k < 16; k++) voice(t + k * BEAT / 4, N(k % 4 === 2 ? chord[2] : root, 3), BEAT / 4.2, { type: 'sawtooth', gain: 0.022, attack: 0.004, release: 0.08, filter: 1800, dest: battleBus, toVerb: 0.15 });
    if (i % 2 === 1) voice(t, N(root, 5), BAR, { type: 'square', gain: 0.012, attack: 0.3, release: 0.6, filter: 2200, dest: battleBus, toVerb: 0.5 });
  }
}

function tick() {
  if (!ctx) return;
  // Battle swells in and then eases off once combat is over
  const target = performance.now() < battleUntil ? 1 : 0;
  intensity += (target - intensity) * 0.08;
  battleBus.gain.setTargetAtTime(intensity * 0.9, ctx.currentTime, 0.4);
  while (nextBar < ctx.currentTime + 0.35) { scheduleBar(nextBar, bar++); nextBar += BAR; }
}

export const Music = {
  playing: false,
  // Music volume 0–1 (Display window; item 127): the loop's level is scaled by it
  volume: 1,
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (ctx && this.playing) master.gain.setTargetAtTime(0.55 * this.volume, ctx.currentTime, 0.3); },
  start() {
    try {
      if (!ctx) setup();
      ctx.resume?.();
      if (this.playing) return;
      this.playing = true;
      nextBar = ctx.currentTime + 0.1;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.55 * this.volume, ctx.currentTime, 1.2);
      timer = setInterval(tick, 60);
    } catch { /* audio unavailable */ }
  },
  stop() {
    if (!ctx || !this.playing) return;
    this.playing = false;
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    clearInterval(timer);
  },
  // Combat: the battle layer comes in for the next several seconds
  battle(seconds = 9) { battleUntil = performance.now() + seconds * 1000; },
};
