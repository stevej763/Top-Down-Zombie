import { rand } from '../core/math';
import type { WeaponId } from '../weapons/WeaponDefs';
import { TRACKS, type Track } from './tracks';

const MASTER_VOLUME = 0.5;
const MUSIC_VOLUME = 0.35;
const TRACKS_URL = `${import.meta.env.BASE_URL}audio/tracks/`;

interface NoiseOpts {
  dur: number;
  freq: number;
  gain: number;
  type?: BiquadFilterType;
  q?: number;
  delay?: number;
}

interface ToneOpts {
  freq: number;
  to?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
}

const SHOTS: Record<WeaponId, { noise: NoiseOpts; tone: ToneOpts }> = {
  pistol: { noise: { dur: 0.12, freq: 2500, gain: 0.5 }, tone: { freq: 140, to: 50, dur: 0.08, gain: 0.3 } },
  shotgun: { noise: { dur: 0.35, freq: 1200, gain: 0.9 }, tone: { freq: 90, to: 35, dur: 0.2, gain: 0.6 } },
  smg: { noise: { dur: 0.07, freq: 3000, gain: 0.3 }, tone: { freq: 160, to: 60, dur: 0.05, gain: 0.18 } },
  rifle: { noise: { dur: 0.15, freq: 2000, gain: 0.5 }, tone: { freq: 120, to: 40, dur: 0.1, gain: 0.35 } },
  lmg: { noise: { dur: 0.12, freq: 1600, gain: 0.45 }, tone: { freq: 100, to: 40, dur: 0.1, gain: 0.35 } },
  magnum: { noise: { dur: 0.4, freq: 1500, gain: 0.9 }, tone: { freq: 80, to: 30, dur: 0.3, gain: 0.7 } },
  plasma: { noise: { dur: 0.15, freq: 4000, gain: 0.15, type: 'highpass' }, tone: { freq: 900, to: 120, dur: 0.25, gain: 0.25, type: 'square' } },
};

/** Procedural WebAudio sound effects. The AudioContext is created on the first user gesture. */
class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private music: HTMLAudioElement | null = null;
  /** Shuffled queue; every track plays once before any repeats. */
  private queue: Track[] = [];
  private lastTrack: Track | null = null;
  /** Called whenever a new track starts (for the "now playing" toast). */
  onTrackChange: ((t: Track) => void) | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    if (typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(ctx.destination);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
  }

  /** Start the shuffled soundtrack (no-op until audio is unlocked, or if already started). */
  startMusic(): void {
    if (!this.ctx || this.music || TRACKS.length === 0) return;
    const music = new Audio();
    music.addEventListener('ended', () => this.nextTrack());
    // A missing or broken file just skips to the next track.
    music.addEventListener('error', () => setTimeout(() => this.nextTrack(), 1000));
    const gain = this.ctx.createGain();
    gain.gain.value = MUSIC_VOLUME;
    // Route through the master gain so mute applies to music too.
    this.ctx.createMediaElementSource(music).connect(gain).connect(this.master);
    this.music = music;
    this.nextTrack();
  }

  private nextTrack(): void {
    const m = this.music;
    if (!m) return;
    if (this.queue.length === 0) {
      this.queue = shuffle([...TRACKS]);
      // Don't repeat the last track across a reshuffle.
      if (this.queue.length > 1 && this.queue[this.queue.length - 1] === this.lastTrack) this.queue.reverse();
    }
    const track = this.queue.pop()!;
    this.lastTrack = track;
    m.src = TRACKS_URL + track.file;
    m.play().catch(() => {});
    this.onTrackChange?.(track);
  }

  setMusicPaused(paused: boolean): void {
    const m = this.music;
    if (!m || m.paused === paused) return;
    if (paused) m.pause();
    else m.play().catch(() => {});
  }

  private noise(o: NoiseOpts, vol = 1): void {
    const c = this.ctx;
    if (!c || vol <= 0.01) return;
    const t = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.value = o.freq;
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, rand(0, 0.5));
    src.stop(t + o.dur + 0.05);
  }

  private tone(o: ToneOpts, vol = 1): void {
    const c = this.ctx;
    if (!c || vol <= 0.01) return;
    const t = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain * vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  shot(id: WeaponId): void {
    const s = SHOTS[id];
    this.noise(s.noise);
    this.tone(s.tone);
  }

  knife(hit: boolean): void {
    this.noise({ dur: 0.12, freq: 3500, gain: 0.25, type: 'highpass' });
    if (hit) this.noise({ dur: 0.1, freq: 400, gain: 0.45, delay: 0.04 });
  }

  reload(): void {
    this.noise({ dur: 0.05, freq: 3000, gain: 0.2, type: 'bandpass', q: 4 });
    this.noise({ dur: 0.06, freq: 2200, gain: 0.25, type: 'bandpass', q: 4, delay: 0.25 });
  }

  hit(): void {
    this.noise({ dur: 0.08, freq: 500, gain: 0.25 });
  }

  zombieDeath(vol: number): void {
    this.tone({ freq: 160, to: 60, dur: 0.4, gain: 0.25, type: 'sawtooth' }, vol);
    this.noise({ dur: 0.2, freq: 400, gain: 0.3 }, vol);
  }

  groan(vol: number): void {
    const c = this.ctx;
    if (!c || vol <= 0.01) return;
    const t = c.currentTime;
    const dur = rand(0.7, 1.3);
    const base = rand(65, 110);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.7, t + dur);
    const lfo = c.createOscillator();
    lfo.frequency.value = rand(4, 8);
    const lfoGain = c.createGain();
    lfoGain.gain.value = base * 0.08;
    lfo.connect(lfoGain).connect(osc.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * vol, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(f).connect(g).connect(this.master);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  plankTear(vol: number): void {
    this.noise({ dur: 0.18, freq: 1400, gain: 0.5, type: 'bandpass', q: 2 }, vol);
    this.tone({ freq: 220, to: 90, dur: 0.12, gain: 0.25, type: 'triangle' }, vol);
  }

  plankPlace(): void {
    this.tone({ freq: 140, to: 80, dur: 0.12, gain: 0.4, type: 'triangle' });
    this.noise({ dur: 0.05, freq: 900, gain: 0.3 });
  }

  buy(): void {
    this.tone({ freq: 880, dur: 0.1, gain: 0.2, type: 'square' });
    this.tone({ freq: 1320, dur: 0.18, gain: 0.2, type: 'square', delay: 0.08 });
  }

  denied(): void {
    this.tone({ freq: 140, dur: 0.25, gain: 0.25, type: 'square' });
  }

  door(): void {
    this.tone({ freq: 300, to: 180, dur: 0.6, gain: 0.15, type: 'sawtooth' });
    this.noise({ dur: 0.4, freq: 600, gain: 0.4, delay: 0.1 });
  }

  perk(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.18, gain: 0.18, type: 'triangle', delay: i * 0.09 }));
  }

  upgrade(): void {
    [220, 330, 440, 660, 880].forEach((f, i) => this.tone({ freq: f, dur: 0.25, gain: 0.18, type: 'sawtooth', delay: i * 0.07 }));
  }

  armour(): void {
    this.noise({ dur: 0.3, freq: 2500, gain: 0.3, type: 'bandpass', q: 3 });
    this.tone({ freq: 400, to: 600, dur: 0.3, gain: 0.15, type: 'triangle' });
  }

  boxTick(): void {
    this.tone({ freq: rand(600, 1200), dur: 0.05, gain: 0.08, type: 'triangle' });
  }

  boxReveal(): void {
    [784, 988, 1175].forEach((f, i) => this.tone({ freq: f, dur: 0.3, gain: 0.15, type: 'triangle', delay: i * 0.06 }));
  }

  powerUp(): void {
    [659, 880, 1319].forEach((f, i) => this.tone({ freq: f, dur: 0.25, gain: 0.2, type: 'square', delay: i * 0.07 }));
  }

  explosion(vol = 1): void {
    this.noise({ dur: 0.6, freq: 700, gain: 0.8 }, vol);
    this.tone({ freq: 70, to: 25, dur: 0.5, gain: 0.6 }, vol);
  }

  hurt(): void {
    this.tone({ freq: 200, to: 100, dur: 0.2, gain: 0.3, type: 'sawtooth' });
    this.noise({ dur: 0.12, freq: 800, gain: 0.3 });
  }

  revive(): void {
    [262, 392, 523, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.4, gain: 0.2, type: 'triangle', delay: i * 0.12 }));
  }

  roundStart(): void {
    [55, 82.5, 110].forEach((f) => this.tone({ freq: f, dur: 3, gain: 0.25, type: 'sawtooth' }));
  }

  roundEnd(): void {
    [110, 131, 165].forEach((f, i) => this.tone({ freq: f, dur: 1.5, gain: 0.2, type: 'triangle', delay: i * 0.2 }));
  }

  gameOver(): void {
    [196, 165, 131, 98].forEach((f, i) => this.tone({ freq: f, dur: 0.8, gain: 0.25, type: 'sawtooth', delay: i * 0.35 }));
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sound = new Sound();
