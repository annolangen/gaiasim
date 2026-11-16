import {html, render} from 'lit-html';
import './style.css';

const config = {
  year: 0,
  isRunning: false,
  speed: 1,
  activeLayer: 'biomes', // 'biomes', 'temp', 'moisture', 'daisies'
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

function bodyHtml() {
  return html`
    ${statusBarHtml()}
    <main></main>
  `;
}

function renderApp() {
  render(bodyHtml(), document.body);
}
renderApp();
document.onclick = renderApp;
