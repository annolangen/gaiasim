# Planetary Simulator Remake — Architecture & Implementation Plan (`plan.md`)

## 1. Primary Reference & License Baseline
* **Canonical Mechanics & Constants:** *SimEarth: The Living Planet™ User Manual* by Michael Bremer (Maxis / Ocean Software, 1990), specifically **Part III: "Inside the Simulation"** (pp. 122–148) and **Appendices / Planet Specification Sheets** (pp. 201–212).
  * Online PDF: `https://www.gamesdatabase.org/Media/SYSTEM/Microsoft_DOS//Manual/formated/Simearth_-_The_Living_Planet_-_Ocean.pdf`
* **Visual & Sprite Assets:** `CharlesAverill/terrasim` (MIT License) — reuse and adapt biome, life-form, and city tilesets for a crisp `128×64` grid renderer.
* **Architectural Reference:** `BradEwing/simearth` — reference implementation for clean browser-based state separation and tick scheduling.
* **IP Guardrail:** Avoid all Maxis/EA trademarks (*SimEarth*, *Sim-* prefix) and original manual prose/audio; implement only the uncopyrightable mathematical models, state machines, and public-domain Gaia/Daisyworld equations.

---

## 2. Core Simulation Architecture (`128×64` Cylindrical Grid)
Per the **Simulation Flow Chart** (*SimEarth Manual*, p. 148), each simulation tick executes five coupled subsystems in strict order across an $8,192$-cell (`128 × 64`) wrapped cylindrical array (`Float32Array` / `Uint8Array` buffers):

1. **Geosphere** (*Manual*, p. 127): Mantle convection, continental drift (plate vectors), magma plumes, volcanic uplift, erosion, and sea-level displacement.
2. **Atmosphere** (*Manual*, p. 129): Global gas reservoirs ($N_2$, $O_2$, $CO_2$, $CH_4$), atmospheric pressure, solar input, albedo reflection, and greenhouse heat retention.
3. **Climate** (*Manual*, p. 131): Latitudinal insolation, Hadley/Ferrel/Polar wind cells, evaporation, orographic rainfall, ocean currents, and surface temperature.
4. **Life and Evolution** (*Manual*, p. 133): Biome classification, food-web energy transfer, population growth/starvation, mutation, speciation, and intelligence thresholds.
5. **Civilization & Energy** (*Manual*, pp. 142–145): Tech-level progression (Stone Age → Nanotech), fuel consumption (Wood → Coal → Oil → Nuclear → Fusion), pollution, and Gaia energy budget.

---

## 3. Manual-Referenced Constants & Lookup Tables

### A. Biome Classification Matrix (*Manual*, "Climate" & "Life", pp. 131–135)
Each cell resolves its `BiomeType` from `altitude`, `temperature` ($^\circ\text{C}$), and `rainfall` ($\text{cm/yr}$):

| Biome ID | Biome Name | Altitude / Condition | Temp Range ($^\circ\text{C}$) | Rainfall ($\text{cm/yr}$) | Base Albedo ($\alpha$) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `0` | **Ocean** | `alt <= 0` | $> -2$ | N/A | `0.08` |
| `1` | **Sea Ice / Arctic** | `alt <= 0` or polar cap | $\le -2$ | Any | `0.75` |
| `2` | **Desert** | `alt > 0` | $> 10$ | $< 25$ | `0.35` |
| `3` | **Grassland / Steppe** | `alt > 0` | $5 \text{ to } 30$ | $25 \text{ to } 75$ | `0.22` |
| `4` | **Forest (Deciduous)** | `alt > 0` | $5 \text{ to } 25$ | $75 \text{ to } 150$ | `0.16` |
| `5` | **Jungle (Rainforest)** | `alt > 0` | $> 22$ | $> 150$ | `0.12` |
| `6` | **Swamp / Marsh** | `0 < alt <= 2` | $> 10$ | $> 120$ | `0.14` |
| `7` | **Tundra** | `alt > 0` | $-10 \text{ to } 5$ | $15 \text{ to } 60$ | `0.45` |
| `8` | **Alpine / Rock** | `alt >= high_threshold` | $< 5$ | Any | `0.30` |

### B. Life-Form Biome & Atmosphere Preferences (*Manual*, "Life and Evolution", pp. 133–141)
Each taxonomic class is defined with its preferred biomes, evolutionary prerequisites, and atmospheric $O_2$ requirements (*Manual*, p. 133):

| Class ID | Evolves From | Min $O_2$ (%) | Temp Range ($^\circ\text{C}$) | Primary Biomes ($1.0\times$ Growth) | Secondary Biomes ($0.5\times$ Survival) | Can Gain Sentience |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `PROKARYOTE` | `null` | `0.0` | $-5 \text{ to } 85$ | Ocean (`0`), Swamp (`6`) | Grassland (`3`), Forest (`4`) | `false` |
| `EUKARYOTE` | `PROKARYOTE` | `1.0` | $0 \text{ to } 50$ | Ocean (`0`) | Swamp (`6`) | `false` |
| `RADIATE` | `EUKARYOTE` | `3.0` | $2 \text{ to } 40$ | Ocean (`0`) | None | `false` |
| `ARTHROPOD` | `EUKARYOTE` | `5.0` | $5 \text{ to } 45$ | Ocean (`0`), Jungle (`5`), Swamp (`6`) | Grassland (`3`), Forest (`4`), Desert (`2`) | `true` |
| `MOLLUSK` | `EUKARYOTE` | `5.0` | $0 \text{ to } 38$ | Ocean (`0`) | Swamp (`6`) | `true` |
| `FISH` | `EUKARYOTE` | `8.0` | $0 \text{ to } 35$ | Ocean (`0`) | None | `false` |
| `AMPHIBIAN` | `FISH` | `12.0` | $10 \text{ to } 38$ | Swamp (`6`), Jungle (`5`) | Forest (`4`), Ocean (`0`) | `false` |
| `REPTILE` | `AMPHIBIAN` | `14.0` | $15 \text{ to } 48$ | Desert (`2`), Grassland (`3`), Swamp (`6`) | Forest (`4`), Jungle (`5`) | `true` |
| `DINOSAUR` | `REPTILE` | `16.0` | $15 \text{ to } 45$ | Grassland (`3`), Forest (`4`), Jungle (`5`) | Swamp (`6`), Desert (`2`) | `true` |
| `BIRD` | `DINOSAUR` | `17.0` | $-15 \text{ to } 45$ | Forest (`4`), Jungle (`5`), Grassland (`3`) | Tundra (`7`), Alpine (`8`), Swamp (`6`) | `true` |
| `MAMMAL` | `REPTILE` | `17.0` | $-20 \text{ to } 45$ | Grassland (`3`), Forest (`4`), Tundra (`7`) | Jungle (`5`), Desert (`2`), Alpine (`8`) | `true` |
| `CETACEAN` | `MAMMAL` | `18.0` | $-2 \text{ to } 35$ | Ocean (`0`) | None | `true` |
| `TRICHORDATE` | `AMPHIBIAN` | `15.0` | $5 \text{ to } 40$ | Forest (`4`), Swamp (`6`) | Grassland (`3`), Jungle (`5`) | `true` |
| `CARNIVORE` | `MAMMAL` | `18.0` | $-15 \text{ to } 45$ | Grassland (`3`), Forest (`4`) | Tundra (`7`), Jungle (`5`) | `true` |

### C. Core Mathematical Formulas (*Manual*, "Daisyworld", "Atmosphere", & "Climate", pp. 118–132)

#### 1. Planetary Radiative Equilibrium & Greenhouse Offset (*Manual*, pp. 129–131)
$$T_{\text{eq}} = \left( \frac{S \cdot L \cdot \cos(\phi) \cdot (1 - \alpha_{\text{cell}})}{4 \sigma \cdot (1 - G_{\text{trap}})} \right)^{1/4} - 273.15$$

* $S = 1361\ \text{W/m}^2$ (Solar constant)
* $L$ = stellar luminosity multiplier
* $\phi$ = cell latitude in $[-\frac{\pi}{2}, \frac{\pi}{2}]$
* $\sigma = 5.67 \times 10^{-8}\ \text{W m}^{-2}\text{K}^{-4}$ (Stefan-Boltzmann constant)
* $G_{\text{trap}} = \text{clamp}\left(k_{CO_2} \ln(1 + P_{CO_2}) + k_{H_2O} \cdot \text{vapor} + k_{CH_4} P_{CH_4},\ 0,\ 0.85\right)$

#### 2. Daisyworld Albedo & Parabolic Growth Feedback (*Manual*, p. 118)
$$\alpha_{\text{cell}} = p_{\text{bare}} \alpha_{\text{soil}} + p_w \alpha_w + p_b \alpha_b \quad (\alpha_w = 0.75,\ \alpha_b = 0.15)$$

$$\beta(T) = \max\left(0,\ 1 - 0.003265 \cdot (22.5 - T)^2\right)$$

$$\frac{dp_i}{dt} = p_i \left( p_{\text{bare}} \beta(T_i) - \gamma \right)$$

#### 3. Gas Exchange & Photosynthesis Loop (*Manual*, pp. 129, 134)
* **Plant / Prokaryote Photosynthesis:**
  $$\Delta O_2 = +k_{\text{photo}} \cdot \text{biomass}_{\text{plant}} \cdot \text{insolation}, \quad \Delta CO_2 = -\Delta O_2$$
* **Animal Respiration & Combustion:**
  $$\Delta CO_2 = +k_{\text{resp}} \cdot \text{biomass}_{\text{animal}} + k_{\text{civ}} \cdot \text{techLevel}, \quad \Delta O_2 = -\Delta CO_2$$

#### 4. Simulation Time Scales (*Manual*, p. 100)
* **Geologic:** $10^6\ \text{yr/tick}$ (plate tectonics active, fast evolution)
* **Evolution:** $10^5\ \text{yr/tick}$ (biome shifts & speciation)
* **Civilized:** $10^2\ \text{yr/tick}$ (cities, tech progression, pollution)
* **Technology:** $1\ \text{yr/tick}$ (industrial crisis, nuclear/climate feedback)

---

## 4. Phased Development Roadmap
* **Phase 1 — Data & Constants (`src/sim/constants.ts`):** Encode the biome matrix, `LIFE_CLASSES` preference table, time-scale multipliers, and Planet Specification presets (*Manual*, p. 212).
* **Phase 2 — Coupled Simulation Kernel (`src/sim/engine.ts`):** Implement the 5-stage tick loop on `128×64` typed arrays with zero DOM dependencies (enabling Web Worker offloading).
* **Phase 3 — Sprite & Shader Viewport (`src/render/canvas.ts`):** Load MIT sprite sheets from `terrasim` onto an HTML5 Canvas with zoom/pan, map-lens overlays (Biomes, Temperature, Rainfall, Wind Vectors, Life Class, Civilization), and smoothed isolines.
* **Phase 4 — Model Control Panels & Scenarios (`src/ui/`):** Build the manual's **Model Control Panels** (*Manual*, p. 94) allowing runtime tuning of solar input, axial tilt, mutation rate, and reproduction rate, plus classic scenarios (*Aquarium*, *Daisyworld*, *Mars*, *Venus*, *Earth*).