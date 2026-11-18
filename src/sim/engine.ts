import {BIOMES, CELL_COUNT, GRID_HEIGHT, GRID_WIDTH} from './constants';
import type {BiomeId} from './constants';
import {noise2D} from './noise';
import type {
  GodTool,
  PlanetType,
  SimulationConfig,
  SimulationMetrics,
  SimulationState,
} from './types';

const BASE_SEA_LEVEL = 0;
const MIN_ELEVATION_METERS = -11_000;
const MAX_ELEVATION_METERS = 9_000;
// ISA reference lapse rate, 6.5 °C/km.
// Source: https://en.wikipedia.org/wiki/Lapse_rate#Environmental_lapse_rate
const ALTITUDE_LAPSE_RATE_C_PER_METER = 0.0065;
// Provisional: orographic rainfall depends on moisture flux and terrain slope.
// Source: https://en.wikipedia.org/wiki/Orographic_precipitation#Cause
const RAINFALL_LOSS_PER_METER = 0.0058;
const VOLCANO_UPLIFT_METERS_PER_RADIUS = 1_000;
const METEOR_DEPTH_METERS_PER_RADIUS = 2_000;
const GOD_TOOL_ELEVATION_STEP_METERS = 1_000;

type ElevationGenerator = (x: number, y: number) => number;

function clampElevationMeters(elevation: number): number {
  return Math.max(
    MIN_ELEVATION_METERS,
    Math.min(MAX_ELEVATION_METERS, elevation),
  );
}

/** Two noise octaves with an equatorial bias form the earth-like continents. */
function generateEarthElevation(x: number, y: number): number {
  const nx = x / 15;
  const ny = y / 15;
  const latFactor =
    1 - Math.pow(Math.abs(y - GRID_HEIGHT / 2) / (GRID_HEIGHT / 2), 2) * 0.3;
  return clampElevationMeters(
    noise2D(nx, ny) * 8_308 * latFactor +
      noise2D(nx * 2, ny * 2) * 3_462 * latFactor +
      6_923 * latFactor -
      7_615,
  );
}

/** A single central landmass with noise added to its edge. */
function generatePangaeaElevation(x: number, y: number): number {
  const distFromCenter = Math.hypot(
    (x - GRID_WIDTH / 2) * 0.6,
    y - GRID_HEIGHT / 2,
  );
  return clampElevationMeters(
    (1 - distFromCenter / 30) * 12_462 +
      noise2D(x / 10, y / 10) * 4_154 -
      7_615,
  );
}

/** Higher-frequency noise produces a fragmented island pattern. */
const generateArchipelagoElevation = (x: number, y: number): number =>
  clampElevationMeters(
    noise2D(x / 6, y / 6) * 9_692 + noise2D(x / 2, y / 2) * 2_769 - 7_615,
  );

/** Low-relief surface for Daisyworld; elevations are meters relative to sea level. */
const generateDaisyworldElevation = (x: number, y: number): number =>
  clampElevationMeters(noise2D(x / 20, y / 20) * 400 + 200);

/** Resolves each preset to its per-cell terrain function. */
const ELEVATION_GENERATORS: Record<PlanetType, ElevationGenerator> = {
  earth: generateEarthElevation,
  pangaea: generatePangaeaElevation,
  archipelago: generateArchipelagoElevation,
  daisyworld: generateDaisyworldElevation,
};

/** Wrap longitude, clamp latitude to the poles, then flatten as row-major storage. */
export function getIdx(x: number, y: number): number {
  const wrappedX = ((x % GRID_WIDTH) + GRID_WIDTH) % GRID_WIDTH;
  const clampedY = Math.max(0, Math.min(GRID_HEIGHT - 1, y));
  return clampedY * GRID_WIDTH + wrappedX;
}

/**
 * Replace elevation and daisy coverage, reset the year, and reclassify biomes.
 * Temperature and moisture are retained until the next simulation tick.
 * The optional random source controls only Daisyworld's initial daisy placement.
 */
export function generatePlanet(
  state: SimulationState,
  config: SimulationConfig,
  type: PlanetType = 'earth',
  random: () => number = Math.random,
): SimulationMetrics {
  config.year = 0;
  const seaBase = BASE_SEA_LEVEL + config.seaLevelOffset;
  const generateElevation = ELEVATION_GENERATORS[type];

  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const idx = getIdx(x, y);
      state.daisyWhite[idx] = 0;
      state.daisyBlack[idx] = 0;
      const elev = generateElevation(x, y);

      if (type === 'daisyworld' && elev > seaBase) {
        // The second draw is conditional, giving black daisies an 18.75% seed chance.
        if (random() < 0.25) {
          state.daisyWhite[idx] = 0.6;
        } else {
          if (random() < 0.25) state.daisyBlack[idx] = 0.6;
        }
      }

      state.elevation[idx] = elev;
    }
  }

  recalculateClimate(state, config);
  return calculateMetrics(state, config, [], [], []);
}

/**
 * Advance one 10-year tick in temperature, moisture, daisy, then biome order.
 * Mutates only model data and returns metrics for the UI to render.
 */
export function simulationStep(
  state: SimulationState,
  config: SimulationConfig,
  temperatureHistory: number[] = [],
  whiteDaisyHistory: number[] = [],
  blackDaisyHistory: number[] = [],
): SimulationMetrics {
  config.year += 10;

  const seaLevel = BASE_SEA_LEVEL + config.seaLevelOffset;
  // The prototype applies a linear 1.2°C change per 100 ppm relative to 350 ppm.
  const co2Effect = ((config.co2Ppm - 350) / 100) * 1.2;
  updateTemperature(state, seaLevel, config.solarLuminosity, co2Effect);
  updateMoisture(state, seaLevel);
  updateDaisies(state, seaLevel);

  classifyBiomes(state, config);
  return calculateMetrics(
    state,
    config,
    temperatureHistory,
    whiteDaisyHistory,
    blackDaisyHistory,
  );
}

function updateTemperature(
  state: SimulationState,
  seaLevel: number,
  solar: number,
  co2Effect: number,
): void {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    // A cosine latitude profile interpolates solar-scaled pole and equator temperatures.
    const latNorm = Math.cos(
      ((y - GRID_HEIGHT / 2) / (GRID_HEIGHT / 2)) * (Math.PI / 2),
    );
    const baseEquatorTemp = 30 * solar;
    const basePoleTemp = -25 * solar;
    const latTemp = basePoleTemp + (baseEquatorTemp - basePoleTemp) * latNorm;

    for (let x = 0; x < GRID_WIDTH; x++) {
      const idx = getIdx(x, y);
      const elev = state.elevation[idx];
      const isWater = elev <= seaLevel;

      // Daisies alter bare-land albedo; water keeps its fixed low-albedo value.
      let albedo = isWater ? 0.08 : 0.25;
      if (!isWater) {
        const dw = state.daisyWhite[idx];
        const db = state.daisyBlack[idx];
        albedo = albedo * (1 - dw - db) + dw * 0.8 + db * 0.1;
      }

      const altitudeCooling = !isWater
        ? (elev - seaLevel) * ALTITUDE_LAPSE_RATE_C_PER_METER
        : 0;
      const targetTemp =
        latTemp + co2Effect - altitudeCooling + (1 - albedo * 1.5) * 8;
      // Ocean temperature relaxes four times slower than land temperature.
      const inertia = isWater ? 0.05 : 0.2;
      state.temperature[idx] += (targetTemp - state.temperature[idx]) * inertia;
    }
  }
}

function updateMoisture(state: SimulationState, seaLevel: number): void {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const idx = getIdx(x, y);
      const isWater = state.elevation[idx] <= seaLevel;
      const temp = state.temperature[idx];

      if (isWater) {
        state.moisture[idx] = Math.min(100, Math.max(30, temp * 2.8 + 20));
      } else {
        // Moisture moves west-to-east; rising terrain removes additional moisture.
        const westIdx = getIdx(x - 1, y);
        const westMoisture = state.moisture[westIdx];
        const elevDelta = Math.max(
          0,
          state.elevation[idx] - state.elevation[westIdx],
        );
        const rainout = elevDelta * RAINFALL_LOSS_PER_METER + 2;
        state.moisture[idx] = Math.max(
          5,
          westMoisture - rainout + (temp > 10 ? 2 : 0),
        );
      }
    }
  }
}

function updateDaisies(state: SimulationState, seaLevel: number): void {
  const prevWhite = new Float32Array(state.daisyWhite);
  const prevBlack = new Float32Array(state.daisyBlack);
  const deathRate = 0.1;
  const spreadRate = 0.03;

  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const i = getIdx(x, y);
      if (state.elevation[i] <= seaLevel) {
        state.daisyWhite[i] = 0;
        state.daisyBlack[i] = 0;
        continue;
      }

      const temperature = state.temperature[i];
      let growthRate = 0;
      // The quadratic response peaks at 22.5°C and is disabled outside 5-40°C.
      if (temperature > 5 && temperature < 40) {
        growthRate = 1 - 0.00326 * Math.pow(22.5 - temperature, 2);
      }

      const white = prevWhite[i];
      const black = prevBlack[i];
      const bareSpace = Math.max(0, 1 - white - black);

      let nextWhite = white + white * (bareSpace * growthRate - deathRate);
      let nextBlack = black + black * (bareSpace * growthRate - deathRate);

      // Seed bare habitable land from neighboring colonized cells.
      if (growthRate > deathRate && bareSpace > 0.05) {
        const neighbors = [
          getIdx(x - 1, y),
          getIdx(x + 1, y),
          getIdx(x, y - 1),
          getIdx(x, y + 1),
        ];
        let maxNeighborWhite = 0;
        let maxNeighborBlack = 0;
        for (const nIdx of neighbors) {
          if (prevWhite[nIdx] > maxNeighborWhite) {
            maxNeighborWhite = prevWhite[nIdx];
          }
          if (prevBlack[nIdx] > maxNeighborBlack) {
            maxNeighborBlack = prevBlack[nIdx];
          }
        }
        if (maxNeighborWhite > 0.1) {
          nextWhite += maxNeighborWhite * bareSpace * growthRate * spreadRate;
        }
        if (maxNeighborBlack > 0.1) {
          nextBlack += maxNeighborBlack * bareSpace * growthRate * spreadRate;
        }
      }

      nextWhite = nextWhite < 0.001 ? 0 : Math.min(1, nextWhite);
      nextBlack = nextBlack < 0.001 ? 0 : Math.min(1, nextBlack);
      const total = nextWhite + nextBlack;
      if (total > 1) {
        nextWhite /= total;
        nextBlack /= total;
      }

      state.daisyWhite[i] = nextWhite;
      state.daisyBlack[i] = nextBlack;
    }
  }
}

/**
 * Approximate treeline from latitude-band averages, mirrored across hemispheres.
 * Assume 0 m at 70 degrees and cap the equatorial threshold at 4,000 m.
 * Source: https://en.wikipedia.org/wiki/Alpine_tundra
 */
function alpineTreelineMeters(latitudeDegrees: number): number {
  const absoluteLatitude = Math.abs(latitudeDegrees);
  if (absoluteLatitude >= 70) return 0;
  if (absoluteLatitude >= 50) return (70 - absoluteLatitude) * 75;
  if (absoluteLatitude >= 30) {
    return Math.min(4_000, 1_500 + (50 - absoluteLatitude) * 130);
  }
  return 4_000;
}

/** Return the matching biome; narrow habitat conditions precede broader climate bands. */
function classifyBiome(
  elevation: number,
  temperature: number,
  rainfall: number,
  seaLevel: number,
  latitudeDegrees: number,
  axialTiltDegrees: number,
): BiomeId {
  const altitude = elevation - seaLevel;

  if (altitude <= 0) {
    return temperature <= -2 ? BIOMES.SEA_ICE.id : BIOMES.OCEAN.id;
  }
  const polarCapLatitude = 90 - axialTiltDegrees;
  if (Math.abs(latitudeDegrees) >= polarCapLatitude && temperature <= -2) {
    return BIOMES.SEA_ICE.id;
  }

  if (altitude >= alpineTreelineMeters(latitudeDegrees) && temperature < 5) {
    return BIOMES.ALPINE.id;
  }

  if (altitude <= 2 && temperature > 10 && rainfall > 120) {
    return BIOMES.SWAMP.id;
  }
  if (temperature > 10 && rainfall < 25) return BIOMES.DESERT.id;
  if (temperature > 22 && rainfall > 150) return BIOMES.JUNGLE.id;
  if (
    temperature >= 5 &&
    temperature <= 25 &&
    rainfall >= 75 &&
    rainfall <= 150
  ) {
    return BIOMES.FOREST.id;
  }
  if (
    temperature >= 5 &&
    temperature <= 30 &&
    rainfall >= 25 &&
    rainfall <= 75
  ) {
    return BIOMES.GRASSLAND.id;
  }
  if (
    temperature >= -10 &&
    temperature <= 5 &&
    rainfall >= 15 &&
    rainfall <= 60
  ) {
    return BIOMES.TUNDRA.id;
  }

  // TODO(plan.md section 3.A): specify a biome for land outside the matrix ranges.
  return temperature < 5 ? BIOMES.TUNDRA.id : BIOMES.GRASSLAND.id;
}

/** Assign one biome per cell using the matrix in plan.md, section 3.A. */
export function classifyBiomes(
  state: SimulationState,
  config: SimulationConfig,
): void {
  const seaLevel = BASE_SEA_LEVEL + config.seaLevelOffset;

  for (let i = 0; i < CELL_COUNT; i++) {
    const latitude =
      90 - (Math.floor(i / GRID_WIDTH) / (GRID_HEIGHT - 1)) * 180;
    state.biome[i] = classifyBiome(
      state.elevation[i],
      state.temperature[i],
      state.moisture[i],
      seaLevel,
      latitude,
      config.axialTiltDegrees,
    );
  }
}

/** Kept as a named prototype operation; it only reclassifies existing temperature/moisture. */
export function recalculateClimate(
  state: SimulationState,
  config: SimulationConfig,
): void {
  classifyBiomes(state, config);
}

/** Aggregate model outputs; the biomass band spans grassland through swamp. */
export function calculateMetrics(
  state: SimulationState,
  config: SimulationConfig,
  temperatureHistory: number[],
  whiteDaisyHistory: number[],
  blackDaisyHistory: number[],
): SimulationMetrics {
  let sumTemp = 0;
  let oceanCount = 0;
  let biomassCount = 0;
  let totalWhiteDaisies = 0;
  let totalBlackDaisies = 0;
  const seaLevel = BASE_SEA_LEVEL + config.seaLevelOffset;

  for (let i = 0; i < CELL_COUNT; i++) {
    sumTemp += state.temperature[i];
    if (state.elevation[i] <= seaLevel) oceanCount++;
    if (
      state.biome[i] >= BIOMES.GRASSLAND.id &&
      state.biome[i] <= BIOMES.SWAMP.id
    ) {
      biomassCount++;
    }
    totalWhiteDaisies += state.daisyWhite[i];
    totalBlackDaisies += state.daisyBlack[i];
  }
  const averageTemperatureC = sumTemp / CELL_COUNT;
  const whiteDaisyCoveragePct = (totalWhiteDaisies / CELL_COUNT) * 100;
  const blackDaisyCoveragePct = (totalBlackDaisies / CELL_COUNT) * 100;
  temperatureHistory.push(averageTemperatureC);
  whiteDaisyHistory.push(whiteDaisyCoveragePct);
  blackDaisyHistory.push(blackDaisyCoveragePct);
  return {
    averageTemperatureC,
    temperatureHistory: temperatureHistory.slice(-300),
    whiteDaisyHistory: whiteDaisyHistory.slice(-300),
    blackDaisyHistory: blackDaisyHistory.slice(-300),
    oceanCoveragePct: Math.round((oceanCount / CELL_COUNT) * 100),
    totalBiomassPct: Math.round((biomassCount / CELL_COUNT) * 100),
    whiteDaisyCoveragePct,
    blackDaisyCoveragePct,
  };
}

/**
 * Apply a radius-three circular brush in grid cells, then reclassify biomes.
 * Volcano/meteor effects taper with radius; other tools apply fixed per-cell changes.
 * Logging and redraws are intentionally left to the later UI layer.
 */
export function applyGodTool(
  state: SimulationState,
  config: SimulationConfig,
  tool: GodTool,
  gx: number,
  gy: number,
): void {
  if (tool === 'inspect') return;

  const radius = 3;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;

      const idx = getIdx(gx + dx, gy + dy);
      if (tool === 'volcano') {
        state.elevation[idx] +=
          (radius - dist) * VOLCANO_UPLIFT_METERS_PER_RADIUS;
        state.temperature[idx] += 15;
      } else if (tool === 'meteor') {
        state.elevation[idx] = Math.max(
          MIN_ELEVATION_METERS,
          state.elevation[idx] -
            (radius - dist) * METEOR_DEPTH_METERS_PER_RADIUS,
        );
        state.temperature[idx] += 30;
      } else if (tool === 'raise') {
        state.elevation[idx] = Math.min(
          MAX_ELEVATION_METERS,
          state.elevation[idx] + GOD_TOOL_ELEVATION_STEP_METERS,
        );
      } else if (tool === 'lower') {
        state.elevation[idx] = Math.max(
          MIN_ELEVATION_METERS,
          state.elevation[idx] - GOD_TOOL_ELEVATION_STEP_METERS,
        );
      } else if (tool === 'daisy_white') {
        if (state.elevation[idx] > BASE_SEA_LEVEL + config.seaLevelOffset) {
          state.daisyWhite[idx] = 0.8;
          state.daisyBlack[idx] = 0;
        }
      } else if (tool === 'daisy_black') {
        if (state.elevation[idx] > BASE_SEA_LEVEL + config.seaLevelOffset) {
          state.daisyBlack[idx] = 0.8;
          state.daisyWhite[idx] = 0;
        }
      } else if (tool === 'nuke') {
        state.temperature[idx] += 40;
      }
    }
  }

  recalculateClimate(state, config);
}
