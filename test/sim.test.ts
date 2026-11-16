import {strictEqual} from 'node:assert';
import {test} from 'node:test';
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
