import {
  createSimulationConfig,
  createSimulationState,
  LIFE_CLASSES,
  LIFE_CLASSES_BY_ID,
  MAX_SPECIES_LEVEL,
  PLANT_BIOME_MIN_O2_PCT,
} from './constants';
import {generatePlanet, simulationStep} from './engine';
import {createNoise2D} from './noise';
import type {PlanetType} from './types';

export interface TrialConfig {
  readonly preset: PlanetType;
  readonly seed: number;
  readonly maxTicks: number;
  readonly varyTerrain?: boolean;
  readonly terrainSeed?: number;
}

export interface ClassTrialOutcome {
  readonly classId: number;
  readonly emergedTick: number | null;
  readonly sentientTick: number | null;
  readonly peakCells: number;
  readonly endCells: number;
  readonly maxSpeciesReached: number;
  readonly extinctAfterEmerging: boolean;
}

export interface TrialResult {
  readonly preset: PlanetType;
  readonly seed: number;
  readonly maxTicks: number;
  readonly eukaryoteTick: number | null;
  readonly eukaryoteYear: number | null;
  readonly greeningTick: number | null;
  readonly greeningYear: number | null;
  readonly evolutionEraTick: number | null;
  readonly evolutionEraYear: number | null;
  readonly firstLandFaunaTick: number | null;
  readonly firstLandFaunaYear: number | null;
  readonly firstLandVertebrateTick: number | null;
  readonly firstLandVertebrateYear: number | null;
  readonly firstSentienceTick: number | null;
  readonly firstSentienceYear: number | null;
  readonly civilizedEraTick: number | null;
  readonly civilizedEraYear: number | null;
  readonly firstSentientClassId: number | null;
  readonly endO2Pct: number;
  readonly peakO2Pct: number;
  readonly endBiomassPct: number;
  readonly endAvgTempC: number;
  readonly endActiveClassCount: number;
  readonly peakCarnifernToInsectRatio: number | null;
  readonly meanCarnifernToInsectRatio: number | null;
  readonly classes: Record<number, ClassTrialOutcome>;
}

export interface NumericSummary {
  readonly n: number;
  readonly total: number;
  readonly rate: number;
  readonly mean: number | null;
  readonly stdDev: number | null;
  readonly se: number | null;
  readonly min: number | null;
  readonly p10: number | null;
  readonly median: number | null;
  readonly p90: number | null;
  readonly max: number | null;
}

export interface BernoulliSummary {
  readonly count: number;
  readonly total: number;
  readonly probability: number;
  readonly ciLow: number;
  readonly ciHigh: number;
}

export interface ClassEvalSummary {
  readonly classId: number;
  readonly name: string;
  readonly emerged: BernoulliSummary;
  readonly firstSentient: BernoulliSummary;
  readonly everSentient: BernoulliSummary;
  readonly extinctAfterEmerging: BernoulliSummary;
  readonly emergedTick: NumericSummary;
  readonly sentientTick: NumericSummary;
  readonly peakCells: NumericSummary;
  readonly endCells: NumericSummary;
}

export interface EvalSummary {
  readonly preset: PlanetType;
  readonly runs: number;
  readonly maxTicks: number;
  readonly varyTerrain: boolean;
  readonly baseSeed: number;
  readonly milestones: {
    readonly eukaryoteTick: NumericSummary;
    readonly eukaryoteYear: NumericSummary;
    readonly greeningTick: NumericSummary;
    readonly greeningYear: NumericSummary;
    readonly evolutionEraTick: NumericSummary;
    readonly evolutionEraYear: NumericSummary;
    readonly firstLandFaunaTick: NumericSummary;
    readonly firstLandFaunaYear: NumericSummary;
    readonly firstLandVertebrateTick: NumericSummary;
    readonly firstLandVertebrateYear: NumericSummary;
    readonly firstSentienceTick: NumericSummary;
    readonly firstSentienceYear: NumericSummary;
    readonly civilizedEraTick: NumericSummary;
    readonly civilizedEraYear: NumericSummary;
  };
  readonly ecology: {
    readonly endO2Pct: NumericSummary;
    readonly peakO2Pct: NumericSummary;
    readonly endBiomassPct: NumericSummary;
    readonly endAvgTempC: NumericSummary;
    readonly endActiveClassCount: NumericSummary;
    readonly peakCarnifernToInsectRatio: NumericSummary;
    readonly meanCarnifernToInsectRatio: NumericSummary;
  };
  readonly anySentience: BernoulliSummary;
  readonly classes: readonly ClassEvalSummary[];
}

const ALL_CLASSES = Object.values(LIFE_CLASSES);
const LAND_VERTEBRATE_IDS = new Set<number>([
  LIFE_CLASSES.AMPHIBIAN.id,
  LIFE_CLASSES.REPTILE.id,
  LIFE_CLASSES.DINOSAUR.id,
  LIFE_CLASSES.AVIAN.id,
  LIFE_CLASSES.MAMMAL.id,
]);

/** Fast, deterministic 32-bit PRNG (Mulberry32) for reproducible Monte Carlo trials. */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run a single headless simulation trial and record player experience & ecological markers. */
export function runHeadlessTrial(options: TrialConfig): TrialResult {
  const {preset, seed, maxTicks, varyTerrain = true, terrainSeed = 1} = options;
  const effectiveTerrainSeed = varyTerrain ? seed : terrainSeed;
  const terrainRng = createMulberry32(effectiveTerrainSeed * 2654435761 + 17);
  const simRng = createMulberry32(seed * 1597334677 + 31);
  const state = createSimulationState();
  const config = createSimulationConfig();
  const noise = createNoise2D(terrainRng);

  let metrics = generatePlanet(state, config, preset, simRng, noise);

  let eukaryoteTick: number | null =
    (metrics.lifeClassCounts[LIFE_CLASSES.EUKARYOTE.id] ?? 0) > 0 ? 0 : null;
  let eukaryoteYear: number | null = eukaryoteTick === 0 ? 0 : null;
  let greeningTick: number | null =
    config.o2Pct >= PLANT_BIOME_MIN_O2_PCT ? 0 : null;
  let greeningYear: number | null = greeningTick === 0 ? 0 : null;
  let evolutionEraTick: number | null =
    config.timeScale === 'evolution' ? 0 : null;
  let evolutionEraYear: number | null = evolutionEraTick === 0 ? 0 : null;
  let civilizedEraTick: number | null =
    config.timeScale === 'civilized' ? 0 : null;
  let civilizedEraYear: number | null = civilizedEraTick === 0 ? 0 : null;

  let firstLandFaunaTick: number | null = null;
  let firstLandFaunaYear: number | null = null;
  let firstLandVertebrateTick: number | null = null;
  let firstLandVertebrateYear: number | null = null;
  let firstSentienceTick: number | null = null;
  let firstSentienceYear: number | null = null;
  let firstSentientClassId: number | null = null;

  const emergedTick = new Map<number, number>();
  const sentientTick = new Map<number, number>();
  const peakCells = new Map<number, number>();
  const maxSpeciesReached = new Map<number, number>();

  for (const def of ALL_CLASSES) {
    const count = metrics.lifeClassCounts[def.id] ?? 0;
    const maxSp = metrics.lifeClassMaxSpecies[def.id] ?? 0;
    peakCells.set(def.id, count);
    maxSpeciesReached.set(def.id, maxSp);
    if (count > 0) {
      emergedTick.set(def.id, 0);
      if (def.domain === 'land' && firstLandFaunaTick === null) {
        firstLandFaunaTick = 0;
        firstLandFaunaYear = 0;
      }
      if (LAND_VERTEBRATE_IDS.has(def.id) && firstLandVertebrateTick === null) {
        firstLandVertebrateTick = 0;
        firstLandVertebrateYear = 0;
      }
    }
  }

  let peakO2Pct = config.o2Pct;
  let peakCarnifernToInsectRatio: number | null = null;
  let ratioSum = 0;
  let ratioSamples = 0;

  for (let tick = 1; tick <= maxTicks; tick++) {
    metrics = simulationStep(state, config, [], [], [], simRng);

    if (config.o2Pct > peakO2Pct) peakO2Pct = config.o2Pct;
    if (greeningTick === null && config.o2Pct >= PLANT_BIOME_MIN_O2_PCT) {
      greeningTick = tick;
      greeningYear = config.year;
    }
    if (evolutionEraTick === null && config.timeScale === 'evolution') {
      evolutionEraTick = tick;
      evolutionEraYear = config.year;
    }
    if (civilizedEraTick === null && config.timeScale === 'civilized') {
      civilizedEraTick = tick;
      civilizedEraYear = config.year;
    }

    for (const def of ALL_CLASSES) {
      const id = def.id;
      const count = metrics.lifeClassCounts[id] ?? 0;
      const maxSp = metrics.lifeClassMaxSpecies[id] ?? 0;

      if (count > (peakCells.get(id) ?? 0)) {
        peakCells.set(id, count);
      }
      if (maxSp > (maxSpeciesReached.get(id) ?? 0)) {
        maxSpeciesReached.set(id, maxSp);
      }
      if (count > 0 && !emergedTick.has(id)) {
        emergedTick.set(id, tick);
        if (id === LIFE_CLASSES.EUKARYOTE.id && eukaryoteTick === null) {
          eukaryoteTick = tick;
          eukaryoteYear = config.year;
        }
        if (def.domain === 'land' && firstLandFaunaTick === null) {
          firstLandFaunaTick = tick;
          firstLandFaunaYear = config.year;
        }
        if (LAND_VERTEBRATE_IDS.has(id) && firstLandVertebrateTick === null) {
          firstLandVertebrateTick = tick;
          firstLandVertebrateYear = config.year;
        }
      }
      if (maxSp >= MAX_SPECIES_LEVEL && !sentientTick.has(id)) {
        sentientTick.set(id, tick);
        if (firstSentienceTick === null) {
          firstSentienceTick = tick;
          firstSentienceYear = config.year;
          firstSentientClassId = id;
        }
      }
    }

    const insectCount = metrics.lifeClassCounts[LIFE_CLASSES.INSECT.id] ?? 0;
    const carnifernCount =
      metrics.lifeClassCounts[LIFE_CLASSES.CARNIFERN.id] ?? 0;
    if (insectCount >= 10) {
      const ratio = carnifernCount / insectCount;
      ratioSum += ratio;
      ratioSamples++;
      if (
        peakCarnifernToInsectRatio === null ||
        ratio > peakCarnifernToInsectRatio
      ) {
        peakCarnifernToInsectRatio = ratio;
      }
    }
  }

  const classes: Record<number, ClassTrialOutcome> = {};
  let endActiveClassCount = 0;
  for (const def of ALL_CLASSES) {
    const id = def.id;
    const endCells = metrics.lifeClassCounts[id] ?? 0;
    if (endCells > 0) endActiveClassCount++;
    const emerged = emergedTick.get(id) ?? null;
    classes[id] = {
      classId: id,
      emergedTick: emerged,
      sentientTick: sentientTick.get(id) ?? null,
      peakCells: peakCells.get(id) ?? 0,
      endCells,
      maxSpeciesReached: maxSpeciesReached.get(id) ?? 0,
      extinctAfterEmerging: emerged !== null && endCells === 0,
    };
  }

  return {
    preset,
    seed,
    maxTicks,
    eukaryoteTick,
    eukaryoteYear,
    greeningTick,
    greeningYear,
    evolutionEraTick,
    evolutionEraYear,
    firstLandFaunaTick,
    firstLandFaunaYear,
    firstLandVertebrateTick,
    firstLandVertebrateYear,
    firstSentienceTick,
    firstSentienceYear,
    civilizedEraTick,
    civilizedEraYear,
    firstSentientClassId,
    endO2Pct: config.o2Pct,
    peakO2Pct,
    endBiomassPct: metrics.totalBiomassPct,
    endAvgTempC: metrics.averageTemperatureC,
    endActiveClassCount,
    peakCarnifernToInsectRatio,
    meanCarnifernToInsectRatio:
      ratioSamples > 0 ? ratioSum / ratioSamples : null,
    classes,
  };
}

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Summarize a sample of observed numeric values with mean, sample SD, SE, and percentiles. */
export function summarizeNumeric(
  values: readonly number[],
  total: number,
): NumericSummary {
  const n = values.length;
  const rate = total > 0 ? n / total : 0;
  if (n === 0) {
    return {
      n: 0,
      total,
      rate,
      mean: null,
      stdDev: null,
      se: null,
      min: null,
      p10: null,
      median: null,
      p90: null,
      max: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  let sqDiffSum = 0;
  for (const v of sorted) {
    const d = v - mean;
    sqDiffSum += d * d;
  }
  const stdDev = n > 1 ? Math.sqrt(sqDiffSum / (n - 1)) : 0;
  return {
    n,
    total,
    rate,
    mean,
    stdDev,
    se: stdDev / Math.sqrt(n),
    min: sorted[0],
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    max: sorted[n - 1],
  };
}

/** Compute probability and 95% Wilson score confidence interval for a Bernoulli count. */
export function summarizeBernoulli(
  count: number,
  total: number,
): BernoulliSummary {
  if (total <= 0) {
    return {count: 0, total: 0, probability: 0, ciLow: 0, ciHigh: 0};
  }
  const p = count / total;
  const z = 1.959963984540054;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denom;
  return {
    count,
    total,
    probability: p,
    ciLow: Math.max(0, center - half),
    ciHigh: Math.min(1, center + half),
  };
}

function collectNonNull<T>(
  items: readonly T[],
  pick: (item: T) => number | null,
): number[] {
  const out: number[] = [];
  for (const item of items) {
    const v = pick(item);
    if (v !== null) out.push(v);
  }
  return out;
}

/** Aggregate per-trial results into mean/variance/CI distributions across all markers. */
export function summarizeEvalTrials(
  preset: PlanetType,
  maxTicks: number,
  varyTerrain: boolean,
  baseSeed: number,
  trials: readonly TrialResult[],
): EvalSummary {
  const runs = trials.length;

  const classes: ClassEvalSummary[] = ALL_CLASSES.map(def => {
    const id = def.id;
    let emergedCount = 0;
    let firstSentientCount = 0;
    let everSentientCount = 0;
    let extinctCount = 0;
    const emergedTicks: number[] = [];
    const sentientTicks: number[] = [];
    const peakCellVals: number[] = [];
    const endCellVals: number[] = [];

    for (const trial of trials) {
      const outcome = trial.classes[id];
      if (!outcome) continue;
      peakCellVals.push(outcome.peakCells);
      endCellVals.push(outcome.endCells);
      if (outcome.emergedTick !== null) {
        emergedCount++;
        emergedTicks.push(outcome.emergedTick);
      }
      if (outcome.sentientTick !== null) {
        everSentientCount++;
        sentientTicks.push(outcome.sentientTick);
      }
      if (trial.firstSentientClassId === id) {
        firstSentientCount++;
      }
      if (outcome.extinctAfterEmerging) {
        extinctCount++;
      }
    }

    return {
      classId: id,
      name: LIFE_CLASSES_BY_ID.get(id)?.name ?? `Class ${id}`,
      emerged: summarizeBernoulli(emergedCount, runs),
      firstSentient: summarizeBernoulli(firstSentientCount, runs),
      everSentient: summarizeBernoulli(everSentientCount, runs),
      extinctAfterEmerging: summarizeBernoulli(extinctCount, emergedCount),
      emergedTick: summarizeNumeric(emergedTicks, runs),
      sentientTick: summarizeNumeric(sentientTicks, runs),
      peakCells: summarizeNumeric(peakCellVals, runs),
      endCells: summarizeNumeric(endCellVals, runs),
    };
  });

  const anySentienceCount = trials.filter(
    t => t.firstSentienceTick !== null,
  ).length;

  return {
    preset,
    runs,
    maxTicks,
    varyTerrain,
    baseSeed,
    milestones: {
      eukaryoteTick: summarizeNumeric(
        collectNonNull(trials, t => t.eukaryoteTick),
        runs,
      ),
      eukaryoteYear: summarizeNumeric(
        collectNonNull(trials, t => t.eukaryoteYear),
        runs,
      ),
      greeningTick: summarizeNumeric(
        collectNonNull(trials, t => t.greeningTick),
        runs,
      ),
      greeningYear: summarizeNumeric(
        collectNonNull(trials, t => t.greeningYear),
        runs,
      ),
      evolutionEraTick: summarizeNumeric(
        collectNonNull(trials, t => t.evolutionEraTick),
        runs,
      ),
      evolutionEraYear: summarizeNumeric(
        collectNonNull(trials, t => t.evolutionEraYear),
        runs,
      ),
      firstLandFaunaTick: summarizeNumeric(
        collectNonNull(trials, t => t.firstLandFaunaTick),
        runs,
      ),
      firstLandFaunaYear: summarizeNumeric(
        collectNonNull(trials, t => t.firstLandFaunaYear),
        runs,
      ),
      firstLandVertebrateTick: summarizeNumeric(
        collectNonNull(trials, t => t.firstLandVertebrateTick),
        runs,
      ),
      firstLandVertebrateYear: summarizeNumeric(
        collectNonNull(trials, t => t.firstLandVertebrateYear),
        runs,
      ),
      firstSentienceTick: summarizeNumeric(
        collectNonNull(trials, t => t.firstSentienceTick),
        runs,
      ),
      firstSentienceYear: summarizeNumeric(
        collectNonNull(trials, t => t.firstSentienceYear),
        runs,
      ),
      civilizedEraTick: summarizeNumeric(
        collectNonNull(trials, t => t.civilizedEraTick),
        runs,
      ),
      civilizedEraYear: summarizeNumeric(
        collectNonNull(trials, t => t.civilizedEraYear),
        runs,
      ),
    },
    ecology: {
      endO2Pct: summarizeNumeric(
        trials.map(t => t.endO2Pct),
        runs,
      ),
      peakO2Pct: summarizeNumeric(
        trials.map(t => t.peakO2Pct),
        runs,
      ),
      endBiomassPct: summarizeNumeric(
        trials.map(t => t.endBiomassPct),
        runs,
      ),
      endAvgTempC: summarizeNumeric(
        trials.map(t => t.endAvgTempC),
        runs,
      ),
      endActiveClassCount: summarizeNumeric(
        trials.map(t => t.endActiveClassCount),
        runs,
      ),
      peakCarnifernToInsectRatio: summarizeNumeric(
        collectNonNull(trials, t => t.peakCarnifernToInsectRatio),
        runs,
      ),
      meanCarnifernToInsectRatio: summarizeNumeric(
        collectNonNull(trials, t => t.meanCarnifernToInsectRatio),
        runs,
      ),
    },
    anySentience: summarizeBernoulli(anySentienceCount, runs),
    classes,
  };
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function fmtYear(year: number | null): string {
  if (year === null) return '-';
  if (year >= 1_000_000_000) return `${(year / 1_000_000_000).toFixed(2)} Byr`;
  if (year >= 1_000_000) return `${(year / 1_000_000).toFixed(1)} Myr`;
  if (year >= 10_000) return `${Math.round(year / 1_000)} kyr`;
  return `${Math.round(year)} yr`;
}

function fmtMeanSd(summary: NumericSummary, digits = 1): string {
  if (summary.mean === null || summary.stdDev === null) return '-';
  return `${summary.mean.toFixed(digits)} ± ${summary.stdDev.toFixed(digits)}`;
}

function fmtQuantiles(summary: NumericSummary, digits = 0): string {
  if (summary.median === null || summary.p10 === null || summary.p90 === null) {
    return '-';
  }
  return `${summary.median.toFixed(digits)} [${summary.p10.toFixed(digits)}–${summary.p90.toFixed(digits)}]`;
}

function fmtDelta(
  current: number | null,
  baseline: number | null,
  suffix = '',
  digits = 1,
): string {
  if (current === null || baseline === null) return '-';
  const diff = current - baseline;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(digits)}${suffix}`;
}

function pad(str: string, width: number, right = false): string {
  if (str.length >= width) return str;
  const spaces = ' '.repeat(width - str.length);
  return right ? spaces + str : str + spaces;
}

/** Render a human-readable terminal report (with optional baseline delta column). */
export function formatEvalReport(
  summary: EvalSummary,
  baseline?: EvalSummary,
  elapsedMs?: number,
): string {
  const lines: string[] = [];
  const terrainTag = summary.varyTerrain ? 'varied-terrain' : 'fixed-terrain';
  const elapsedTag =
    elapsedMs !== undefined ? `, ${(elapsedMs / 1000).toFixed(1)}s` : '';
  lines.push(
    `=== GaiaSim Eval: ${summary.preset.toUpperCase()} (n=${summary.runs}, ticks=${summary.maxTicks}, seed=${summary.baseSeed}, ${terrainTag}${elapsedTag}) ===`,
  );
  lines.push(
    `Any Sentience: ${summary.anySentience.count}/${summary.runs} (${fmtPct(summary.anySentience.probability)}, 95% CI ${fmtPct(summary.anySentience.ciLow)}–${fmtPct(summary.anySentience.ciHigh)})`,
  );
  lines.push('');

  lines.push('--- Experience Milestones ---');
  const mHeaders = [
    pad('Milestone', 24),
    pad('Reach', 8, true),
    pad('Mean ± SD (ticks)', 19, true),
    pad('Med [p10–p90]', 16, true),
    pad('Mean Year', 12, true),
    ...(baseline ? [pad('Δ Mean', 10, true)] : []),
  ];
  lines.push(mHeaders.join('  '));
  lines.push('-'.repeat(mHeaders.join('  ').length));

  const milestoneRows: ReadonlyArray<{
    label: string;
    tick: NumericSummary;
    year: NumericSummary;
    baseTick?: NumericSummary;
  }> = [
    {
      label: 'Eukaryote Emergence',
      tick: summary.milestones.eukaryoteTick,
      year: summary.milestones.eukaryoteYear,
      baseTick: baseline?.milestones.eukaryoteTick,
    },
    {
      label: 'Continents Green (4% O2)',
      tick: summary.milestones.greeningTick,
      year: summary.milestones.greeningYear,
      baseTick: baseline?.milestones.greeningTick,
    },
    {
      label: 'Era -> Evolution',
      tick: summary.milestones.evolutionEraTick,
      year: summary.milestones.evolutionEraYear,
      baseTick: baseline?.milestones.evolutionEraTick,
    },
    {
      label: 'First Land Fauna',
      tick: summary.milestones.firstLandFaunaTick,
      year: summary.milestones.firstLandFaunaYear,
      baseTick: baseline?.milestones.firstLandFaunaTick,
    },
    {
      label: 'First Land Vertebrate',
      tick: summary.milestones.firstLandVertebrateTick,
      year: summary.milestones.firstLandVertebrateYear,
      baseTick: baseline?.milestones.firstLandVertebrateTick,
    },
    {
      label: 'First Sentience (Sp.16)',
      tick: summary.milestones.firstSentienceTick,
      year: summary.milestones.firstSentienceYear,
      baseTick: baseline?.milestones.firstSentienceTick,
    },
    {
      label: 'Era -> Civilized',
      tick: summary.milestones.civilizedEraTick,
      year: summary.milestones.civilizedEraYear,
      baseTick: baseline?.milestones.civilizedEraTick,
    },
  ];

  for (const row of milestoneRows) {
    const cols = [
      pad(row.label, 24),
      pad(fmtPct(row.tick.rate), 8, true),
      pad(fmtMeanSd(row.tick, 1), 19, true),
      pad(fmtQuantiles(row.tick, 0), 16, true),
      pad(fmtYear(row.year.mean), 12, true),
      ...(baseline
        ? [pad(fmtDelta(row.tick.mean, row.baseTick?.mean ?? null), 10, true)]
        : []),
    ];
    lines.push(cols.join('  '));
  }

  lines.push('');
  lines.push('--- Life Class Emergence, Abundance & Sentience Probability ---');
  const cHeaders = [
    pad('Class', 13),
    pad('Emerge', 7, true),
    pad('1st Sent (95% CI)', 22, true),
    pad('Any Sent', 9, true),
    pad('Emerge t', 11, true),
    pad('Peak Cells', 14, true),
    pad('End Cells', 13, true),
    pad('Extinct', 8, true),
    ...(baseline ? [pad('Δ 1st%', 9, true)] : []),
  ];
  lines.push(cHeaders.join('  '));
  lines.push('-'.repeat(cHeaders.join('  ').length));

  const baseClassById = new Map(
    (baseline?.classes ?? []).map(c => [c.classId, c]),
  );

  for (const cls of summary.classes) {
    const firstStr = `${fmtPct(cls.firstSentient.probability)} (${fmtPct(cls.firstSentient.ciLow)}–${fmtPct(cls.firstSentient.ciHigh)})`;
    const baseCls = baseClassById.get(cls.classId);
    const cols = [
      pad(cls.name, 13),
      pad(fmtPct(cls.emerged.probability), 7, true),
      pad(firstStr, 22, true),
      pad(fmtPct(cls.everSentient.probability), 9, true),
      pad(
        cls.emergedTick.mean !== null ? cls.emergedTick.mean.toFixed(1) : '-',
        11,
        true,
      ),
      pad(fmtMeanSd(cls.peakCells, 0), 14, true),
      pad(fmtMeanSd(cls.endCells, 0), 13, true),
      pad(
        cls.emerged.count > 0
          ? fmtPct(cls.extinctAfterEmerging.probability)
          : '-',
        8,
        true,
      ),
      ...(baseline
        ? [
            pad(
              fmtDelta(
                cls.firstSentient.probability * 100,
                baseCls ? baseCls.firstSentient.probability * 100 : null,
                '%',
                1,
              ),
              9,
              true,
            ),
          ]
        : []),
    ];
    lines.push(cols.join('  '));
  }

  lines.push('');
  lines.push('--- Ecology & Atmosphere (at end of run) ---');
  const eHeaders = [
    pad('Metric', 28),
    pad('Mean ± SD', 18, true),
    pad('Med [p10–p90]', 18, true),
    ...(baseline ? [pad('Δ Mean', 10, true)] : []),
  ];
  lines.push(eHeaders.join('  '));
  lines.push('-'.repeat(eHeaders.join('  ').length));

  const ecoRows: ReadonlyArray<{
    label: string;
    val: NumericSummary;
    baseVal?: NumericSummary;
    digits: number;
  }> = [
    {
      label: 'End O2 (%)',
      val: summary.ecology.endO2Pct,
      baseVal: baseline?.ecology.endO2Pct,
      digits: 1,
    },
    {
      label: 'Peak O2 (%)',
      val: summary.ecology.peakO2Pct,
      baseVal: baseline?.ecology.peakO2Pct,
      digits: 1,
    },
    {
      label: 'End Biomass (%)',
      val: summary.ecology.endBiomassPct,
      baseVal: baseline?.ecology.endBiomassPct,
      digits: 1,
    },
    {
      label: 'End Avg Temp (°C)',
      val: summary.ecology.endAvgTempC,
      baseVal: baseline?.ecology.endAvgTempC,
      digits: 1,
    },
    {
      label: 'End Active Classes',
      val: summary.ecology.endActiveClassCount,
      baseVal: baseline?.ecology.endActiveClassCount,
      digits: 1,
    },
    {
      label: 'Peak Carnifern:Insect Ratio',
      val: summary.ecology.peakCarnifernToInsectRatio,
      baseVal: baseline?.ecology.peakCarnifernToInsectRatio,
      digits: 3,
    },
    {
      label: 'Mean Carnifern:Insect Ratio',
      val: summary.ecology.meanCarnifernToInsectRatio,
      baseVal: baseline?.ecology.meanCarnifernToInsectRatio,
      digits: 3,
    },
  ];

  for (const row of ecoRows) {
    const cols = [
      pad(row.label, 28),
      pad(fmtMeanSd(row.val, row.digits), 18, true),
      pad(fmtQuantiles(row.val, row.digits), 18, true),
      ...(baseline
        ? [
            pad(
              fmtDelta(row.val.mean, row.baseVal?.mean ?? null, '', row.digits),
              10,
              true,
            ),
          ]
        : []),
    ];
    lines.push(cols.join('  '));
  }

  return lines.join('\n');
}
