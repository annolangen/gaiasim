/** Scalar field sampled at continuous grid coordinates for terrain generation. */
export type Noise2D = (x: number, y: number) => number;

/**
 * Create a gradient-noise sampler. Supplying a seeded random source makes its
 * lookup table reproducible; the default produces a different terrain field per load.
 */
export function createNoise2D(random: () => number = Math.random): Noise2D {
  // The prototype duplicates random bytes rather than shuffling a true permutation.
  const lookup = new Uint8Array(512);
  for (let i = 0; i < 256; i++) {
    lookup[i] = lookup[i + 256] = Math.floor(random() * 256);
  }

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

  const interpolate = (t: number, start: number, end: number): number =>
    start + t * (end - start);

  function grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  return (x: number, y: number): number => {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const X = floorX & 255;
    const Y = floorY & 255;
    x -= floorX;
    y -= floorY;

    const A = lookup[X] + Y;
    const B = lookup[X + 1] + Y;

    return interpolate(
      fade(y),
      interpolate(fade(x), grad(lookup[A], x, y), grad(lookup[B], x - 1, y)),
      interpolate(
        fade(x),
        grad(lookup[A + 1], x, y - 1),
        grad(lookup[B + 1], x - 1, y - 1),
      ),
    );
  };
}

/** Shared noise field: regeneration varies by page load, not by preset selection. */
export const noise2D = createNoise2D();
