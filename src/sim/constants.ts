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
  };
}

/** Prototype defaults; the oxygen value is currently display/config state only. */
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
