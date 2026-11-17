import {html, render, svg} from 'lit-html';
import {createRef, ref} from 'lit-html/directives/ref.js';
import './style.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import {drawMap, createMapPixels} from './map-renderer';
import type {MapLayer} from './map-renderer';
import {
  BIOMES,
  createSimulationConfig,
  createSimulationState,
} from './sim/constants';
import {generatePlanet, recalculateClimate, simulationStep} from './sim/engine';
import type {PlanetType} from './sim/types';

const uiState = {
  isRunning: false,
  speed: 1,
  activeLayer: 'biomes' as MapLayer,
  activeTool: 'inspect',
};
const SIMULATION_TICK_INTERVAL_MS = 1_000;
const worldMapRef = createRef<HTMLCanvasElement>();

const simulation = (() => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  let timer: number | undefined;
  let metrics = generatePlanet(state, config, 'earth');

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

  function toggle() {
    uiState.isRunning = !uiState.isRunning;
    if (uiState.isRunning) {
      start();
    } else {
      stop();
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
  }
  return {
    toggle,
    config,
    get metrics() {
      return metrics;
    },
    mapPixels: (layer: MapLayer) => createMapPixels(state, config, layer),
    generate(type: PlanetType) {
      metrics = generatePlanet(state, config, type);
    },
    step,
    setSeaLevelOffset(seaLevelOffset: number) {
      config.seaLevelOffset = seaLevelOffset;
      recalculateClimate(state, config);
      step();
    },
    setSpeed(speed: number) {
      uiState.speed = speed;
      if (uiState.isRunning) start();
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
          uiState.isRunning ? 'bg-emerald-600' : 'bg-amber-600'
        } hover:bg-emerald-500 text-white rounded font-bold text-xs flex items-center gap-1.5 transition"
      >
        <i class="fa-solid fa-play"></i>
        <span> ${uiState.isRunning ? 'PAUSE' : 'RUN'} </span>
      </button>
      <button
        @click=${simulation.step}
        class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs transition"
      >
        <i class="fa-solid fa-forward-step"></i>
      </button>
      <div class="h-4 w-px bg-slate-800 mx-1"></div>
      ${speedButtonHtml(1)} ${speedButtonHtml(2)} ${speedButtonHtml(5)}
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
      class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2"
    >
      <i class="fa-solid fa-layer-group text-blue-400"></i> Map Display Layer
    </h3>
    <div class="grid grid-cols-2 gap-2 text-xs">
      ${layerButtonHtml('biomes', 'Biomes/Terrain', 'fa-tree')}
      ${layerButtonHtml('temp', 'Temperature', 'fa-temperature-half')}
      ${layerButtonHtml('moisture', 'Moisture', 'fa-cloud-rain')}
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
            ${simulation.config.o2Pct}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="40"
          step="1"
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

function preetsHtml() {
  return html`
    <div class="bg-slate-950 p-3 rounded-lg border border-slate-800">
      <h3
        class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"
      >
        <i class="fa-solid fa-wand-magic-sparkles text-purple-400"></i>
        Generator Presets
      </h3>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <button
          id="presetEarth"
          @click=${() => simulation.generate('earth')}
          class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-mono"
        >
          Earth-like
        </button>
        <button
          id="presetPangaea"
          @click=${() => simulation.generate('pangaea')}
          class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-mono"
        >
          Pangaea
        </button>
        <button
          id="presetArchipelago"
          @click=${() => simulation.generate('archipelago')}
          class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-mono"
        >
          Islands
        </button>
        <button
          id="presetDaisyworld"
          @click=${() => simulation.generate('daisyworld')}
          class="px-2 py-1.5 bg-purple-900/40 hover:bg-purple-800/50 border border-purple-500/30 text-purple-200 rounded font-mono"
        >
          Daisyworld
        </button>
      </div>
    </div>
  `;
}

function logBoxHtml() {
  return html`
    <div
      class="flex-1 bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col justify-between min-h-30"
    >
      <h3
        class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center justify-between"
      >
        <span>Events Console</span>
        <i class="fa-solid fa-terminal text-[10px]"></i>
      </h3>
      <div
        id="eventConsole"
        class="flex-1 font-mono text-[10px] text-slate-400 overflow-y-auto space-y-1 my-1 pr-1"
      >
        <p class="text-emerald-400">> Simulation core initialized [128x64].</p>
        <p class="text-slate-500">> Select a God Tool to alter surface.</p>
      </div>
    </div>
  `;
}

function worldMapHtml() {
  return html`
    <div
      class="flex-1 min-h-0 relative flex items-center justify-center p-4 bg-slate-950 overflow-hidden"
    >
      <div
        class="relative w-full max-w-5xl max-h-full aspect-[2/1] border-2 border-slate-700 rounded-lg overflow-hidden bg-black"
      >
        <canvas
          ${ref(worldMapRef)}
          width="128"
          height="64"
          class="world-map-canvas block h-full w-full"
        ></canvas>
      </div>
    </div>
  `;
}

function temperatureChartSvg() {
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

  const plot = {left: 32, right: 298, top: 4, bottom: 84};
  const ticks = Array.from(
    {length: 6},
    (_, index) => minTemperatureBound + (temperatureRange * index) / 5,
  );
  const yForTemperature = (temperature: number) =>
    plot.bottom -
    ((temperature - minTemperatureBound) / temperatureRange) *
      (plot.bottom - plot.top);
  const points = values
    .map((temperature, index) => {
      const x =
        plot.left +
        (index / Math.max(1, values.length - 1)) * (plot.right - plot.left);
      return `${x},${yForTemperature(temperature)}`;
    })
    .join(' ');

  return svg`<svg
    class="h-full w-full"
    viewBox="0 0 300 100"
    preserveAspectRatio="none"
    role="img"
    aria-label="Global temperature history"
  >
    ${ticks.map(temperature => {
      const y = yForTemperature(temperature);
      return svg`<g>
        <line
          x1=${plot.left}
          y1=${y}
          x2=${plot.right}
          y2=${y}
          stroke="#1e293b"
          stroke-width="1"
        />
        <text
          x=${plot.left - 4}
          y=${y}
          fill="#64748b"
          font-size="8"
          text-anchor="end"
          dominant-baseline="middle"
        >${temperature.toFixed(1)}</text>
      </g>`;
    })}
    <polyline
      points=${points}
      fill="none"
      stroke="#10b981"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
    />
  </svg>`;
}

function daisyChartSvg() {
  const whiteHistory = simulation.metrics.whiteDaisyHistory;
  const blackHistory = simulation.metrics.blackDaisyHistory;
  const maxCoverage = Math.max(0, ...whiteHistory, ...blackHistory);
  const coverageRange = maxCoverage > 0 ? maxCoverage * 1.1 : 1;
  const plot = {left: 32, right: 298, top: 4, bottom: 84};
  const ticks = Array.from(
    {length: 5},
    (_, index) => (coverageRange * index) / 4,
  );
  const yForCoverage = (coverage: number) =>
    plot.bottom - (coverage / coverageRange) * (plot.bottom - plot.top);
  const linePoints = (history: number[]) =>
    history
      .map((coverage, index) => {
        const x =
          plot.left +
          (index / Math.max(1, history.length - 1)) * (plot.right - plot.left);
        return `${x},${yForCoverage(coverage)}`;
      })
      .join(' ');

  return svg`<svg
    class="h-full w-full"
    viewBox="0 0 300 100"
    preserveAspectRatio="none"
    role="img"
    aria-label="White and black daisy coverage history"
  >
    ${ticks.map(coverage => {
      const y = yForCoverage(coverage);
      return svg`<g>
        <line
          x1=${plot.left}
          y1=${y}
          x2=${plot.right}
          y2=${y}
          stroke="#1e293b"
          stroke-width="1"
        />
        <text
          x=${plot.left - 4}
          y=${y}
          fill="#64748b"
          font-size="8"
          text-anchor="end"
          dominant-baseline="middle"
        >${coverage.toFixed(coverageRange < 1 ? 2 : 1)}%</text>
      </g>`;
    })}
    <polyline
      points=${linePoints(whiteHistory)}
      fill="none"
      stroke="#f8fafc"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
    />
    <polyline
      points=${linePoints(blackHistory)}
      fill="none"
      stroke="#64748b"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
    />
  </svg>`;
}

function dashBoardHtml() {
  return html`
    <div
      class="h-44 bg-slate-900 border-t border-slate-800 p-3 grid grid-cols-1 md:grid-cols-3 gap-4 z-10 shrink-0"
    >
      <!-- Chart 1: Global Temperature & Greenhouse Trend -->
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-between"
      >
        <div
          class="flex justify-between items-center text-[11px] text-slate-400 font-bold uppercase mb-1"
        >
          <span>
            <i class="fa-solid fa-chart-line text-blue-400 mr-1"></i>
            Global Temp (°C)
          </span>
          <span class="text-emerald-400 font-mono">
            ${simulation.metrics.averageTemperatureC.toFixed(1)}°C
          </span>
        </div>
        <div class="flex-1 relative">${temperatureChartSvg()}</div>
      </div>

      <!-- Chart 2: Daisyworld Population / Coverage Chart -->
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-between"
      >
        <div
          class="flex justify-between items-center text-[11px] text-slate-400 font-bold uppercase mb-1"
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
        <div class="flex-1 relative">${daisyChartSvg()}</div>
      </div>

      <!-- Biome Legend & Distribution Summary -->
      <div
        class="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col justify-between overflow-y-auto"
      >
        <div
          class="text-[11px] text-slate-400 font-bold uppercase mb-1.5 flex items-center justify-between"
        >
          <span>
            <i class="fa-solid fa-palette text-amber-400 mr-1"></i>
            Biome Color Key
          </span>
          <span class="text-[10px] text-slate-500 font-mono">128x64 Map</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
          ${Object.values(BIOMES).map(
            ({name, color}) =>
              html`<div class="flex items-center space-x-1.5">
                <span
                  class="w-3 h-3 rounded-sm inline-block"
                  style="background-color: rgb(${color.join(', ')})"
                ></span>
                <span class="text-slate-400">${name}</span>
              </div>`,
          )}
        </div>
      </div>
    </div>
  `;
}

function bodyHtml() {
  return html`
    ${statusBarHtml()}
    <main class="flex-1 flex overflow-hidden relative">
      <!-- LEFT SIDEBAR: Atmospheric & Global Sliders -->
      <aside
        class="w-80 bg-slate-900 border-r border-slate-800 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto"
      >
        ${layerSwitchHtml()} ${atmosphericSlidersHtml()} ${preetsHtml()}
        ${logBoxHtml()}       
        </div>
      </aside>

      <!-- CENTER VIEWPORT: Canvas Simulation Display & God Tools -->
      <section
        class="flex-1 min-h-0 flex flex-col bg-slate-950 overflow-hidden relative"
      >
        ${worldMapHtml()}
        ${dashBoardHtml()}
    </section>
    </main>
  `;
}

function renderApp() {
  render(bodyHtml(), document.body);
  const canvas = worldMapRef.value;
  if (!canvas) throw new Error('World map canvas was not rendered');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get the world map canvas context');
  drawMap(context, simulation.mapPixels(uiState.activeLayer));
}
renderApp();
document.onclick = renderApp;
document.oninput = renderApp;
