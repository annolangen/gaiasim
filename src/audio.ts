import {viewportToGridCoords} from './map-renderer';
import type {MapCamera} from './map-renderer';
import {getIdx} from './sim/engine';
import type {SimulationMetrics, SimulationState} from './sim/types';

/** C Lydian Pentatonic scale frequencies (C, D, E, F#, G, B) across octaves 3 and 4. */
const SCALE_FREQUENCIES: readonly number[] = [
  130.81, 146.83, 164.81, 185.0, 196.0, 246.94, 261.63, 293.66, 329.63, 369.99,
  392.0, 493.88,
];

// Program constants for the procedural soundtrack mix and DSP routing.
const MASTER_VOLUME = 0.28;
const MASTER_FADE_IN_SEC = 1.5;
const MASTER_FADE_OUT_SEC = 0.08;

const REVERB_ENABLED = true;
const REVERB_WET_GAIN = 0.55;
const REVERB_DURATION_SEC = 3.2;
const REVERB_DECAY = 2.3;

const DELAY_MAX_SEC = 2.0;
const DELAY_TIME_SEC = 0.65;
const DELAY_FEEDBACK = 0.4;

const PAD_FILTER_Q = 0.7;
const PAD_FILTER_MIN_HZ = 400;
const PAD_FILTER_MAX_HZ = 1400;
const PAD_DETUNE_RATIO = 1.003;
const PAD_BASE_PEAK_GAIN = 0.12;

const DRONE_FREQ_HZ = 65.41; // C2
const DRONE_SUB_LPF_HZ = 140;
const DRONE_SUB_LPF_Q = 0.7;
const DRONE_LFO_HZ = 0.08; // ~12.5s tidal breathing cycle
const DRONE_BASE_GAIN = 0.16;
const DRONE_LFO_GAIN = 0.07;
const DRONE_MIN_SCALE = 0.6;
const DRONE_MAX_SCALE = 1.2;

const WIND_BUFFER_SEC = 4;
const WIND_BASE_FILTER_Q = 1.8;
const WIND_SWELL_Q_DROP = 0.9;
const WIND_MIN_FREQ_HZ = 80;
const WIND_MAX_FREQ_HZ = 1200;
const WIND_CALM_SPEED_MPS = 2.5;
const WIND_STRONG_SPEED_MPS = 8.0;
const WIND_SWELL_MAX_GAIN = 0.95;
const WIND_SWELL_FREQ_BOOST_HZ = 280;
const WIND_SWELL_FULL_ZOOM = 4;
const VIEWPORT_WIND_SAMPLE_GRID = 5;
const VIEWPORT_WIND_SAMPLE_SPAN = 0.5;

interface LoopConfig {
  readonly intervalMs: number;
  readonly baseProb: number;
}

/** Asynchronous Eno-style prime-number phase loops prevent repeating patterns. */
const LOOP_CONFIGS: readonly LoopConfig[] = [
  {intervalMs: 5300, baseProb: 0.7},
  {intervalMs: 7900, baseProb: 0.5},
  {intervalMs: 11300, baseProb: 0.4},
];

export interface ViewportWindState {
  /** Mean wind speed (m/s) sampled across the visible camera viewport. */
  meanWindSpeedMps: number;
  /** Current map camera zoom level (1..8). */
  zoom: number;
}

export interface PlanetaryAudioParams {
  avgTempC: number;
  biomassRatio: number;
  droneScale: number;
  padFilterCutoffHz: number;
  windGain: number;
  windFilterHz: number;
  windFilterQ: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Sample mean wind speed (m/s) across the central region of the current camera viewport. */
export function sampleViewportWindSpeed(
  state: SimulationState,
  camera: MapCamera,
): number {
  let sum = 0;
  let count = 0;
  const margin = (1 - VIEWPORT_WIND_SAMPLE_SPAN) / 2;
  for (let sy = 0; sy < VIEWPORT_WIND_SAMPLE_GRID; sy++) {
    const normY =
      margin +
      ((sy + 0.5) / VIEWPORT_WIND_SAMPLE_GRID) * VIEWPORT_WIND_SAMPLE_SPAN;
    for (let sx = 0; sx < VIEWPORT_WIND_SAMPLE_GRID; sx++) {
      const normX =
        margin +
        ((sx + 0.5) / VIEWPORT_WIND_SAMPLE_GRID) * VIEWPORT_WIND_SAMPLE_SPAN;
      const coords = viewportToGridCoords(normX, normY, camera);
      if (!coords) continue;
      const idx = getIdx(coords.x, coords.y);
      sum += Math.hypot(state.windX[idx], state.windY[idx]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Derive DSP synthesizer targets from live planetary simulation metrics and viewport wind. */
export function computePlanetaryAudioParams(
  metrics: SimulationMetrics,
  viewportWind: ViewportWindState = {meanWindSpeedMps: 0, zoom: 1},
): PlanetaryAudioParams {
  const avgTempC = metrics.averageTemperatureC;
  const landPct = Math.max(0, 100 - metrics.oceanCoveragePct);
  const daisyPct =
    metrics.whiteDaisyCoveragePct + metrics.blackDaisyCoveragePct;
  const biomassRatio =
    landPct > 0
      ? clamp(Math.max(metrics.totalBiomassPct, daisyPct) / landPct, 0, 1)
      : 0;

  const oceanRatio = clamp(metrics.oceanCoveragePct / 100, 0, 1);
  const droneScale =
    DRONE_MIN_SCALE + (DRONE_MAX_SCALE - DRONE_MIN_SCALE) * oceanRatio;

  const padFilterCutoffHz = Math.round(
    clamp(
      500 + avgTempC * 15 + biomassRatio * 400,
      PAD_FILTER_MIN_HZ,
      PAD_FILTER_MAX_HZ,
    ),
  );

  // Global temperature extremity sets the baseline wind bed; zooming into windy
  // regions swells local wind volume and broadens/brightens the bandpass filter.
  const tempExtremity = clamp(Math.abs(avgTempC - 15) / 45, 0, 1);
  const baseWindGain = 0.015 + tempExtremity * 0.065;
  const baseWindFilterHz = 220 + (avgTempC + 20) * 6.5;

  const clampedZoom = clamp(viewportWind.zoom, 1, WIND_SWELL_FULL_ZOOM);
  const zoomDepth = Math.log2(clampedZoom) / Math.log2(WIND_SWELL_FULL_ZOOM);
  const windIntensity = clamp(
    (viewportWind.meanWindSpeedMps - WIND_CALM_SPEED_MPS) /
      (WIND_STRONG_SPEED_MPS - WIND_CALM_SPEED_MPS),
    0,
    1,
  );
  const windSwell = zoomDepth * windIntensity;

  const windGain =
    baseWindGain * (1 - 0.5 * zoomDepth) + windSwell * WIND_SWELL_MAX_GAIN;
  const windFilterHz = clamp(
    baseWindFilterHz + windSwell * WIND_SWELL_FREQ_BOOST_HZ,
    WIND_MIN_FREQ_HZ,
    WIND_MAX_FREQ_HZ,
  );
  const windFilterQ = WIND_BASE_FILTER_Q - windSwell * WIND_SWELL_Q_DROP;

  return {
    avgTempC,
    biomassRatio,
    droneScale,
    padFilterCutoffHz,
    windGain,
    windFilterHz,
    windFilterQ,
  };
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const win = window as Window & {webkitAudioContext?: typeof AudioContext};
  return window.AudioContext ?? win.webkitAudioContext;
}

/**
 * Procedural Web Audio ambient soundtrack synthesizer driven by GaiaSim's
 * planetary metrics, viewport wind, and play/pause state.
 */
export class PlanetaryAmbientEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private droneLfoGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private isPlaying = false;
  private readonly timers = new Set<number>();
  private params: PlanetaryAudioParams = {
    avgTempC: 15,
    biomassRatio: 0.5,
    droneScale: 1.0,
    padFilterCutoffHz: 750,
    windGain: 0.015,
    windFilterHz: 447.5,
    windFilterQ: WIND_BASE_FILTER_Q,
  };

  start(
    metrics: SimulationMetrics,
    state: SimulationState,
    camera: MapCamera,
  ): void {
    this.params = computePlanetaryAudioParams(metrics, {
      meanWindSpeedMps: sampleViewportWindSpeed(state, camera),
      zoom: camera.zoom,
    });
    if (this.isPlaying) {
      this.applyParams();
      return;
    }

    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) return;

    const ctx = new AudioCtx({latencyHint: 'playback'});
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    this.ctx = ctx;
    this.isPlaying = true;

    const now = ctx.currentTime;

    // Master output & warm low-pass filter
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, MASTER_VOLUME),
      now + MASTER_FADE_IN_SEC,
    );
    masterGain.connect(ctx.destination);
    this.masterGain = masterGain;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.params.padFilterCutoffHz;
    filter.Q.value = PAD_FILTER_Q;
    this.filter = filter;

    // Stereo delay with feedback
    const delay = ctx.createDelay(DELAY_MAX_SEC);
    delay.delayTime.value = DELAY_TIME_SEC;
    const feedback = ctx.createGain();
    feedback.gain.value = DELAY_FEEDBACK;
    delay.connect(feedback);
    feedback.connect(delay);

    // Procedural ConvolverNode reverb
    const reverbNode = ctx.createConvolver();
    reverbNode.buffer = this.createImpulseResponse(
      ctx,
      REVERB_DURATION_SEC,
      REVERB_DECAY,
    );
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = REVERB_ENABLED ? REVERB_WET_GAIN : 0.0;

    // Routing graph:
    // Oscillators -> LowPass Filter -> [Dry, Delay, Convolver Reverb] -> MasterGain -> Destination
    filter.connect(masterGain);

    filter.connect(delay);
    delay.connect(masterGain);

    filter.connect(reverbNode);
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);

    // 1. Continuous warm breathing sub-bass drone
    this.spawnDrone(ctx, masterGain);

    // 2. Atmospheric wind bed modulated by global temperature & zoomed viewport wind
    this.spawnAtmosphericWind(ctx, masterGain);

    // 3. Asynchronous prime-interval phase loops
    for (const cfg of LOOP_CONFIGS) {
      this.scheduleLoop(cfg);
    }
  }

  updateFromSimulation(
    metrics: SimulationMetrics,
    state: SimulationState,
    camera: MapCamera,
  ): void {
    this.params = computePlanetaryAudioParams(metrics, {
      meanWindSpeedMps: sampleViewportWindSpeed(state, camera),
      zoom: camera.zoom,
    });
    this.applyParams();
  }

  stop(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;

    for (const id of this.timers) {
      window.clearTimeout(id);
    }
    this.timers.clear();

    const ctx = this.ctx;
    const masterGain = this.masterGain;
    this.ctx = null;
    this.masterGain = null;
    this.filter = null;
    this.droneGain = null;
    this.droneLfoGain = null;
    this.windGain = null;
    this.windFilter = null;

    if (!ctx) return;
    if (masterGain) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(
        Math.max(0.0001, masterGain.gain.value),
        now,
      );
      masterGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + MASTER_FADE_OUT_SEC,
      );
      window.setTimeout(
        () => {
          void ctx.close().catch(() => {});
        },
        Math.ceil(MASTER_FADE_OUT_SEC * 1000) + 20,
      );
    } else {
      void ctx.close().catch(() => {});
    }
  }

  private applyParams(): void {
    if (!this.ctx || !this.isPlaying) return;
    const now = this.ctx.currentTime;

    if (this.filter) {
      this.filter.frequency.setTargetAtTime(
        this.params.padFilterCutoffHz,
        now,
        1.2,
      );
    }

    if (this.windGain && this.windFilter) {
      this.windGain.gain.setTargetAtTime(this.params.windGain, now, 0.35);
      this.windFilter.frequency.setTargetAtTime(
        this.params.windFilterHz,
        now,
        0.35,
      );
      this.windFilter.Q.setTargetAtTime(this.params.windFilterQ, now, 0.35);
    }

    if (this.droneGain && this.droneLfoGain) {
      this.droneGain.gain.setTargetAtTime(
        DRONE_BASE_GAIN * this.params.droneScale,
        now,
        0.5,
      );
      this.droneLfoGain.gain.setTargetAtTime(
        DRONE_LFO_GAIN * this.params.droneScale,
        now,
        0.5,
      );
    }
  }

  private createImpulseResponse(
    ctx: AudioContext,
    durationSec: number,
    decay: number,
  ): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  private spawnDrone(ctx: AudioContext, masterGain: GainNode): void {
    const osc = ctx.createOscillator();
    const subFilter = ctx.createBiquadFilter();
    const droneGain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = DRONE_FREQ_HZ;

    // Dedicated low-pass filter strips upper odd harmonics (eliminates buzz)
    subFilter.type = 'lowpass';
    subFilter.frequency.value = DRONE_SUB_LPF_HZ;
    subFilter.Q.value = DRONE_SUB_LPF_Q;

    droneGain.gain.value = DRONE_BASE_GAIN * this.params.droneScale;

    // Slow sine LFO for tidal breathing cycle
    const lfo = ctx.createOscillator();
    const droneLfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = DRONE_LFO_HZ;
    droneLfoGain.gain.value = DRONE_LFO_GAIN * this.params.droneScale;

    lfo.connect(droneLfoGain);
    droneLfoGain.connect(droneGain.gain);

    // Route directly to masterGain to bypass the brighter main pad filter
    osc.connect(subFilter);
    subFilter.connect(droneGain);
    droneGain.connect(masterGain);

    osc.start();
    lfo.start();

    this.droneGain = droneGain;
    this.droneLfoGain = droneLfoGain;
  }

  private spawnAtmosphericWind(ctx: AudioContext, masterGain: GainNode): void {
    const bufferSize = ctx.sampleRate * WIND_BUFFER_SEC;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 2.5;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = this.params.windFilterHz;
    windFilter.Q.value = this.params.windFilterQ;

    const windGain = ctx.createGain();
    windGain.gain.value = this.params.windGain;

    noiseSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);
    noiseSource.start();

    this.windFilter = windFilter;
    this.windGain = windGain;
  }

  private getEffectiveProbability(baseProb: number): number {
    return Math.min(0.95, baseProb * (0.15 + this.params.biomassRatio * 1.15));
  }

  private playPadNote(freq: number, durationSec: number): void {
    if (!this.isPlaying || !this.ctx || !this.filter) return;
    const now = this.ctx.currentTime;
    const attack = durationSec * 0.35;

    const bioScale = 0.35 + this.params.biomassRatio * 0.65;
    const peakGain = PAD_BASE_PEAK_GAIN * bioScale;

    const noteGain = this.ctx.createGain();
    noteGain.gain.setValueAtTime(0.0001, now);
    noteGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, peakGain),
      now + attack,
    );
    noteGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    noteGain.connect(this.filter);

    // Dual detuned sine oscillators for chorus warmth
    for (const f of [freq, freq * PAD_DETUNE_RATIO]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.connect(noteGain);
      osc.start(now);
      osc.stop(now + durationSec + 0.15);
    }
  }

  private scheduleLoop(cfg: LoopConfig): void {
    let activeId: number | undefined;
    const tick = () => {
      if (activeId !== undefined) {
        this.timers.delete(activeId);
        activeId = undefined;
      }
      if (!this.isPlaying) return;

      const effectiveProb = this.getEffectiveProbability(cfg.baseProb);
      if (Math.random() < effectiveProb) {
        const maxIndex = Math.max(
          4,
          Math.ceil(
            SCALE_FREQUENCIES.length * (0.4 + this.params.biomassRatio * 0.6),
          ),
        );
        const freq = SCALE_FREQUENCIES[Math.floor(Math.random() * maxIndex)];
        this.playPadNote(freq, (cfg.intervalMs / 1000) * 1.4);
      }

      activeId = window.setTimeout(tick, cfg.intervalMs);
      this.timers.add(activeId);
    };
    tick();
  }
}
