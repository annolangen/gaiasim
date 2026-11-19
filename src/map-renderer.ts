import {BIOMES, CELL_COUNT, GRID_HEIGHT, GRID_WIDTH} from './sim/constants';
import type {SimulationConfig, SimulationState} from './sim/types';

export type MapLayer = 'biomes' | 'temp' | 'moisture' | 'daisies';

export const TILE_SIZE = 16;
export const OCEAN_FRAME_COUNT = 8;
export const LAND_TILE_COUNT = 32;
export const DAISY_TILE_COUNT = 7;

const BIOME_COLORS = new Map<number, readonly [number, number, number]>(
  Object.values(BIOMES).map(
    ({id, color}): [number, readonly [number, number, number]] => [id, color],
  ),
);

type RgbColor = readonly [number, number, number];

export interface SpriteSheet {
  biomes: ReadonlyMap<number, HTMLImageElement>;
  ocean: {
    shallow: HTMLImageElement[];
    regular: HTMLImageElement[];
    deep: HTMLImageElement[];
  };
  land: HTMLImageElement[];
  daisy: HTMLImageElement[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load sprite: ${src}`));
    img.src = src;
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export async function loadSprites(baseUrl = './sprites'): Promise<SpriteSheet> {
  const biomeEntries = Object.values(BIOMES).filter(
    (b): b is typeof b & {sprite: string} => 'sprite' in b,
  );

  const [biomePairs, shallow, regular, deep, land, daisy] = await Promise.all([
    Promise.all(
      biomeEntries.map(
        async ({id, sprite}): Promise<[number, HTMLImageElement]> => [
          id,
          await loadImage(`${baseUrl}/biomes/${sprite}.png`),
        ],
      ),
    ),
    Promise.all(
      Array.from({length: OCEAN_FRAME_COUNT}, (_, i) =>
        loadImage(`${baseUrl}/ocean/shallow/${pad2(i)}.png`),
      ),
    ),
    Promise.all(
      Array.from({length: OCEAN_FRAME_COUNT}, (_, i) =>
        loadImage(`${baseUrl}/ocean/regular/${pad2(i)}.png`),
      ),
    ),
    Promise.all(
      Array.from({length: OCEAN_FRAME_COUNT}, (_, i) =>
        loadImage(`${baseUrl}/ocean/deep/${pad2(i)}.png`),
      ),
    ),
    Promise.all(
      Array.from({length: LAND_TILE_COUNT}, (_, i) =>
        loadImage(`${baseUrl}/land/${pad2(i)}.png`),
      ),
    ),
    Promise.all(
      Array.from({length: DAISY_TILE_COUNT}, (_, i) =>
        loadImage(`${baseUrl}/daisy/${pad2(i)}.png`),
      ),
    ),
  ]);

  return {
    biomes: new Map(biomePairs),
    ocean: {shallow, regular, deep},
    land,
    daisy,
  };
}

export function selectLandTileIndex(
  elevation: number,
  seaLevel: number,
): number {
  const altitude = Math.max(0, elevation - seaLevel);
  // Map 0..9000m above sea level onto terrasim's upper half (16..31) of the 32 land elevation tiles.
  const normalized = Math.min(1, altitude / 6_000);
  return Math.min(
    LAND_TILE_COUNT - 1,
    16 + Math.floor(normalized * (LAND_TILE_COUNT - 16)),
  );
}

export function selectOceanSprite(
  sprites: SpriteSheet,
  elevation: number,
  seaLevel: number,
  frame: number,
): HTMLImageElement {
  const depth = seaLevel - elevation;
  const frameIdx = frame % OCEAN_FRAME_COUNT;
  if (depth < 1_200) {
    return sprites.ocean.shallow[frameIdx];
  }
  if (depth < 4_000) {
    return sprites.ocean.regular[frameIdx];
  }
  return sprites.ocean.deep[frameIdx];
}

export function selectDaisySprite(
  sprites: SpriteSheet,
  white: number,
  black: number,
): HTMLImageElement | null {
  const total = white + black;
  if (total < 0.1) return null;
  // daisy/00.png is white (high albedo) through daisy/06.png which is dark (low albedo).
  const blackRatio = black / total;
  const idx = Math.min(
    DAISY_TILE_COUNT - 1,
    Math.max(0, Math.round(blackRatio * (DAISY_TILE_COUNT - 1))),
  );
  return sprites.daisy[idx];
}

export function selectCellSprite(
  sprites: SpriteSheet,
  state: SimulationState,
  config: SimulationConfig,
  index: number,
  layer: 'biomes' | 'daisies',
  frame = 0,
): HTMLImageElement {
  const elevation = state.elevation[index];
  const seaLevel = config.seaLevelOffset;
  const biomeId = state.biome[index];

  if (biomeId === BIOMES.OCEAN.id) {
    return selectOceanSprite(sprites, elevation, seaLevel, frame);
  }
  if (biomeId === BIOMES.SEA_ICE.id && elevation <= seaLevel) {
    return sprites.biomes.get(BIOMES.SEA_ICE.id)!;
  }

  const daisySprite = selectDaisySprite(
    sprites,
    state.daisyWhite[index],
    state.daisyBlack[index],
  );
  if (
    daisySprite &&
    (layer === 'daisies' ||
      state.daisyWhite[index] + state.daisyBlack[index] >= 0.25)
  ) {
    return daisySprite;
  }

  if (layer === 'daisies') {
    return sprites.land[selectLandTileIndex(elevation, seaLevel)];
  }

  return (
    sprites.biomes.get(biomeId) ??
    sprites.land[selectLandTileIndex(elevation, seaLevel)]
  );
}

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
      const white = Math.max(0, Math.min(1, state.daisyWhite[index]));
      const black = Math.max(0, Math.min(1, state.daisyBlack[index]));
      const bare = Math.max(0, 1 - white - black);
      return [
        Math.round(bare * 60 + white * 245 + black * 12),
        Math.round(bare * 68 + white * 248 + black * 14),
        Math.round(bare * 80 + white * 255 + black * 20),
      ];
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

let heatmapScratchCanvas: HTMLCanvasElement | null = null;

function drawScaledPixels(
  context: CanvasRenderingContext2D,
  pixels: Uint8ClampedArray,
  alpha = 1,
): void {
  if (
    context.canvas.width === GRID_WIDTH &&
    context.canvas.height === GRID_HEIGHT &&
    alpha === 1
  ) {
    drawMap(context, pixels);
    return;
  }

  if (!heatmapScratchCanvas && typeof document !== 'undefined') {
    heatmapScratchCanvas = document.createElement('canvas');
    heatmapScratchCanvas.width = GRID_WIDTH;
    heatmapScratchCanvas.height = GRID_HEIGHT;
  }
  const scratchCtx = heatmapScratchCanvas?.getContext('2d');
  if (!scratchCtx || !heatmapScratchCanvas) {
    drawMap(context, pixels);
    return;
  }

  drawMap(scratchCtx, pixels);
  context.save();
  context.imageSmoothingEnabled = false;
  context.globalAlpha = alpha;
  context.drawImage(
    heatmapScratchCanvas,
    0,
    0,
    context.canvas.width,
    context.canvas.height,
  );
  context.restore();
}

export function renderWorldMap(
  context: CanvasRenderingContext2D,
  state: SimulationState,
  config: SimulationConfig,
  layer: MapLayer,
  sprites: SpriteSheet | null,
  frame = 0,
): void {
  if (!sprites) {
    drawScaledPixels(context, createMapPixels(state, config, layer));
    return;
  }

  const tileLayer = layer === 'daisies' ? 'daisies' : 'biomes';
  context.imageSmoothingEnabled = false;

  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const idx = y * GRID_WIDTH + x;
      const sprite = selectCellSprite(
        sprites,
        state,
        config,
        idx,
        tileLayer,
        frame,
      );
      context.drawImage(
        sprite,
        x * TILE_SIZE,
        y * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
      );
    }
  }

  if (layer === 'temp' || layer === 'moisture') {
    drawScaledPixels(context, createMapPixels(state, config, layer), 0.72);
  }
}
