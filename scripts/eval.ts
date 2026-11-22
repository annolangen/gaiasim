import {fork} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {availableParallelism} from 'node:os';
import {fileURLToPath} from 'node:url';
import {
  formatEvalReport,
  runHeadlessTrial,
  summarizeEvalTrials,
} from '../src/sim/eval';
import type {EvalSummary, TrialResult} from '../src/sim/eval';
import type {PlanetType} from '../src/sim/types';

interface WorkerPayload {
  readonly preset: PlanetType;
  readonly seeds: readonly number[];
  readonly maxTicks: number;
  readonly varyTerrain: boolean;
  readonly terrainSeed: number;
}

if (process.argv.includes('--worker')) {
  process.once('message', (payload: WorkerPayload) => {
    const results: TrialResult[] = payload.seeds.map(seed =>
      runHeadlessTrial({
        preset: payload.preset,
        seed,
        maxTicks: payload.maxTicks,
        varyTerrain: payload.varyTerrain,
        terrainSeed: payload.terrainSeed,
      }),
    );
    process.send?.(results, () => process.exit(0));
  });
} else {
  const VALID_PRESETS: readonly PlanetType[] = [
    'archean',
    'cambrian',
    'earth',
    'pangaea',
    'archipelago',
    'daisyworld',
  ];
  const EVOLUTION_PRESETS: readonly PlanetType[] = [
    'archean',
    'cambrian',
    'earth',
    'pangaea',
    'archipelago',
  ];

  interface CliOptions {
    presets: PlanetType[];
    runs: number;
    ticks: number;
    seed: number;
    workers: number;
    varyTerrain: boolean;
    jsonPath?: string;
    comparePath?: string;
  }

  function printUsage(): void {
    console.log(
      [
        'Usage: npm run eval -- [options]',
        '',
        'Options:',
        '  --preset <name|all>   Planet preset (archean, cambrian, earth, pangaea, archipelago, daisyworld, all) [default: archean]',
        '  --runs <n>            Number of Monte Carlo trials per preset [default: 24]',
        '  --ticks <n>           Simulation ticks per trial [default: 600]',
        '  --seed <n>            Starting seed [default: 1]',
        '  --workers <n>         Parallel worker processes [default: available CPU cores]',
        '  --fixed-terrain       Keep one shared terrain map across runs (isolate evolution randomness)',
        '  --json <path>         Write structured EvalSummary JSON to disk',
        '  --compare <path>      Compare against a previously saved JSON summary',
        '  -h, --help            Show this help message',
      ].join('\n'),
    );
  }

  function parseArgs(argv: readonly string[]): CliOptions {
    let presetArg = 'archean';
    let runs = 24;
    let ticks = 600;
    let seed = 1;
    let workers = availableParallelism();
    let varyTerrain = true;
    let jsonPath: string | undefined;
    let comparePath: string | undefined;

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '-h' || arg === '--help') {
        printUsage();
        process.exit(0);
      } else if (arg === '--preset' && argv[i + 1]) {
        presetArg = argv[++i];
      } else if (arg === '--runs' && argv[i + 1]) {
        runs = Math.max(1, Number(argv[++i]));
      } else if (arg === '--ticks' && argv[i + 1]) {
        ticks = Math.max(1, Number(argv[++i]));
      } else if (arg === '--seed' && argv[i + 1]) {
        seed = Number(argv[++i]);
      } else if (arg === '--workers' && argv[i + 1]) {
        workers = Math.max(1, Number(argv[++i]));
      } else if (arg === '--fixed-terrain') {
        varyTerrain = false;
      } else if (arg === '--json' && argv[i + 1]) {
        jsonPath = argv[++i];
      } else if (arg === '--compare' && argv[i + 1]) {
        comparePath = argv[++i];
      } else {
        throw new Error(`Unknown or incomplete option: ${arg}`);
      }
    }

    const presets: PlanetType[] =
      presetArg === 'all'
        ? [...EVOLUTION_PRESETS]
        : VALID_PRESETS.includes(presetArg as PlanetType)
          ? [presetArg as PlanetType]
          : (() => {
              throw new Error(
                `Invalid --preset "${presetArg}". Expected one of: ${VALID_PRESETS.join(', ')}, all`,
              );
            })();

    return {
      presets,
      runs,
      ticks,
      seed,
      workers: Math.min(workers, runs),
      varyTerrain,
      jsonPath,
      comparePath,
    };
  }

  async function runPresetParallel(
    preset: PlanetType,
    runs: number,
    maxTicks: number,
    baseSeed: number,
    workerCount: number,
    varyTerrain: boolean,
  ): Promise<TrialResult[]> {
    const allSeeds = Array.from({length: runs}, (_, i) => baseSeed + i);
    if (workerCount <= 1) {
      return allSeeds.map(seed =>
        runHeadlessTrial({
          preset,
          seed,
          maxTicks,
          varyTerrain,
          terrainSeed: baseSeed,
        }),
      );
    }

    const buckets: number[][] = Array.from({length: workerCount}, () => []);
    allSeeds.forEach((s, i) => buckets[i % workerCount].push(s));

    const scriptPath = fileURLToPath(import.meta.url);
    const promises = buckets
      .filter(seeds => seeds.length > 0)
      .map(
        seeds =>
          new Promise<TrialResult[]>((resolve, reject) => {
            const payload: WorkerPayload = {
              preset,
              seeds,
              maxTicks,
              varyTerrain,
              terrainSeed: baseSeed,
            };
            const child = fork(scriptPath, ['--worker'], {
              execArgv: process.execArgv,
            });
            let settled = false;
            child.once('message', (res: TrialResult[]) => {
              settled = true;
              resolve(res);
            });
            child.once('error', err => {
              settled = true;
              reject(err);
            });
            child.once('exit', code => {
              if (!settled && code !== 0) {
                reject(new Error(`Eval worker exited with code ${code}`));
              }
            });
            child.send(payload);
          }),
      );

    const chunked = await Promise.all(promises);
    return chunked.flat().sort((a, b) => a.seed - b.seed);
  }

  async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    const baselineByPreset = new Map<PlanetType, EvalSummary>();
    if (opts.comparePath) {
      const parsed = JSON.parse(readFileSync(opts.comparePath, 'utf8')) as
        EvalSummary | EvalSummary[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        baselineByPreset.set(item.preset, item);
      }
    }

    const summaries: EvalSummary[] = [];
    for (const preset of opts.presets) {
      const start = performance.now();
      const trials = await runPresetParallel(
        preset,
        opts.runs,
        opts.ticks,
        opts.seed,
        opts.workers,
        opts.varyTerrain,
      );
      const elapsedMs = performance.now() - start;
      const summary = summarizeEvalTrials(
        preset,
        opts.ticks,
        opts.varyTerrain,
        opts.seed,
        trials,
      );
      summaries.push(summary);
      console.log(
        formatEvalReport(summary, baselineByPreset.get(preset), elapsedMs),
      );
      if (opts.presets.length > 1) console.log('');
    }

    if (opts.jsonPath) {
      const payload = summaries.length === 1 ? summaries[0] : summaries;
      writeFileSync(opts.jsonPath, JSON.stringify(payload, null, 2) + '\n');
      console.log(`Saved JSON summary to ${opts.jsonPath}`);
    }
  }

  void main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
