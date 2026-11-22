import {deepStrictEqual, strictEqual} from 'node:assert';
import {test} from 'node:test';
import {
  computePlanetaryAudioParams,
  sampleViewportWindSpeed,
} from '../src/audio';
import {
  centerCameraOnGridCell,
  clampCamera,
  computeIsolineSegments,
  computePinchCamera,
  createCameraFlight,
  createMapPixels,
  createPinchAnchor,
  getBiomeLegendSpriteUrl,
  sampleCameraFlight,
  selectCellSprite,
  selectDaisySprite,
  selectLandTileIndex,
  selectOceanSprite,
  stripLifeformBackgroundPixels,
  viewportToGridCoords,
  WORLD_PIXEL_HEIGHT,
  WORLD_PIXEL_WIDTH,
} from '../src/map-renderer';
import type {SpriteSheet} from '../src/map-renderer';
import {
  BIOMES,
  createSimulationConfig,
  createSimulationState,
  GRID_HEIGHT,
  GRID_WIDTH,
  LIFE_CLASS_NONE,
  LIFE_CLASSES,
} from '../src/sim/constants';
import {
  applyGodTool,
  classifyBiomes,
  generatePlanet,
  getIdx,
  getLifeHabitatSuitability,
  simulationStep,
  updateLife,
  updateWindVectors,
} from '../src/sim/engine';
import {createNoise2D} from '../src/sim/noise';
import type {PlanetType} from '../src/sim/types';

void test('getIdx wraps longitude and clamps latitude', () => {
  strictEqual(getIdx(-1, 0), GRID_WIDTH - 1);
  strictEqual(getIdx(GRID_WIDTH, 0), 0);
  strictEqual(getIdx(0, -1), 0);
  strictEqual(getIdx(0, GRID_HEIGHT), (GRID_HEIGHT - 1) * GRID_WIDTH);
});

void test('classifyBiomes applies ocean and climate thresholds', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  const cases = [
    [0, -2, 50, BIOMES.SEA_ICE.id],
    [0, -1, 50, BIOMES.OCEAN.id],
    [1, 11, 24, BIOMES.DESERT.id],
    [1, 11, 25, BIOMES.GRASSLAND.id],
    [1, 5, 50, BIOMES.GRASSLAND.id],
    [1, 30, 50, BIOMES.GRASSLAND.id],
    [1, 20, 100, BIOMES.FOREST.id],
    [10, 23, 150, BIOMES.FOREST.id],
    [10, 23, 151, BIOMES.JUNGLE.id],
    [2, 11, 121, BIOMES.SWAMP.id],
    [2.1, 11, 121, BIOMES.FOREST.id],
    [1, -10, 40, BIOMES.TUNDRA.id],
    [1, 0, 40, BIOMES.TUNDRA.id],
    [1, -20, 50, BIOMES.TUNDRA.id],
    [3_000, 4, 50, BIOMES.TUNDRA.id],
  ];

  cases.forEach(([elevation, temperature, moisture, expected], index) => {
    const cell = getIdx(index, Math.floor(GRID_HEIGHT / 2));
    state.elevation[cell] = elevation;
    state.temperature[cell] = temperature;
    state.moisture[cell] = moisture;
    classifyBiomes(state, config);
    strictEqual(state.biome[cell], expected);
  });
});

void test('classifyBiomes varies the alpine treeline with latitude', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  state.elevation.fill(3_200);
  state.temperature.fill(4);
  state.moisture.fill(40);

  classifyBiomes(state, config);

  strictEqual(state.biome[getIdx(0, 32)], BIOMES.TUNDRA.id);
  strictEqual(state.biome[getIdx(0, 18)], BIOMES.ALPINE.id);
});

void test('classifyBiomes derives polar circles from axial tilt', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  state.elevation.fill(100);
  state.temperature.fill(-5);
  state.moisture.fill(40);

  classifyBiomes(state, config);

  strictEqual(state.biome[getIdx(0, 8)], BIOMES.SEA_ICE.id);
  strictEqual(state.biome[getIdx(0, 9)], BIOMES.TUNDRA.id);
  strictEqual(state.biome[getIdx(0, 55)], BIOMES.SEA_ICE.id);
  strictEqual(state.biome[getIdx(0, 54)], BIOMES.TUNDRA.id);

  config.axialTiltDegrees = 0;
  classifyBiomes(state, config);
  strictEqual(state.biome[getIdx(0, 8)], BIOMES.TUNDRA.id);
});

void test('simulationStep advances time, clears submerged daisies, and reports metrics', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  state.elevation.fill(0);
  state.daisyWhite.fill(0.5);
  state.daisyBlack.fill(0.5);

  const metrics = simulationStep(state, config);

  strictEqual(config.year, 10);
  strictEqual(metrics.oceanCoveragePct, 100);
  strictEqual(metrics.whiteDaisyCoveragePct, 0);
  strictEqual(metrics.blackDaisyCoveragePct, 0);
  strictEqual(metrics.temperatureHistory.length, 1);
  strictEqual(metrics.whiteDaisyHistory.length, 1);
  strictEqual(metrics.blackDaisyHistory.length, 1);
  strictEqual(metrics.whiteDaisyHistory[0], 0);
  strictEqual(metrics.blackDaisyHistory[0], 0);
  strictEqual(state.biome[0], BIOMES.OCEAN.id);
});

void test('simulationStep cools land by the standard lapse rate', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  const equatorCell = getIdx(0, GRID_HEIGHT / 2);
  state.elevation[equatorCell] = 1_000;

  simulationStep(state, config);

  strictEqual(Math.round(state.temperature[equatorCell] * 100) / 100, 5.7);
});

void test('simulationStep records white and black daisy coverage history', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  state.elevation.fill(100);
  state.daisyWhite.fill(0.2);
  state.daisyBlack.fill(0.1);

  const firstMetrics = simulationStep(state, config);
  const secondMetrics = simulationStep(
    state,
    config,
    firstMetrics.temperatureHistory,
    firstMetrics.whiteDaisyHistory,
    firstMetrics.blackDaisyHistory,
  );

  strictEqual(secondMetrics.whiteDaisyHistory.length, 2);
  strictEqual(secondMetrics.blackDaisyHistory.length, 2);
  strictEqual(
    secondMetrics.whiteDaisyHistory[1],
    secondMetrics.whiteDaisyCoveragePct,
  );
  strictEqual(
    secondMetrics.blackDaisyHistory[1],
    secondMetrics.blackDaisyCoveragePct,
  );
});

void test('simulationStep spreads daisies to adjacent habitable bare land', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  state.elevation.fill(100);
  state.temperature.fill(22.5);
  const centerIdx = getIdx(10, 32);
  const neighborIdx = getIdx(11, 32);
  state.daisyWhite[centerIdx] = 0.6;

  simulationStep(state, config);

  strictEqual(state.daisyWhite[neighborIdx] > 0, true);
});

void test('volcano brush wraps at the longitude edge and tapers by radius', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();

  applyGodTool(state, config, 'volcano', 0, 32);

  strictEqual(state.elevation[getIdx(0, 32)], 3_000);
  strictEqual(state.elevation[getIdx(-1, 32)], 2_000);
  strictEqual(state.elevation[getIdx(4, 32)], 0);
});

void test('planet presets generate finite terrain and reset the year', () => {
  const planetTypes: PlanetType[] = [
    'earth',
    'pangaea',
    'archipelago',
    'daisyworld',
  ];

  for (const type of planetTypes) {
    const state = createSimulationState();
    const config = createSimulationConfig();
    config.year = 100;
    state.temperature.fill(7);
    state.moisture.fill(33);

    const metrics = generatePlanet(state, config, type, () => 0);

    strictEqual(config.year, 0);
    strictEqual(state.temperature[0], 7);
    strictEqual(state.moisture[0], 33);
    strictEqual(
      state.elevation.every(elevation => Number.isFinite(elevation)),
      true,
    );
    strictEqual(
      state.elevation.every(
        elevation => elevation >= -11_000 && elevation <= 9_000,
      ),
      true,
    );
    strictEqual(Number.isFinite(metrics.averageTemperatureC), true);
  }
});

void test('createNoise2D is reproducible with a deterministic random source', () => {
  const firstNoise = createNoise2D(() => 0.5);
  const secondNoise = createNoise2D(() => 0.5);

  strictEqual(firstNoise(1.25, 3.75), secondNoise(1.25, 3.75));
});

void test('createMapPixels renders the selected layer as opaque RGBA pixels', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  state.elevation.fill(100);
  state.biome.fill(BIOMES.FOREST.id);
  state.temperature.fill(40);
  state.moisture.fill(50);
  state.daisyWhite.fill(0.1);

  deepStrictEqual(
    Array.from(createMapPixels(state, config, 'biomes').slice(0, 4)),
    [...BIOMES.FOREST.color, 255],
  );
  deepStrictEqual(
    Array.from(createMapPixels(state, config, 'temp').slice(0, 4)),
    [255, 0, 0, 255],
  );
  deepStrictEqual(
    Array.from(createMapPixels(state, config, 'moisture').slice(0, 4)),
    [110, 150, 127, 255],
  );
  deepStrictEqual(
    Array.from(createMapPixels(state, config, 'daisies').slice(0, 4)),
    [79, 86, 98, 255],
  );

  state.moisture[0] = 150;
  deepStrictEqual(
    Array.from(createMapPixels(state, config, 'moisture').slice(0, 4)),
    [0, 100, 255, 255],
  );
});

void test('selectCellSprite maps biomes, ocean depth frames, daisies, and alpine elevation', () => {
  const fakeImg = (tag: string) => ({alt: tag}) as unknown as HTMLImageElement;
  const sprites: SpriteSheet = {
    biomes: new Map(
      Object.values(BIOMES)
        .filter((b): b is typeof b & {sprite: string} => 'sprite' in b)
        .map(b => [b.id, fakeImg(`biome:${b.sprite}`)]),
    ),
    ocean: {
      shallow: Array.from({length: 8}, (_, i) => fakeImg(`shallow:${i}`)),
      regular: Array.from({length: 8}, (_, i) => fakeImg(`regular:${i}`)),
      deep: Array.from({length: 8}, (_, i) => fakeImg(`deep:${i}`)),
    },
    land: Array.from({length: 32}, (_, i) => fakeImg(`land:${i}`)),
    daisy: Array.from({length: 7}, (_, i) => fakeImg(`daisy:${i}`)),
    lifeforms: new Map(),
    lifeformIconUrls: new Map(),
  };

  const state = createSimulationState();
  const config = createSimulationConfig();

  // Ocean depth tiers and frame wrapping
  strictEqual(selectOceanSprite(sprites, -500, 0, 3).alt, 'shallow:3');
  strictEqual(selectOceanSprite(sprites, -2_000, 0, 9).alt, 'regular:1');
  strictEqual(selectOceanSprite(sprites, -6_000, 0, 2).alt, 'deep:2');

  // Static biome mapping via BIOMES[...].sprite
  state.elevation[0] = 200;
  state.biome[0] = BIOMES.FOREST.id;
  strictEqual(
    selectCellSprite(sprites, state, config, 0, 'biomes', 0).alt,
    'biome:forest',
  );

  // Alpine falls back to elevation-indexed land tiles (16..31)
  state.biome[0] = BIOMES.ALPINE.id;
  state.elevation[0] = 6_000;
  strictEqual(selectLandTileIndex(6_000, 0), 31);
  strictEqual(
    selectCellSprite(sprites, state, config, 0, 'biomes', 0).alt,
    'land:31',
  );

  // Daisy sprites scale from 0 (white) to 6 (black)
  strictEqual(selectDaisySprite(sprites, 0.8, 0)?.alt, 'daisy:0');
  strictEqual(selectDaisySprite(sprites, 0, 0.8)?.alt, 'daisy:6');
  strictEqual(selectDaisySprite(sprites, 0.4, 0.4)?.alt, 'daisy:3');
});

void test('updateWindVectors produces trade winds, westerlies, and polar easterlies', () => {
  const state = createSimulationState();
  updateWindVectors(state, 0);

  // Equator (~row 32): Hadley trade winds blow westward (windX < 0)
  strictEqual(state.windX[getIdx(0, 32)] < 0, true);
  // Mid-latitude (~row 16, ~45°N): Ferrel westerlies blow eastward (windX > 0)
  strictEqual(state.windX[getIdx(0, 16)] > 0, true);
  // Polar (~row 2, ~84°N): Polar easterlies blow westward (windX < 0)
  strictEqual(state.windX[getIdx(0, 2)] < 0, true);
});

void test('clampCamera and viewportToGridCoords handle zoom, pan, and longitude wrap', () => {
  const cam = clampCamera({zoom: 2, panX: -16, panY: 9999});
  strictEqual(cam.zoom, 2);
  strictEqual(cam.panX, WORLD_PIXEL_WIDTH - 16);
  strictEqual(cam.panY, WORLD_PIXEL_HEIGHT / 2);

  // At top-left of this panned camera (normX=0, normY=0), worldX is 2032 (cell x=127), worldY is 512 (cell y=32)
  deepStrictEqual(viewportToGridCoords(0, 0, cam), {x: 127, y: 32});
  // Slightly to the right wraps past 2048 back to cell x=0
  deepStrictEqual(viewportToGridCoords(0.05, 0, cam), {x: 2, y: 32});
});

void test('computeIsolineSegments generates marching-squares contour segments across a gradient', () => {
  const field = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      field[getIdx(x, y)] = y;
    }
  }
  const segments = computeIsolineSegments(field, 31.5);
  // A horizontal contour across all 128 columns produces 128 segments at y = (31.5 + 0.5) * 16 = 512
  strictEqual(segments.length, GRID_WIDTH);
  strictEqual(segments[0].y1, 512);
  strictEqual(segments[0].y2, 512);
});

void test('computePlanetaryAudioParams maps planetary metrics to bounded audio parameters', () => {
  const coldBarren = computePlanetaryAudioParams({
    averageTemperatureC: -60,
    temperatureHistory: [],
    whiteDaisyHistory: [],
    blackDaisyHistory: [],
    oceanCoveragePct: 70,
    totalBiomassPct: 0,
    whiteDaisyCoveragePct: 0,
    blackDaisyCoveragePct: 0,
    lifeCoveragePct: 0,
    lifeClassCounts: {},
    lifeClassSampleCoords: {},
  });
  strictEqual(coldBarren.biomassRatio, 0);
  strictEqual(coldBarren.padFilterCutoffHz, 400);
  strictEqual(coldBarren.windFilterHz, 80);
  strictEqual(coldBarren.windGain, 0.08);

  const lushTemperate = computePlanetaryAudioParams({
    averageTemperatureC: 15,
    temperatureHistory: [],
    whiteDaisyHistory: [],
    blackDaisyHistory: [],
    oceanCoveragePct: 50,
    totalBiomassPct: 50,
    whiteDaisyCoveragePct: 0,
    blackDaisyCoveragePct: 0,
    lifeCoveragePct: 0,
    lifeClassCounts: {},
    lifeClassSampleCoords: {},
  });
  strictEqual(lushTemperate.biomassRatio, 1);
  strictEqual(lushTemperate.padFilterCutoffHz, 1125);
  strictEqual(lushTemperate.windGain, 0.015);
  strictEqual(Math.abs(lushTemperate.droneScale - 0.9) < 1e-9, true);

  // Zooming into a windy region swells wind gain, brightens filter frequency, and broadens Q.
  const calmZoomed = computePlanetaryAudioParams(
    {
      averageTemperatureC: 15,
      temperatureHistory: [],
      whiteDaisyHistory: [],
      blackDaisyHistory: [],
      oceanCoveragePct: 50,
      totalBiomassPct: 50,
      whiteDaisyCoveragePct: 0,
      blackDaisyCoveragePct: 0,
      lifeCoveragePct: 0,
      lifeClassCounts: {},
      lifeClassSampleCoords: {},
    },
    {meanWindSpeedMps: 0, zoom: 8},
  );
  const windyZoomed = computePlanetaryAudioParams(
    {
      averageTemperatureC: 15,
      temperatureHistory: [],
      whiteDaisyHistory: [],
      blackDaisyHistory: [],
      oceanCoveragePct: 50,
      totalBiomassPct: 50,
      whiteDaisyCoveragePct: 0,
      blackDaisyCoveragePct: 0,
      lifeCoveragePct: 0,
      lifeClassCounts: {},
      lifeClassSampleCoords: {},
    },
    {meanWindSpeedMps: 8, zoom: 3},
  );
  strictEqual(windyZoomed.windGain > 0.7, true);
  strictEqual(windyZoomed.windGain > calmZoomed.windGain, true);
  strictEqual(windyZoomed.windFilterHz > calmZoomed.windFilterHz, true);
  strictEqual(windyZoomed.windFilterQ < calmZoomed.windFilterQ, true);
});

void test('sampleViewportWindSpeed distinguishes calm doldrums from windy belts when zoomed in', () => {
  const state = createSimulationState();
  updateWindVectors(state, 0);

  // Zoom into the Ferrel westerlies (~45°N, row 16 -> y=256px) vs equatorial doldrums (~0°, row 32 -> y=512px)
  const westerliesWind = sampleViewportWindSpeed(state, {
    zoom: 8,
    panX: 0,
    panY: 16 * 16 - WORLD_PIXEL_HEIGHT / 16,
  });
  const doldrumsWind = sampleViewportWindSpeed(state, {
    zoom: 8,
    panX: 0,
    panY: 32 * 16 - WORLD_PIXEL_HEIGHT / 16,
  });
  strictEqual(westerliesWind > doldrumsWind * 2, true);
});

void test('getBiomeLegendSpriteUrl maps ocean, static biomes, and alpine to sprite paths', () => {
  strictEqual(
    getBiomeLegendSpriteUrl(BIOMES.OCEAN.id),
    './sprites/ocean/regular/00.png',
  );
  strictEqual(
    getBiomeLegendSpriteUrl(BIOMES.FOREST.id),
    './sprites/biomes/forest.png',
  );
  strictEqual(
    getBiomeLegendSpriteUrl(BIOMES.TUNDRA.id),
    './sprites/biomes/boreal.png',
  );
  strictEqual(
    getBiomeLegendSpriteUrl(BIOMES.ALPINE.id),
    './sprites/land/28.png',
  );
});

void test('createPinchAnchor and computePinchCamera zoom and pan around the pinch midpoint', () => {
  const startCam = {zoom: 1, panX: 0, panY: 0};
  // Pinch centered on the middle of the map (cell [64, 32])
  const anchor = createPinchAnchor(startCam, 100, 0.5, 0.5);

  // Spreading fingers to 2x distance doubles zoom while keeping [64, 32] centered
  const zoomed = computePinchCamera(anchor, 200, 0.5, 0.5);
  strictEqual(zoomed.zoom, 2);
  deepStrictEqual(viewportToGridCoords(0.5, 0.5, zoomed), {x: 64, y: 32});

  // Moving the midpoint right while zoomed pans the anchor to follow the fingers
  const panned = computePinchCamera(anchor, 200, 0.75, 0.5);
  strictEqual(panned.zoom, 2);
  deepStrictEqual(viewportToGridCoords(0.75, 0.5, panned), {x: 64, y: 32});
});

void test('lifeforms enforce O2/habitat suitability, photosynthesize O2, spread, evolve, and respond to God Tools', () => {
  // Suitability checks
  strictEqual(
    getLifeHabitatSuitability(LIFE_CLASSES.PROKARYOTE, BIOMES.OCEAN.id, 20, 0),
    1.0,
  );
  strictEqual(
    getLifeHabitatSuitability(LIFE_CLASSES.EUKARYOTE, BIOMES.OCEAN.id, 20, 0.5),
    0,
  );
  strictEqual(
    getLifeHabitatSuitability(LIFE_CLASSES.EUKARYOTE, BIOMES.OCEAN.id, 20, 1.5),
    1.0,
  );
  strictEqual(
    getLifeHabitatSuitability(LIFE_CLASSES.AMPHIBIAN, BIOMES.OCEAN.id, 20, 12),
    0.5,
  );

  // Photosynthesis raises O2 from 0% and enables prokaryote -> eukaryote evolution
  const state = createSimulationState();
  const config = createSimulationConfig();
  config.o2Pct = 0;
  state.elevation.fill(-2_000);
  state.temperature.fill(20);
  state.biome.fill(BIOMES.OCEAN.id);

  // Seed prokaryotes via God Tool in the middle of the ocean
  applyGodTool(state, config, 'seed_life', 64, 32);
  const centerIdx = getIdx(64, 32);
  strictEqual(state.lifeClass[centerIdx], LIFE_CLASSES.PROKARYOTE.id);
  strictEqual(Math.abs(state.lifePopulation[centerIdx] - 0.7) < 1e-6, true);

  // Deterministic low random source triggers spread and evolution once O2 >= 1%
  const alwaysLow = () => 0.001;
  for (let i = 0; i < 40; i++) {
    updateLife(state, config, alwaysLow);
  }
  strictEqual(config.o2Pct > 0, true);
  // Once O2 reaches 1%, eukaryotes emerge
  config.o2Pct = 2;
  updateLife(state, config, alwaysLow);
  const hasEukaryote = Array.from(state.lifeClass).some(
    cls => cls === LIFE_CLASSES.EUKARYOTE.id,
  );
  strictEqual(hasEukaryote, true);

  // Catastrophe tool clears life at the impact site
  applyGodTool(state, config, 'meteor', 64, 32);
  strictEqual(state.lifeClass[centerIdx], LIFE_CLASS_NONE);
  strictEqual(state.lifePopulation[centerIdx], 0);
});

void test('stripLifeformBackgroundPixels removes cyan chroma-key and amphibian water backdrop without touching foreground', () => {
  // 2x2 sprite with cyan top row and interior-only blue bottom-left (not both bottom corners)
  const regularPixels = new Uint8ClampedArray([
    32, 200, 248, 255, 32, 200, 248, 255, 80, 80, 192, 255, 16, 16, 16, 255,
  ]);
  stripLifeformBackgroundPixels(regularPixels, 2, 2);
  strictEqual(regularPixels[3], 0);
  strictEqual(regularPixels[7], 0);
  strictEqual(regularPixels[11], 255); // preserved when not a full bottom-corner backdrop
  strictEqual(regularPixels[15], 255);

  // 2x2 amphibian-style sprite with cyan top and blue water across both bottom corners
  const amphibianPixels = new Uint8ClampedArray([
    32, 200, 248, 255, 160, 160, 160, 255, 80, 80, 192, 255, 80, 80, 192, 255,
  ]);
  stripLifeformBackgroundPixels(amphibianPixels, 2, 2);
  strictEqual(amphibianPixels[3], 0);
  strictEqual(amphibianPixels[7], 255); // grey body preserved
  strictEqual(amphibianPixels[11], 0);
  strictEqual(amphibianPixels[15], 0);
});

void test('centerCameraOnGridCell centers target cell at requested zoom including longitude wrap', () => {
  const centered = centerCameraOnGridCell(42, 30, 4);
  strictEqual(centered.zoom, 4);
  deepStrictEqual(viewportToGridCoords(0.5, 0.5, centered), {x: 42, y: 30});

  // Near the international date line (x=0), panX wraps around and cell x=0 stays centered
  const wrapped = centerCameraOnGridCell(0, 32, 4);
  strictEqual(wrapped.zoom, 4);
  deepStrictEqual(viewportToGridCoords(0.5, 0.5, wrapped), {x: 0, y: 32});
});

void test('createMapPixels filters life layer cells using visibleLifeClasses', () => {
  const state = createSimulationState();
  const config = createSimulationConfig();
  state.elevation[0] = -1_000;
  state.lifeClass[0] = LIFE_CLASSES.FISH.id;
  state.lifePopulation[0] = 0.8;

  // Included in filter -> renders FISH color
  const shown = createMapPixels(
    state,
    config,
    'life',
    new Set([LIFE_CLASSES.FISH.id]),
  );
  deepStrictEqual(Array.from(shown.slice(0, 4)), [
    ...LIFE_CLASSES.FISH.color,
    255,
  ]);

  // Excluded from filter -> falls back to ocean backdrop color
  const hidden = createMapPixels(
    state,
    config,
    'life',
    new Set([LIFE_CLASSES.MAMMAL.id]),
  );
  deepStrictEqual(Array.from(hidden.slice(0, 4)), [15, 23, 42, 255]);
});

void test('createCameraFlight glides shortest wrapped longitude path with a midpoint zoom-out arc', () => {
  // Start zoomed at 4x on x=122, fly across the 180° seam to x=4 (only 10 tiles east, not 118 tiles west)
  const start = centerCameraOnGridCell(122, 32, 4);
  const shortSeam = createCameraFlight(start, 4, 32, 4);
  strictEqual(shortSeam.deltaX > 0 && shortSeam.deltaX < 12 * 16, true);
  deepStrictEqual(
    viewportToGridCoords(0.5, 0.5, sampleCameraFlight(shortSeam, 1)),
    {x: 4, y: 32},
  );

  // Opposite-hemisphere hop while zoomed in dips zoom smoothly at midpoint, then lands at 4x
  const crossGlobe = createCameraFlight(start, 58, 32, 4);
  const midCam = sampleCameraFlight(crossGlobe, 0.5);
  const endCam = sampleCameraFlight(crossGlobe, 1);
  strictEqual(midCam.zoom < 3, true);
  strictEqual(endCam.zoom, 4);
  deepStrictEqual(viewportToGridCoords(0.5, 0.5, endCam), {x: 58, y: 32});
});
