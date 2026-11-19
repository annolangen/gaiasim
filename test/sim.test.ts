import {deepStrictEqual, strictEqual} from 'node:assert';
import {test} from 'node:test';
import {
  createMapPixels,
  selectCellSprite,
  selectDaisySprite,
  selectLandTileIndex,
  selectOceanSprite,
} from '../src/map-renderer';
import type {SpriteSheet} from '../src/map-renderer';
import {
  BIOMES,
  createSimulationConfig,
  createSimulationState,
  GRID_HEIGHT,
  GRID_WIDTH,
} from '../src/sim/constants';
import {
  applyGodTool,
  classifyBiomes,
  generatePlanet,
  getIdx,
  simulationStep,
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
