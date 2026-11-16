import {BIOMES, CELL_COUNT, GRID_HEIGHT, GRID_WIDTH} from './sim/constants';
import type {SimulationConfig, SimulationState} from './sim/types';

export type MapLayer = 'biomes' | 'temp' | 'moisture' | 'daisies';

const BIOME_COLORS = new Map<number, readonly [number, number, number]>(
  Object.values(BIOMES).map(
    ({id, color}): [number, readonly [number, number, number]] => [id, color],
  ),
);

type RgbColor = readonly [number, number, number];

export function createMapPixels(
  state: SimulationState,
  config: SimulationConfig,
  layer: MapLayer,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(CELL_COUNT * 4);
  const paintByLayer: Record<MapLayer, (index: number) => RgbColor> = {
    biomes: index => BIOME_COLORS.get(state.biome[index]) ?? BIOMES.OCEAN.color,
    temp: index => {
      const normalizedTemperature = Math.max(
        0,
        Math.min(1, (state.temperature[index] + 20) / 60),
      );
      return [
        Math.floor(normalizedTemperature * 255),
        Math.floor((1 - Math.abs(normalizedTemperature - 0.5) * 2) * 200),
        Math.floor((1 - normalizedTemperature) * 255),
      ];
    },
    moisture: index => {
      const moisture = Math.max(0, Math.min(1, state.moisture[index] / 100));
      return [
        Math.floor((1 - moisture) * 220),
        Math.floor((1 - moisture) * 200 + moisture * 100),
        Math.floor(moisture * 255),
      ];
    },
    daisies: index => {
      if (state.elevation[index] <= config.seaLevelOffset) {
        return BIOMES.OCEAN.color;
      }
      if (state.daisyWhite[index] > 0.05) return [240, 240, 255];
      if (state.daisyBlack[index] > 0.05) return [40, 40, 50];
      return [30, 35, 45];
    },
  };
  const paint = paintByLayer[layer];

  for (let index = 0; index < CELL_COUNT; index++) {
    pixels.set(paint(index), index * 4);
    pixels[index * 4 + 3] = 255; // alpha channel
  }

  return pixels;
}

export function drawMap(
  context: CanvasRenderingContext2D,
  pixels: Uint8ClampedArray,
): void {
  const image = context.createImageData(GRID_WIDTH, GRID_HEIGHT);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
}
