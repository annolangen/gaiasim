import type {SimulationConfig, SimulationState, TimeScale} from './types';

export const GRID_WIDTH = 128;
export const GRID_HEIGHT = 64;
/** Number of entries required by each per-cell state buffer. */
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;

export interface TimeScaleDefinition {
  readonly id: TimeScale;
  readonly label: string;
  readonly yearsPerTick: number;
  readonly advancementMultiplier: number;
}

/** Simulation time scales following manual p. 100 and plan.md section 3.C.4. */
export const TIME_SCALES: Readonly<Record<TimeScale, TimeScaleDefinition>> = {
  geologic: {
    id: 'geologic',
    label: 'Geologic',
    yearsPerTick: 1_000_000,
    advancementMultiplier: 2.0,
  },
  evolution: {
    id: 'evolution',
    label: 'Evolution',
    yearsPerTick: 100_000,
    advancementMultiplier: 1.0,
  },
  civilized: {
    id: 'civilized',
    label: 'Civilized',
    yearsPerTick: 100,
    advancementMultiplier: 0.15,
  },
  technology: {
    id: 'technology',
    label: 'Technology',
    yearsPerTick: 1,
    advancementMultiplier: 0.02,
  },
  daisyworld: {
    id: 'daisyworld',
    label: 'Daisyworld',
    yearsPerTick: 10,
    advancementMultiplier: 1.0,
  },
};

/** Minimum atmospheric O₂ (%) required for vegetated land plant biomes to colonize rock. */
export const PLANT_BIOME_MIN_O2_PCT = 4;

interface BiomeDefinition {
  /** Stored in the state's `Uint8Array`; IDs must fit in one byte. */
  id: number;
  name: string;
  /** RGB color channels in the 0-to-255 range, for the later renderer. */
  color: readonly [number, number, number];
  /**
   * Static biome sprite stem in `sprites/biomes/<sprite>.png` and its matching
   * Page 141 habitat zone key. Omitted for ocean depth tiers and alpine rock.
   */
  sprite?: string;
}

/** Biome IDs follow plan.md section 3.A; RGB colors are for the later renderer. */
export const BIOMES = {
  OCEAN: {id: 0, name: 'Ocean', color: [30, 64, 175]},
  SEA_ICE: {
    id: 1,
    name: 'Sea Ice / Arctic',
    color: [226, 232, 240],
    sprite: 'arctic',
  },
  DESERT: {id: 2, name: 'Desert', color: [217, 119, 6], sprite: 'desert'},
  GRASSLAND: {
    id: 3,
    name: 'Grassland / Steppe',
    color: [234, 179, 8],
    sprite: 'grass',
  },
  FOREST: {
    id: 4,
    name: 'Forest (Deciduous)',
    color: [34, 197, 94],
    sprite: 'forest',
  },
  JUNGLE: {
    id: 5,
    name: 'Jungle (Rainforest)',
    color: [4, 120, 87],
    sprite: 'jungle',
  },
  SWAMP: {
    id: 6,
    name: 'Swamp / Marsh',
    color: [21, 128, 61],
    sprite: 'swamp',
  },
  TUNDRA: {id: 7, name: 'Tundra', color: [148, 163, 184], sprite: 'boreal'},
  ALPINE: {id: 8, name: 'Alpine / Rock', color: [100, 116, 139]},
} as const satisfies Record<string, BiomeDefinition>;

export type BiomeId = (typeof BIOMES)[keyof typeof BIOMES]['id'];

type StaticBiomeSprite = Extract<
  (typeof BIOMES)[keyof typeof BIOMES],
  {sprite: string}
>['sprite'];

/** Eleven habitat columns from the manual p. 141 Chart of Life Classes and Preferred Biomes. */
export type HabitatZone =
  'shelf' | 'ocean' | 'deep_sea' | 'rock' | StaticBiomeSprite;

/** Four-tier Page 141 suitability rating: 0=cannot exist, 1=barely, 2=fairly well, 3=paradise. */
export type SuitabilityRating = 0 | 1 | 2 | 3;

/** Maps Page 141 suitability ratings (0..3) to base carrying-capacity / growth multipliers. */
export const SUITABILITY_MULTIPLIERS: readonly [
  number,
  number,
  number,
  number,
] = [0, 0.25, 0.6, 1.0];

/** Ocean depth tier thresholds from manual p. 133 (meters below sea level). */
export const SHELF_MAX_DEPTH_METERS = 1_000;
export const OCEAN_MAX_DEPTH_METERS = 2_500;

const LAND_HABITAT_BY_BIOME_ID = new Map<number, HabitatZone>(
  Object.values(BIOMES)
    .filter((b): b is typeof b & {sprite: StaticBiomeSprite} => 'sprite' in b)
    .map(b => [b.id, b.sprite]),
);

/** Resolve a grid cell's biome & elevation to one of the 11 Page 141 habitat zones. */
export function resolveHabitatZone(
  biomeId: number,
  elevation: number,
  seaLevel: number,
): HabitatZone {
  if (biomeId === BIOMES.OCEAN.id) {
    const depth = seaLevel - elevation;
    if (depth <= SHELF_MAX_DEPTH_METERS) return 'shelf';
    if (depth <= OCEAN_MAX_DEPTH_METERS) return 'ocean';
    return 'deep_sea';
  }
  return LAND_HABITAT_BY_BIOME_ID.get(biomeId) ?? 'rock';
}

export const LIFE_CLASS_NONE = 0;
export const MAX_SPECIES_LEVEL = 16;

export interface EvolutionLink {
  readonly fromClassId: number;
  readonly minSpecies: number;
  readonly maxSpecies: number;
}

export interface OutgoingMutation {
  readonly toClassId: number;
  readonly minSpecies: number;
  readonly maxSpecies: number;
}

export interface CoEvolutionRule {
  readonly companionClassId: number;
  readonly minSpecies: number;
  readonly maxSpecies: number;
}

export interface LifeClassDefinition {
  /** Stored in `SimulationState.lifeClass`; `0` means uninhabited. */
  readonly id: number;
  readonly name: string;
  readonly domain: 'sea' | 'land';
  /** Folder name under `public/sprites/lifeforms/<sprite>/species_<n>/`. */
  readonly sprite: string;
  /** Trophic tier (0=pioneer, 1=producer, 2=marine grazer, 3=land consumer, 4=marine predator, 5=insectivorous plant). */
  readonly trophicTier: 0 | 1 | 2 | 3 | 4 | 5;
  /** Relative evolutionary rank used for cell competition (manual p. 134). */
  readonly competitionRank: number;
  /** Ancestor class & species-slot ranges capable of mutating into this class. */
  readonly evolvesFrom: readonly EvolutionLink[];
  /** Outgoing mutations from species slots `minSpecies..maxSpecies` into child classes. */
  readonly mutations: readonly OutgoingMutation[];
  /** Optional co-evolution requirement (Carnifern co-evolves from plants with Insects 1-4). */
  readonly coEvolvesFrom?: CoEvolutionRule;
  /** Relative planetary rate multiplier for species advancement through `1..15`. */
  readonly advancementRate: number;
  /** Relative planetary multiplier for achieving Sentience (`15 -> 16`); `0` requires external help. */
  readonly sentienceRate: number;
  /** Provisional GaiaSim minimum atmospheric O₂ percentage. */
  readonly minO2Pct: number;
  /** Provisional GaiaSim livable temperature range (°C). */
  readonly minTempC: number;
  readonly maxTempC: number;
  /** Direct transcription of the manual p. 141 Chart of Life Classes and Preferred Biomes. */
  readonly habitatPreferences: Readonly<Record<HabitatZone, SuitabilityRating>>;
  /** Fallback RGB color for pixel-buffer rendering when sprites are not loaded. */
  readonly color: readonly [number, number, number];
}

/** Whether a life class can be manually placed (false for co-evolving Carniferns). */
export function canPlaceLifeClassManually(def: LifeClassDefinition): boolean {
  return !def.coEvolvesFrom;
}

/** All 15 taxonomic life classes following manual pp. 135–141 and plan.md section 3.B. */
export const LIFE_CLASSES = {
  PROKARYOTE: {
    id: 1,
    name: 'Prokaryote',
    domain: 'sea',
    sprite: 'bacteria',
    trophicTier: 0,
    competitionRank: 1,
    evolvesFrom: [],
    mutations: [{toClassId: 2, minSpecies: 9, maxSpecies: 16}],
    advancementRate: 1.8,
    sentienceRate: 0,
    minO2Pct: 0,
    minTempC: -5,
    maxTempC: 85,
    habitatPreferences: {
      shelf: 3,
      ocean: 3,
      deep_sea: 3,
      rock: 0,
      arctic: 0,
      boreal: 0,
      desert: 0,
      grass: 0,
      forest: 0,
      jungle: 0,
      swamp: 0,
    },
    color: [163, 230, 53],
  },
  EUKARYOTE: {
    id: 2,
    name: 'Eukaryote',
    domain: 'sea',
    sprite: 'amoeba',
    trophicTier: 1,
    competitionRank: 2,
    evolvesFrom: [{fromClassId: 1, minSpecies: 9, maxSpecies: 16}],
    mutations: [{toClassId: 3, minSpecies: 13, maxSpecies: 16}],
    advancementRate: 2.0,
    sentienceRate: 0,
    minO2Pct: 0,
    minTempC: 0,
    maxTempC: 50,
    habitatPreferences: {
      shelf: 3,
      ocean: 3,
      deep_sea: 3,
      rock: 0,
      arctic: 0,
      boreal: 0,
      desert: 0,
      grass: 0,
      forest: 0,
      jungle: 0,
      swamp: 0,
    },
    color: [52, 211, 153],
  },
  RADIATE: {
    id: 3,
    name: 'Radiate',
    domain: 'sea',
    sprite: 'starfish',
    trophicTier: 2,
    competitionRank: 3,
    evolvesFrom: [{fromClassId: 2, minSpecies: 13, maxSpecies: 16}],
    mutations: [
      {toClassId: 4, minSpecies: 1, maxSpecies: 8},
      {toClassId: 8, minSpecies: 9, maxSpecies: 12},
    ],
    advancementRate: 0.9,
    sentienceRate: 0,
    minO2Pct: 2,
    minTempC: 2,
    maxTempC: 40,
    habitatPreferences: {
      shelf: 3,
      ocean: 3,
      deep_sea: 2,
      rock: 0,
      arctic: 0,
      boreal: 0,
      desert: 0,
      grass: 0,
      forest: 0,
      jungle: 1,
      swamp: 1,
    },
    color: [244, 114, 182],
  },
  ARTHROPOD: {
    id: 4,
    name: 'Arthropod',
    domain: 'sea',
    sprite: 'crab',
    trophicTier: 2,
    competitionRank: 4,
    evolvesFrom: [{fromClassId: 3, minSpecies: 1, maxSpecies: 8}],
    mutations: [
      {toClassId: 5, minSpecies: 1, maxSpecies: 4},
      {toClassId: 9, minSpecies: 5, maxSpecies: 12},
    ],
    advancementRate: 0.7,
    sentienceRate: 0.015,
    minO2Pct: 4,
    minTempC: 2,
    maxTempC: 45,
    habitatPreferences: {
      shelf: 3,
      ocean: 3,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 0,
      desert: 0,
      grass: 0,
      forest: 0,
      jungle: 1,
      swamp: 2,
    },
    color: [251, 146, 60],
  },
  MOLLUSK: {
    id: 5,
    name: 'Mollusk',
    domain: 'sea',
    sprite: 'octopus',
    trophicTier: 2,
    competitionRank: 5,
    evolvesFrom: [{fromClassId: 4, minSpecies: 1, maxSpecies: 4}],
    mutations: [{toClassId: 6, minSpecies: 5, maxSpecies: 12}],
    advancementRate: 0.75,
    sentienceRate: 0.04,
    minO2Pct: 4,
    minTempC: 0,
    maxTempC: 40,
    habitatPreferences: {
      shelf: 3,
      ocean: 3,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 0,
      desert: 0,
      grass: 0,
      forest: 0,
      jungle: 2,
      swamp: 1,
    },
    color: [192, 132, 252],
  },
  FISH: {
    id: 6,
    name: 'Fish',
    domain: 'sea',
    sprite: 'fish',
    trophicTier: 4,
    competitionRank: 6,
    evolvesFrom: [{fromClassId: 5, minSpecies: 5, maxSpecies: 12}],
    mutations: [
      {toClassId: 10, minSpecies: 1, maxSpecies: 8},
      {toClassId: 8, minSpecies: 9, maxSpecies: 12},
    ],
    advancementRate: 1.0,
    sentienceRate: 0,
    minO2Pct: 7,
    minTempC: 0,
    maxTempC: 35,
    habitatPreferences: {
      shelf: 3,
      ocean: 3,
      deep_sea: 2,
      rock: 0,
      arctic: 0,
      boreal: 0,
      desert: 0,
      grass: 0,
      forest: 0,
      jungle: 0,
      swamp: 0,
    },
    color: [56, 189, 248],
  },
  CETACEAN: {
    id: 7,
    name: 'Cetacean',
    domain: 'sea',
    sprite: 'whale',
    trophicTier: 4,
    competitionRank: 12,
    evolvesFrom: [{fromClassId: 14, minSpecies: 5, maxSpecies: 12}],
    mutations: [{toClassId: 14, minSpecies: 13, maxSpecies: 16}],
    advancementRate: 0.95,
    sentienceRate: 0.75,
    minO2Pct: 17,
    minTempC: -2,
    maxTempC: 35,
    habitatPreferences: {
      shelf: 3,
      ocean: 3,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 0,
      desert: 0,
      grass: 0,
      forest: 0,
      jungle: 2,
      swamp: 0,
    },
    color: [96, 165, 250],
  },
  TRICHORDATE: {
    id: 8,
    name: 'Trichordate',
    domain: 'land',
    sprite: 'trichordate',
    trophicTier: 3,
    competitionRank: 7,
    evolvesFrom: [
      {fromClassId: 3, minSpecies: 9, maxSpecies: 12},
      {fromClassId: 6, minSpecies: 9, maxSpecies: 12},
    ],
    mutations: [],
    advancementRate: 0.7,
    sentienceRate: 0.05,
    minO2Pct: 10,
    minTempC: -5,
    maxTempC: 40,
    habitatPreferences: {
      shelf: 0,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 3,
      desert: 1,
      grass: 1,
      forest: 3,
      jungle: 3,
      swamp: 2,
    },
    color: [167, 139, 250],
  },
  INSECT: {
    id: 9,
    name: 'Insect',
    domain: 'land',
    sprite: 'insect',
    trophicTier: 3,
    competitionRank: 5,
    evolvesFrom: [{fromClassId: 4, minSpecies: 5, maxSpecies: 12}],
    mutations: [],
    advancementRate: 0.5,
    sentienceRate: 0.015,
    minO2Pct: 8,
    minTempC: 0,
    maxTempC: 45,
    habitatPreferences: {
      shelf: 3,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 2,
      desert: 2,
      grass: 2,
      forest: 2,
      jungle: 2,
      swamp: 2,
    },
    color: [234, 179, 8],
  },
  AMPHIBIAN: {
    id: 10,
    name: 'Amphibian',
    domain: 'land',
    sprite: 'amphibian',
    trophicTier: 3,
    competitionRank: 7,
    evolvesFrom: [{fromClassId: 6, minSpecies: 1, maxSpecies: 8}],
    mutations: [{toClassId: 11, minSpecies: 1, maxSpecies: 8}],
    advancementRate: 1.0,
    sentienceRate: 0,
    minO2Pct: 11,
    minTempC: 8,
    maxTempC: 38,
    habitatPreferences: {
      shelf: 3,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 1,
      desert: 0,
      grass: 1,
      forest: 2,
      jungle: 3,
      swamp: 3,
    },
    color: [74, 222, 128],
  },
  REPTILE: {
    id: 11,
    name: 'Reptile',
    domain: 'land',
    sprite: 'reptile',
    trophicTier: 3,
    competitionRank: 8,
    evolvesFrom: [{fromClassId: 10, minSpecies: 1, maxSpecies: 8}],
    mutations: [
      {toClassId: 12, minSpecies: 1, maxSpecies: 8},
      {toClassId: 14, minSpecies: 9, maxSpecies: 12},
    ],
    advancementRate: 0.95,
    sentienceRate: 0.35,
    minO2Pct: 13,
    minTempC: 10,
    maxTempC: 48,
    habitatPreferences: {
      shelf: 0,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 2,
      desert: 3,
      grass: 3,
      forest: 3,
      jungle: 2,
      swamp: 2,
    },
    color: [250, 204, 21],
  },
  DINOSAUR: {
    id: 12,
    name: 'Dinosaur',
    domain: 'land',
    sprite: 'dinosaur',
    trophicTier: 3,
    competitionRank: 9,
    evolvesFrom: [{fromClassId: 11, minSpecies: 1, maxSpecies: 8}],
    mutations: [
      {toClassId: 13, minSpecies: 1, maxSpecies: 4},
      {toClassId: 14, minSpecies: 5, maxSpecies: 8},
    ],
    advancementRate: 0.95,
    sentienceRate: 0.6,
    minO2Pct: 15,
    minTempC: 10,
    maxTempC: 45,
    habitatPreferences: {
      shelf: 0,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 2,
      desert: 1,
      grass: 1,
      forest: 3,
      jungle: 3,
      swamp: 2,
    },
    color: [248, 113, 113],
  },
  AVIAN: {
    id: 13,
    name: 'Avian',
    domain: 'land',
    sprite: 'bird',
    trophicTier: 3,
    competitionRank: 10,
    evolvesFrom: [{fromClassId: 12, minSpecies: 1, maxSpecies: 4}],
    mutations: [],
    advancementRate: 0.9,
    sentienceRate: 0.6,
    minO2Pct: 16,
    minTempC: -15,
    maxTempC: 45,
    habitatPreferences: {
      shelf: 0,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 3,
      desert: 1,
      grass: 2,
      forest: 3,
      jungle: 3,
      swamp: 1,
    },
    color: [125, 211, 252],
  },
  MAMMAL: {
    id: 14,
    name: 'Mammal',
    domain: 'land',
    sprite: 'mammal',
    trophicTier: 3,
    competitionRank: 11,
    evolvesFrom: [
      {fromClassId: 7, minSpecies: 13, maxSpecies: 16},
      {fromClassId: 11, minSpecies: 9, maxSpecies: 12},
      {fromClassId: 12, minSpecies: 5, maxSpecies: 8},
    ],
    mutations: [{toClassId: 7, minSpecies: 5, maxSpecies: 12}],
    advancementRate: 0.95,
    sentienceRate: 1.0,
    minO2Pct: 16,
    minTempC: -20,
    maxTempC: 45,
    habitatPreferences: {
      shelf: 0,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 2,
      desert: 1,
      grass: 3,
      forest: 3,
      jungle: 2,
      swamp: 2,
    },
    color: [251, 191, 36],
  },
  CARNIFERN: {
    id: 15,
    name: 'Carnifern',
    domain: 'land',
    sprite: 'carnifern',
    trophicTier: 5,
    competitionRank: 4,
    evolvesFrom: [],
    mutations: [],
    coEvolvesFrom: {companionClassId: 9, minSpecies: 1, maxSpecies: 4},
    advancementRate: 0.45,
    sentienceRate: 0.01,
    minO2Pct: 11,
    minTempC: 0,
    maxTempC: 45,
    habitatPreferences: {
      shelf: 0,
      ocean: 0,
      deep_sea: 0,
      rock: 0,
      arctic: 0,
      boreal: 1,
      desert: 1,
      grass: 1,
      forest: 1,
      jungle: 1,
      swamp: 1,
    },
    color: [251, 113, 133],
  },
} as const satisfies Record<string, LifeClassDefinition>;

export type LifeClassId =
  | typeof LIFE_CLASS_NONE
  | (typeof LIFE_CLASSES)[keyof typeof LIFE_CLASSES]['id'];

export const LIFE_CLASSES_BY_ID: ReadonlyMap<number, LifeClassDefinition> =
  new Map(Object.values(LIFE_CLASSES).map(def => [def.id, def]));

/** Allocate independent arrays so separate simulations never share mutable cell data. */
export function createSimulationState(): SimulationState {
  return {
    elevation: new Float32Array(CELL_COUNT),
    temperature: new Float32Array(CELL_COUNT),
    moisture: new Float32Array(CELL_COUNT),
    daisyWhite: new Float32Array(CELL_COUNT),
    daisyBlack: new Float32Array(CELL_COUNT),
    windX: new Float32Array(CELL_COUNT),
    windY: new Float32Array(CELL_COUNT),
    biome: new Uint8Array(CELL_COUNT),
    lifeClass: new Uint8Array(CELL_COUNT),
    lifeSpecies: new Uint8Array(CELL_COUNT),
    lifePopulation: new Float32Array(CELL_COUNT),
  };
}

/** Default planetary configuration (Earth-like baseline). */
export function createSimulationConfig(): SimulationConfig {
  return {
    year: 0,
    timeScale: 'daisyworld',
    solarLuminosity: 1,
    co2Ppm: 350,
    axialTiltDegrees: 23.5,
    o2Pct: 21,
    seaLevelOffset: 0,
  };
}
