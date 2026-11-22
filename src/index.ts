import {html, render, svg} from 'lit-html';
import {createRef, ref} from 'lit-html/directives/ref.js';
import './style.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import {PlanetaryAmbientEngine} from './audio';
import {
  clampCamera,
  computePinchCamera,
  createCameraFlight,
  createMapPixels,
  createPinchAnchor,
  getBiomeLegendSpriteUrl,
  loadSprites,
  renderWorldMap,
  sampleCameraFlight,
  TILE_SIZE,
  viewportToGridCoords,
  WORLD_PIXEL_HEIGHT,
  WORLD_PIXEL_WIDTH,
} from './map-renderer';
import type {
  EventBeacon,
  MapCamera,
  MapLayer,
  PinchAnchor,
  SpriteSheet,
} from './map-renderer';
import {
  BIOMES,
  createSimulationConfig,
  createSimulationState,
  GRID_HEIGHT,
  GRID_WIDTH,
  LIFE_CLASSES,
  LIFE_CLASSES_BY_ID,
} from './sim/constants';
import {
  applyGodTool,
  calculateMetrics,
  generatePlanet,
  getIdx,
  recalculateClimate,
  simulationStep,
} from './sim/engine';
import type {GodTool, PlanetType} from './sim/types';

interface EventLogEntry {
  message: string;
  tone: 'info' | 'emerald' | 'amber' | 'cyan' | 'red' | 'muted';
  coords?: {x: number; y: number};
}

const LOG_TONE_CLASSES: Record<EventLogEntry['tone'], string> = {
  info: 'text-slate-300',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  cyan: 'text-cyan-400',
  red: 'text-red-400',
  muted: 'text-slate-500',
};

const BIOME_NAMES = new Map<number, string>(
  Object.values(BIOMES).map(({id, name}) => [id, name]),
);

const MAX_LOG_ENTRIES = 100;
const EVENT_ZOOM_LEVEL = 4;
const ALL_LIFE_CLASSES = Object.values(LIFE_CLASSES);

const uiState = {
  isRunning: false,
  speed: 1,
  activeLayer: 'biomes' as MapLayer,
  activeTool: 'inspect' as GodTool,
  activePreset: 'earth' as PlanetType,
  showIsolines: true,
  zoomToEvent: false,
  visibleLifeClasses: new Set<number>(ALL_LIFE_CLASSES.map(def => def.id)),
  camera: {zoom: 1, panX: 0, panY: 0} as MapCamera,
  activePointers: new Map<number, {x: number; y: number}>(),
  dragState: null as {
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null,
  pinchState: null as PinchAnchor | null,
  suppressNextClick: false,
  hoveredCell: null as {x: number; y: number} | null,
  logs: [
    {message: 'Simulation core initialized [128x64].', tone: 'emerald'},
    {message: 'Select a God Tool to alter surface.', tone: 'muted'},
  ] as EventLogEntry[],
};
const SIMULATION_TICK_INTERVAL_MS = 1_000;
const worldMapRef = createRef<HTMLCanvasElement>();
const eventConsoleRef = createRef<HTMLDivElement>();

const EVENT_BEACON_DURATION_MS = 2_200;
let activeCameraFlightRafId: number | null = null;
let activeEventBeacon: EventBeacon | null = null;

function cancelCameraFlight(): void {
  if (activeCameraFlightRafId !== null) {
    window.cancelAnimationFrame(activeCameraFlightRafId);
    activeCameraFlightRafId = null;
  }
  activeEventBeacon = null;
}

function focusGridCell(x: number, y: number): void {
  cancelCameraFlight();
  const flight = createCameraFlight(uiState.camera, x, y, EVENT_ZOOM_LEVEL);
  const startTime = performance.now();
  let landed = false;

  const stepFrame = (now: number) => {
    const elapsed = now - startTime;
    if (elapsed < flight.durationMs) {
      uiState.camera = sampleCameraFlight(flight, elapsed / flight.durationMs);
      activeEventBeacon = {x, y, progress: 0};
      simulation.syncAudio();
      renderApp();
      activeCameraFlightRafId = window.requestAnimationFrame(stepFrame);
      return;
    }

    if (!landed) {
      landed = true;
      uiState.camera = sampleCameraFlight(flight, 1);
      simulation.syncAudio();
    }

    const beaconElapsed = elapsed - flight.durationMs;
    if (beaconElapsed < EVENT_BEACON_DURATION_MS) {
      activeEventBeacon = {
        x,
        y,
        progress: beaconElapsed / EVENT_BEACON_DURATION_MS,
      };
      renderApp();
      activeCameraFlightRafId = window.requestAnimationFrame(stepFrame);
      return;
    }

    activeEventBeacon = null;
    activeCameraFlightRafId = null;
    drawWorldCanvas();
  };

  activeCameraFlightRafId = window.requestAnimationFrame(stepFrame);
}

function logEvent(
  message: string,
  tone: EventLogEntry['tone'] = 'info',
  options?: {coords?: {x: number; y: number}; autoZoom?: boolean},
) {
  uiState.logs.push({message, tone, coords: options?.coords});
  if (uiState.logs.length > MAX_LOG_ENTRIES) {
    uiState.logs.splice(0, uiState.logs.length - MAX_LOG_ENTRIES);
  }
  if (options?.autoZoom && uiState.zoomToEvent && options.coords) {
    focusGridCell(options.coords.x, options.coords.y);
  }
}

const simulation = (() => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  const ambientAudio = new PlanetaryAmbientEngine();
  const activeLifeClassCoords = new Map<number, {x: number; y: number}>();
  let timer: number | undefined;
  let metrics = generatePlanet(state, config, 'earth');
  for (const [id, coords] of Object.entries(metrics.lifeClassSampleCoords)) {
    activeLifeClassCoords.set(Number(id), coords);
  }

  function recordLifeMilestones() {
    const nextCoords = new Map<number, {x: number; y: number}>();
    for (const [id, coords] of Object.entries(metrics.lifeClassSampleCoords)) {
      nextCoords.set(Number(id), coords);
    }
    for (const [id, coords] of nextCoords) {
      if (!activeLifeClassCoords.has(id)) {
        const def = LIFE_CLASSES_BY_ID.get(id);
        if (def) {
          logEvent(
            `Evolution milestone: [${def.name.toUpperCase()}] emerged at (${coords.x}, ${coords.y})!`,
            'emerald',
            {coords, autoZoom: true},
          );
        }
      }
    }
    for (const [id, lastCoords] of activeLifeClassCoords) {
      if (!nextCoords.has(id)) {
        const def = LIFE_CLASSES_BY_ID.get(id);
        if (def) {
          logEvent(
            `Extinction event: [${def.name.toUpperCase()}] went extinct!`,
            'red',
            {coords: lastCoords},
          );
        }
      }
    }
    activeLifeClassCoords.clear();
    for (const [id, coords] of nextCoords) {
      activeLifeClassCoords.set(id, coords);
    }
  }

  function stop() {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
  }

  function start() {
    stop();
    timer = window.setInterval(() => {
      simulation.step();
      renderApp();
    }, SIMULATION_TICK_INTERVAL_MS / uiState.speed);
  }

  function syncAudio() {
    ambientAudio.updateFromSimulation(metrics, state, uiState.camera);
  }

  function toggle() {
    uiState.isRunning = !uiState.isRunning;
    if (uiState.isRunning) {
      start();
      ambientAudio.start(metrics, state, uiState.camera);
    } else {
      stop();
      ambientAudio.stop();
    }
  }
  function step() {
    metrics = simulationStep(
      state,
      config,
      metrics.temperatureHistory,
      metrics.whiteDaisyHistory,
      metrics.blackDaisyHistory,
    );
    recordLifeMilestones();
    syncAudio();
  }

  /** Recompute summary metrics after terrain/sea-level edits without advancing the year or chart history. */
  function refreshMetrics() {
    const next = calculateMetrics(state, config, [], [], []);
    metrics = {
      ...next,
      temperatureHistory: metrics.temperatureHistory,
      whiteDaisyHistory: metrics.whiteDaisyHistory,
      blackDaisyHistory: metrics.blackDaisyHistory,
    };
    recordLifeMilestones();
    syncAudio();
  }

  return {
    toggle,
    syncAudio,
    state,
    config,
    get metrics() {
      return metrics;
    },
    mapPixels: (layer: MapLayer) => createMapPixels(state, config, layer),
    generate(type: PlanetType) {
      cancelCameraFlight();
      uiState.activePreset = type;
      metrics = generatePlanet(state, config, type);
      activeLifeClassCoords.clear();
      for (const [id, coords] of Object.entries(
        metrics.lifeClassSampleCoords,
      )) {
        activeLifeClassCoords.set(Number(id), coords);
      }
      syncAudio();
      logEvent(`Planet generated: Presets [${type.toUpperCase()}].`, 'emerald');
    },
    step,
    setSeaLevelOffset(seaLevelOffset: number) {
      config.seaLevelOffset = seaLevelOffset;
      recalculateClimate(state, config);
      refreshMetrics();
    },
    setSpeed(speed: number) {
      uiState.speed = speed;
      if (uiState.isRunning) start();
    },
    applyTool(gx: number, gy: number) {
      if (uiState.activeTool === 'inspect') return;
      applyGodTool(state, config, uiState.activeTool, gx, gy);
      refreshMetrics();
      logEvent(
        `Intervention triggered: [${uiState.activeTool.toUpperCase()}] at grid (${gx}, ${gy}).`,
        'amber',
        {coords: {x: gx, y: gy}},
      );
    },
    triggerIceAge() {
      config.solarLuminosity = 0.75;
      config.co2Ppm = 100;
      logEvent(
        'GLOBAL EVENT: Ice Age triggered! Solar radiation dropped.',
        'cyan',
      );
    },
    triggerGlobalWarming() {
      config.solarLuminosity = 1.25;
      config.co2Ppm = 2000;
      logEvent(
        'GLOBAL EVENT: Scorch sequence active! Thermal greenhouse surge.',
        'red',
      );
    },
    getCellInfo(gx: number, gy: number) {
      const idx = getIdx(gx, gy);
      const lifeDef = LIFE_CLASSES_BY_ID.get(state.lifeClass[idx]);
      return {
        biomeName: BIOME_NAMES.get(state.biome[idx]) ?? 'Ocean',
        elevation: state.elevation[idx],
        temperature: state.temperature[idx],
        moisture: state.moisture[idx],
        windX: state.windX[idx],
        windY: state.windY[idx],
        daisyWhite: state.daisyWhite[idx],
        daisyBlack: state.daisyBlack[idx],
        lifeClassName:
          lifeDef && state.lifePopulation[idx] >= 0.05 ? lifeDef.name : null,
        lifeSpecies: state.lifeSpecies[idx],
        lifePopulation: state.lifePopulation[idx],
      };
    },
  };
})();

function speedButtonHtml(speed: number) {
  const isSelected = uiState.speed === speed;
  return html`<button
    @click=${() => simulation.setSpeed(speed)}
    aria-pressed=${isSelected}
    class="btn-speed px-2.5 py-1 ${
      isSelected
        ? 'bg-blue-600 text-white font-bold'
        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
    } rounded text-xs font-mono"
  >
    ${speed}x
  </button>`;
}

function statusBarHtml() {
  return html` <header
    class="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between z-20 shrink-0"
  >
    <div class="flex items-center space-x-3">
      <div
        class="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30"
      >
        <i class="fa-solid font-retro text-2xl fa-globe"></i>
      </div>
      <div>
        <h1
          class="font-retro text-2xl tracking-widest text-blue-400 font-bold leading-none"
        >
          GaiaSim // v1.02
        </h1>
        <p class="text-[10px] text-slate-400 tracking-wider uppercase">
          Cylindrical Grid Engine (128x64)
        </p>
      </div>
    </div>

    <!-- Global Planetary Metrics Display -->
    <div
      class="hidden md:flex items-center space-x-6 text-xs bg-slate-950/70 px-4 py-2 rounded-lg border border-slate-800"
    >
      <div class="flex items-center space-x-2">
        <span class="text-slate-500">
          <i class="fa-solid fa-clock"></i> Year:
        </span>
        <span class="font-bold text-amber-400 font-mono">
          ${simulation.config.year}
        </span>
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-slate-500">
          <i class="fa-solid fa-temperature-high"></i> Avg Temp:
        </span>
        <span class="font-bold text-emerald-400 font-mono">
          ${simulation.metrics.averageTemperatureC.toFixed(1)}°C
        </span>
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-slate-500">
          <i class="fa-solid fa-droplet"></i> Ocean Cover:
        </span>
        <span class="font-bold text-blue-400 font-mono">
          ${simulation.metrics.oceanCoveragePct}%
        </span>
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-slate-500">
          <i class="fa-solid fa-seedling"></i> Biomass:
        </span>
        <span class="font-bold text-green-400 font-mono">
          ${simulation.metrics.totalBiomassPct}%
        </span>
      </div>
    </div>

    <!-- Simulation Speed / Play / Pause Controls -->
    <div class="flex items-center space-x-2">
      <button
        @click=${simulation.toggle}
        aria-pressed=${uiState.isRunning}
        class="px-3 py-1.5 ${
          uiState.isRunning
            ? 'bg-amber-600 hover:bg-amber-500'
            : 'bg-emerald-600 hover:bg-emerald-500'
        } text-white rounded font-bold text-xs flex items-center gap-1.5 transition"
      >
        <i class="fa-solid ${uiState.isRunning ? 'fa-pause' : 'fa-play'}"></i>
        <span> ${uiState.isRunning ? 'PAUSE' : 'RUN'} </span>
      </button>
      <button
        @click=${simulation.step}
        class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs transition"
      >
        <i class="fa-solid fa-forward-step"></i>
      </button>
      <div class="h-4 w-px bg-slate-800 mx-1"></div>
      ${[1, 2, 5].map(s => speedButtonHtml(s))}
    </div>
  </header>`;
}

function layerButtonHtml(layer: MapLayer, label: string, icon: string) {
  const isSelected = uiState.activeLayer === layer;
  return html`<button
    @click=${() => (uiState.activeLayer = layer)}
    aria-pressed=${isSelected}
    class="px-2.5 py-2 rounded ${
      isSelected
        ? 'bg-blue-600 text-white'
        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
    } text-left font-medium flex items-center justify-between"
  >
    <span>${label}</span> <i class="fa-solid ${icon} text-[10px]"></i>
  </button>`;
}

function layerSwitchHtml() {
  return html` <div class="bg-slate-950 p-3 rounded-lg border border-slate-800">
    <h3
      class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center justify-between"
    >
      <span class="flex items-center gap-2">
        <i class="fa-solid fa-layer-group text-blue-400"></i> Map Display Layer
      </span>
      <button
        type="button"
        aria-pressed=${uiState.showIsolines}
        @click=${() => (uiState.showIsolines = !uiState.showIsolines)}
        title="Toggle smoothed temperature & moisture contour isolines"
        class="px-1.5 py-0.5 rounded text-[10px] font-mono ${
          uiState.showIsolines
            ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-600/50'
            : 'bg-slate-800 text-slate-500'
        }"
      >
        Isolines
      </button>
    </h3>
    <div class="grid grid-cols-2 gap-2 text-xs">
      ${layerButtonHtml('biomes', 'Biomes/Terrain', 'fa-tree')}
      ${layerButtonHtml('life', 'Life Forms', 'fa-dna')}
      ${layerButtonHtml('temp', 'Temperature', 'fa-temperature-half')}
      ${layerButtonHtml('moisture', 'Moisture', 'fa-cloud-rain')}
      ${layerButtonHtml('wind', 'Wind Vectors', 'fa-wind')}
      ${layerButtonHtml('daisies', 'Daisyworld', 'fa-sun-plant-wilt')}
    </div>
  </div>`;
}

function atmosphericSlidersHtml() {
  function resetAtmosphere() {
    simulation.config.solarLuminosity = 1;
    simulation.config.co2Ppm = 350;
    simulation.config.o2Pct = 21;
    simulation.setSeaLevelOffset(0);
  }

  function solarLuminosityInput(this: HTMLInputElement) {
    simulation.config.solarLuminosity = Number(this.value);
  }

  function co2Input(this: HTMLInputElement) {
    simulation.config.co2Ppm = Number(this.value);
  }

  function oxygenInput(this: HTMLInputElement) {
    simulation.config.o2Pct = Number(this.value);
  }

  function seaLevelInput(this: HTMLInputElement) {
    simulation.setSeaLevelOffset(Number(this.value));
  }

  return html`
    <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-4">
      <h3
        class="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between"
      >
        <span>
          <i class="fa-solid fa-sliders text-emerald-400 mr-2"></i>
          Atmosphere Parameters
        </span>
        <button
          @click=${resetAtmosphere}
          class="text-[10px] text-blue-400 hover:underline"
        >
          Reset
        </button>
      </h3>

      <!-- Solar Luminosity Slider -->
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="text-slate-400">Solar Luminosity</span>
          <span class="font-mono text-amber-400 font-bold">
            ${simulation.config.solarLuminosity.toFixed(2)}x
          </span>
        </div>
        <input
          type="range"
          min="0.6"
          max="1.4"
          step="0.01"
          .value=${String(simulation.config.solarLuminosity)}
          @input=${solarLuminosityInput}
          class="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
        />
        <div class="flex justify-between text-[9px] text-slate-600 mt-0.5">
          <span>Faint Sun (0.6x)</span>
          <span>Super Nova (1.4x)</span>
        </div>
      </div>

      <!-- Greenhouse CO2 Slider -->
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="text-slate-400">Carbon Dioxide (CO2)</span>
          <span class="font-mono text-emerald-400 font-bold">
            ${simulation.config.co2Ppm} ppm
          </span>
        </div>
        <input
          type="range"
          min="50"
          max="2500"
          step="10"
          .value=${String(simulation.config.co2Ppm)}
          @input=${co2Input}
          class="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      <!-- Oxygen Slider -->
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="text-slate-400">Oxygen Level (O2)</span>
          <span class="font-mono text-blue-400 font-bold">
            ${simulation.config.o2Pct.toFixed(1)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="40"
          step="0.5"
          .value=${String(simulation.config.o2Pct)}
          @input=${oxygenInput}
          class="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      <!-- Sea Level Offset Slider -->
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="text-slate-400">Global Sea Level</span>
          <span class="font-mono text-cyan-400 font-bold">
            ${
              simulation.config.seaLevelOffset === 0
                ? 'Baseline'
                : `${simulation.config.seaLevelOffset > 0 ? '+' : ''}${
                    simulation.config.seaLevelOffset
                  }m`
            }
          </span>
        </div>
        <input
          type="range"
          min="-30"
          max="30"
          step="1"
          .value=${String(simulation.config.seaLevelOffset)}
          @input=${seaLevelInput}
          class="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
        />
      </div>
    </div>
  `;
}

const GENERATOR_PRESETS: readonly {
  id: string;
  type: PlanetType;
  label: string;
}[] = [
  {id: 'presetEarth', type: 'earth', label: 'Earth-like'},
  {id: 'presetPangaea', type: 'pangaea', label: 'Pangaea'},
  {id: 'presetArchipelago', type: 'archipelago', label: 'Islands'},
  {id: 'presetDaisyworld', type: 'daisyworld', label: 'Daisyworld'},
];

function presetsHtml() {
  return html`
    <div class="bg-slate-950 p-3 rounded-lg border border-slate-800">
      <h3
        class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"
      >
        <i class="fa-solid fa-wand-magic-sparkles text-purple-400"></i>
        Generator Presets
      </h3>
      <div class="grid grid-cols-2 gap-2 text-xs">
        ${GENERATOR_PRESETS.map(preset => {
          const isSelected = uiState.activePreset === preset.type;
          return html`<button
            id=${preset.id}
            aria-pressed=${isSelected}
            @click=${() => simulation.generate(preset.type)}
            class="px-2 py-1.5 rounded font-mono ${
              isSelected
                ? 'bg-blue-600 text-white font-medium'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }"
          >
            ${preset.label}
          </button>`;
        })}
      </div>
    </div>
  `;
}

function logBoxHtml() {
  return html`
    <div
      class="flex-1 bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col justify-between min-h-30"
    >
      <div class="mb-1 flex items-center justify-between gap-2">
        <h3
          class="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"
        >
          <i class="fa-solid fa-terminal text-[10px]"></i>
          <span>Events Console</span>
        </h3>
        <label
          class="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer select-none"
          title="Auto-center and zoom (4x) on newly emerged lifeform events"
        >
          <input
            type="checkbox"
            .checked=${uiState.zoomToEvent}
            @change=${(event: Event) => {
              uiState.zoomToEvent = (
                event.currentTarget as HTMLInputElement
              ).checked;
            }}
            class="accent-emerald-500 cursor-pointer"
          />
          <span>Zoom to event</span>
        </label>
      </div>
      <div
        ${ref(eventConsoleRef)}
        id="eventConsole"
        class="flex-1 font-mono text-[10px] text-slate-400 overflow-y-auto space-y-1 my-1 pr-1"
      >
        ${uiState.logs.map(entry =>
          entry.coords
            ? html`<button
                type="button"
                @click=${() => focusGridCell(entry.coords!.x, entry.coords!.y)}
                title=${`Center & zoom (${EVENT_ZOOM_LEVEL}x) on (${entry.coords.x}, ${entry.coords.y})`}
                class="block w-full text-left ${LOG_TONE_CLASSES[entry.tone]} hover:bg-slate-800/70 hover:underline rounded px-1 -mx-1 cursor-pointer transition"
              >
                > ${entry.message}
              </button>`
            : html`<p class=${LOG_TONE_CLASSES[entry.tone]}>
                > ${entry.message}
              </p>`,
        )}
      </div>
    </div>
  `;
}

interface GodToolMeta {
  id: GodTool;
  label: string;
  icon: string;
  iconClass: string;
  title: string;
  labelBreakpoint: 'md' | 'lg';
}

const GOD_TOOLS: readonly GodToolMeta[] = [
  {
    id: 'inspect',
    label: 'Inspect',
    icon: 'fa-magnifying-glass',
    iconClass: '',
    title: 'Inspect Grid Details',
    labelBreakpoint: 'md',
  },
  {
    id: 'volcano',
    label: 'Volcano',
    icon: 'fa-volcano',
    iconClass: 'text-red-400',
    title: 'Spawn Volcano & Mountain',
    labelBreakpoint: 'md',
  },
  {
    id: 'meteor',
    label: 'Meteor',
    icon: 'fa-meteor',
    iconClass: 'text-amber-500',
    title: 'Trigger Meteor Impact',
    labelBreakpoint: 'md',
  },
  {
    id: 'raise',
    label: 'Raise Land',
    icon: 'fa-mountain',
    iconClass: 'text-emerald-400',
    title: 'Raise Land Mass',
    labelBreakpoint: 'md',
  },
  {
    id: 'lower',
    label: 'Lower Land',
    icon: 'fa-water',
    iconClass: 'text-cyan-400',
    title: 'Lower Land / Dig Ocean',
    labelBreakpoint: 'md',
  },
  {
    id: 'daisy_white',
    label: 'White Daisy',
    icon: 'fa-sun',
    iconClass: 'text-slate-100',
    title: 'Plant White Daisies (High Albedo)',
    labelBreakpoint: 'lg',
  },
  {
    id: 'daisy_black',
    label: 'Black Daisy',
    icon: 'fa-moon',
    iconClass: 'text-slate-400',
    title: 'Plant Black Daisies (Low Albedo)',
    labelBreakpoint: 'lg',
  },
  {
    id: 'seed_life',
    label: 'Seed Life',
    icon: 'fa-bacterium',
    iconClass: 'text-lime-400',
    title: 'Seed Prokaryote Life',
    labelBreakpoint: 'lg',
  },
  {
    id: 'nuke',
    label: 'Heat Blast',
    icon: 'fa-fire',
    iconClass: 'text-orange-500',
    title: 'Thermal Blast',
    labelBreakpoint: 'lg',
  },
];

function godToolsBarHtml() {
  return html`
    <div
      class="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto z-10 shrink-0"
    >
      <div class="flex items-center space-x-1">
        <span
          class="text-xs text-slate-400 font-bold uppercase tracking-wider mr-2 hidden sm:inline"
        >
          <i class="fa-solid fa-hand-sparkles text-amber-400 mr-1"></i>
          Interventions:
        </span>
        ${GOD_TOOLS.map(tool => {
          const isSelected = uiState.activeTool === tool.id;
          const hiddenClass =
            tool.labelBreakpoint === 'lg'
              ? 'hidden lg:inline'
              : 'hidden md:inline';
          return html`<button
            type="button"
            data-tool=${tool.id}
            title=${tool.title}
            aria-pressed=${isSelected}
            @click=${() => (uiState.activeTool = tool.id)}
            class="btn-tool p-2 rounded ${
              isSelected
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            } text-xs flex items-center gap-1.5 px-3 transition"
          >
            <i
              class="fa-solid ${tool.icon} ${isSelected ? '' : tool.iconClass}"
            ></i>
            <span class=${hiddenClass}>${tool.label}</span>
          </button>`;
        })}
      </div>

      <!-- Global Cataclysm Actions -->
      <div class="flex items-center space-x-2 shrink-0">
        <button
          id="btnTriggerIceAge"
          type="button"
          @click=${simulation.triggerIceAge}
          class="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/50 text-cyan-300 rounded text-xs font-mono transition"
        >
          <i class="fa-solid fa-snowflake"></i> Freeze
        </button>
        <button
          id="btnTriggerGlobalWarming"
          type="button"
          @click=${simulation.triggerGlobalWarming}
          class="px-2.5 py-1 bg-red-950 hover:bg-red-900 border border-red-700/50 text-red-300 rounded text-xs font-mono transition"
        >
          <i class="fa-solid fa-fire-flame-curved"></i> Scorch
        </button>
      </div>
    </div>
  `;
}

function getGridCoordsFromEvent(
  event: MouseEvent,
): {x: number; y: number} | null {
  const canvas = worldMapRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const normX = (event.clientX - rect.left) / rect.width;
  const normY = (event.clientY - rect.top) / rect.height;
  return viewportToGridCoords(normX, normY, uiState.camera);
}

function zoomAtNormalizedPoint(
  nextZoom: number,
  normX = 0.5,
  normY = 0.5,
): void {
  cancelCameraFlight();
  const prev = clampCamera(uiState.camera);
  const clampedZoom = Math.max(1, Math.min(8, nextZoom));
  const worldFocusX = prev.panX + normX * (WORLD_PIXEL_WIDTH / prev.zoom);
  const worldFocusY = prev.panY + normY * (WORLD_PIXEL_HEIGHT / prev.zoom);
  uiState.camera = clampCamera({
    zoom: clampedZoom,
    panX: worldFocusX - normX * (WORLD_PIXEL_WIDTH / clampedZoom),
    panY: worldFocusY - normY * (WORLD_PIXEL_HEIGHT / clampedZoom),
  });
  simulation.syncAudio();
}

function formatWind(windX: number, windY: number): string {
  const speed = Math.hypot(windX, windY);
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const angle = Math.atan2(windY, windX);
  const idx =
    Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return `${speed.toFixed(1)} m/s ${dirs[idx]}`;
}

function formatDaisyCover(white: number, black: number): string {
  const hasWhite = white > 0.05;
  const hasBlack = black > 0.05;
  if (hasWhite && hasBlack) {
    return `W:${Math.round(white * 100)}% / B:${Math.round(black * 100)}%`;
  }
  if (hasWhite) return `White (${Math.round(white * 100)}%)`;
  if (hasBlack) return `Black (${Math.round(black * 100)}%)`;
  return 'None';
}

function gridTooltipHtml() {
  const hovered = uiState.hoveredCell;
  if (!hovered) return html``;
  const info = simulation.getCellInfo(hovered.x, hovered.y);
  return html`
    <div
      id="gridTooltip"
      class="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 text-slate-200 text-xs p-2.5 rounded shadow-xl pointer-events-none font-mono z-30"
    >
      <div class="font-bold text-blue-400 border-b border-slate-800 pb-1 mb-1">
        Cell [${hovered.x}, ${hovered.y}]
      </div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        <span class="text-slate-400">Biome:</span>
        <span class="text-emerald-400 font-bold">${info.biomeName}</span>
        <span class="text-slate-400">Elevation:</span>
        <span class="text-slate-200">${Math.round(info.elevation)}m</span>
        <span class="text-slate-400">Temp:</span>
        <span class="text-amber-400">${info.temperature.toFixed(1)}°C</span>
        <span class="text-slate-400">Moisture:</span>
        <span class="text-cyan-400">${Math.round(info.moisture)} cm/yr</span>
        <span class="text-slate-400">Wind:</span>
        <span class="text-sky-300">${formatWind(info.windX, info.windY)}</span>
        <span class="text-slate-400">Daisy Cover:</span>
        <span class="text-purple-300">
          ${formatDaisyCover(info.daisyWhite, info.daisyBlack)}
        </span>
        <span class="text-slate-400">Life:</span>
        <span class="text-lime-300">
          ${
            info.lifeClassName
              ? `${info.lifeClassName} Sp.${info.lifeSpecies} (${Math.round(
                  info.lifePopulation * 100,
                )}%)`
              : 'None'
          }
        </span>
      </div>
    </div>
  `;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  } else {
    void document.documentElement.requestFullscreen().catch(() => {});
  }
}

function fullscreenButtonHtml() {
  const fullscreenSupported = Boolean(
    document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === 'function',
  );
  if (!fullscreenSupported) return html``;
  const isFullscreen = Boolean(document.fullscreenElement);

  return html`<button
    type="button"
    title=${isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
    aria-label=${isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
    aria-pressed=${isFullscreen}
    @click=${toggleFullscreen}
    class="fixed bottom-3 right-3 z-50 w-10 h-10 flex items-center justify-center bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg shadow-xl transition"
  >
    <i class="fa-solid ${isFullscreen ? 'fa-compress' : 'fa-expand'}"></i>
  </button>`;
}

function viewportControlsHtml() {
  return html`
    <div
      class="absolute bottom-3 right-3 bg-slate-900/90 border border-slate-700 rounded flex items-center gap-1 p-1 text-xs font-mono z-30 shadow-lg"
    >
      <button
        id="btnZoomOut"
        type="button"
        title="Zoom Out"
        @click=${() => zoomAtNormalizedPoint(uiState.camera.zoom / 1.5)}
        class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
      >
        <i class="fa-solid fa-minus"></i>
      </button>
      <span class="px-1.5 text-blue-400 font-bold">
        ${uiState.camera.zoom.toFixed(1)}x
      </span>
      <button
        type="button"
        title="Zoom In"
        @click=${() => zoomAtNormalizedPoint(uiState.camera.zoom * 1.5)}
        class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
      >
        <i class="fa-solid fa-plus"></i>
      </button>
      <button
        type="button"
        title="Reset Zoom & Pan"
        @click=${() => {
          cancelCameraFlight();
          uiState.camera = {zoom: 1, panX: 0, panY: 0};
          simulation.syncAudio();
        }}
        class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
      >
        Reset
      </button>
    </div>
  `;
}

function worldMapHtml() {
  function getTwoPointerMetrics(canvas: HTMLCanvasElement): {
    distance: number;
    normMidX: number;
    normMidY: number;
  } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const pointers = Array.from(uiState.activePointers.values());
    if (pointers.length < 2) return null;
    const [p1, p2] = pointers;
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const normMidX = Math.max(
      0,
      Math.min(0.999, (midX - rect.left) / rect.width),
    );
    const normMidY = Math.max(
      0,
      Math.min(0.999, (midY - rect.top) / rect.height),
    );
    return {distance, normMidX, normMidY};
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    const canvas = worldMapRef.value;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const normX = Math.max(
      0,
      Math.min(0.999, (event.clientX - rect.left) / rect.width),
    );
    const normY = Math.max(
      0,
      Math.min(0.999, (event.clientY - rect.top) / rect.height),
    );
    const factor = event.deltaY < 0 ? 1.25 : 0.8;
    zoomAtNormalizedPoint(uiState.camera.zoom * factor, normX, normY);
    renderApp();
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const canvas = worldMapRef.value;
    if (!canvas) return;
    cancelCameraFlight();

    uiState.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignore synthetic events without an active pointer.
    }

    if (uiState.activePointers.size === 1) {
      uiState.suppressNextClick = false;
      uiState.pinchState = null;
      uiState.dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startPanX: uiState.camera.panX,
        startPanY: uiState.camera.panY,
        moved: false,
      };
    } else if (uiState.activePointers.size === 2) {
      uiState.dragState = null;
      uiState.suppressNextClick = true;
      const metrics = getTwoPointerMetrics(canvas);
      if (metrics) {
        uiState.pinchState = createPinchAnchor(
          uiState.camera,
          Math.max(1, metrics.distance),
          metrics.normMidX,
          metrics.normMidY,
        );
      }
    }
  }

  function handlePointerMove(event: PointerEvent) {
    const canvas = worldMapRef.value;
    if (uiState.activePointers.has(event.pointerId)) {
      uiState.activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      if (uiState.activePointers.size >= 2 && uiState.pinchState && canvas) {
        const metrics = getTwoPointerMetrics(canvas);
        if (metrics) {
          uiState.camera = computePinchCamera(
            uiState.pinchState,
            metrics.distance,
            metrics.normMidX,
            metrics.normMidY,
          );
          simulation.syncAudio();
          renderApp();
        }
        return;
      }

      if (
        uiState.dragState &&
        uiState.dragState.pointerId === event.pointerId &&
        canvas
      ) {
        const dx = event.clientX - uiState.dragState.startX;
        const dy = event.clientY - uiState.dragState.startY;
        if (Math.hypot(dx, dy) > 4) {
          uiState.dragState.moved = true;
        }
        if (uiState.dragState.moved) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const worldDx =
              (dx / rect.width) * (WORLD_PIXEL_WIDTH / uiState.camera.zoom);
            const worldDy =
              (dy / rect.height) * (WORLD_PIXEL_HEIGHT / uiState.camera.zoom);
            uiState.camera = clampCamera({
              zoom: uiState.camera.zoom,
              panX: uiState.dragState.startPanX - worldDx,
              panY: uiState.dragState.startPanY - worldDy,
            });
            simulation.syncAudio();
            renderApp();
          }
        }
      }
    }

    if (event.pointerType === 'mouse') {
      uiState.hoveredCell = getGridCoordsFromEvent(event);
    }
  }

  function handlePointerEnd(event: PointerEvent) {
    const wasTracked = uiState.activePointers.delete(event.pointerId);
    if (!wasTracked) return;

    const canvas = worldMapRef.value;
    if (uiState.activePointers.size >= 2 && canvas) {
      const metrics = getTwoPointerMetrics(canvas);
      if (metrics) {
        uiState.pinchState = createPinchAnchor(
          uiState.camera,
          Math.max(1, metrics.distance),
          metrics.normMidX,
          metrics.normMidY,
        );
      }
      return;
    }

    if (uiState.activePointers.size === 1) {
      // Transition cleanly from two-finger pinch to single-finger pan.
      const [[remainingId, remainingPos]] = Array.from(
        uiState.activePointers.entries(),
      );
      uiState.pinchState = null;
      uiState.suppressNextClick = true;
      uiState.dragState = {
        pointerId: remainingId,
        startX: remainingPos.x,
        startY: remainingPos.y,
        startPanX: uiState.camera.panX,
        startPanY: uiState.camera.panY,
        moved: true,
      };
      return;
    }

    const shouldSuppress = Boolean(
      uiState.pinchState || uiState.dragState?.moved,
    );
    uiState.pinchState = null;
    uiState.dragState = null;
    if (shouldSuppress) {
      uiState.suppressNextClick = true;
      window.setTimeout(() => {
        uiState.suppressNextClick = false;
      }, 0);
    }
  }

  function handlePointerLeave(event: PointerEvent) {
    if (event.pointerType === 'mouse') {
      uiState.hoveredCell = null;
    }
  }

  function handleClick(event: MouseEvent) {
    if (uiState.suppressNextClick) {
      uiState.suppressNextClick = false;
      return;
    }
    const coords = getGridCoordsFromEvent(event);
    if (!coords) return;
    if (uiState.activeTool === 'inspect') {
      uiState.hoveredCell = coords;
      return;
    }
    simulation.applyTool(coords.x, coords.y);
  }

  return html`
    <div
      class="flex-1 min-h-0 relative flex items-center justify-center p-4 bg-slate-950 overflow-hidden"
    >
      <div
        class="w-full h-full flex items-center justify-center"
        style="container-type: size"
      >
        <div
          class="relative border-2 border-slate-700 rounded-lg overflow-hidden bg-black"
          style="width: min(100cqw, 200cqh); height: min(100cqh, 50cqw);"
        >
          <canvas
            ${ref(worldMapRef)}
            width=${GRID_WIDTH * TILE_SIZE}
            height=${GRID_HEIGHT * TILE_SIZE}
            @wheel=${handleWheel}
            @pointerdown=${handlePointerDown}
            @pointermove=${handlePointerMove}
            @pointerup=${handlePointerEnd}
            @pointercancel=${handlePointerEnd}
            @pointerleave=${handlePointerLeave}
            @click=${handleClick}
            class="world-map-canvas touch-none cursor-crosshair block h-full w-full"
          ></canvas>
          ${gridTooltipHtml()} ${viewportControlsHtml()}
        </div>
      </div>
    </div>
  `;
}

interface ChartSeries {
  values: readonly number[];
  stroke: string;
}

function lineChartHtml(
  ariaLabel: string,
  minBound: number,
  range: number,
  ticks: readonly number[],
  formatTick: (value: number) => string,
  series: readonly ChartSeries[],
) {
  const topPct = 6;
  const bottomPct = 94;
  const yPctForValue = (value: number) =>
    bottomPct - ((value - minBound) / range) * (bottomPct - topPct);

  const linePoints = (values: readonly number[]) =>
    values
      .map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * 100;
        return `${x},${yPctForValue(value)}`;
      })
      .join(' ');

  return html`<div class="h-full w-full flex items-stretch gap-1.5">
    <div class="relative w-10 shrink-0 font-mono text-[9px] text-slate-500">
      ${ticks.map(
        tick =>
          html`<span
            class="absolute right-0 leading-none"
            style="top: ${yPctForValue(tick)}%; transform: translateY(-50%);"
          >
            ${formatTick(tick)}
          </span>`,
      )}
    </div>
    <div class="flex-1 min-w-0 h-full">
      ${svg`<svg
        class="h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label=${ariaLabel}
      >
        ${ticks.map(tick => {
          const y = yPctForValue(tick);
          return svg`<line
            x1="0"
            y1=${y}
            x2="100"
            y2=${y}
            stroke="#1e293b"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />`;
        })}
        ${series.map(
          ({values, stroke}) => svg`<polyline
            points=${linePoints(values)}
            fill="none"
            stroke=${stroke}
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />`,
        )}
      </svg>`}
    </div>
  </div>`;
}

function temperatureChartHtml() {
  const history = simulation.metrics.temperatureHistory;
  const values = history.length
    ? history
    : [simulation.metrics.averageTemperatureC];
  const minTemperature = Math.min(...values);
  const maxTemperature = Math.max(...values);
  const integerEnvelope =
    Math.ceil(maxTemperature) - Math.floor(minTemperature);
  const temperatureRange = Math.max(1.2, integerEnvelope);
  const temperatureCenter = (minTemperature + maxTemperature) / 2;
  const minTemperatureBound = temperatureCenter - temperatureRange / 2;
  const ticks = Array.from(
    {length: 6},
    (_, index) => minTemperatureBound + (temperatureRange * index) / 5,
  );

  return lineChartHtml(
    'Global temperature history',
    minTemperatureBound,
    temperatureRange,
    ticks,
    temperature => temperature.toFixed(1),
    [{values, stroke: '#10b981'}],
  );
}

function daisyChartHtml() {
  const whiteHistory = simulation.metrics.whiteDaisyHistory;
  const blackHistory = simulation.metrics.blackDaisyHistory;
  const maxCoverage = Math.max(0, ...whiteHistory, ...blackHistory);
  const coverageRange = maxCoverage > 0 ? maxCoverage * 1.1 : 1;
  const ticks = Array.from(
    {length: 5},
    (_, index) => (coverageRange * index) / 4,
  );
  const decimals = coverageRange < 1 ? 2 : 1;

  return lineChartHtml(
    'White and black daisy coverage history',
    0,
    coverageRange,
    ticks,
    coverage => `${coverage.toFixed(decimals)}%`,
    [
      {values: whiteHistory, stroke: '#f8fafc'},
      {values: blackHistory, stroke: '#64748b'},
    ],
  );
}

function toggleAllLifeClasses(): void {
  if (uiState.visibleLifeClasses.size > ALL_LIFE_CLASSES.length / 2) {
    uiState.visibleLifeClasses.clear();
  } else {
    for (const def of ALL_LIFE_CLASSES) {
      uiState.visibleLifeClasses.add(def.id);
    }
  }
}

function layerLegendPanelHtml() {
  if (uiState.activeLayer === 'life') {
    const moreThanHalfSelected =
      uiState.visibleLifeClasses.size > ALL_LIFE_CLASSES.length / 2;
    return html`
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-start min-h-0 overflow-hidden"
      >
        <div
          class="text-[11px] text-slate-400 font-bold uppercase mb-1 flex items-center justify-between gap-2 shrink-0"
        >
          <span>
            <i class="fa-solid fa-dna text-lime-400 mr-1"></i>
            Life Forms
          </span>
          <button
            type="button"
            @click=${toggleAllLifeClasses}
            class="text-[10px] font-mono normal-case font-normal text-blue-400 hover:underline cursor-pointer"
          >
            ${moreThanHalfSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div
          class="grid grid-cols-3 gap-x-1.5 gap-y-0.5 text-[10px] font-mono overflow-y-auto"
        >
          ${ALL_LIFE_CLASSES.map(def => {
            const isChecked = uiState.visibleLifeClasses.has(def.id);
            const count = simulation.metrics.lifeClassCounts[def.id] ?? 0;
            const iconUrl = loadedSprites?.lifeformIconUrls.get(def.id);
            return html`<label
              class="flex items-center gap-1 min-w-0 cursor-pointer hover:bg-slate-900 rounded px-0.5 py-0.5 select-none leading-none"
              title=${`${def.name}: ${count} cells (min O2: ${def.minO2Pct}%, ${def.minTempC}..${def.maxTempC}°C)`}
            >
              <span
                class="w-7 text-right text-[9px] tabular-nums shrink-0 ${
                  count > 0 ? 'text-lime-400/90' : 'text-slate-700'
                }"
              >
                ${count > 0 ? count : ''}
              </span>
              <input
                type="checkbox"
                .checked=${isChecked}
                @change=${(event: Event) => {
                  const checked = (event.currentTarget as HTMLInputElement)
                    .checked;
                  if (checked) {
                    uiState.visibleLifeClasses.add(def.id);
                  } else {
                    uiState.visibleLifeClasses.delete(def.id);
                  }
                }}
                class="accent-lime-400 cursor-pointer shrink-0"
              />
              ${
                iconUrl
                  ? html`<img
                      src=${iconUrl}
                      alt=""
                      width="16"
                      height="16"
                      class="w-4 h-4 shrink-0 [image-rendering:pixelated] ${
                        count > 0 ? '' : 'opacity-45'
                      }"
                    />`
                  : html`<span
                      class="w-3 h-3 rounded-sm inline-block shrink-0"
                      style="background-color: rgb(${def.color.join(', ')})"
                    ></span>`
              }
              <span
                class="truncate ${
                  count > 0 ? 'text-slate-200' : 'text-slate-500'
                }"
              >
                ${def.name}
              </span>
            </label>`;
          })}
        </div>
      </div>
    `;
  }

  if (uiState.activeLayer === 'temp') {
    return html`
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-start gap-2 min-h-0 overflow-y-auto"
      >
        <div
          class="text-[11px] text-slate-400 font-bold uppercase flex items-center justify-between shrink-0"
        >
          <span>
            <i class="fa-solid fa-temperature-half text-amber-400 mr-1"></i>
            Temperature Legend
          </span>
          <span class="text-[10px] text-slate-500 font-mono">°C</span>
        </div>
        <div class="space-y-1 font-mono text-[10px]">
          <div
            class="h-3 w-full rounded"
            style="background: linear-gradient(to right, rgb(0,0,255), rgb(128,200,128), rgb(255,0,0))"
          ></div>
          <div class="flex justify-between text-slate-400">
            <span>-20°C</span>
            <span>+10°C</span>
            <span>+40°C</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono">
          <span class="flex items-center gap-1 text-slate-400">
            <span class="w-3 h-0.5 bg-sky-200 inline-block"></span>-10°C
          </span>
          <span class="flex items-center gap-1 text-slate-400">
            <span class="w-3 h-0.5 bg-white inline-block"></span>0°C
          </span>
          <span class="flex items-center gap-1 text-slate-400">
            <span class="w-3 h-0.5 bg-yellow-300 inline-block"></span>15°C
          </span>
          <span class="flex items-center gap-1 text-slate-400">
            <span class="w-3 h-0.5 bg-orange-400 inline-block"></span>25°C
          </span>
        </div>
      </div>
    `;
  }

  if (uiState.activeLayer === 'moisture') {
    return html`
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-start gap-2 min-h-0 overflow-y-auto"
      >
        <div
          class="text-[11px] text-slate-400 font-bold uppercase flex items-center justify-between shrink-0"
        >
          <span>
            <i class="fa-solid fa-cloud-rain text-cyan-400 mr-1"></i>
            Moisture Legend
          </span>
          <span class="text-[10px] text-slate-500 font-mono">cm/yr</span>
        </div>
        <div class="space-y-1 font-mono text-[10px]">
          <div
            class="h-3 w-full rounded"
            style="background: linear-gradient(to right, rgb(220,200,0), rgb(110,150,128), rgb(0,100,255))"
          ></div>
          <div class="flex justify-between text-slate-400">
            <span>0 (Arid)</span>
            <span>50</span>
            <span>100+ (Wet)</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono">
          <span class="flex items-center gap-1 text-slate-400">
            <span class="w-3 h-0.5 bg-yellow-300 inline-block"></span>25
          </span>
          <span class="flex items-center gap-1 text-slate-400">
            <span class="w-3 h-0.5 bg-sky-300 inline-block"></span>50
          </span>
          <span class="flex items-center gap-1 text-slate-400">
            <span class="w-3 h-0.5 bg-sky-400 inline-block"></span>75 cm/yr
          </span>
        </div>
      </div>
    `;
  }

  if (uiState.activeLayer === 'wind') {
    return html`
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-start gap-2 min-h-0 overflow-y-auto"
      >
        <div
          class="text-[11px] text-slate-400 font-bold uppercase flex items-center justify-between shrink-0"
        >
          <span>
            <i class="fa-solid fa-wind text-sky-400 mr-1"></i>
            Wind Legend
          </span>
          <span class="text-[10px] text-slate-500 font-mono">m/s</span>
        </div>
        <div class="space-y-1 font-mono text-[10px]">
          <div
            class="h-3 w-full rounded"
            style="background: linear-gradient(to right, rgb(0,80,160), rgb(60,168,208), rgb(120,255,255))"
          ></div>
          <div class="flex justify-between text-slate-400">
            <span>0 (Calm)</span>
            <span>6 m/s</span>
            <span>12+ m/s</span>
          </div>
        </div>
        <div class="text-[10px] font-mono text-slate-400 leading-snug">
          0–30° Trade Winds · 30–60° Westerlies · 60–90° Polar Easterlies
        </div>
      </div>
    `;
  }

  if (uiState.activeLayer === 'daisies') {
    return html`
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-start gap-2 min-h-0 overflow-y-auto"
      >
        <div
          class="text-[11px] text-slate-400 font-bold uppercase flex items-center justify-between shrink-0"
        >
          <span>
            <i class="fa-solid fa-sun-plant-wilt text-purple-400 mr-1"></i>
            Daisyworld Legend
          </span>
          <span class="text-[10px] text-slate-500 font-mono">Albedo</span>
        </div>
        <div class="space-y-1.5 text-[10px] font-mono text-slate-300">
          <div class="flex items-center gap-2">
            <img
              src="./sprites/daisy/00.png"
              alt=""
              width="16"
              height="16"
              class="w-4 h-4 rounded-sm shrink-0 [image-rendering:pixelated]"
            />
            <span>White Daisies (High Albedo — cools)</span>
          </div>
          <div class="flex items-center gap-2">
            <img
              src="./sprites/daisy/03.png"
              alt=""
              width="16"
              height="16"
              class="w-4 h-4 rounded-sm shrink-0 [image-rendering:pixelated]"
            />
            <span>Mixed Colony</span>
          </div>
          <div class="flex items-center gap-2">
            <img
              src="./sprites/daisy/06.png"
              alt=""
              width="16"
              height="16"
              class="w-4 h-4 rounded-sm shrink-0 [image-rendering:pixelated]"
            />
            <span>Black Daisies (Low Albedo — warms)</span>
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div
      class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-start min-h-0 overflow-y-auto"
    >
      <div
        class="text-[11px] text-slate-400 font-bold uppercase mb-1.5 flex items-center justify-between shrink-0"
      >
        <span>
          <i class="fa-solid fa-map text-amber-400 mr-1"></i>
          Biome Legend
        </span>
        <span class="text-[10px] text-slate-500 font-mono">128x64 Map</span>
      </div>
      <div class="grid grid-cols-3 gap-x-2 gap-y-1.5 text-[10px] font-mono">
        ${Object.values(BIOMES).map(
          ({id, name, color}) =>
            html`<div class="flex items-center space-x-1.5 min-w-0">
              <img
                src=${getBiomeLegendSpriteUrl(id)}
                alt=""
                width="16"
                height="16"
                class="w-4 h-4 rounded-sm shrink-0 [image-rendering:pixelated]"
                style="background-color: rgb(${color.join(', ')})"
              />
              <span class="text-slate-400 truncate" title=${name}>
                ${name}
              </span>
            </div>`,
        )}
      </div>
    </div>
  `;
}

function dashBoardHtml() {
  return html`
    <div
      class="h-44 bg-slate-900 border-t border-slate-800 p-3 grid grid-cols-1 md:grid-cols-3 md:grid-rows-1 gap-4 z-10 shrink-0 min-h-0"
    >
      <!-- Chart 1: Global Temperature & Greenhouse Trend -->
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-between min-h-0 overflow-hidden"
      >
        <div
          class="flex justify-between items-center text-[11px] text-slate-400 font-bold uppercase mb-1 shrink-0"
        >
          <span>
            <i class="fa-solid fa-chart-line text-blue-400 mr-1"></i>
            Global Temp (°C)
          </span>
          <span class="text-emerald-400 font-mono">
            ${simulation.metrics.averageTemperatureC.toFixed(1)}°C
          </span>
        </div>
        <div class="flex-1 min-h-0 relative">${temperatureChartHtml()}</div>
      </div>

      <!-- Chart 2: Daisyworld Population / Coverage Chart -->
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-between min-h-0 overflow-hidden"
      >
        <div
          class="flex justify-between items-center text-[11px] text-slate-400 font-bold uppercase mb-1 shrink-0"
        >
          <span>
            <i class="fa-solid fa-chart-pie text-purple-400 mr-1"></i>
            Daisy Populations
          </span>
          <span class="text-purple-300 font-mono">
            W:${simulation.metrics.whiteDaisyCoveragePct.toFixed(1)}% /
            B:${simulation.metrics.blackDaisyCoveragePct.toFixed(1)}%
          </span>
        </div>
        <div class="flex-1 min-h-0 relative">${daisyChartHtml()}</div>
      </div>

      <!-- Active Layer Legend / Controls -->
      ${layerLegendPanelHtml()}
    </div>
  `;
}

function bodyHtml() {
  return html`
    ${statusBarHtml()}
    <main class="flex-1 min-h-0 flex overflow-hidden relative">
      <!-- LEFT SIDEBAR: Atmospheric & Global Sliders -->
      <aside
        class="w-80 bg-slate-900 border-r border-slate-800 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto"
      >
        ${layerSwitchHtml()} ${atmosphericSlidersHtml()} ${presetsHtml()}
        ${logBoxHtml()}
      </aside>

      <!-- CENTER VIEWPORT: Canvas Simulation Display & God Tools -->
      <section
        class="flex-1 min-h-0 flex flex-col bg-slate-950 overflow-hidden relative"
      >
        ${godToolsBarHtml()} ${worldMapHtml()} ${dashBoardHtml()}
      </section>
    </main>
    ${fullscreenButtonHtml()}
  `;
}

const SPRITE_ANIMATION_FPS = 5;
const SPRITE_ANIMATION_INTERVAL_MS = 1_000 / SPRITE_ANIMATION_FPS;
let lastScrolledLog: EventLogEntry | undefined;
let loadedSprites: SpriteSheet | null = null;
let animationFrame = 0;

function drawWorldCanvas() {
  const canvas = worldMapRef.value;
  if (!canvas) throw new Error('World map canvas was not rendered');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get the world map canvas context');
  renderWorldMap(
    context,
    simulation.state,
    simulation.config,
    uiState.activeLayer,
    loadedSprites,
    animationFrame,
    uiState.camera,
    uiState.showIsolines,
    uiState.visibleLifeClasses,
    activeEventBeacon,
  );
}

function renderApp() {
  render(bodyHtml(), document.body);
  drawWorldCanvas();

  const latestLog = uiState.logs[uiState.logs.length - 1];
  const consoleEl = eventConsoleRef.value;
  if (consoleEl && latestLog !== lastScrolledLog) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
    lastScrolledLog = latestLog;
  }
}
renderApp();
void loadSprites().then(sprites => {
  loadedSprites = sprites;
  renderApp();
  window.setInterval(() => {
    animationFrame = (animationFrame + 1) % 8;
    drawWorldCanvas();
  }, SPRITE_ANIMATION_INTERVAL_MS);
});
document.onclick = renderApp;
document.onchange = renderApp;
document.oninput = renderApp;
document.onmousemove = renderApp;
document.onmouseout = renderApp;
document.addEventListener('fullscreenchange', renderApp);
