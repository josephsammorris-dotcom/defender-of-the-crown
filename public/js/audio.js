// Small synthesised sound kit — no audio files needed.
export class Audio {
  constructor() { this.ctx = null; this.musicOn = true; this.musicTimer = null; }

  start() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain(); this.music.gain.value = 0.16; this.music.connect(this.master);
  }

  tone(freq, dur, { type = 'triangle', vol = 0.3, at = 0, slide = 0, dest } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.4, freq = 1000, q = 1, at = 0, type = 'bandpass' } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }

  fanfare() { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.35, { type: 'square', vol: 0.12, at: i * 0.12 })); this.tone(784, 0.8, { type: 'square', vol: 0.1, at: 0.5 }); }
  clang() { this.tone(1800, 0.25, { type: 'square', vol: 0.12 }); this.tone(2600, 0.3, { vol: 0.1 }); this.noise(0.15, { freq: 5000, vol: 0.3 }); }
  hit(heavy) { this.noise(heavy ? 0.35 : 0.2, { freq: heavy ? 400 : 900, vol: 0.6 }); this.tone(heavy ? 90 : 140, 0.25, { type: 'sine', vol: 0.4, slide: 0.5 }); }
  whoosh() { this.noise(0.5, { freq: 600, q: 0.6, vol: 0.25 }); }
  thud() { this.tone(70, 0.35, { type: 'sine', vol: 0.5, slide: 0.5 }); this.noise(0.25, { freq: 200, vol: 0.4 }); }
  boom() { this.tone(55, 0.8, { type: 'sine', vol: 0.7, slide: 0.4 }); this.noise(0.9, { freq: 300, vol: 0.8, type: 'lowpass' }); }
  hammer() { [0, 0.18].forEach((at) => { this.tone(900, 0.08, { type: 'square', vol: 0.12, at }); this.noise(0.06, { freq: 3000, vol: 0.2, at }); }); }
  hooves(secs) { for (let t = 0; t < secs; t += 0.18) this.noise(0.06, { freq: 250 + Math.random() * 80, vol: 0.25, at: t }); }
  chime() { this.tone(880, 0.3, { vol: 0.15 }); this.tone(1320, 0.4, { vol: 0.1, at: 0.08 }); }

  // A gentle looping lute-like tune in D dorian.
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const notes = [62, 65, 69, 67, 65, 64, 62, 57, 60, 62, 64, 65, 64, 62, 60, 62];
    const bass = [50, 50, 48, 48, 46, 46, 45, 45];
    let step = 0;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    this.musicTimer = setInterval(() => {
      if (!this.musicOn) return;
      const n = notes[step % notes.length];
      this.tone(midi(n), 0.5, { type: 'triangle', vol: 0.5, dest: this.music });
      if (step % 2 === 0) this.tone(midi(bass[(step / 2) % bass.length]), 0.9, { type: 'sine', vol: 0.6, dest: this.music });
      step++;
    }, 340);
  }
  toggleMusic() { this.musicOn = !this.musicOn; return this.musicOn; }
}
