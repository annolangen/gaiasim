/** Terrain presets accepted by `generatePlanet`; each uses a distinct elevation field. */
export type PlanetType = 'earth' | 'pangaea' | 'archipelago' | 'daisyworld';

/** Brush operations accepted by the model; `inspect` intentionally changes nothing. */
export type GodTool =
  | 'inspect'
  | 'volcano'
  | 'meteor'
  | 'raise'
  | 'lower'
  | 'daisy_white'
  | 'daisy_black'
  | 'nuke';

/**
 * Per-cell buffers for the 128-by-64 grid, flattened in row-major order.
 * Use `getIdx` to map grid coordinates to array offsets.
 */
export interface SimulationState {
  /** Elevation in meters relative to sea level; terrain spans about -11,000 to 9,000 m. */
  elevation: Float32Array;
  /** Surface temperature in degrees Celsius. */
  temperature: Float32Array;
  /** Rainfall in cm/year, compared directly with the plan's biome thresholds. */
  moisture: Float32Array;
  /** White daisy coverage in each cell, from 0 to 1. */
  daisyWhite: Float32Array;
  /** Black daisy coverage in each cell, from 0 to 1. */
  daisyBlack: Float32Array;
  /** Eastward wind velocity component (u) in m/s (+east, -west). */
  windX: Float32Array;
  /** Southward wind velocity component (v) in m/s (+south, -north). */
  windY: Float32Array;
  /** Biome IDs from `BIOMES`, stored as unsigned bytes. */
  biome: Uint8Array;
}

export interface SimulationConfig {
  /** Elapsed simulation years; each call to `simulationStep` adds 10. */
  year: number;
  /** Stellar luminosity relative to the default value of 1. */
  solarLuminosity: number;
  /** Atmospheric carbon dioxide concentration in parts per million. */
  co2Ppm: number;
  /** Axial tilt in degrees; determines the latitude of the polar circles. */
  axialTiltDegrees: number;
  /** Atmospheric oxygen percentage; retained from the UI, not used by current equations. */
  o2Pct: number;
  /** Meters added to the baseline sea level, which is 0 m. */
  seaLevelOffset: number;
}

export interface SimulationMetrics {
  /** Unrounded mean across all grid cells, including ocean cells. */
  averageTemperatureC: number;
  temperatureHistory: number[];
  whiteDaisyHistory: number[];
  blackDaisyHistory: number[];
  /** Percentage of cells whose elevation is at or below sea level. */
  oceanCoveragePct: number;
  /** Percentage of cells classified from grassland through swamp, inclusive. */
  totalBiomassPct: number;
  /** Sum of per-cell white daisy coverage, expressed as a percentage of the whole grid. */
  whiteDaisyCoveragePct: number;
  /** Sum of per-cell black daisy coverage, expressed as a percentage of the whole grid. */
  blackDaisyCoveragePct: number;
}
