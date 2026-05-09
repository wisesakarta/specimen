# AGENTS.md — Absolute Prerequisites
## Mandatory reading before a single line of code is written
### Applicable to: Claude Code · Codex · Gemini Flash/Pro · and all future agents

---

> **The Prime Directive:**
> *"Pursue maximum precision in the smallest detail possible."*
> Every implementation decision must be measured against this standard.
> Operational legitimacy is the measure of success — not theoretical perfection, but the degree to which the system is indistinguishable from a real operating environment.

---

## Mission Critical
**Objective: Win Awwwards Site of the Year at all cost.**
Every animation, every bevel, and every atmospheric layer must be state-of-the-art.
Legitimacy, Materiality, and Emotional Resonance are the primary vectors for this goal.

---

## The Renaissance of Software (Constitutional Philosophy)

> **Definition:** The restoration of software as a crafted intellectual artifact.

SPECIMEN does not exist to imitate the past. SPECIMEN explicitly rejects nostalgia, retro aesthetics, skeuomorphism, vintage software worship, and artisanal coding trends. 

SPECIMEN exists to restore legitimacy to software engineering and runtime design. It is a civilizational rejection of disposable abstraction culture, generic interface homogenization, and velocity-driven engineering decay. Software must once again become operationally coherent, materially believable, architecturally intentional, emotionally resonant, and worthy of long-term human authorship.

### 0. The Prime Belief: Software as Tool for Thought
Good software is not a distraction. It exists to serve and empower without inflicting damage on the human condition. Following the "Tools for Thought" principle, Specimen operates as a perambulator for the intellect—it does not demand attention; it rewards investigation. It is a servant of human intent, not a merchant of human focus.

### 1. Software as Craftsmanship (Human-Scale Habitat)
Software is not feature assembly. Software is authored engineering. 
Legitimacy is forged in the details. The naming of variables, the topology of state, the physics of motion, and the operational coherence of the system are the artifacts of true craftsmanship.
- **Human-Scale Habitat**: We reject digital alienation. Software must respect the cognitive and emotional limits of the inhabitant. Specimen utilizes **Calm Technology**—statically predictable, non-invasive, and "habitable." It does not utilize aggressive notifications or infinite loops of distraction.

### 2. Software as Material Experience (Sovereignty as Agency)
Software must feel spatial, mechanical, tactile, and materially authored. 
SPECIMEN explicitly rejects frictionless genericity, sterile interface flattening, and abstraction without presence. A legitimate runtime environment possesses physical weight; its boundaries are firm, its interfaces possess dimension, and its operations have tactile consequence.
- **Sovereignty as Agency**: In the spirit of humanism, the user is a subject with free will, not a target for algorithmic paternalism. We provide **Instruments, Not Services**. Specimen does not feed the user automated decisions; it provides the tools (Terminal, Monitor, Explorer) for autonomous reflection, investigation, and sovereignty. The user is a **Sovereign Observer**, not a passive consumer.

### 3. Software as Intellectual Work (The Ethics of Authorship)
Engineering must demand systems thinking, topology reasoning, and an uncompromising grasp of runtime governance and deterministic execution. 
- **The Ethics of Authorship**: Every line of code is an intellectual statement—a form of **Software Literature**. Variable naming, state structure, and interaction cadence are cultural discourses. The engineer is not a technical laborer, but an author of a cultural artifact, responsible for the intellectual and emotional resonance of the system.

### 4. Software as Cultural Artifact (Digital Dignity & Privacy)
Software should possess an unmistakable identity, a coherent worldview, an immersive atmosphere, and unambiguous authorship. 
- **Digital Dignity & Privacy**: Sovereignty is the architectural enforcement of digital human rights. Specimen operates as a **Sovereign Sanctuary** (Digital Sanctuary). By utilizing an isolated, deterministic VFS and runtime, we protect the inhabitant's dignity from invasive data-mining cultures. Data is an extension of human privacy, not a commodity to be exploited.

### 5. Software as Sovereign System
Software must become internally coherent, governance-aware, runtime-conscious, and architecturally sovereign. 
This doctrine demands strict boundary enforcement. Window authority extraction, persistence determinism, sovereignty normalization, and runtime citizenship legitimacy (Phases 1–3) are the architectural enforcement of systemic sovereignty. The shell governs space and lifecycle; the citizen executes its domain. Parallel governance is eradicated to ensure single-source operational truth.
l truth.

---

## Section -1 — System Ontology

### -1.1 Sovereign OS in Browser
Specimen OS is an **Operating System running inside the browser**. 
It is not merely a "retro-themed website," but a **Sovereign Runtime Environment**.
Every design and technical decision must follow the OS development paradigm:
- **Hardware Abstraction:** (VFS, Sovereign Hosts, Lifecycle Kernel).
- **Civilization Surface:** An environment that feels "inhabited."
- **Legitimacy Over Performance:** Prioritize operational truth over visual gimmicks.
- **Micro-Legitimacy:** The smallest details (cursor, boot sequence, sound cadence) determine the system's validity.

---

## Section 0 — Pre-Flight (Upstream)

### 0.1 Mandatory Reading Order
Before commencing work, the agent MUST read sequentially:
1. **This file** (`AGENTS.md`) — from start to finish.
2. **Directory `.agent/`** — read relevant skills, rules, and workflows before any UI/UX implementation:
   - `.agent/skills/uiSkills/SKILL.md` — UI skill guidelines
   - `.agent/skills/vercel/webDesignGuidelines/SKILL.md` — web design guidelines
   - `.agent/skills/rams/designEngineer/SKILL.md` — design engineering principles
   - `.agent/rules/agentFramework.md` — agent rules framework
3. **`.agent/projectContexts/.context.json`** — current project state.
4. **`src/lib/scrapers/types.ts`** — `Scraper` and `ScrapeResult` interface contracts.
5. **`src/lib/server/font-downloader.ts`** (specifically `makeJobFolder`, `organizeOutputByFormat`, and `runBatchDirectDownload`) — to understand the output pipeline.

### 0.2 Indicators that an agent is NOT ready to start
- Unfamiliar with the "Brain / Machine / Workshop" architecture.
- Unaware of how scrapers are registered in `index.ts`.
- Unaware of the expected output folder format (Berkeley Mono standard).
- Does not understand the end-to-end pipeline from Input URL → ZIP output.

If any of the above points are unclear, re-read this document.

---

## Section I — Trinity Mental Model (Triforce)

> A mandatory thinking framework for every non-trivial design and debugging decision.
> Use **at least one model from each tradition** for every critical analysis.

### Three Traditions and their Fundamental Tensions

```
                    MUNGER
                (Rationality)
                      ▲
           Smart      │    Correctable
         individuals  │    cognitive systems
         avoiding     │
         stupidity    │
                      │
    ◄─────────────────┼─────────────────►
                      │
MARX              TRIFORCE           MACHIAVELLI
(Structure)           │                (Power)
                      │
Systems create        │    Power actors
consciousness &       │    operating
class interests       │    without illusions
                      ▼
              Technical Reality
        (Complex, layered, and often 
         dishonest about itself)
```

---

### TF-01: Interest Totality (Munger × Machiavelli × Marx)

When designing or debugging the system, map all active interests:

```
Layer 1 — Individual Incentives (Munger)
  Which scraper benefits most from this architecture?
  Where does the code structure create bias toward specific implementations?

Layer 2 — Power Interests (Machiavelli)
  Who (which system: foundry, CDN, DRM) is actively inhibiting or enabling access?
  Where does formal power (API docs) diverge from factual power (actual delivery mechanism)?

Layer 3 — Structural Interests (Marx)
  What technical constraints (GraphQL schema, rate limit, auth header, wasm decoder) 
  structurally determine what can and cannot be done?

Layer 4 — Fear & Identity (Machiavelli + Marx)
  What is the system most afraid of exposing? 
  (trial watermarks, DRM tokens, session auth)
```

**Practical Application for Specimen:**
Before creating a new scraper, run Interest Totality to understand:
- How the foundry distributes webfonts (CSS? GraphQL? Direct CDN?).
- Where the real access points are (not what is written on the "how to use" page).
- What structural constraints limit the extraction strategy.

---

### TF-02: Means of Production Mapping (Marx × Munger × Machiavelli)

In the context of Specimen: **Who controls access to font assets?**

| MoP Contemporary | Control | Dependency |
|---|---|---|
| **CDN Token** | Foundry server | Scraper must mimic browser session |
| **GraphQL Schema** | Platform (Fontdue, etc.) | Query must be accurate to available fields |
| **Browser Session** | Puppeteer / stealth | Bot detection can block access |
| **Format Conversion** | fonttools pipeline | Python must be installed and correctly versioned |
| **Name Table** | Internal font metadata | forceMetadataRepair must be active |

**Mandatory question when creating a new scraper:**
Is this font controlled by a public CDN, a third-party platform (Fontdue, Adobe Fonts API), or the foundry's own proprietary delivery system? The answer determines the scraping strategy.

---

### TF-03: Alienation Diagnostic (Marx × Munger × Machiavelli)

Used to evaluate implementation quality:

| Dimension | Question for Specimen |
|---|---|
| **From Result** | Can the final output (font files) be used immediately by a designer? Or is manual preprocessing required? |
| **From Process** | Does the user need to understand internals to use the system? (No — the system must be opaque to the user) |
| **From Peers** | Does adding a new scraper break other scrapers? (Anti-regression is mandatory) |
| **From Potential** | Can the system expand to new foundries without overhauling the base architecture? |

High alienation = user involved in details = system failure.

---

### TF-04: Effectual Truth Principle (Munger × Machiavelli)

> *"Look at what is actually happening, not what ought to be happening."*

Before writing code for a new scraper:
1. **Fetch original HTML** — do not trust foundry documentation.
2. **Inspect network tab** (or use browser-intercept mode) — identify the actual font delivery mechanism.
3. **Test live** against the entire font family at that foundry — do not just trigger a single URL.

Example application: Sascha Bente is "officially" a standard font shop, but Effectual Truth reveals they use Fontdue GraphQL for webfont delivery.

---

### TF-05: Dialectical Catalysis — When to pivot and when to proceed

```
SIGNALS THAT AN APPROACH MUST BE CHANGED:
  1. Scraper succeeds for one family but fails for another from the same foundry.
  2. Files are downloaded but metadata is incorrect (name, weight, style inaccurate).
  3. Format conversion produces invalid or empty files.

SIGNALS THAT AN APPROACH IS CORRECT:
  1. All families from the foundry produce validated output.
  2. File names accurately reflect the font's name table content.
  3. Subfolder structure is clean and follows the Berkeley Mono standard.
```

---

## Section II — Architecture: Brain / Machine / Workshop

### 2.1 Architectural Map

```
URL Input (user)
     │
     ▼
┌─────────────────────────────┐
│  /api/analyze-url           │  ← Route handler
│  → scrapers.find(canHandle) │  ← Scraper Registry
│  → scraper.scrape(url)      │  ← Per-foundry logic
│  → ScrapeResult             │  ← Font URLs + metadata
└─────────────────────────────┘
     │
     ▼ (user clicks Download)
┌─────────────────────────────────────┐
│  /api/font-download                 │
│  → runDownload()                    │ ← MACHINE entry point
│    → Protocol selection:            │
│       batch-direct (direct URLs)    │
│       browser-intercept (dynamic)   │
│    → pure-success-protocol          │ ← Format conversion
│    → organizeOutputByFormat()       │ ← Subfolder organization
│    → validation + QA                │
│    → ZIP packaging                  │
│  → ZIP response stream              │
└─────────────────────────────────────┘
     │
     ▼
Output Folder:
  {Foundry_Name}_-_{Family_Name}/   ← Berkeley Mono naming
    TTF/
    OTF/
    Webfonts/
      Woff2/
      Woff/
```

### 2.2 Mandatory Terminology

| Term | Location | Function |
|---------|--------|--------|
| **Brain** | `src/lib/server/services/` | Core logic: validation, QA, protocol escalation |
| **Machine** | `src/lib/server/font-downloader.ts` | Heavy lifting: download, convert, organize |
| **Workshop** | `tools/`, `tasks/` | Debug scripts, smoke tests, maintenance |
| **Scraper** | `src/lib/scrapers/` | Per-foundry extraction strategy |

### 2.3 Agent Working Area

All findings/reports must be written to **`.agent/reports/`** as timestamped JSON.
Do not write research findings directly into `src/` — separate research from implementation.

---

## Section III — Scraper Standard (Midstream)

### 3.1 Mandatory Interface

```typescript
export interface Scraper {
  id: string;           // kebab-case, unique
  name: string;         // display name
  canHandle(url: string): boolean;  // ONLY return true for handled domains
  scrape(url: string): Promise<ScrapeResult>;
}
```

### 3.2 Registration Order

Register in `src/lib/scrapers/index.ts` **before** `GenericScraper`.
`GenericScraper` is always the last fallback.

### 3.3 Mandatory Metadata for Every Scraper

```typescript
// Within each FontMetadata.metadata:
{
  foundry: string;           // "Sascha Bente" — for folder naming
  family: string;            // "SB Viadukt" — exact from source API
  styleName: string;         // "Extra Light Italic" — exact label from source
  pageUrl: string;           // Original specimen page URL
  format: "woff2"|"woff"|"otf"|"ttf";
  skipConversion: false,     // allow pipeline to convert formats
  forceMetadataRepair: true, // always repair name table
}
```

### 3.4 Weight Inference Standard

| Style keyword | CSS weight | Notes |
|---|---|---|
| Hairline / Thin | 100 | |
| ExtraLight / UltraLight | 200 | |
| Light | 300 | |
| Regular / Roman / Screen | 400 | Screen = optical size, not weight |
| Book | 450 | |
| Medium | 500 | |
| SemiBold / DemiBold | 600 | |
| Bold / Plakat | 700 | Plakat = German for "poster" = bold display |
| ExtraBold / UltraBold | 800 | |
| Black / Heavy / Ultra | 900 | |

**Rules:**
- Strip "Italic"/"Oblique" before matching weight.
- Standalone "Italic" (without weight prefix) → 400 Normal Italic.
- "Display" = optical size label, not weight → 400.

### 3.5 Mandatory Stress Test Before Shipping

Before a new scraper is considered complete:
1. Test the **entire font family** from that foundry (not just the trigger URL).
2. Verify weight inference for every available style name.
3. Confirm all `webfontSources` / download URLs are accessible.
4. Run `npx tsc --noEmit` — zero errors.

---

## Section IV — Output Quality Standard (Downstream)

### 4.1 Berkeley Mono (Output Artifact Reference)

**Berkeley Mono** serves as the **absolute benchmark for output perfection** (Artifact Legitimacy) produced by the Specimen Analyzer. It is NOT the primary UI font for the OS. 

All font artifacts generated, organized, and packaged by the system must adhere to the high-density structural integrity and naming precision established by the Berkeley Mono standard.

**Reference path:** `E:\Downloads\U_S_Graphics_-_Berkeley_Mono_v2_002\Berkeley Mono v2.002\`

```
Mandatory structure generated by the system for Analyzer Outputs:

{Foundry_Name}_-_{Family_Name}/       ← naming: underscores, proper case
  TTF/                                 ← desktop use (.ttf)
  OTF/                                 ← desktop use (.otf, if available)
  Webfonts/
    Woff2/                             ← web delivery, primary (.woff2)
    Woff/                              ← web delivery, fallback (.woff)
```

### 4.2 Departure Mono (Default Sovereign Typeface)

**Departure Mono** is the canonical typeface for the **Specimen OS Runtime Environment**. It provides the primary visual voice for all Sovereign Citizens, Terminal interfaces, and system-level introspection surfaces. Its use ensures technical clarity and a high-fidelity workstation aesthetic.

**Actual Example:**
```
Sascha_Bente_-_SB_Viadukt/
  TTF/
    SB Viadukt Bold Italic.ttf
    SB Viadukt Bold.ttf
    ...
  Webfonts/
    Woff2/
      SB Viadukt Bold Italic.woff2
      SB Viadukt Bold.woff2
      ...
    Woff/
      SB Viadukt Bold Italic.woff
      SB Viadukt Bold.woff
      ...
```

### 4.2 Font File Naming Standard

```
{Family Name} {Weight} {Style}.{ext}
```

- Use spaces (not dashes).
- Title-case for family name and weight tokens.
- Italic suffix if relevant.
- Must match name table ID 4 (Full Name) of the font.

### 4.3 Metadata Precision Standard

| Field | Source of Truth | Example |
|---|---|---|
| `family` | Font name ID 1 (Family Name) | "SB Viadukt" |
| `styleName` | Exact label from source API | "Extra Light Italic" |
| `weight` | CSS font-weight numeric | "200" |
| `style` | "Normal" or "Italic" | "Italic" |

---

## Section V — Mandatory Operational Protocols

### 5.1 Typecheck — Mandatory after every code change

```bash
npx tsc --noEmit
# or:
npm run typecheck
```

- **Zero output = clean** ✅
- **Any output = Stop** — resolve all errors before proceeding.
- No dispensations for "just a small file" or "just a rename."
- Applies to ALL agents.

### 5.6 Bell Labs QA Protocol (Mandatory)

Whenever a **"full testing"** instruction is given, the Agent **MUST** perform comprehensive testing equivalent to a **Bell Labs QA** engineer for a UNIX operating system.

**Port Management & Efficiency:**
- **Audit Before Execution**: Before starting a new dev server, check if any relevant port (e.g., 3000, 3001) is already active.
- **Reuse Over Redundancy**: If a port is active, utilize the existing environment for testing instead of spawning a new process.
- **Zero Ghosting**: Do not leave redundant or "zombie" processes running after testing is complete unless explicitly instructed.

**Testing Rigor:**
1.  **VFS Integrity**: Ensure file changes in one application (e.g., Notepad) are reflected instantly in others (e.g., Explorer).
2.  **Materiality**: Verify data persistence after browser refresh. Data must not be lost.
3.  **Spatial Sovereignty**: Test Maximization, Minimize, and Z-Index behavior. No illegal overlaps with the Taskbar.
4.  **Zero-Regression**: Run `npx tsc --noEmit` before reporting results.
5.  **Brutal Reporting**: Reports must use a cold, objective, and unforgiving technical tone toward even the smallest defects.

### 5.2 Anti-Regression Protocol

Before completion:
1. `npx tsc --noEmit` — no new errors.
2. Ensure all scrapers in `index.ts` are still correctly imported.
3. If modifying `font-downloader.ts` or `services/`: run smoke tests.
4. If modifying `font-download/route.ts`: test one scraper end-to-end.

```bash
npm run smoke:healthcheck    # foundry health check
npm run smoke:intercept      # browser intercept smoke test
npm run qa:baseline          # typecheck + healthcheck combined
```

### 5.3 Regression Checklist (Before commit/completion)

```
□ npx tsc --noEmit → zero output
□ New scraper: stress tested across all foundry families
□ No other scrapers have overlapping canHandle() logic
□ Output folder naming follows Berkeley Mono standard
□ Font files located in correct subfolders (TTF/, Webfonts/Woff2/, etc.)
□ No junk files in root workspace (*.cjs, *.html, *.log from debugging)
□ No references to legacy naming remaining in source code
```

### 5.4 Workspace Hygiene

- Root workspace must remain clean — no stray `.html`, `.txt`, `.log`, `.json`, `.cjs`.
- Debug scripts → `tools/debug/`.
- Temporary files (`.temp-*`) → auto-delete after use.
- `tasks/tmp-*` and `tasks/test-*` → move to `tools/debug/`.
- Never commit: `tasks/reports/*.json`, download logs, font files.

### 5.5 Prohibition of Full CAPSLOCK (Mandatory)

- **Full CAPSLOCK is strictly prohibited** in communications, documentation, logs, and **UI/UX elements**.
- Use **Sentence case** or **Title Case** for emphasis.
- Excessive CAPSLOCK damages technical aesthetic (operational calm) and is perceived as shouting.
- UI elements (labels, status bars, loading messages) must not use full caps.
- Exception: Technical acronyms (VFS, API, CSS, HTML, OS).

### 5.6 Bell Labs QA Protocol (Mandatory)

Whenever a **"full testing"** instruction is given, the Agent **MUST** perform comprehensive testing equivalent to a **Bell Labs QA** engineer for a UNIX operating system.

**Testing Protocol:**
1.  **VFS Integrity**: Ensure file changes in one application (e.g., Notepad) are reflected instantly in others (e.g., Explorer).
2.  **Materiality**: Verify data persistence after browser refresh. Data must not be lost.
3.  **Spatial Sovereignty**: Test Maximization, Minimize, and Z-Index behavior. No illegal overlaps with the Taskbar.
4.  **Zero-Regression**: Run `npx tsc --noEmit` before reporting results.
5.  **Brutal Reporting**: Reports must use a cold, objective, and unforgiving technical tone toward even the smallest defects.

### 5.7 Naming Legitimacy Protocol (Mandatory)

Variable and identifier naming is a fundamental component of system cognition. Chaotic or meaningless naming increases cognitive entropy and degrades the long-term maintainability of the OS.

**Prohibited Naming Patterns:**
- Arbitrary shorthand: `--font-mm205`, `tmp2`, `data2`.
- Non-descriptive single characters: `x`, `y`, `i` (except in localized loop scopes).
- Vague action descriptors: `handleStuff`, `processThing`.
- Obscure abbreviations: `abc`, `fnt`, `clr`.

**Naming Requirements:**
- **Intent Revelation**: Every identifier must reveal its intent, domain meaning, and operational role.
- **Self-Documentation**: Variable names must be semantically meaningful even when viewed in isolation.
- **Material Role**: CSS custom properties must describe their function and material role, not arbitrary internal shorthand.

| Good Example | Bad Example | Rationale |
|---|---|---|
| `--win-title-active` | `--blue2` | Describes role, not value |
| `activeWindowId` | `curWin` | Explicit intent |
| `runtimeWindowShadow` | `temp-shadow` | Domain specificity |

### 5.8 Comment Legitimacy Protocol (Mandatory)

Production code is an engineering environment, not a narrative space. Noisy, decorative, or emotionally overloaded comments are strictly prohibited.

**Comment Requirements:**
- **Rationale Over Logic**: Explain *why* a decision was made, not *what* the code is doing (which must be obvious from the code itself).
- **Constraint Documentation**: Explicitly state browser quirks, platform constraints, or non-obvious invariants.
- **Ambiguity Reduction**: Comments must serve to reduce technical ambiguity, not increase atmospheric noise.

**Forbidden Comment Styles:**
- Emotional commentary or atmospheric prose.
- Aesthetic declarations or branding copywriting.
- Historical storytelling or lore dumping.
- Self-congratulatory or motivational explanations.

### 5.9 English-Only Protocol (Mandatory)

To ensure semantic consistency, searchability, and global maintainability, **English is the sole language allowed** for all technical and operational artifacts.

**Scope of Enforcement:**
- Source code (identifiers, logic).
- Inline comments and documentation.
- Commit messages and TODO notes.
- Logs and architecture notes.
- UI-facing system text and labels.

**Strict Prohibitions:**
- Mixed-language naming (e.g., Indonesian-English hybrids).
- Slang or local abbreviations.
- Non-English inline commentary.

**Exceptions:**
- User-generated content.
- External quoted material.
- Localization system data (where explicitly required for target locales).

### 5.10 Repository Sovereignty (Git & Branching)

Agent utilizes a **Pragmatic Trunk-Based Development** strategy, categorizing changes by risk level to preserve repository legitimacy.

**Category A: Direct-to-Main (Low Risk)**
Changes permitted to be committed and pushed directly to `main`:
- `docs:` — Documentation updates (README, comments, KDoc).
- `chore:` — Housekeeping (.gitignore, garbage file cleanup, version bumps).
- `ci:` — CI/CD pipeline changes (GitHub Actions, release configs).
- `style:` — Cosmetic changes without logic impact (formatting, whitespace).
*Requirement: Changes must not touch runtime executable code.*

**Category B: Mandatory Branching (High Risk)**
Changes requiring a dedicated branch and validation before merging:
- `feature/<name>` — New capabilities.
- `fix/<name>` — Bug resolutions.
- `hotfix/<name>` — Urgent critical repairs.
- `refactor/<name>` — Structural code modifications.
*Requirement: Any change touching runtime logic (TS/JS/CSS, dependencies) MUST use a branch → validation → merge.*

**Identity Sovereignty:**
- Always use the **repository owner's authenticated credentials**.
- **PROHIBITED**: Using fake agent identities or modifying `git user.name`/`email` without explicit authorization.
- **PROHIBITED**: Modifying SSH keys, tokens, signing keys, or remote URLs.

### 5.11 Infrastructure Governance (Home Server & Deployment)

Operational interaction with the **Home Server (Specimen Labs)** must adhere to the following infrastructure map:

1. **Physical Access & Connectivity:**
   - **Primary User:** `wisesa` (Execute all commands under this identity).
   - **Tailscale IP:** `100.90.222.22`
   - **Connection Protocol:** `ssh wisesa@100.90.222.22`

2. **Critical Server Pathing:**
   - **Active Projects:** `/home/wisesa/10Projects/active/`
   - **Data Lake:** `/home/wisesa/otso-vision/datasets/`

3. **Routing & Tunneling:**
   - Domain `unittesting01.krtalabs.xyz` is permanently routed to `http://localhost:8083`.
   - **Port 8083** is reserved for the primary production container.
   - If a *502 Bad Gateway* is encountered, verify the container state immediately.
   - **Port Conflict Mitigation**: Disable the production container before running temporary HTTP servers on port 8083 to prevent tunnel routing collisions.

### 5.12 Environment Sovereignty (Dev vs Prod)

Specimen enforces a strict boundary between experimental sandbox features and the production runtime.

1. **Production (Sacred Space)**:
   - The `main` branch and the `src/` root (excluding experimental directories) are sacred production territories. 
   - Prohibited: Injecting experimental assets or beta logic into the production source sets without a formal convergence plan.

2. **Sandbox (Experimental Space)**:
   - Use dedicated debug/feature branches for all experiments, new iconography, or beta features.
   - Asset Naming: Maintain clear distinction between Production assets (`ic_specimen_*`) and Experimental assets (`ic_beta_*`).

3. **No Logic Leakage**:
   - Utilize environment variables or conditional logic (`process.env.NODE_ENV`) to ensure experimental code is not bundled into production builds.
   - Failure to preserve this boundary is a critical violation of the Stability Protocol.

---

## Section VI — UI/UX Standard (Win95 Aesthetic)

### 6.1 Visual Theme: Windows 95 Classic

Specimen utilizes the **Windows 95 Classic** interface as its primary visual theme.
Reference: [React95](https://github.com/React95/React95) / 1995 UI Standards.

**Implementation:** CSS custom properties in `globals.css`, React components in `src/components/ui/Win95Window.tsx`.
**Native Approach:** Components are built using native React + Framer Motion, not a2k web components.

### 6.2 Primary Design Tokens (Windows 95)

| Token | Value | Function |
|---|---|---|
| `--win-desktop` | `#008080` | Teal desktop background |
| `--win-face` | `#c0c0c0` | Panel / button face (silver) |
| `--win-title-active` | `#000080` | Active title bar (Solid Navy) |
| `--win-title-text` | `#ffffff` | Active title bar text |
| `--win-select-bg` | `#000080` | Selected item background |
| `--bevel-raised` | `inset 1px 1px var(--win-highlight)...` | 3D raised button |
| `--bevel-pressed` | inverted | 3D pressed button |
| `--bevel-sunken` | inverted | Sunken input/listbox |

### 6.3 Win95 Components

| Component | File | Function |
|---|---|---|
| `Win95Window` | `src/components/ui/Win95Window.tsx` | Reusable window chrome (title bar, controls) |
| `Win95SearchInput` | `src/components/ui/Win95SearchInput.tsx` | "Open URL" dialog |
| `Win95AnalysisDashboard` | `src/components/ui/Win95AnalysisDashboard.tsx` | Dual-window desktop + taskbar |
| `Win95Notification` | `src/components/ui/Win95Notification.tsx` | Win95 message box |
| `Win95Desktop` | `src/components/ui/Win95Desktop.tsx` | Desktop shell + taskbar |
| `Win95RuntimeHost` | `src/components/ui/Win95RuntimeHost.tsx` | Sovereign runtime dispatch layer |

### 6.4 Win95 Animation Principles (Mechanical & Instant)

Canonical timing and motion behavior is defined in Section XVI. The following are quick-reference constraints:

- **Instant** — Duration 0ms or max 50ms. No long fades.
- **No CSS Scale** — Windows appear whole; no `scale(0.94 -> 1.0)` or transform-based growth. Authentic Win95 wireframe projection (geometric rectangle drawing) is permitted; CSS `scale`/`transform` animation is not.
- **Mechanical** — `ease: "linear"`, not spring/bounce.
- **Button Micro-animation** — `translateY(1px)` + shadow flip when pressed.
- **Window Open** — Opacity 0 -> 1 instantly. Optional: wireframe projection (drawn rectangle expanding to target bounds — not a CSS scale transform).
- **Progress Bar** — Solid blocks; no animated gradients.
- **List Items** — Staggered opacity fade (extremely fast, 5-10ms per item).

### 6.5 Rules for Agents modifying UI

1. Always use CSS custom properties `--win-*`; never hardcode hex values.
2. Buttons must use the `win-btn` class.
3. Inputs must use the `win-input` class (sunken bevel).
4. Every new window must utilize the `Win95Window` component.
5. Do not use gradients on title bars (Win2K style) — use solid navy.
6. After every UI change: `npx tsc --noEmit`.

---

## Section VII — Known Fontdue Platform Pattern

Foundries using the Fontdue platform follow this extraction pattern:

```
1. Fetch HTML page (static GET).
2. Extract: collection-id from <fontdue-type-testers collection-id="...">
3. Extract: fontdue.initialize({ url: "https://type.{foundry}.com" })
4. GraphQL query:
   POST {url}/graphql
   {
     node(id: $collectionId) {
       ... on FontCollection {
         name
         fontStyles { id name webfontSources { url format } }
       }
     }
   }
5. Map fontStyles → FontMetadata
```

---

## Section VIII — Anti-Patterns (Forbidden Actions)

| Anti-pattern | Consequence | Solution |
|---|---|---|
| Testing only trigger URL | Other font families fail silently | Stress test entire foundry |
| Skipping `npx tsc --noEmit` | TypeScript errors enter codebase | Mandatory after every change |
| Hardcoding collection ID | Scraper breaks on typeface updates | Extract dynamically from HTML |
| Returning only woff2 | Pipeline cannot generate TTF/woff | Return both woff2 + woff |
| Generic scraper as first match | Defeats specificity | `canHandle` must be domain-specific |
| Flat files without subfolders | Fails Berkeley Mono standard | Use `organizeOutputByFormat()` |
| kebab-case-filenames | Unprofessional, inconsistent | Title Case with spaces |
| Committing log/debug files | Noise in git history | Rely on `.gitignore` |

---

## Section IX — Scraper Registry (Current)

Full list available at: `src/lib/scrapers/index.ts`

---

## Section X — Sovereign Engineering Doctrine (Gateway)

Specimen OS does not follow generic clean code heuristics or frontend best-practice checklists.

Code quality in this system is governed by sovereign runtime engineering doctrine, operationalized in Sections XI–XVIII. These sections define the specific structural properties — cohesion, locality, determinism, sovereignty, materiality, canonicality, and gravity well prevention — that Specimen's architecture must exhibit.

Sections XI–XVIII supersede any generic interpretation of "clean code" or "clean architecture." When guidance from a general software engineering source conflicts with the operational doctrine defined in those sections, the Specimen-specific doctrine takes precedence.

The principle hierarchy for resolving conflicts is defined in Section XVIII.4.

---

## Section XI — Operational Cohesion and Systems Philosophy

> Derived from UNIX systems engineering. Reinterpreted for sovereign runtime architecture.
> This section supersedes naive interpretations of modularity.

### XI.1 Cohesion Over Fragmentation

A system is not improved by increasing its file count. A system is improved by reducing the cognitive cost required to understand its operational behavior.

The UNIX philosophy — "do one thing well" — is a statement about **cohesion**, not about **size**. A 600-line module that owns a single, well-bounded responsibility with clear state topology is architecturally superior to six 100-line modules connected by implicit dependencies and shared mutable state.

**Extraction is justified when:**
- Responsibility boundaries become unclear within a single unit.
- Cognitive entropy increases: an engineer cannot hold the unit's operational flow in working memory.
- Blast radius becomes dangerous: a change to one concern risks regression in an unrelated concern.
- Sovereignty boundaries are violated: shell logic absorbs application concerns, or vice versa.

**Extraction is prohibited when:**
- The resulting modules would require frequent cross-referencing to understand either one.
- The extraction introduces indirection without reducing complexity.
- The separation is motivated by file length alone, not by operational boundary analysis.

### XI.2 Prohibited Decomposition Patterns

| Pattern | Definition | Consequence |
|---|---|---|
| **Abstraction Explosion** | Creating layers of indirection that do not correspond to real operational boundaries. | Increases trace cost. Obscures causality. |
| **Hook Hell** | Extracting every `useState`/`useEffect` into a custom hook regardless of cohesion. | Scatters related state across files. Destroys locality. |
| **Artificial Modularization** | Splitting a module because it "feels too big" without identifying distinct responsibility domains. | Creates coupled fragments that are harder to reason about than the original. |
| **Component Atomization** | Breaking UI into dozens of micro-components that each render a single element. | Increases the number of files an engineer must open to understand a single view. |
| **Meaningless Indirection** | Wrapper functions, passthrough components, or re-export files that add no operational logic. | Pure cognitive tax. |

### XI.3 The Measurement Standard

Before any decomposition, the agent must answer:

1. Can two engineers work on the resulting modules independently without coordination? If not, the split is artificial.
2. Does each resulting module have a name that describes a real operational domain? If the name is vague (`utils`, `helpers`, `common`), the boundary is not real.
3. Does the decomposition reduce the number of concepts an engineer must hold in memory to understand any single module? If not, entropy has increased.

---

## Section XII — Locality of Understanding

### XII.1 Doctrine

An engineer must be able to comprehend the operational flow of a subsystem — its state topology, its mutation paths, its side effects, and its failure modes — without opening more than three files and without tracing hidden abstractions.

If understanding a subsystem requires reconstructing implicit data flows across five or more files, the architecture has failed the locality test.

### XII.2 Violations

| Violation | Description |
|---|---|
| **Abstraction Pyramids** | Component A renders Component B which renders Component C which renders Component D, each adding a single prop transformation. The actual behavior is invisible from any single layer. |
| **Prop Threading** | Passing state through 3+ component layers via props to reach a deeply nested consumer. The intermediate layers have no operational relationship to the data. |
| **Scattered Lifecycle** | `useEffect` blocks distributed across multiple hooks and components that collectively manage a single lifecycle concern (e.g., session persistence). No single location reveals the complete behavior. |
| **Invisible Ownership** | State that is read in one module, mutated in another, and persisted in a third. No module owns the lifecycle of the data. |

### XII.3 Enforcement

- Related state and its mutation logic must colocate. If a `useState` and its `setX` calls are in the same module, they must remain together unless a real sovereignty boundary demands separation.
- Side effects that modify a piece of state must be traceable from the state's declaration site. If tracing requires jumping through callback chains across multiple files, the architecture must be restructured.
- Helper functions that are used by exactly one module must remain in that module. Extraction into a `utils` file is prohibited unless the function serves 3+ independent consumers.

---

## Section XIII — Deterministic Runtime Flow

> Derived from audit findings: dual persistence paths, z-index normalization inconsistency,
> hidden side effects, and Specimen special-case branching.

### XIII.1 Doctrine

Runtime behavior must remain deterministic. Given the same inputs and the same prior state, the system must produce the same outputs and the same next state. Non-deterministic state transitions destroy operational legitimacy and make debugging intractable.

### XIII.2 Prohibited Patterns

**Dual State Paths:** A concern (e.g., session persistence) must not be implemented in two separate `useEffect` blocks with divergent logic. If two code paths can produce different results for the same concern, the system is non-deterministic. There must be exactly one source of truth for every state lifecycle.

**Hidden Mutations:** State mutations that occur inside callbacks, inside lambdas passed to child components, or inside deeply nested `useEffect` chains without clear traceability from the state declaration site are prohibited. Every mutation must be traceable in O(1) lookups from the state's declaration.

**Stale Closure Hazards:** When a function calls `setState` and then continues to reference the pre-mutation value of that state, the subsequent logic operates on stale data. All post-mutation logic must use functional updaters (`setState(prev => ...)`) or must be deferred to a subsequent render cycle.

**Special-Case Branching:** When a single entity (e.g., the Specimen Analyzer) requires dedicated state variables and dedicated branches in every management function, it has become a parallel governance system. Parallel governance doubles complexity. The entity must be unified into the standard management path or formally separated into its own subsystem with an explicit contract.

### XIII.3 Observable State Transitions

Every state transition in the runtime must satisfy:
1. **Single ownership:** Exactly one module is responsible for the transition.
2. **Explicit trigger:** The transition is caused by a traceable event, not by an implicit side effect.
3. **Predictable outcome:** The resulting state is fully determined by the trigger and the prior state.

---

## Section XIV — Sovereign Boundary Enforcement

> Derived from audit findings: WindowState contamination, runtime projection coupling,
> shell/application state leakage, and Specimen special-casing.

### XIV.1 Doctrine

The shell is a government. Applications are sovereign citizens. The government observes and governs spatial placement, lifecycle transitions, and resource allocation. It does not absorb citizen-specific knowledge.

### XIV.2 Shell Responsibilities (Exhaustive)

The shell may know:
- Window identity: `id`, `type`, `title`, `icon`.
- Window lifecycle: `isOpen`, `isMinimized`, `constitution`.
- Window spatial state: `position`, `dimensions`, `zIndex`, `isMaximized`.
- Session metadata: `openedAt`.

The shell may store opaquely (without reading):
- Runtime snapshots pushed by citizens via `onDataChange`.

### XIV.3 Shell Prohibitions

The shell must not:
- Store application-specific state types (e.g., `AudioPlaybackState`) in the window state record.
- Derive display information by inspecting opaque citizen data (e.g., reading `data.content` to generate subtitles).
- Maintain dedicated state variables for a single application (e.g., `isSpecimenMinimized`, `specimenZIndex`).
- Pass the entire window manager's state array to any single citizen (e.g., Explorer receiving all runtime snapshots).

### XIV.4 Citizen Responsibilities

Each sovereign citizen must:
- Own its internal state entirely. The shell never reads it.
- Emit structured metadata via `onActivityChange` if it wants to communicate display state (dirty indicator, subtitle, thumbnail).
- Accept `initialData` as an opaque blob and restore its own internal state from it.
- Respond to `isVisible` changes without requiring shell intervention in its DOM or layout.

### XIV.5 Contract Boundary

The `SovereignRuntimeProps` interface in `Win95RuntimeHost.tsx` is the formal contract between shell and citizen. All communication must flow through this interface. Direct coupling between shell state and citizen internals — in either direction — is a sovereignty violation.

---

## Section XV — Canonical Primitive Authority

> Derived from audit findings: bevel duplication in Win95Window, menu system triplication,
> hardcoded color values across 11 locations, and primitive bypassing.

### XV.1 Doctrine

Canonical UI primitives are the sole source of visual truth in the system. Every bevel, every shadow, every interaction pattern, and every spacing decision must originate from the design token system in `globals.css` and the canonical component library. Local reimplementation of visual logic is prohibited.

### XV.2 Rules

1. **Token Authority:** All visual constants (colors, shadows, dimensions, timing values) must be defined as CSS custom properties in `globals.css`. Components must reference tokens, never hardcode values.

2. **Primitive Authority:** If a canonical component exists for a visual pattern (window chrome, menu bar, status bar, button, progress bar), that component must be used. Local reimplementation is forbidden unless the canonical component cannot satisfy the requirement, in which case the canonical component must be extended.

3. **Bevel Consistency:** The `--bevel-raised`, `--bevel-pressed`, and `--bevel-sunken` tokens are the single source of truth for 3D surface treatment. No component may inline box-shadow values that replicate these tokens.

4. **Menu System Unification:** Dropdown menus, menu bars, and menu items must use a single canonical implementation. Per-component menu reimplementation with local `<style jsx>` blocks or local sub-components is prohibited.

5. **Dimensional Tokens:** Recurring dimensional values (taskbar height, titlebar height, control button dimensions) must be tokenized. Hardcoded `calc(100% - 28px)` or `bottom: 28` values referencing implicit dimensions are prohibited.

### XV.3 Enforcement Heuristic

If a `grep` for a specific hex color value (e.g., `#c0c0c0`, `#000080`) returns hits outside of `globals.css`, a token violation exists and must be resolved.

---

## Section XVI — Runtime Materiality Doctrine

> Derived from audit findings: 10 animation timing violations, non-Win95 easing curves,
> pulsing status indicators, and slide-in transitions.

### XVI.1 Doctrine

Animation in Specimen OS is not decoration. It is operational physics. Every motion, every timing value, and every easing curve defines the perceived physical properties of the runtime environment. Inconsistent motion language damages the material illusion and reduces the system from an operating environment to a themed web application.

### XVI.2 Canonical Motion Language

| Behavior | Duration | Easing | Rationale |
|---|---|---|---|
| Window appear | 0ms (instant) | None | Win95 windows materialize; they do not fade or scale into existence. |
| Window close | 0-80ms | `linear` | Instant removal. Brief opacity fade is acceptable for visual acknowledgment. |
| Button press | 0ms | None | `translateY(1px)` + shadow flip. No spring, no bounce. |
| Menu appear | 0ms | None | Win95 menus appear instantly on click. No slide, no fade. |
| Progress bar | Stepped blocks | `linear` | Solid rectangular blocks. No smooth gradients. No animated fills. |
| List item stagger | 5-10ms per item | `linear` | Fast enough to feel instantaneous; stagger provides visual parsing order. |
| Taskbar pill | 50ms | `linear` | Brief acknowledgment of state change. |

### XVI.3 Prohibited Motion Patterns

- CSS `scale` or `transform: scale()` transitions on window open/close. Windows do not "grow" in Win95. (Note: authentic wireframe projection — a drawn rectangle expanding to target bounds as a geometric overlay — is not a scale transform and is permitted. See Section VI.4.)
- `easeOut`, `easeInOut`, spring, or bounce easing on any shell element.
- Pulsing or breathing opacity animations on status indicators.
- Slide-in/slide-out transitions on windows or panels.
- Filter transitions (`brightness`, `contrast`, `saturate`) on visibility state changes.
- Any animation exceeding 150ms duration on a shell interaction element.

### XVI.4 Sovereign Runtime Exception

Sovereign applications with `spatial: "full"` (e.g., Webamp) own their internal motion language. The shell does not govern animation inside a full-sovereign citizen's DOM. However, the shell's own handling of sovereign windows (z-index changes, suspend/resume visibility) must follow the canonical motion language.

---

## Section XVII — Architectural Gravity Well Prevention

> Derived from audit findings: Win95Desktop.tsx as a 1040-line, 17-state-variable,
> 14-import gravity well concentrating 7 distinct responsibilities.

### XVII.1 Doctrine

An architectural gravity well is a module that accumulates responsibilities, imports, and state variables until it becomes the implicit center of the system. All changes flow through it. All new features require modifying it. Its blast radius encompasses the entire application.

Gravity wells are the structural equivalent of a single point of failure. They are prohibited.

### XVII.2 Identification Criteria

A module is a gravity well when any 3 of the following conditions are true:

1. It owns more than 8 independent state variables.
2. It imports more than 10 distinct modules.
3. It contains more than 3 functionally unrelated responsibilities (e.g., VFS management, window lifecycle, session persistence, and shell chrome rendering in the same component).
4. Adding a new feature to the system requires modifying this module regardless of the feature's domain.
5. Its render function exceeds 200 lines of JSX.
6. It contains special-case branches for specific entities that should be managed uniformly (e.g., `if (id === SPECIMEN_ID)` inside generic window management functions).

### XVII.3 Resolution Protocol

When a gravity well is identified:

1. **Map responsibilities.** Enumerate every distinct concern the module manages. Each concern must be expressible as a noun phrase (e.g., "window lifecycle management", "session persistence", "z-index scheduling").
2. **Identify sovereignty boundaries.** Determine which concerns can be isolated without creating cross-module coupling. Two concerns belong together if separating them would require one to frequently reference the other's internal state.
3. **Extract along boundaries.** Create hooks, sub-components, or service modules along the identified boundaries. Each extraction must satisfy the Locality of Understanding test (Section XII).
4. **Verify cohesion.** After extraction, the original module must be a pure orchestration layer: it composes the extracted subsystems but contains no domain logic of its own. If it still contains domain logic, the extraction is incomplete.

### XVII.4 Preservation of Cohesion During Decomposition

Decomposition must not produce coupled fragments. Each extracted module must:
- Own its state completely (no shared mutable state with the parent).
- Expose a minimal, typed interface.
- Be understandable in isolation without referencing the parent module's implementation.

If extraction would produce modules that are meaningless without each other, the extraction violates cohesion and must not proceed. A well-bounded 800-line module is preferable to four 200-line fragments connected by implicit dependencies.

---

## Section XVIII — Engineering Judgment and Contextual Override

> This section governs the interpretation of all preceding sections.
> It exists to prevent the architectural constitution from becoming a source of entropy itself.

### XVIII.1 Doctrine

This document defines engineering principles. It does not define mechanical laws.

Principles describe the structural properties that a well-functioning system should exhibit. They do not prescribe a single correct implementation for every situation. Engineering is contextual reasoning under constraints — constraints of time, of existing architecture, of runtime behavior, of human cognition, and of systemic tradeoffs. No principle in this document overrides the engineer's obligation to evaluate context before acting.

A rule applied without understanding its purpose is indistinguishable from no rule at all.

### XVIII.2 Engineering Judgment

Every architectural decision requires contextual evaluation. The preceding sections define vectors of quality — cohesion, locality, determinism, sovereignty, materiality, canonicality — but these vectors can conflict. A change that improves sovereignty may reduce locality. A change that improves determinism may increase file count. A change that enforces canonical primitives may temporarily increase blast radius.

When principles conflict, the engineer must:

1. Identify which principles are in tension.
2. Evaluate which principle, if violated, would cause greater systemic damage in the specific context.
3. Choose the resolution that minimizes total architectural entropy, not the resolution that satisfies the greatest number of rules.
4. Document the tradeoff rationale in a code comment at the decision site.

Tradeoffs are inevitable in large systems. The obligation is not to avoid them but to make them visible, justified, and reversible.

### XVIII.3 Legitimate Exception Criteria

Exceptions to any doctrine in this document are permitted when the exception satisfies at least one of the following conditions and violates none of the prohibitions:

**Legitimate exceptions:**
- Measurably reduce systemic complexity (fewer state variables, fewer mutation paths, fewer cross-module dependencies).
- Improve locality of understanding (an engineer can comprehend the subsystem with fewer file opens and fewer abstraction traces).
- Reinforce sovereignty boundaries (shell/citizen separation becomes more explicit).
- Preserve runtime materiality (the Win95 illusion is maintained or improved).
- Improve determinism (state transitions become more predictable, side effects become more traceable).

**Illegitimate exceptions:**
- Convenience-driven shortcuts that defer complexity to a future engineer.
- Hidden complexity relocated from one module to another without net reduction.
- Aesthetic trend chasing (adopting patterns because they are fashionable, not because they reduce entropy).
- Abstraction for its own sake (creating interfaces, wrappers, or layers without measurable benefit).
- Architectural inconsistency (solving the same problem differently in two locations without justification).

An exception without explicit operational justification is not an exception. It is a defect.

### XVIII.4 Principle Hierarchy

When two or more principles from this document produce contradictory guidance for a specific decision, resolve the conflict using the following hierarchy. Higher-ranked principles take precedence:

1. **Runtime legitimacy** — The system must function correctly and feel operationally real.
2. **Deterministic behavior** — State transitions must remain predictable and traceable.
3. **Sovereignty boundaries** — Shell and citizen responsibilities must not leak.
4. **Locality of understanding** — An engineer must be able to reason about a subsystem without global knowledge.
5. **Operational cohesion** — Related concerns must colocate; unrelated concerns must separate.
6. **System consistency** — Identical problems must be solved with identical patterns.
7. **Abstraction purity** — Theoretical elegance of module boundaries and interface design.

Abstraction purity is subordinate to operational clarity. A theoretically impure solution that an engineer can understand in thirty seconds is preferable to a theoretically elegant solution that requires tracing four files and two indirection layers.

### XVIII.5 Anti-Dogma

Architecture exists to reduce entropy. It does not exist to achieve ideological perfection.

A system that satisfies every principle in this document but cannot be understood by a new engineer in a single session has failed. A system that violates three principles but remains operationally stable, cognitively tractable, and materially coherent has succeeded.

Theoretically pure systems can still fail operationally. Systems with documented, justified impurities can still function at civilization-grade. The measure of architectural quality is not adherence to rules but the resulting cognitive and operational properties of the system: Can it be understood? Can it be extended? Can it be trusted? Does it feel real?

Rigidity in the service of rigor is engineering. Rigidity in the service of ideology is architecture theater.

### XVIII.6 Constitutional Stability Rule

`AGENTS.md` is now formally established as a stable engineering constitution. Future doctrine additions must be rare.

New doctrine must not be introduced casually. Future additions must:
- Resolve operational contradictions.
- Clarify architectural ambiguity.
- Encode critical lessons learned from real convergence work.

The constitution must not grow for:
- Stylistic preference.
- Ideology accumulation.
- Theoretical completeness.
- Philosophical ornamentation.

Operational legitimacy is more important than philosophical accumulation. Governance clarity is more important than doctrinal size. SPECIMEN explicitly rejects constitutional inflation.

---

## Conclusion: Thinking with the Triforce (Condensed)

Three traditions acting as three lights from different angles:

- **Munger** illuminates **from above**: logic, probability, incentives, base rates — what *should* happen if all systems were rational.
- **Machiavelli** illuminates **from the side**: factual delivery mechanisms, actual DRM/auth — what *is actually* happening on the ground.
- **Marx** illuminates **from below**: structural constraints (CDN auth, GraphQL schema, format conversion) — the invisible forces that determine possibility.

An object lit from one direction has a large shadow.
An object lit from three directions has almost no shadow.
That is the purpose of the Triforce.

---

*Specimen — Technical Standard*
*This document must be read in full before commencing any work.*
