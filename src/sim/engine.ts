import {
  BIOMES,
  CELL_COUNT,
  GRID_HEIGHT,
  GRID_WIDTH,
  LIFE_CLASS_NONE,
  LIFE_CLASSES,
  LIFE_CLASSES_BY_ID,
  MAX_SPECIES_LEVEL,
  resolveHabitatZone,
  SUITABILITY_MULTIPLIERS,
} from './constants';
import type {BiomeId, HabitatZone, LifeClassDefinition} from './constants';
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
      state.lifeClass[idx] = LIFE_CLASS_NONE;
      state.lifeSpecies[idx] = 0;
      state.lifePopulation[idx] = 0;
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

  // Seed primordial prokaryote pockets in equatorial ocean/deep-sea cells (manual p. 133).
  if (type !== 'daisyworld') {
    const deepCandidates: number[] = [];
    const fallbackCandidates: number[] = [];
    for (let y = 20; y <= 44; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const idx = getIdx(x, y);
        const zone = resolveHabitatZone(
          state.biome[idx],
          state.elevation[idx],
          seaBase,
        );
        if (zone === 'ocean' || zone === 'deep_sea') {
          deepCandidates.push(idx);
        } else if (zone === 'shelf') {
          fallbackCandidates.push(idx);
        }
      }
    }
    const candidates =
      deepCandidates.length > 0 ? deepCandidates : fallbackCandidates;
    const seedCount = Math.min(3, candidates.length);
    for (let s = 0; s < seedCount; s++) {
      const pick = Math.floor(random() * candidates.length);
      const idx = candidates[pick];
      state.lifeClass[idx] = LIFE_CLASSES.PROKARYOTE.id;
      state.lifeSpecies[idx] = 1;
      state.lifePopulation[idx] = 0.5;
    }
  }

  return calculateMetrics(state, config, [], [], []);
}

/**
 * Advance one 10-year tick in temperature, moisture, daisy, biome, then life order.
 * Mutates only model data and returns metrics for the UI to render.
 */
export function simulationStep(
  state: SimulationState,
  config: SimulationConfig,
  temperatureHistory: number[] = [],
  whiteDaisyHistory: number[] = [],
  blackDaisyHistory: number[] = [],
  random: () => number = Math.random,
): SimulationMetrics {
  config.year += 10;

  const seaLevel = BASE_SEA_LEVEL + config.seaLevelOffset;
  // The prototype applies a linear 1.2°C change per 100 ppm relative to 350 ppm.
  const co2Effect = ((config.co2Ppm - 350) / 100) * 1.2;
  updateTemperature(state, seaLevel, config.solarLuminosity, co2Effect);
  updateWindVectors(state, seaLevel);
  updateMoisture(state, seaLevel);
  updateDaisies(state, seaLevel);

  classifyBiomes(state, config);
  updateLife(state, config, random);
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

/**
 * Compute Hadley (0-30°), Ferrel (30-60°), and Polar (60-90°) circulation cells
 * with terrain-gradient deflection over land.
 * +windX is eastward, +windY is southward (increasing grid y).
 */
export function updateWindVectors(
  state: SimulationState,
  seaLevel: number,
): void {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const latitudeDeg = 90 - (y / (GRID_HEIGHT - 1)) * 180;
    const absLat = Math.abs(latitudeDeg);
    const signLat = latitudeDeg >= 0 ? 1 : -1;

    // Zonal wind (u): Trade winds (<30°, westward), Westerlies (30-60°, eastward), Polar easterlies (>60°, westward)
    const zonalBase =
      absLat < 30
        ? -Math.sin(((30 - absLat) / 30) * Math.PI) * 8
        : absLat < 60
          ? Math.sin(((absLat - 30) / 30) * Math.PI) * 8
          : -Math.sin(((absLat - 60) / 30) * Math.PI) * 7;
    // Meridional wind (v): equatorward in Hadley (<30°) and Polar (>60°) cells, poleward in Ferrel (30-60°) cell
    const meridionalBase = Math.sin((absLat * Math.PI) / 30) * 3 * signLat;

    for (let x = 0; x < GRID_WIDTH; x++) {
      const idx = getIdx(x, y);
      let u = zonalBase;
      let v = meridionalBase;

      if (state.elevation[idx] > seaLevel) {
        const eastElev = Math.max(seaLevel, state.elevation[getIdx(x + 1, y)]);
        const westElev = Math.max(seaLevel, state.elevation[getIdx(x - 1, y)]);
        const southElev = Math.max(seaLevel, state.elevation[getIdx(x, y + 1)]);
        const northElev = Math.max(seaLevel, state.elevation[getIdx(x, y - 1)]);
        // Orographic barrier deflection away from steep uphill slopes
        u -= ((eastElev - westElev) / 2_000) * 1.5;
        v -= ((southElev - northElev) / 2_000) * 1.5;
      }

      state.windX[idx] = u;
      state.windY[idx] = v;
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

/** Kept as a named prototype operation; it updates wind vectors and reclassifies existing temperature/moisture. */
export function recalculateClimate(
  state: SimulationState,
  config: SimulationConfig,
): void {
  const seaLevel = BASE_SEA_LEVEL + config.seaLevelOffset;
  updateWindVectors(state, seaLevel);
  classifyBiomes(state, config);
}

/** Return habitat suitability (`0`, `0.25`, `0.6`, or `1.0`) from the Page 141 chart + O₂/temp gates. */
export function getLifeHabitatSuitability(
  def: LifeClassDefinition,
  zone: HabitatZone,
  temperatureC: number,
  o2Pct: number,
): number {
  if (o2Pct < def.minO2Pct) return 0;
  if (temperatureC < def.minTempC || temperatureC > def.maxTempC) return 0;
  return SUITABILITY_MULTIPLIERS[def.habitatPreferences[zone]];
}

const BASE_PLANETARY_ADVANCEMENT_RATE = 0.08;
const BASE_PLANETARY_SENTIENCE_RATE = 0.004;

/**
 * Compute the per-cell probability that a cell of `(def, species)` advances to
 * `species + 1` on a tick. Dividing by `classCellCount` keeps the planetary
 * expected advancement rate bounded while still rewarding larger populations.
 */
export function computeSpeciesAdvancementProb(
  def: LifeClassDefinition,
  species: number,
  classCellCount: number,
): number {
  if (species >= MAX_SPECIES_LEVEL || classCellCount <= 0) return 0;
  const popFactor = Math.min(1, Math.sqrt(classCellCount / 160));
  if (species === MAX_SPECIES_LEVEL - 1) {
    return (
      (BASE_PLANETARY_SENTIENCE_RATE * popFactor * def.sentienceRate) /
      classCellCount
    );
  }
  const speciesFactor = species <= 8 ? 1.0 : species <= 12 ? 0.65 : 0.35;
  return (
    (BASE_PLANETARY_ADVANCEMENT_RATE *
      popFactor *
      def.advancementRate *
      speciesFactor) /
    classCellCount
  );
}

/** Return all child classes reachable by mutation from `(def, species)`. */
export function getEligibleMutations(
  def: LifeClassDefinition,
  species: number,
): LifeClassDefinition[] {
  const result: LifeClassDefinition[] = [];
  for (const mutation of def.mutations) {
    if (species >= mutation.minSpecies && species <= mutation.maxSpecies) {
      const child = LIFE_CLASSES_BY_ID.get(mutation.toClassId);
      if (child) result.push(child);
    }
  }
  return result;
}

function isVegetatedLandZone(zone: HabitatZone): boolean {
  return (
    zone === 'boreal' ||
    zone === 'desert' ||
    zone === 'grass' ||
    zone === 'forest' ||
    zone === 'jungle' ||
    zone === 'swamp'
  );
}

function lifeAdvancementScore(
  def: LifeClassDefinition,
  species: number,
): number {
  return def.competitionRank * 20 + species;
}

interface NeighborhoodTrophicSummary {
  marineProducerPop: number;
  fishPreyPop: number;
  cetaceanPreyPop: number;
  insectPop: number;
  earlyInsectCells: number;
}

function sampleNeighborhoodTrophic(
  prevClass: Uint8Array,
  prevSpecies: Uint8Array,
  prevPop: Float32Array,
  cx: number,
  cy: number,
): NeighborhoodTrophicSummary {
  let marineProducerPop = 0;
  let fishPreyPop = 0;
  let cetaceanPreyPop = 0;
  let insectPop = 0;
  let earlyInsectCells = 0;

  for (let dy = -2; dy <= 2; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= GRID_HEIGHT) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const nIdx = getIdx(cx + dx, ny);
      const cls = prevClass[nIdx];
      if (cls === LIFE_CLASS_NONE) continue;
      const pop = prevPop[nIdx];
      if (pop < 0.05) continue;

      if (
        cls === LIFE_CLASSES.PROKARYOTE.id ||
        cls === LIFE_CLASSES.EUKARYOTE.id
      ) {
        marineProducerPop += pop;
        fishPreyPop += pop;
      } else if (
        cls === LIFE_CLASSES.RADIATE.id ||
        cls === LIFE_CLASSES.ARTHROPOD.id ||
        cls === LIFE_CLASSES.MOLLUSK.id
      ) {
        fishPreyPop += pop;
        if (cls !== LIFE_CLASSES.RADIATE.id) {
          cetaceanPreyPop += pop;
        }
      } else if (cls === LIFE_CLASSES.FISH.id) {
        cetaceanPreyPop += pop;
      } else if (cls === LIFE_CLASSES.INSECT.id) {
        insectPop += pop;
        const sp = prevSpecies[nIdx];
        if (sp >= 1 && sp <= 4) {
          earlyInsectCells++;
        }
      }
    }
  }

  return {
    marineProducerPop,
    fishPreyPop,
    cetaceanPreyPop,
    insectPop,
    earlyInsectCells,
  };
}

/**
 * Advance per-cell lifeform growth, species advancement (`1..16`), slot-gated
 * multi-parent mutation, Carnifern co-evolution, trophic food-chain carrying
 * capacity, competition, and Eukaryote/plant O₂ photosynthesis.
 */
export function updateLife(
  state: SimulationState,
  config: SimulationConfig,
  random: () => number = Math.random,
): void {
  const seaLevel = BASE_SEA_LEVEL + config.seaLevelOffset;
  const prevClass = new Uint8Array(state.lifeClass);
  const prevSpecies = new Uint8Array(state.lifeSpecies);
  const prevPop = new Float32Array(state.lifePopulation);

  // Precompute habitat zones and global class cell counts once per tick.
  const zones: HabitatZone[] = new Array<HabitatZone>(CELL_COUNT);
  const classCellCounts = new Int32Array(16);
  let plantBiomeCount = 0;

  for (let i = 0; i < CELL_COUNT; i++) {
    const zone = resolveHabitatZone(
      state.biome[i],
      state.elevation[i],
      seaLevel,
    );
    zones[i] = zone;
    if (
      zone === 'boreal' ||
      zone === 'grass' ||
      zone === 'forest' ||
      zone === 'jungle' ||
      zone === 'swamp'
    ) {
      plantBiomeCount++;
    }
    const cls = prevClass[i];
    if (cls !== LIFE_CLASS_NONE && prevPop[i] >= 0.05) {
      classCellCounts[cls]++;
    }
  }

  const globalMarineProducerFrac =
    (classCellCounts[LIFE_CLASSES.PROKARYOTE.id] +
      classCellCounts[LIFE_CLASSES.EUKARYOTE.id]) /
    CELL_COUNT;
  const globalMarinePreyFrac =
    globalMarineProducerFrac +
    (classCellCounts[LIFE_CLASSES.RADIATE.id] +
      classCellCounts[LIFE_CLASSES.ARTHROPOD.id] +
      classCellCounts[LIFE_CLASSES.MOLLUSK.id]) /
      CELL_COUNT;
  const globalCetaceanPreyFrac =
    (classCellCounts[LIFE_CLASSES.ARTHROPOD.id] +
      classCellCounts[LIFE_CLASSES.MOLLUSK.id] +
      classCellCounts[LIFE_CLASSES.FISH.id]) /
    CELL_COUNT;

  let eukaryotePopSum = 0;
  let animalPopSum = 0;

  // Pass 1: trophic growth/decline, species advancement, in-place mutation, & Carnifern co-evolution.
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const i = y * GRID_WIDTH + x;
      const zone = zones[i];
      const temp = state.temperature[i];
      const cls = prevClass[i];

      if (cls === LIFE_CLASS_NONE) {
        // Carnifern co-evolution from vegetated land plants in the presence of Insects 1–4.
        if (
          isVegetatedLandZone(zone) &&
          classCellCounts[LIFE_CLASSES.INSECT.id] >= 2 &&
          getLifeHabitatSuitability(
            LIFE_CLASSES.CARNIFERN,
            zone,
            temp,
            config.o2Pct,
          ) > 0
        ) {
          const trophic = sampleNeighborhoodTrophic(
            prevClass,
            prevSpecies,
            prevPop,
            x,
            y,
          );
          if (trophic.earlyInsectCells >= 2 && random() < 0.012) {
            state.lifeClass[i] = LIFE_CLASSES.CARNIFERN.id;
            state.lifeSpecies[i] = 1;
            state.lifePopulation[i] = 0.3;
          }
        }
        continue;
      }

      const def = LIFE_CLASSES_BY_ID.get(cls);
      if (!def) continue;

      const pop = prevPop[i];
      const species = Math.max(1, prevSpecies[i]);
      const baseSuit = getLifeHabitatSuitability(def, zone, temp, config.o2Pct);

      // Compute trophic food-chain factor for consumers and Carniferns.
      let effectiveCapacity = baseSuit;
      if (baseSuit > 0) {
        if (def.trophicTier === 2) {
          if (zone === 'shelf' || zone === 'ocean' || zone === 'deep_sea') {
            const trophic = sampleNeighborhoodTrophic(
              prevClass,
              prevSpecies,
              prevPop,
              x,
              y,
            );
            const food = Math.min(
              1,
              0.35 +
                trophic.marineProducerPop * 0.25 +
                globalMarineProducerFrac * 2.0,
            );
            effectiveCapacity = baseSuit * food;
          }
        } else if (def.trophicTier === 3) {
          if (
            cls === LIFE_CLASSES.AMPHIBIAN.id ||
            cls === LIFE_CLASSES.REPTILE.id ||
            cls === LIFE_CLASSES.AVIAN.id
          ) {
            const trophic = sampleNeighborhoodTrophic(
              prevClass,
              prevSpecies,
              prevPop,
              x,
              y,
            );
            const insectBonus = Math.min(1, trophic.insectPop * 0.5);
            effectiveCapacity = baseSuit * (0.8 + 0.2 * insectBonus);
          }
        } else if (def.trophicTier === 4) {
          if (cls === LIFE_CLASSES.FISH.id) {
            const trophic = sampleNeighborhoodTrophic(
              prevClass,
              prevSpecies,
              prevPop,
              x,
              y,
            );
            const food = Math.min(
              1,
              0.35 + trophic.fishPreyPop * 0.25 + globalMarinePreyFrac * 2.5,
            );
            effectiveCapacity = baseSuit * food;
          } else if (
            cls === LIFE_CLASSES.CETACEAN.id &&
            (zone === 'shelf' || zone === 'ocean')
          ) {
            const trophic = sampleNeighborhoodTrophic(
              prevClass,
              prevSpecies,
              prevPop,
              x,
              y,
            );
            const food = Math.min(
              1,
              0.35 +
                trophic.cetaceanPreyPop * 0.25 +
                globalCetaceanPreyFrac * 2.5,
            );
            effectiveCapacity = baseSuit * food;
          }
        } else if (def.trophicTier === 5) {
          // Carniferns strictly depend on nearby Insect prey (manual pp. 139, 141).
          const trophic = sampleNeighborhoodTrophic(
            prevClass,
            prevSpecies,
            prevPop,
            x,
            y,
          );
          const food = Math.min(1, trophic.insectPop * 0.6);
          effectiveCapacity = Math.min(1, baseSuit + 0.55) * food;
        }
      }

      if (effectiveCapacity > 0.05) {
        let nextPop =
          pop <= effectiveCapacity
            ? Math.min(
                effectiveCapacity,
                pop +
                  0.18 *
                    effectiveCapacity *
                    pop *
                    Math.max(0, 1 - pop / effectiveCapacity) +
                  0.04 * effectiveCapacity,
              )
            : pop + (effectiveCapacity - pop) * 0.18;
        nextPop = Math.min(1, Math.max(0.05, nextPop));
        state.lifePopulation[i] = nextPop;

        // Within-class species Advancement (1..16), planetary-rate normalized (manual pp. 133, 135).
        let nextSpecies = species;
        if (nextPop >= 0.35 && species < MAX_SPECIES_LEVEL) {
          const advanceProb = computeSpeciesAdvancementProb(
            def,
            species,
            classCellCounts[cls],
          );
          if (advanceProb > 0 && random() < advanceProb) {
            nextSpecies = species + 1;
            state.lifeSpecies[i] = nextSpecies;
          }
        }

        // Slot-gated in-place Mutation into an eligible child class (spawns at species 1).
        if (nextPop >= 0.4) {
          const children = getEligibleMutations(def, nextSpecies);
          if (children.length > 0) {
            const eligible = children.filter(
              child =>
                getLifeHabitatSuitability(child, zone, temp, config.o2Pct) > 0,
            );
            const mutationProb =
              def.domain === 'sea' && zone === 'shelf' ? 0.025 : 0.008;
            if (eligible.length > 0 && random() < mutationProb) {
              const chosen = eligible[Math.floor(random() * eligible.length)];
              state.lifeClass[i] = chosen.id;
              state.lifeSpecies[i] = 1;
              state.lifePopulation[i] = Math.max(0.3, nextPop * 0.6);
            }
          }
        }

        if (cls === LIFE_CLASSES.EUKARYOTE.id) {
          eukaryotePopSum += nextPop;
        } else if (cls >= LIFE_CLASSES.RADIATE.id) {
          animalPopSum += nextPop;
        }
      } else {
        const nextPop = pop - 0.25;
        if (nextPop < 0.05) {
          state.lifeClass[i] = LIFE_CLASS_NONE;
          state.lifeSpecies[i] = 0;
          state.lifePopulation[i] = 0;
        } else {
          state.lifePopulation[i] = nextPop;
        }
      }
    }
  }

  // Pass 2: migration, neighbor-colonization mutation, and competition (manual p. 134).
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const i = y * GRID_WIDTH + x;
      const cls = prevClass[i];
      if (cls === LIFE_CLASS_NONE || prevPop[i] < 0.25) continue;
      const def = LIFE_CLASSES_BY_ID.get(cls);
      if (!def) continue;
      const species = Math.max(1, prevSpecies[i]);
      const children = getEligibleMutations(def, species);

      const neighbors = [
        getIdx(x - 1, y),
        getIdx(x + 1, y),
        getIdx(x, y - 1),
        getIdx(x, y + 1),
      ];
      for (const nIdx of neighbors) {
        const nClass = state.lifeClass[nIdx];
        const nZone = zones[nIdx];
        const nTemp = state.temperature[nIdx];
        const suit = getLifeHabitatSuitability(def, nZone, nTemp, config.o2Pct);

        if (nClass === LIFE_CLASS_NONE) {
          // Cross-habitat mutation into empty neighbor (e.g., Arthropod -> Insect, Fish -> Amphibian, Mammal <-> Cetacean).
          if (prevPop[i] >= 0.45 && children.length > 0) {
            const eligible = children.filter(
              child =>
                getLifeHabitatSuitability(child, nZone, nTemp, config.o2Pct) >
                0,
            );
            const crossProb = nZone === 'shelf' ? 0.025 : 0.015;
            if (eligible.length > 0 && random() < crossProb) {
              const chosen = eligible[Math.floor(random() * eligible.length)];
              state.lifeClass[nIdx] = chosen.id;
              state.lifeSpecies[nIdx] = 1;
              state.lifePopulation[nIdx] = 0.25;
              continue;
            }
          }
          if (suit > 0 && random() < 0.18 * suit) {
            state.lifeClass[nIdx] = def.id;
            state.lifeSpecies[nIdx] = species;
            state.lifePopulation[nIdx] = 0.2;
          }
        } else if (nClass !== def.id && suit >= 0.6) {
          const nDef = LIFE_CLASSES_BY_ID.get(nClass);
          if (
            nDef &&
            lifeAdvancementScore(def, species) >
              lifeAdvancementScore(nDef, state.lifeSpecies[nIdx]) &&
            random() < 0.06
          ) {
            state.lifeClass[nIdx] = def.id;
            state.lifeSpecies[nIdx] = species;
            state.lifePopulation[nIdx] = 0.25;
          }
        }
      }
    }
  }

  // Pass 3: Eukaryote & land plant biome photosynthesis O₂ coupling (manual p. 136).
  const eukaryoteFrac = eukaryotePopSum / CELL_COUNT;
  const plantFrac = plantBiomeCount / CELL_COUNT;
  const animalFrac = animalPopSum / CELL_COUNT;
  const o2Production =
    (eukaryoteFrac * 1.4 + plantFrac * 0.25) * config.solarLuminosity;
  const o2Consumption = animalFrac * 0.15;
  const oxidationSink = config.o2Pct > 21 ? (config.o2Pct - 21) * 0.02 : 0;
  config.o2Pct = Math.max(
    0,
    Math.min(40, config.o2Pct + o2Production - o2Consumption - oxidationSink),
  );
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
  let inhabitedCount = 0;
  const lifeClassCounts: Record<number, number> = {};
  const lifeClassMaxSpecies: Record<number, number> = {};
  const lifeClassSampleCoords: Record<number, {x: number; y: number}> = {};
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
    const lifeCls = state.lifeClass[i];
    if (lifeCls !== LIFE_CLASS_NONE && state.lifePopulation[i] >= 0.05) {
      inhabitedCount++;
      lifeClassCounts[lifeCls] = (lifeClassCounts[lifeCls] ?? 0) + 1;
      const sp = Math.max(1, state.lifeSpecies[i]);
      const prevMax = lifeClassMaxSpecies[lifeCls] ?? 0;
      if (sp > prevMax) {
        lifeClassMaxSpecies[lifeCls] = sp;
        lifeClassSampleCoords[lifeCls] = {
          x: i % GRID_WIDTH,
          y: Math.floor(i / GRID_WIDTH),
        };
      }
    }
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
    lifeCoveragePct: Math.round((inhabitedCount / CELL_COUNT) * 100),
    lifeClassCounts,
    lifeClassMaxSpecies,
    lifeClassSampleCoords,
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
      const seaLevel = BASE_SEA_LEVEL + config.seaLevelOffset;
      if (tool === 'volcano') {
        state.elevation[idx] +=
          (radius - dist) * VOLCANO_UPLIFT_METERS_PER_RADIUS;
        state.temperature[idx] += 15;
        state.lifeClass[idx] = LIFE_CLASS_NONE;
        state.lifeSpecies[idx] = 0;
        state.lifePopulation[idx] = 0;
      } else if (tool === 'meteor') {
        state.elevation[idx] = Math.max(
          MIN_ELEVATION_METERS,
          state.elevation[idx] -
            (radius - dist) * METEOR_DEPTH_METERS_PER_RADIUS,
        );
        state.temperature[idx] += 30;
        state.lifeClass[idx] = LIFE_CLASS_NONE;
        state.lifeSpecies[idx] = 0;
        state.lifePopulation[idx] = 0;
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
        if (state.elevation[idx] > seaLevel) {
          state.daisyWhite[idx] = 0.8;
          state.daisyBlack[idx] = 0;
        }
      } else if (tool === 'daisy_black') {
        if (state.elevation[idx] > seaLevel) {
          state.daisyBlack[idx] = 0.8;
          state.daisyWhite[idx] = 0;
        }
      } else if (tool === 'seed_life') {
        const zone = resolveHabitatZone(
          state.biome[idx],
          state.elevation[idx],
          seaLevel,
        );
        if (
          getLifeHabitatSuitability(
            LIFE_CLASSES.PROKARYOTE,
            zone,
            state.temperature[idx],
            config.o2Pct,
          ) > 0
        ) {
          state.lifeClass[idx] = LIFE_CLASSES.PROKARYOTE.id;
          state.lifeSpecies[idx] = Math.max(1, state.lifeSpecies[idx]);
          state.lifePopulation[idx] = Math.max(state.lifePopulation[idx], 0.7);
        }
      } else if (tool === 'nuke') {
        state.temperature[idx] += 40;
        state.lifeClass[idx] = LIFE_CLASS_NONE;
        state.lifeSpecies[idx] = 0;
        state.lifePopulation[idx] = 0;
      }
    }
  }

  recalculateClimate(state, config);
}
