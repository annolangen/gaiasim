# GaiaSim Evaluation & Balance Notes

Living playbook and experiment log for tuning evolutionary pacing, ecological diversity, atmospheric homeostasis, and sentience probabilities using headless Monte Carlo simulation.

---

## 1. The Balance Tuning Loop

Because planetary evolution is stochastic across both continent layouts and evolutionary rolls, single manual playthroughs can easily mislead. Use this loop when tuning simulation parameters:

1. **Capture a baseline JSON** before changing knobs:
   ```bash
   npm run eval -- --preset archean --runs 24 --ticks 700 --json /tmp/eval_base.json
   ```
2. **Diagnose one bottleneck at a time** from the report:
   - Check **Experience Milestones** (`Reach %`, `Mean ± SD`, `Median [p10–p90]`, `Mean Year`).
   - Check **Life Class Emergence & Sentience** (`Emerge %`, `1st Sent` with 95% Wilson CI, `Peak`/`End Cells`, `Extinct %`).
   - Check **Ecology & Atmosphere** (`End O2`, `Peak O2`, `End Biomass`, `End Active Classes`, `Carnifern:Insect Ratio`).
3. **Adjust 1–2 related knobs** in `src/sim/constants.ts` or `src/sim/engine.ts`.
4. **Re-run with `--compare`** using the exact same `--seed`, `--runs`, and `--ticks`:
   ```bash
   npm run eval -- --preset archean --runs 24 --ticks 700 --compare /tmp/eval_base.json --json /tmp/eval_next.json
   ```
5. **Cross-check other presets** (`--preset cambrian`, `--preset earth`, `--preset all`) to ensure fixes don't regress later-era scenarios.
6. **Verify unit tests, lint, build, and browser feel**:
   ```bash
   npm run compile && npm test && npm run lint && npm run build
   ```
7. **Record the experiment** in the Experiment Log below and commit.

---

## 2. Headless Eval CLI Reference

The evaluation harness lives in `src/sim/eval.ts` (pure logic & statistics) and `scripts/eval.ts` (multi-process runner across CPU cores via `node:child_process.fork`).

```bash
npm run eval -- [options]
```

| Flag | Default | Purpose |
| :--- | :--- | :--- |
| `--preset <name\|all>` | `archean` | Preset to evaluate (`archean`, `cambrian`, `earth`, `pangaea`, `archipelago`, `daisyworld`, or `all`). |
| `--runs <n>` | `24` | Number of Monte Carlo trials per preset (`seed`, `seed+1`, …, `seed+n-1`). |
| `--ticks <n>` | `600` | Simulation ticks per trial. |
| `--seed <n>` | `1` | Starting seed for deterministic Mulberry32 PRNGs. |
| `--workers <n>` | CPU cores | Parallel worker processes. |
| `--fixed-terrain` | off | Reuse one deterministic continent map across all trials to isolate evolutionary randomness from geography variance. |
| `--json <path>` | — | Write full `EvalSummary` JSON to disk for later diffs. |
| `--compare <path>` | — | Print `Δ Mean` and `Δ 1st%` columns against a saved JSON baseline. |

### Practical Statistics Notes
- **Sample size vs. precision:** At `n = 24` (~55–60s on 12 cores for 700 ticks), timing means (`± SD`) are well-estimated, while Bernoulli 95% Wilson CIs are roughly `±15–20%`. Use `n = 24` for fast iteration and `n = 60–100` (`--runs 60` or `100`) when validating subtle sentience-probability shifts.
- **Separating variance sources:** Compare a default varied-terrain run against `--fixed-terrain` to see whether high variance comes from continent geography (e.g., coastal shelf area) or evolutionary RNG.

---

## 3. Experience Markers & Target Heuristics

| Marker | What It Measures for the Player | Working Target (`archean`, 700 ticks) |
| :--- | :--- | :--- |
| **Eukaryote Emergence** | Early primordial progress; shouldn't feel stalled | ~30–60 ticks (`100%` reach) |
| **Continents Green (`4% O₂`)** | Visual "Great Oxidation" transformation of barren rock into plant biomes | ~100–140 ticks (`100%` reach) |
| **Era → Evolution** | Transition from `1 Myr/tick` Geologic era to `100 kyr/tick` Evolution era | ~120–160 ticks (`100%` reach) |
| **First Land Fauna / Vertebrate** | Life moving from seas onto continents | ~200–260 ticks (`100%` reach) |
| **Biodiversity (`End Active Classes`)** | Richness of coexisting biomes & food webs | ≥ 12 of 15 classes active |
| **Mammal & Cetacean Emergence** | Full evolutionary tree reachable without dead ends | `90–100%` emergence |
| **First Sentience (`Sp.16`)** | Climax triggering `Era → Civilized` (`100 yr/tick`) | ~450–650 ticks; led by Mammals, with occasional Avians/Dinosaurs/Cetaceans/Reptiles and rare invertebrates |
| **Atmospheric Homeostasis (`End O₂`)** | Realistic Earth-like O₂ equilibrium | ~21–24% O₂ (not drifting to 30%+) |
| **Carnifern : Insect Ratio** | Exotic co-evolving predator should feel sparse, not 1:1 and not permanently extinct | Sparse persistence (~`0.03–0.08` mean ratio, low extinction) |

---

## 4. Inventory of Balance Knobs

### Time Scales & Era Transitions
- `TIME_SCALES` (`src/sim/constants.ts`): `yearsPerTick` and `advancementMultiplier` per era (`geologic`, `evolution`, `civilized`, `technology`, `daisyworld`).
- `updateTimeScale()` (`src/sim/engine.ts`): thresholds for `geologic → evolution` (any land fauna, or `O₂ ≥ 8%` + Arthropod/Fish) and `evolution → civilized` (first `Sp.16`).

### Species Advancement (`Sp.1 → Sp.15`) & Sentience (`Sp.15 → Sp.16`)
- `BASE_PLANETARY_ADVANCEMENT_RATE` (`0.14`) and `BASE_PLANETARY_SENTIENCE_RATE` (`0.006`) in `src/sim/engine.ts`.
- `computeSpeciesAdvancementProb()` (`src/sim/engine.ts`): `popFactor = min(1, sqrt(classCellCount / 160))`, `speciesFactor` (`1.0` for `1–8`, `0.65` for `9–12`, `0.35` for `13–15`), normalized by frontier `speciesCellCount`.
- Per-class `advancementRate` and `sentienceRate` in `LIFE_CLASSES` (`src/sim/constants.ts`).

### Mutation & Co-Evolution
- In-place mutation (`Pass 1`) and cross-habitat mutation (`Pass 2`, both empty and occupied lower-rank neighbors) probabilities in `updateLife()` (`src/sim/engine.ts`).
- Mutation species-slot windows (`mutations` / `evolvesFrom`) in `LIFE_CLASSES` (`src/sim/constants.ts`).
- Carnifern co-evolution gates in `updateLife()` (`src/sim/engine.ts`): `earlyInsectCells >= 3`, `carnifernCells === 0`, global cap (`< 15%` of Insects), per-tile prob (`0.002`).

### Habitat Suitability, Competition & Food Web
- `SUITABILITY_MULTIPLIERS` (`[0, 0.25, 0.6, 1.0]`) and per-class `habitatPreferences`, `minO2Pct`, `minTempC`, `maxTempC`, and `competitionRank` in `src/sim/constants.ts`.
- `lifeAdvancementScore()` (`rank * 20 + species`) and Pass 2 competition rules (`suit > nSuit` or equal suitability with advancement edge) in `src/sim/engine.ts`.
- Trophic food-chain formulas (Tiers 2–5) and Carnifern crowding penalty in `updateLife()` (`src/sim/engine.ts`).

### Atmosphere & Presets
- `PLANT_BIOME_MIN_O2_PCT` (`4%`) in `src/sim/constants.ts`.
- O₂ photosynthesis (`eukaryoteFrac * 1.4 + plantFrac * 0.45`), animal respiration (`animalFrac * 0.15`), and `oxidationSink` (`(o2Pct - 21) * 0.045`) in `updateLife()` Pass 3 (`src/sim/engine.ts`).
- `PLANET_PRESETS` (`src/sim/engine.ts`): era terrain, atmosphere, time scale, and starting life seeds.

---

## 5. Experiment Log

### Exp 0 — Baseline (`386bbd3`, `archean`, `n=24`, `ticks=700`, `seed=1`)
- **Milestones:** Eukaryote `42.8 ± 9.0`, Greening `121.5 ± 10.2`, `Era → Evolution` `137.0 ± 10.3`, First Land Vertebrate `251.6 ± 41.0`, Any Sentience `41.7%` (`583.3 ± 67.3`).
- **Key Findings:**
  - **Avian bottleneck:** `Avian` (`competitionRank: 10`) mutated from `Dinosaur Sp.1–4` and displaced `Dinosaur` (`9`) and `Reptile` (`8`) even in Grassland/Desert, collapsing Reptiles (`34.8%` extinct) and Dinosaurs (`39.1%` extinct) before they reached `Mammal` mutation slots. Result: `Mammal` emerged in only `29.2%` of runs, `Cetacean` `0.0%`, and `Avian` won `37.5%` (9/10) of sentience runs vs `Mammal` `4.2%`.
  - **Carnifern over-nerf:** Emerged in `95.8%` of runs but peaked at `4 ± 2` cells and went extinct in `95.7%` (`mean ratio 0.003`).
  - **Atmosphere:** `End O2 23.8 ± 2.0%`, `End Biomass 21.4 ± 1.6%`, `End Active Classes 11.2 ± 1.2`.

### Exp 1 — Avian Bottleneck & Coastal Cetacean Fix (`archean`, `n=24`, `ticks=700`, `seed=1`)
- **Changes:**
  - Added habitat-suitability protection in Pass 2 competition (`suit > nSuit`, or `suit === nSuit && score > nScore`).
  - Made `Avian` peer to `Dinosaur` (`competitionRank: 9`, with `Mammal: 10`, `Cetacean: 11`), keeping `rank * 20 + species` so ancestors don't overwrite newly mutated descendants.
  - Allowed cross-habitat mutation into occupied neighbors of strictly lower `competitionRank` (`0.008` prob), unblocking coastal `Mammal → Cetacean`.
- **Results vs. Exp 0:**
  - `Mammal` emergence: `29.2% → 100.0%` (`t=395.5`, `476 ± 258` cells, `0%` extinct); 1st-sentient share `4.2% → 33.3%` (`+29.2%`, 8/10 sentient runs).
  - `Cetacean` emergence: `0.0% → 100.0%` (`t=494.4`, `302 ± 170` cells, `0%` extinct).
  - `Avian` 1st-sentient share: `37.5% → 8.3%` (`-29.2%`); `End Cells 595 → 115`.
  - `Reptile` extinction `34.8% → 4.2%`; `Dinosaur` extinction `39.1% → 16.7%`; `End Active Classes` `11.2 → 13.1`.
- **New / Remaining Items for Next Session:**
  1. **O₂ Equilibrium (`End O2 29.4%`, `+5.6%`):** Habitat protection preserved deep-sea Eukaryotes (`2270` cells), pushing equilibrium O₂ up from `23.8%` to `29.4%`. Tune `oxidationSink` (or scale deep-sea/Eukaryote O₂ production) to pull equilibrium back near `21–23%`.
  2. **Carnifern Persistence (`Peak 3 ± 2`, `86.4%` extinct):** Soften Carnifern crowding penalty from quadratic (`1 / carnifernCells²`) to linear (`1 / carnifernCells`), raise cap slightly (`+0.25`, max `0.55`), and set `competitionRank: 5` so Carniferns persist at a sparse ~1:15–1:25 ratio.
  3. **Multi-preset sweep:** Run `--preset all --runs 24 --ticks 700` to verify `cambrian`, `earth`, `pangaea`, and `archipelago` balance alongside `archean`.
