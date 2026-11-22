# Planetary Simulator Remake — Architecture & Implementation Plan (`plan.md`)

## 1. Primary Reference & License Baseline
* **Canonical Mechanics & Constants:** *SimEarth: The Living Planet™ User Manual* by Michael Bremer (Maxis / Ocean Software, 1990), specifically **Part III: "Inside the Simulation"** (pp. 122–148) and **Appendices / Planet Specification Sheets** (pp. 201–212).
  * Online PDF: `https://www.gamesdatabase.org/Media/SYSTEM/Microsoft_DOS//Manual/formated/Simearth_-_The_Living_Planet_-_Ocean.pdf`
* **Visual & Sprite Assets:** `CharlesAverill/terrasim` (MIT License) — reuse and adapt biome, life-form, and city tilesets for a crisp `128×64` grid renderer.
* **Architectural Reference:** `BradEwing/simearth` — reference implementation for clean browser-based state separation and tick scheduling.
* **IP Guardrail:** Avoid all Maxis/EA trademarks (*SimEarth*, *Sim-* prefix) and original manual prose/audio; implement only the uncopyrightable mathematical models, state machines, and public-domain Gaia/Daisyworld equations.

---

## 2. Core Simulation Architecture (`128×64` Cylindrical Grid)
Per the **Simulation Flow Chart** (*Manual*, p. 148), each simulation tick executes five coupled subsystems in strict order across an $8,192$-cell (`128 × 64`) wrapped cylindrical array (`Float32Array` / `Uint8Array` buffers):

1. **Geosphere** (*Manual*, p. 127): Mantle convection, continental drift (plate vectors), magma plumes, volcanic uplift, erosion, and sea-level displacement.
2. **Atmosphere** (*Manual*, p. 129): Global gas reservoirs ($N_2$, $O_2$, $CO_2$, $CH_4$), atmospheric pressure, solar input, albedo reflection, and greenhouse heat retention.
3. **Climate** (*Manual*, p. 131): Latitudinal insolation, Hadley/Ferrel/Polar wind cells, evaporation, orographic rainfall, ocean currents, and surface temperature.
4. **Life and Evolution** (*Manual*, pp. 133–141): Biome classification, two-step evolution (within-class species advancement `1..16` and cross-class mutation), trophic/food-chain dependencies, competition, and sentience at species 16.
5. **Civilization & Energy** (*Manual*, pp. 142–145): Tech-level progression (Stone Age → Nanotech), fuel consumption (Wood → Coal → Oil → Nuclear → Fusion), pollution, and Gaia energy budget.

---

## 3. Manual-Referenced Tables & Simulation Models

### A. Terrain, Ocean Depth Tiers & Biome Classification (*Manual*, pp. 133–135, 141)

#### 1. Water Depth Tiers (`altitude <= 0`)
Depth below sea level determines both origin-of-life eligibility (*Manual*, p. 133) and marine biome suitability (*Manual*, p. 141):

| Tier ID | Water Zone | Depth Below Sea Level | Role in Life & Evolution | Base Albedo ($\alpha$) *(GaiaSim)* |
| :--- | :--- | :--- | :--- | :--- |
| `0a` | **Shelf** | $0 \text{ to } 1000\ \text{m}$ | Required for sea-life evolution; habitable by coastal land/marine transition classes | `0.10` |
| `0b` | **Ocean** | $1000 \text{ to } 2500\ \text{m}$ | Supports primordial origins of life and open-water marine classes | `0.08` |
| `0c` | **Deep Sea** | $> 2500\ \text{m}$ | Supports primordial origins of life; uninhabitable for Arthropod, Mollusk, and Cetacean | `0.06` |

*(When ocean surface temperature drops $\le -2^\circ\text{C}$, ice forms over water with high albedo $\alpha = 0.75$.)*

#### 2. Land Biome Preference Chart (*Manual*, pp. 134–135)
Land cells (`altitude > 0`) resolve to **7 vegetated/climate biomes** plus **Rock** (barren / no biome, e.g. high altitude, insufficient $CO_2$, or newly raised crust):

| Temperature \ Rainfall | **Dry** ($< 30\ \text{cm/yr}$) | **Moderate** ($30\text{–}90\ \text{cm/yr}$) | **Wet** ($> 90\ \text{cm/yr}$) |
| :--- | :--- | :--- | :--- |
| **Cold** ($< 0^\circ\text{C}$) | **Arctic** | **Boreal Forest** | **Boreal Forest** |
| **Moderate** ($0\text{–}25^\circ\text{C}$) | **Desert** | **Temp. Grasslands** | **Forest** |
| **Hot** ($> 25^\circ\text{C}$) | **Desert** | **Swamp** | **Jungle** |

| Biome Key | Name | Sprite Stem | Base Albedo ($\alpha$) *(GaiaSim)* | Notes (*Manual*, pp. 134–135) |
| :--- | :--- | :--- | :--- | :--- |
| `ROCK` | **Rock / Alpine** | `land/16..31` | `0.30` | Lack of biome (barren crust / high altitude); uninhabitable for all 15 life classes |
| `ARCTIC` | **Arctic** | `arctic` | `0.75` | Cold & dry; uninhabitable for all 15 life classes |
| `BOREAL` | **Boreal Forest** | `boreal` | `0.35` | Cold with moderate-to-high rainfall |
| `DESERT` | **Desert** | `desert` | `0.35` | Moderate-to-hot with very little rainfall |
| `GRASS` | **Temp. Grasslands** | `grass` | `0.22` | Moderate temperature and rainfall |
| `FOREST` | **Forest** | `forest` | `0.16` | Moderate temperature and high rainfall |
| `JUNGLE` | **Jungle** | `jungle` | `0.12` | Hot and wet (includes river systems habitable by Cetaceans, p. 138) |
| `SWAMP` | **Swamp** | `swamp` | `0.14` | Hot with moderate rainfall |

---

### B. Life-Form Taxonomy, Evolution Graph & Biome Preferences (*Manual*, pp. 133–141)

#### 1. 15-Class Evolutionary Graph (*Manual*, pp. 135–141)
There are **15 life classes** (**7 sea**, **8 land**), each containing **16 species** (`1..16`, 240 species total). Reaching **species 16** grants sentience (*Manual*, p. 135). Evolution has two step types (*Manual*, p. 134):
* **Advancement:** stepping `species k → k + 1` within the same class (probability increases with planetary population size, p. 133).
* **Mutation:** jumping from an eligible species-slot range of a parent class into species `1` of a child class. A class may have **multiple ancestors**, and **Carniferns** are not manually placeable — they co-evolve from land plants when Insects are present (*Manual*, pp. 135, 139, 141).

| ID | Class | Domain | Sprite Folder | Manual Place | Evolves From *(Parent & Species Slots)* | Outgoing Mutations *(Species Slots → Child)* | Metabolism / Notes (*Manual*, pp. 136–141) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `1` | **Prokaryote** | Sea | `bacteria` | Yes | Spontaneous in Deep Sea / Ocean | `9–16` → Eukaryote | Anaerobic, methane-consuming/releasing (p. 136) |
| `2` | **Eukaryote** | Sea | `amoeba` | Yes | Prokaryote (`9–16`) | `13–16` → Radiate | Aerobic, photosynthesizing (+$O_2$, p. 136) |
| `3` | **Radiate** | Sea | `starfish` | Yes | Eukaryote (`13–16`) | `1–8` → Arthropod; `9–12` → Trichordate | Radially symmetrical marine life |
| `4` | **Arthropod** | Sea | `crab` | Yes | Radiate (`1–8`) | `1–4` → Mollusk; `5–12` → Insect | Marine arthropods (crabs, lobsters, crayfish) |
| `5` | **Mollusk** | Sea | `octopus` | Yes | Arthropod (`1–4`) | `5–12` → Fish | Shelled/cephalopod marine life |
| `6` | **Fish** | Sea | `fish` | Yes | Mollusk (`5–12`) | `1–8` → Amphibian; `9–12` → Trichordate | Bony marine vertebrates |
| `7` | **Cetacean** | Sea | `whale` | Yes | Mammal (`5–12`) | `13–16` → Mammal | Marine mammals; also inhabit Jungle rivers (p. 138) |
| `8` | **Trichordate** | Land | `trichordate` | Yes | Radiate (`9–12`), Fish (`9–12`) | None (dead-end class) | Three-chord spine class; can still reach sp. 16 |
| `9` | **Insect** | Land | `insect` | Yes | Arthropod (`5–12`) | `1–4` co-evolve Carnifern from plants | Terrestrial arthropods; prey base for Carniferns |
| `10` | **Amphibian** | Land | `amphibian` | Yes | Fish (`1–8`) | `1–8` → Reptile | Coastal/wetland cold-blooded vertebrates |
| `11` | **Reptile** | Land | `reptile` | Yes | Amphibian (`1–8`) | `1–8` → Dinosaur; `9–12` → Mammal | Cold-blooded terrestrial vertebrates |
| `12` | **Dinosaur** | Land | `dinosaur` | Yes | Reptile (`1–8`) | `1–4` → Avian; `5–8` → Mammal | Large terrestrial reptiles |
| `13` | **Avian** | Land | `bird` | Yes | Dinosaur (`1–4`) | None (dead-end class) | Warm-blooded feathered vertebrates |
| `14` | **Mammal** | Land | `mammal` | Yes | Cetacean (`13–16`), Reptile (`9–12`), Dinosaur (`5–8`) | `5–12` → Cetacean | Warm-blooded vertebrates |
| `15` | **Carnifern** | Land | `carnifern` | **No** | Plants (co-evolves with Insect `1–4`) | None (dead-end class) | Mobile carnivorous plants; depend on Insect prey (p. 141) |

#### 2. Chart of Life Classes and Preferred Biomes (*Manual*, p. 141)
Four-tier suitability directly from the Page 141 matrix:
* `0` = Cannot exist (`X`)
* `1` = Can exist here, but barely
* `2` = Can exist here fairly well
* `3` = Paradise

| Life Class | Shelf | Ocean | Deep Sea | Rock | Arctic | Boreal | Desert | Grass | Forest | Jungle | Swamp |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Prokaryote** | `3` | `3` | `3` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `0` |
| **Eukaryote** | `3` | `3` | `3` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `0` |
| **Radiate** | `3` | `3` | `2` | `0` | `0` | `0` | `0` | `0` | `0` | `1` | `1` |
| **Arthropod** | `3` | `3` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `1` | `2` |
| **Mollusk** | `3` | `3` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `2` | `1` |
| **Fish** | `3` | `3` | `2` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `0` |
| **Cetacean** | `3` | `3` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `2` | `0` |
| **Trichordate** | `0` | `0` | `0` | `0` | `0` | `3` | `1` | `1` | `3` | `3` | `2` |
| **Insect** | `3` | `0` | `0` | `0` | `0` | `2` | `2` | `2` | `2` | `2` | `2` |
| **Amphibian** | `3` | `0` | `0` | `0` | `0` | `1` | `0` | `1` | `2` | `3` | `3` |
| **Reptile** | `0` | `0` | `0` | `0` | `0` | `2` | `3` | `3` | `3` | `2` | `2` |
| **Dinosaur** | `0` | `0` | `0` | `0` | `0` | `2` | `1` | `1` | `3` | `3` | `2` |
| **Avian** | `0` | `0` | `0` | `0` | `0` | `3` | `1` | `2` | `3` | `3` | `1` |
| **Mammal** | `0` | `0` | `0` | `0` | `0` | `2` | `1` | `3` | `3` | `2` | `2` |
| **Carnifern** | `0` | `0` | `0` | `0` | `0` | `1` | `1` | `1` | `1` | `1` | `1` |

#### 3. Competition (*Manual*, p. 134)
When two life-forms occupy or spread into the same cell, the more advanced organism displaces the other based on class rank, species advancement (`1..16`), and intelligence/IQ; a newly mutated higher class takes precedence over lower forms.

---

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

#### 3. Gas Exchange & Photosynthesis Loop (*Manual*, pp. 129, 134, 136)
* **Eukaryote & Land Plant Biome Photosynthesis:**
  $$\Delta O_2 = +k_{\text{photo}} \cdot (\text{biomass}_{\text{eukaryote}} + \text{biomass}_{\text{plant}}) \cdot \text{insolation}, \quad \Delta CO_2 = -\Delta O_2$$
* **Prokaryote Anaerobic Metabolism (*Manual*, p. 136):**
  Prokaryotes thrive without $O_2$, cycling $CH_4$ rather than producing $O_2$.
* **Animal Respiration & Combustion:**
  $$\Delta CO_2 = +k_{\text{resp}} \cdot \text{biomass}_{\text{animal}} + k_{\text{civ}} \cdot \text{techLevel}, \quad \Delta O_2 = -\Delta CO_2$$

#### 4. Simulation Time Scales (*Manual*, p. 100)
* **Geologic:** $10^6\ \text{yr/tick}$ (plate tectonics active, fast evolution)
* **Evolution:** $10^5\ \text{yr/tick}$ (biome shifts & speciation)
* **Civilized:** $10^2\ \text{yr/tick}$ (cities, tech progression, pollution)
* **Technology:** $1\ \text{yr/tick}$ (industrial crisis, nuclear/climate feedback)

---

### D. GaiaSim Trophic, Food-Chain & Atmospheric Gating Model *(Provisional Design Constants)*

The manual describes qualitative atmospheric/temperature limits (p. 133) and the **plant + Insect → Carnifern** co-evolution dependency (pp. 139, 141), but does not publish numeric food-chain formulas or $O_2$/temperature tables. The constants below are **GaiaSim tuning parameters** designed to make the ecosystem self-limiting and ecologically reactive:

#### 1. Suitability Multipliers
Map the 4-tier Page 141 preference rating $r \in \{0, 1, 2, 3\}$ to carrying capacity / growth multiplier:
* `0` (`X`): $0.00$ (decline & extinction)
* `1` (`Barely`): $0.25$
* `2` (`Fairly well`): $0.60$
* `3` (`Paradise`): $1.00$

#### 2. Trophic Levels & Food-Chain Dependencies
Each inhabited cell's effective carrying capacity $K_{\text{eff}} = K_{\text{biome}} \cdot K_{\text{food}}$ scales with local/regional food availability (computed over a neighborhood window, e.g. $5 \times 5$ cells, plus global marine/land floor):

| Trophic Tier | Classes | Food / Energy Source | Co-Evolution / Prey Rule |
| :--- | :--- | :--- | :--- |
| **0. Anaerobic Pioneer** | `PROKARYOTE` | Dissolved nutrients / $CH_4$ (no prey needed) | Independent of $O_2$ and other life |
| **1. Primary Producers** | `EUKARYOTE` (sea), Vegetated Land Biomes (`BOREAL`..`SWAMP`) | Sunlight + $CO_2$ + moisture | Generates $O_2$ and supplies base energy for Tier 2 |
| **2. Marine Grazers & Detritivores** | `RADIATE`, `ARTHROPOD`, `MOLLUSK` | Local/regional `EUKARYOTE` + `PROKARYOTE` (and Swamp/Jungle plants) | Carrying capacity scales with nearby marine producer density |
| **3. Land Herbivores & Insectivores** | `INSECT`, `AMPHIBIAN`, `TRICHORDATE`, `REPTILE`, `DINOSAUR`, `AVIAN`, `MAMMAL` | Underlying vegetated land biome productivity (`suitability` $1..3$) + secondary `INSECT` bonus for Amphibian/Reptile/Avian | Cannot persist on `ROCK` / `ARCTIC`; higher biome suitability = richer plant food |
| **4. Marine Predators** | `FISH`, `CETACEAN` | Regional marine prey (`EUKARYOTE`..`MOLLUSK` for `FISH`; `FISH`/`MOLLUSK`/`ARTHROPOD` for `CETACEAN`) | `CETACEAN` requires active marine (or Jungle river) prey base |
| **5. Insectivorous Plant Co-Evolution** | `CARNIFERN` | Land plant biome **+ abundant `INSECT` prey** (*Manual*, pp. 139, 141) | **Emergence:** spawns on a vegetated land cell when `INSECT` species `1–4` occupy $\ge 2$ cells in the local $5 \times 5$ neighborhood (and planetary insect coverage exceeds a minimum threshold). **Sustenance:** $K_{\text{food}}$ scales with nearby `INSECT` population (`0` insects nearby → decline/extinction). |

#### 3. Provisional Atmospheric ($O_2$) & Temperature Gates
Retained as tunable GaiaSim parameters (not manual constants) so atmospheric terraforming visibly gates evolutionary eras:

| Class | Min $O_2$ (%) | Livable Temp ($^\circ\text{C}$) | Notes |
| :--- | :---: | :---: | :--- |
| `PROKARYOTE` | `0.0` | `-5` to `85` | Anaerobic pioneer |
| `EUKARYOTE` | `0.0` | `0` to `50` | Initiates Great Oxidation (+$O_2$) |
| `RADIATE` | `2.0` | `2` to `40` | Early multicellular marine |
| `ARTHROPOD` | `4.0` | `2` to `45` | Shallow-shelf & ocean radiation |
| `MOLLUSK` | `4.0` | `0` to `40` | Marine radiation |
| `FISH` | `7.0` | `0` to `35` | Active marine vertebrates |
| `INSECT` | `8.0` | `0` to `45` | First land colonists (from Arthropod `5–12`) |
| `TRICHORDATE` | `10.0` | `-5` to `40` | Land colonists (from Radiate/Fish `9–12`) |
| `AMPHIBIAN` | `11.0` | `8` to `38` | Coastal/wetland vertebrates |
| `CARNIFERN` | `11.0` | `0` to `45` | Co-evolves with Insects `1–4` on plant biomes |
| `REPTILE` | `13.0` | `10` to `48` | Warm/arid terrestrial vertebrates |
| `DINOSAUR` | `15.0` | `10` to `45` | Large forest/jungle reptiles |
| `AVIAN` | `16.0` | `-15` to `45` | Endothermic; tolerates Boreal cold |
| `MAMMAL` | `16.0` | `-20` to `45` | Endothermic; broad climate tolerance |
| `CETACEAN` | `17.0` | `-2` to `35` | High-metabolism marine mammals |

---

## 4. Phased Development Roadmap
* **Phase 1 — Data & Constants (`src/sim/constants.ts`):** Encode the 3 ocean depth tiers, 3×3 biome preference matrix, 15-class multi-parent evolutionary graph (with species-slot mutation windows `1..16`), and the 15×11 Page 141 suitability matrix.
* **Phase 2 — Coupled Simulation Kernel (`src/sim/engine.ts`):** Implement the 5-stage tick loop on `128×64` typed arrays — including within-class species advancement (`lifeSpecies: 1..16`), multi-parent slot-gated mutation, `EUKARYOTE` + plant $O_2$ photosynthesis, trophic food-chain carrying capacity (including `INSECT` → `CARNIFERN` co-evolution), and `(class, species)` competition.
* **Phase 3 — Sprite & Viewport Renderer (`src/map-renderer.ts`):** Render 16×16 `terrasim` sprites (including per-species `species_1..16` animated lifeforms with chroma-key transparency), zoom/pan/pinch, smooth cylindrical `flyTo` camera glides, map-lens overlays, isolines, and wind vectors.
* **Phase 4 — Controls, Charts & Scenarios (`src/index.ts`):** Active-layer legends & lifeform filter, evolving middle dashboard chart (Daisyworld vs. Biosphere/Life & $O_2$), Model Control Panels (mutation/advancement/reproduction rates), and classic scenarios (*Aquarium*, *Daisyworld*, *Mars*, *Venus*, *Earth*).
