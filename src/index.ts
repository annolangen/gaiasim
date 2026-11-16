import {html, render} from 'lit-html';
import './style.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

type MapLayer = 'biomes' | 'temp' | 'moisture' | 'daisies';

const config = {
  year: 0,
  isRunning: false,
  speed: 1,
  activeLayer: 'biomes' as MapLayer,
  activeTool: 'inspect',
  solarLuminosity: 1.0, // Multiplier
  co2Ppm: 350, // Greenhouse driver
  o2Pct: 21, // Oxygen percentage
  seaLevelOffset: 0, // Height modifier
  avgPlanetTemp: 15.0,
  oceanCoveragePct: 70,
  totalBiomassPct: 35,
};

function speedButtonHtml(speed: number) {
  const isSelected = config.speed === speed;
  return html`<button
    @click=${() => (config.speed = speed)}
    aria-pressed=${isSelected}
    class="btn-speed px-2.5 py-1 ${isSelected ? 'bg-blue-600 text-white font-bold' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'} rounded text-xs font-mono"
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
        <span class="font-bold text-amber-400 font-mono"> ${config.year} </span>
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-slate-500">
          <i class="fa-solid fa-temperature-high"></i> Avg Temp:
        </span>
        <span class="font-bold text-emerald-400 font-mono">
          ${config.avgPlanetTemp}°C
        </span>
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-slate-500">
          <i class="fa-solid fa-droplet"></i> Ocean Cover:
        </span>
        <span class="font-bold text-blue-400 font-mono">
          ${config.oceanCoveragePct}%
        </span>
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-slate-500">
          <i class="fa-solid fa-seedling"></i> Biomass:
        </span>
        <span class="font-bold text-green-400 font-mono">
          ${config.totalBiomassPct}%
        </span>
      </div>
    </div>

    <!-- Simulation Speed / Play / Pause Controls -->
    <div class="flex items-center space-x-2">
      <button
        @click=${() => (config.isRunning = !config.isRunning)}
        class="px-3 py-1.5 ${config.isRunning ? 'bg-emerald-600' : 'bg-amber-600'} hover:bg-emerald-500 text-white rounded font-bold text-xs flex items-center gap-1.5 transition"
      >
        <i class="fa-solid fa-play"></i>
        <span> ${config.isRunning ? 'PAUSE' : 'RUN'} </span>
      </button>
      <button
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
  const isSelected = config.activeLayer === layer;
  return html`<button
    @click=${() => (config.activeLayer = layer)}
    aria-pressed=${isSelected}
    class="px-2.5 py-2 rounded ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'} text-left font-medium flex items-center justify-between"
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
    config.solarLuminosity = 1;
    config.co2Ppm = 350;
    config.o2Pct = 21;
    config.seaLevelOffset = 0;
  }

  function solarLuminosityInput(this: HTMLInputElement) {
    config.solarLuminosity = Number(this.value);
  }

  function co2Input(this: HTMLInputElement) {
    config.co2Ppm = Number(this.value);
  }

  function oxygenInput(this: HTMLInputElement) {
    config.o2Pct = Number(this.value);
  }

  function seaLevelInput(this: HTMLInputElement) {
    config.seaLevelOffset = Number(this.value);
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
            ${config.solarLuminosity.toFixed(2)}x
          </span>
        </div>
        <input
          type="range"
          min="0.6"
          max="1.4"
          step="0.01"
          .value=${String(config.solarLuminosity)}
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
            ${config.co2Ppm} ppm
          </span>
        </div>
        <input
          type="range"
          min="50"
          max="2500"
          step="10"
          .value=${String(config.co2Ppm)}
          @input=${co2Input}
          class="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      <!-- Oxygen Slider -->
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="text-slate-400">Oxygen Level (O2)</span>
          <span class="font-mono text-blue-400 font-bold">
            ${config.o2Pct}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="40"
          step="1"
          .value=${String(config.o2Pct)}
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
              config.seaLevelOffset === 0
                ? 'Baseline'
                : `${config.seaLevelOffset > 0 ? '+' : ''}${config.seaLevelOffset}m`
            }
          </span>
        </div>
        <input
          type="range"
          min="-30"
          max="30"
          step="1"
          .value=${String(config.seaLevelOffset)}
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
          class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-mono"
        >
          Earth-like
        </button>
        <button
          id="presetPangaea"
          class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-mono"
        >
          Pangaea
        </button>
        <button
          id="presetArchipelago"
          class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-mono"
        >
          Islands
        </button>
        <button
          id="presetDaisyworld"
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
        class="flex-1 flex flex-col bg-slate-950 overflow-hidden relative"
      >
    
    </section>
    </main>
  `;
}

function renderApp() {
  render(bodyHtml(), document.body);
}
renderApp();
document.onclick = renderApp;
document.oninput = renderApp;
