import type {SimulationConfig, SimulationState} from './types';

export const GRID_WIDTH = 128;
export const GRID_HEIGHT = 64;
/** Number of entries required by each per-cell state buffer. */
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;

interface BiomeDefinition {
  /** Stored in the state's `Uint8Array`; IDs must fit in one byte. */
  id: number;
  name: string;
  /** RGB color channels in the 0-to-255 range, for the later renderer. */
  color: readonly [number, number, number];
  /** Optional static biome sprite stem in `sprites/biomes/<sprite>.png`. */
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

export const LIFE_CLASS_NONE = 0;

export interface LifeClassDefinition {
  /** Stored in `SimulationState.lifeClass`; `0` means uninhabited. */
  readonly id: number;
  readonly name: string;
  /** Folder name under `public/sprites/lifeforms/<sprite>/species_1/`. */
  readonly sprite: string;
  /** Parent class ID required for evolution, or `null` for primordial life. */
  readonly evolvesFrom: number | null;
  readonly minO2Pct: number;
  readonly minTempC: number;
  readonly maxTempC: number;
  readonly primaryBiomes: readonly BiomeId[];
  readonly secondaryBiomes: readonly BiomeId[];
  readonly canGainSentience: boolean;
  /** Fallback RGB color for pixel-buffer rendering when sprites are not loaded. */
  readonly color: readonly [number, number, number];
}

/** Taxonomic life classes following plan.md section 3.B. */
export const LIFE_CLASSES = {
  PROKARYOTE: {
    id: 1,
    name: 'Prokaryote',
    sprite: 'bacteria',
    evolvesFrom: null,
    minO2Pct: 0,
    minTempC: -5,
    maxTempC: 85,
    primaryBiomes: [BIOMES.OCEAN.id, BIOMES.SWAMP.id],
    secondaryBiomes: [BIOMES.GRASSLAND.id, BIOMES.FOREST.id],
    canGainSentience: false,
    color: [163, 230, 53],
  },
  EUKARYOTE: {
    id: 2,
    name: 'Eukaryote',
    sprite: 'amoeba',
    evolvesFrom: 1,
    minO2Pct: 1,
    minTempC: 0,
    maxTempC: 50,
    primaryBiomes: [BIOMES.OCEAN.id],
    secondaryBiomes: [BIOMES.SWAMP.id],
    canGainSentience: false,
    color: [52, 211, 153],
  },
  RADIATE: {
    id: 3,
    name: 'Radiate',
    sprite: 'starfish',
    evolvesFrom: 2,
    minO2Pct: 3,
    minTempC: 2,
    maxTempC: 40,
    primaryBiomes: [BIOMES.OCEAN.id],
    secondaryBiomes: [],
    canGainSentience: false,
    color: [244, 114, 182],
  },
  ARTHROPOD: {
    id: 4,
    name: 'Arthropod',
    sprite: 'crab',
    evolvesFrom: 2,
    minO2Pct: 5,
    minTempC: 5,
    maxTempC: 45,
    primaryBiomes: [BIOMES.OCEAN.id, BIOMES.JUNGLE.id, BIOMES.SWAMP.id],
    secondaryBiomes: [BIOMES.GRASSLAND.id, BIOMES.FOREST.id, BIOMES.DESERT.id],
    canGainSentience: true,
    color: [251, 146, 60],
  },
  MOLLUSK: {
    id: 5,
    name: 'Mollusk',
    sprite: 'octopus',
    evolvesFrom: 2,
    minO2Pct: 5,
    minTempC: 0,
    maxTempC: 38,
    primaryBiomes: [BIOMES.OCEAN.id],
    secondaryBiomes: [BIOMES.SWAMP.id],
    canGainSentience: true,
    color: [192, 132, 252],
  },
  FISH: {
    id: 6,
    name: 'Fish',
    sprite: 'fish',
    evolvesFrom: 2,
    minO2Pct: 8,
    minTempC: 0,
    maxTempC: 35,
    primaryBiomes: [BIOMES.OCEAN.id],
    secondaryBiomes: [],
    canGainSentience: false,
    color: [56, 189, 248],
  },
  AMPHIBIAN: {
    id: 7,
    name: 'Amphibian',
    sprite: 'amphibian',
    evolvesFrom: 6,
    minO2Pct: 12,
    minTempC: 10,
    maxTempC: 38,
    primaryBiomes: [BIOMES.SWAMP.id, BIOMES.JUNGLE.id],
    secondaryBiomes: [BIOMES.FOREST.id, BIOMES.OCEAN.id],
    canGainSentience: false,
    color: [74, 222, 128],
  },
  REPTILE: {
    id: 8,
    name: 'Reptile',
    sprite: 'reptile',
    evolvesFrom: 7,
    minO2Pct: 14,
    minTempC: 15,
    maxTempC: 48,
    primaryBiomes: [BIOMES.DESERT.id, BIOMES.GRASSLAND.id, BIOMES.SWAMP.id],
    secondaryBiomes: [BIOMES.FOREST.id, BIOMES.JUNGLE.id],
    canGainSentience: true,
    color: [250, 204, 21],
  },
  DINOSAUR: {
    id: 9,
    name: 'Dinosaur',
    sprite: 'dinosaur',
    evolvesFrom: 8,
    minO2Pct: 16,
    minTempC: 15,
    maxTempC: 45,
    primaryBiomes: [BIOMES.GRASSLAND.id, BIOMES.FOREST.id, BIOMES.JUNGLE.id],
    secondaryBiomes: [BIOMES.SWAMP.id, BIOMES.DESERT.id],
    canGainSentience: true,
    color: [248, 113, 113],
  },
  BIRD: {
    id: 10,
    name: 'Bird',
    sprite: 'bird',
    evolvesFrom: 9,
    minO2Pct: 17,
    minTempC: -15,
    maxTempC: 45,
    primaryBiomes: [BIOMES.FOREST.id, BIOMES.JUNGLE.id, BIOMES.GRASSLAND.id],
    secondaryBiomes: [BIOMES.TUNDRA.id, BIOMES.ALPINE.id, BIOMES.SWAMP.id],
    canGainSentience: true,
    color: [125, 211, 252],
  },
  MAMMAL: {
    id: 11,
    name: 'Mammal',
    sprite: 'mammal',
    evolvesFrom: 8,
    minO2Pct: 17,
    minTempC: -20,
    maxTempC: 45,
    primaryBiomes: [BIOMES.GRASSLAND.id, BIOMES.FOREST.id, BIOMES.TUNDRA.id],
    secondaryBiomes: [BIOMES.JUNGLE.id, BIOMES.DESERT.id, BIOMES.ALPINE.id],
    canGainSentience: true,
    color: [251, 191, 36],
  },
  CETACEAN: {
    id: 12,
    name: 'Cetacean',
    sprite: 'whale',
    evolvesFrom: 11,
    minO2Pct: 18,
    minTempC: -2,
    maxTempC: 35,
    primaryBiomes: [BIOMES.OCEAN.id],
    secondaryBiomes: [],
    canGainSentience: true,
    color: [96, 165, 250],
  },
  TRICHORDATE: {
    id: 13,
    name: 'Trichordate',
    sprite: 'trichordate',
    evolvesFrom: 7,
    minO2Pct: 15,
    minTempC: 5,
    maxTempC: 40,
    primaryBiomes: [BIOMES.FOREST.id, BIOMES.SWAMP.id],
    secondaryBiomes: [BIOMES.GRASSLAND.id, BIOMES.JUNGLE.id],
    canGainSentience: true,
    color: [167, 139, 250],
  },
  CARNIVORE: {
    id: 14,
    name: 'Carnivore',
    sprite: 'carnifern',
    evolvesFrom: 11,
    minO2Pct: 18,
    minTempC: -15,
    maxTempC: 45,
    primaryBiomes: [BIOMES.GRASSLAND.id, BIOMES.FOREST.id],
    secondaryBiomes: [BIOMES.TUNDRA.id, BIOMES.JUNGLE.id],
    canGainSentience: true,
    color: [251, 113, 133],
  },
} as const satisfies Record<string, LifeClassDefinition>;

export type LifeClassId =
  | typeof LIFE_CLASS_NONE
  | (typeof LIFE_CLASSES)[keyof typeof LIFE_CLASSES]['id'];

export const LIFE_CLASSES_BY_ID: ReadonlyMap<number, LifeClassDefinition> =
  new Map(Object.values(LIFE_CLASSES).map(def => [def.id, def]));

export const LIFE_CLASS_CHILDREN: ReadonlyMap<
  number,
  readonly LifeClassDefinition[]
> = (() => {
  const byParent = new Map<number, LifeClassDefinition[]>();
  for (const def of Object.values(LIFE_CLASSES)) {
    if (def.evolvesFrom === null) continue;
    const list = byParent.get(def.evolvesFrom) ?? [];
    list.push(def);
    byParent.set(def.evolvesFrom, list);
  }
  return byParent;
})();

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
    lifePopulation: new Float32Array(CELL_COUNT),
  };
}

/** Default planetary configuration (Earth-like baseline). */
export function createSimulationConfig(): SimulationConfig {
  return {
    year: 0,
    solarLuminosity: 1,
    co2Ppm: 350,
    axialTiltDegrees: 23.5,
    o2Pct: 21,
    seaLevelOffset: 0,
  };
}
