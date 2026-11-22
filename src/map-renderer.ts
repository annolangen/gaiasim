import {BIOMES, CELL_COUNT, GRID_HEIGHT, GRID_WIDTH} from './sim/constants';
import type {BiomeId} from './sim/constants';
import {getIdx} from './sim/engine';
import type {SimulationConfig, SimulationState} from './sim/types';

export type MapLayer = 'biomes' | 'temp' | 'moisture' | 'wind' | 'daisies';

export const TILE_SIZE = 16;
export const WORLD_PIXEL_WIDTH = GRID_WIDTH * TILE_SIZE;
export const WORLD_PIXEL_HEIGHT = GRID_HEIGHT * TILE_SIZE;
export const OCEAN_FRAME_COUNT = 8;
export const LAND_TILE_COUNT = 32;
export const DAISY_TILE_COUNT = 7;

export interface MapCamera {
  /** Zoom multiplier from 1 (full planet) to 8. */
  zoom: number;
  /** Top-left world pixel X offset [0, WORLD_PIXEL_WIDTH), wrapped horizontally. */
  panX: number;
  /** Top-left world pixel Y offset [0, WORLD_PIXEL_HEIGHT - WORLD_PIXEL_HEIGHT / zoom]. */
  panY: number;
}

export interface IsolineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

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

const BIOME_SPRITE_STEMS = new Map<number, string>(
  Object.values(BIOMES)
    .filter((b): b is typeof b & {sprite: string} => 'sprite' in b)
    .map(({id, sprite}) => [id, sprite]),
);

const ALPINE_LEGEND_ELEVATION_METERS = 4_500;

/** Return the representative 16x16 sprite URL for a biome in the UI legend. */
export function getBiomeLegendSpriteUrl(
  biomeId: BiomeId,
  baseUrl = './sprites',
): string {
  if (biomeId === BIOMES.OCEAN.id) {
    return `${baseUrl}/ocean/regular/00.png`;
  }
  const stem = BIOME_SPRITE_STEMS.get(biomeId);
  if (stem) {
    return `${baseUrl}/biomes/${stem}.png`;
  }
  return `${baseUrl}/land/${pad2(selectLandTileIndex(ALPINE_LEGEND_ELEVATION_METERS, 0))}.png`;
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
    wind: index => {
      const speed = Math.min(
        1,
        Math.hypot(state.windX[index], state.windY[index]) / 12,
      );
      return [
        Math.floor(speed * 120),
        Math.floor(80 + speed * 175),
        Math.floor(160 + speed * 95),
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

export function clampCamera(camera: MapCamera): MapCamera {
  const zoom = Math.max(1, Math.min(8, camera.zoom));
  const viewH = WORLD_PIXEL_HEIGHT / zoom;
  const maxPanY = Math.max(0, WORLD_PIXEL_HEIGHT - viewH);
  const panX =
    ((camera.panX % WORLD_PIXEL_WIDTH) + WORLD_PIXEL_WIDTH) % WORLD_PIXEL_WIDTH;
  const panY = Math.max(0, Math.min(maxPanY, camera.panY));
  return {zoom, panX, panY};
}

export interface PinchAnchor {
  startDistance: number;
  startZoom: number;
  worldAnchorX: number;
  worldAnchorY: number;
}

/** Snapshot the world-space anchor under the initial two-finger midpoint. */
export function createPinchAnchor(
  camera: MapCamera,
  startDistance: number,
  normMidX: number,
  normMidY: number,
): PinchAnchor {
  const prev = clampCamera(camera);
  return {
    startDistance,
    startZoom: prev.zoom,
    worldAnchorX: prev.panX + normMidX * (WORLD_PIXEL_WIDTH / prev.zoom),
    worldAnchorY: prev.panY + normMidY * (WORLD_PIXEL_HEIGHT / prev.zoom),
  };
}

/** Compute zoomed/panned camera keeping the pinch anchor pinned under the current midpoint. */
export function computePinchCamera(
  anchor: PinchAnchor,
  currentDistance: number,
  normMidX: number,
  normMidY: number,
): MapCamera {
  const ratio =
    anchor.startDistance > 0 ? currentDistance / anchor.startDistance : 1;
  const nextZoom = Math.max(1, Math.min(8, anchor.startZoom * ratio));
  return clampCamera({
    zoom: nextZoom,
    panX: anchor.worldAnchorX - normMidX * (WORLD_PIXEL_WIDTH / nextZoom),
    panY: anchor.worldAnchorY - normMidY * (WORLD_PIXEL_HEIGHT / nextZoom),
  });
}

/**
 * Convert normalized viewport coordinates (0..1 across the canvas element)
 * into grid cell coordinates (0..127, 0..63), accounting for zoom and pan.
 */
export function viewportToGridCoords(
  normX: number,
  normY: number,
  camera: MapCamera,
): {x: number; y: number} | null {
  if (normX < 0 || normX >= 1 || normY < 0 || normY >= 1) return null;
  const clamped = clampCamera(camera);
  const worldX =
    (clamped.panX + normX * (WORLD_PIXEL_WIDTH / clamped.zoom)) %
    WORLD_PIXEL_WIDTH;
  const worldY = clamped.panY + normY * (WORLD_PIXEL_HEIGHT / clamped.zoom);
  const gx = Math.floor(worldX / TILE_SIZE);
  const gy = Math.floor(worldY / TILE_SIZE);
  if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return null;
  return {x: gx, y: gy};
}

/**
 * Compute marching-squares contour line segments in world-pixel coordinates
 * for a given threshold across the 128x64 scalar field.
 */
export function computeIsolineSegments(
  field: Float32Array,
  threshold: number,
): IsolineSegment[] {
  const segments: IsolineSegment[] = [];
  const interp = (v1: number, v2: number): number => {
    const denom = v2 - v1;
    if (Math.abs(denom) < 1e-6) return 0.5;
    return Math.max(0, Math.min(1, (threshold - v1) / denom));
  };

  for (let y = 0; y < GRID_HEIGHT - 1; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const v0 = field[getIdx(x, y)];
      const v1 = field[getIdx(x + 1, y)];
      const v2 = field[getIdx(x + 1, y + 1)];
      const v3 = field[getIdx(x, y + 1)];

      const mask =
        (v0 >= threshold ? 1 : 0) |
        (v1 >= threshold ? 2 : 0) |
        (v2 >= threshold ? 4 : 0) |
        (v3 >= threshold ? 8 : 0);
      if (mask === 0 || mask === 15) continue;

      const x0 = (x + 0.5) * TILE_SIZE;
      const y0 = (y + 0.5) * TILE_SIZE;

      // Edge points: 0=top, 1=right, 2=bottom, 3=left
      const edgePoint = (edge: number): [number, number] => {
        if (edge === 0) return [x0 + interp(v0, v1) * TILE_SIZE, y0];
        if (edge === 1) {
          return [x0 + TILE_SIZE, y0 + interp(v1, v2) * TILE_SIZE];
        }
        if (edge === 2) {
          return [x0 + interp(v3, v2) * TILE_SIZE, y0 + TILE_SIZE];
        }
        return [x0, y0 + interp(v0, v3) * TILE_SIZE];
      };

      const addSeg = (eA: number, eB: number) => {
        const [x1, y1] = edgePoint(eA);
        const [x2, y2] = edgePoint(eB);
        segments.push({x1, y1, x2, y2});
      };

      switch (mask) {
        case 1:
        case 14:
          addSeg(3, 0);
          break;
        case 2:
        case 13:
          addSeg(0, 1);
          break;
        case 3:
        case 12:
          addSeg(3, 1);
          break;
        case 4:
        case 11:
          addSeg(1, 2);
          break;
        case 5:
          addSeg(3, 2);
          addSeg(0, 1);
          break;
        case 6:
        case 9:
          addSeg(0, 2);
          break;
        case 7:
        case 8:
          addSeg(3, 2);
          break;
        case 10:
          addSeg(3, 0);
          addSeg(1, 2);
          break;
      }
    }
  }

  return segments;
}

function drawIsolines(
  context: CanvasRenderingContext2D,
  field: Float32Array,
  thresholds: readonly {value: number; color: string}[],
): void {
  context.save();
  context.lineWidth = 1.75;
  context.lineCap = 'round';

  for (const {value, color} of thresholds) {
    const segments = computeIsolineSegments(field, value);
    if (segments.length === 0) continue;
    context.strokeStyle = color;
    context.beginPath();
    for (const seg of segments) {
      context.moveTo(seg.x1, seg.y1);
      context.lineTo(seg.x2, seg.y2);
    }
    context.stroke();
  }

  context.restore();
}

function drawWindVectors(
  context: CanvasRenderingContext2D,
  state: SimulationState,
): void {
  context.save();
  context.lineWidth = 1.8;
  context.strokeStyle = 'rgba(224, 242, 254, 0.9)';
  context.fillStyle = 'rgba(56, 189, 248, 0.95)';

  // Sample every 2x2 grid cell so wind arrows stay crisp and uncluttered.
  for (let y = 1; y < GRID_HEIGHT; y += 2) {
    for (let x = 1; x < GRID_WIDTH; x += 2) {
      const idx = getIdx(x, y);
      const u = state.windX[idx];
      const v = state.windY[idx];
      const mag = Math.hypot(u, v);
      if (mag < 0.2) continue;

      const cx = (x + 0.5) * TILE_SIZE;
      const cy = (y + 0.5) * TILE_SIZE;
      const len = Math.min(TILE_SIZE * 1.6, 8 + mag * 1.4);
      const dx = (u / mag) * len;
      const dy = (v / mag) * len;

      const x1 = cx - dx * 0.45;
      const y1 = cy - dy * 0.45;
      const x2 = cx + dx * 0.55;
      const y2 = cy + dy * 0.55;

      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();

      const angle = Math.atan2(dy, dx);
      const headLen = 5;
      context.beginPath();
      context.moveTo(x2, y2);
      context.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6),
      );
      context.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6),
      );
      context.closePath();
      context.fill();
    }
  }

  context.restore();
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
    WORLD_PIXEL_WIDTH,
    WORLD_PIXEL_HEIGHT,
  );
  context.restore();
}

const TEMP_ISOLINES = [
  {value: -10, color: 'rgba(186, 230, 253, 0.85)'},
  {value: 0, color: 'rgba(255, 255, 255, 0.95)'},
  {value: 15, color: 'rgba(253, 224, 71, 0.85)'},
  {value: 25, color: 'rgba(251, 146, 60, 0.9)'},
] as const;

const MOISTURE_ISOLINES = [
  {value: 25, color: 'rgba(253, 224, 71, 0.85)'},
  {value: 50, color: 'rgba(125, 211, 252, 0.9)'},
  {value: 75, color: 'rgba(56, 189, 248, 0.95)'},
] as const;

function renderWorldPass(
  context: CanvasRenderingContext2D,
  state: SimulationState,
  config: SimulationConfig,
  layer: MapLayer,
  sprites: SpriteSheet | null,
  frame: number,
  showIsolines: boolean,
): void {
  if (!sprites) {
    drawScaledPixels(context, createMapPixels(state, config, layer));
  } else {
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
    } else if (layer === 'wind') {
      drawScaledPixels(context, createMapPixels(state, config, 'wind'), 0.3);
    }
  }

  if (showIsolines) {
    if (layer === 'temp') {
      drawIsolines(context, state.temperature, TEMP_ISOLINES);
    } else if (layer === 'moisture') {
      drawIsolines(context, state.moisture, MOISTURE_ISOLINES);
    }
  }

  if (layer === 'wind') {
    drawWindVectors(context, state);
  }
}

export function renderWorldMap(
  context: CanvasRenderingContext2D,
  state: SimulationState,
  config: SimulationConfig,
  layer: MapLayer,
  sprites: SpriteSheet | null,
  frame = 0,
  camera: MapCamera = {zoom: 1, panX: 0, panY: 0},
  showIsolines = true,
): void {
  const {zoom, panX, panY} = clampCamera(camera);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);

  context.save();
  context.scale(zoom, zoom);
  context.translate(-panX, -panY);
  renderWorldPass(context, state, config, layer, sprites, frame, showIsolines);

  // If horizontal pan wraps across the 180° meridian, draw the wrapped eastern continuation.
  if (panX + WORLD_PIXEL_WIDTH / zoom > WORLD_PIXEL_WIDTH) {
    context.translate(WORLD_PIXEL_WIDTH, 0);
    renderWorldPass(
      context,
      state,
      config,
      layer,
      sprites,
      frame,
      showIsolines,
    );
  }
  context.restore();
}
