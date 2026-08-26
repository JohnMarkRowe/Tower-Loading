# Tower Loading Study

A single-page, client-side calculator for preliminary radio communications tower loading studies —
wind and ice load **demand** across a matrix of wind speeds and ice thicknesses, checked against
a tower's user-supplied structural capacity.

No build step, no server-side code, no dependencies. It's plain HTML/CSS/JS that runs entirely in
the browser.

> **⚠️ Preliminary planning tool — not a substitute for a licensed Professional Engineer.**
> This tool estimates wind and ice load *demand* using standard TIA-222 / ASCE 7 methodology. It does
> **not** contain manufacturer tower capacity ratings — you must supply your tower's allowable
> moment/weight capacity from its original engineering data, a manufacturer load chart, or a PE
> evaluation. Tower foundations, guy anchors, and other supporting structures are assumed adequate.
> Do not add, remove, or modify tower loading based solely on the output of this tool.

## Features

- **Tower definition** — manufacturer/model (record-keeping only), guyed lattice / self-supporting
  lattice / monopole, height, face width, solidity ratio, self-weight, exposure category (B/C/D),
  and advanced wind parameters (K<sub>zt</sub>, K<sub>d</sub>, K<sub>e</sub>, G<sub>h</sub>).
- **Age & design-standard comparison** — tracks tower age from year built, an editable age-based
  capacity derating percentage, and compares the tower's original design wind speed (with a
  fastest-mile → 3-second-gust conversion) against the current code-required wind speed for the site.
- **Appurtenance schedule** — repeatable rows for antennas, dishes, mounts, and other attachments,
  with EPA (Effective Projected Area) computed from dimensions (flat panel, cylindrical, or parabolic
  dish) or entered directly, plus weight and mounting height.
- **Feedline schedule** — repeatable coax/feedline runs with preloaded common cable sizes (LMR-400,
  LMR-600, RG-213, 1/2"–1-5/8" Heliax) or custom OD/weight, each modeled as a vertical round member
  over its height range.
- **Loading study matrix** — wind speed 25–150 mph in 25 mph steps × ice thickness 0–2" in 0.25"
  steps, with results shown as overturning moment, total weight, required EPA, or as a percentage of
  user-entered allowable capacity (color-coded ok / warning / exceeds capacity / not evaluated).
- **Governing case** and **per-case load breakdown** by item (structure, each appurtenance, each
  feedline run).
- **Save/Load/Export** — studies persist to the browser (localStorage) or export/import as JSON files.
- **Print-friendly report view** for record-keeping.
- **In-app Methodology tab** documenting every formula, constant, and assumption used.

## Getting Started

No installation required — it's static files.

**Simplest:** open [`index.html`](index.html) directly in any modern browser.

**Local server (optional, needed for some browser preview tools that block `file://` script
execution):** a zero-dependency PowerShell static server is included.

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8843
```

Then browse to `http://localhost:8843`.

## Project Structure

```
tower-loading-study/
├── index.html    # page structure / tabs
├── style.css     # styling, color-coded results, print stylesheet
├── app.js        # calculation engine + UI logic
├── serve.ps1     # optional local static file server (no Node/Python required)
└── README.md
```

## Methodology (summary)

Demand-side loads follow TIA-222-H / ASCE 7 conventions:

- Velocity pressure: `qz = 0.00256 × Kz × Kzt × Kd × Ke × V²` (psf), with `Kz` from the standard
  exposure-category (B/C/D) power-law formula.
- Structure and feedline wind force/moment are found by numerically integrating pressure over height.
- Appurtenance EPA is computed from a shape factor (flat, cylindrical, parabolic dish) or entered
  directly from a spec sheet.
- Ice accretion (0–2", 56 lb/ft³ glaze ice) is applied rigorously to round members (feedlines) and as
  a documented planning-level approximation to lumped appurtenances and the tower structure.
- Capacity ratios compare demand against a user-entered allowable base overturning moment and/or
  allowable total supported weight, reduced by an editable age-based derating percentage.

Full formulas, constants, and stated limitations are in the app's **Methodology** tab.

## Limitations

- Guy cable wind/ice load and guy tension are not modeled.
- Gust Response Factor (G<sub>h</sub>) is a user-adjustable planning-level constant, not a full
  TIA-222-H dynamic analysis.
- Tower foundations, guy anchors, and other supporting structures are assumed adequate — out of
  scope for this study.
- Contains no proprietary manufacturer tower capacity charts; capacity must be supplied by the user.

## License

[MIT](LICENSE)
