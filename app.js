/* ============================================================
   Tower Loading Study — calculation engine & UI logic
   Demand-side formulas follow TIA-222-H / ASCE 7 methodology.
   Capacity values are user-supplied (manufacturer / PE data) —
   this tool contains NO proprietary tower capacity ratings.
   ============================================================ */

const WIND_SPEEDS = [25, 50, 75, 100, 125, 150];
const ICE_THICKNESSES = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const ICE_DENSITY = 56; // lb/ft^3, glaze ice per ASCE 7 / TIA-222
const CF_ROUND = 1.2;   // force coefficient, round members (feedlines)
const N_SLICES = 20;    // numerical integration slices over height
const ICE_WEIGHT_FACTOR = 1.0;

const EXPOSURE = {
  B: { alpha: 7.0, zg: 1200, zmin: 30 },
  C: { alpha: 9.5, zg: 900, zmin: 15 },
  D: { alpha: 11.5, zg: 700, zmin: 7 },
};

const CABLE_PRESETS = {
  "RG-213/U": { od: 0.405, wpf: 0.16 },
  "LMR-400": { od: 0.405, wpf: 0.11 },
  "LMR-600": { od: 0.590, wpf: 0.19 },
  "1/2\" Heliax (LDF4-50A)": { od: 0.630, wpf: 0.155 },
  "7/8\" Heliax (LDF5-50A)": { od: 1.09, wpf: 0.34 },
  "1-1/4\" Heliax (LDF6-50A)": { od: 1.55, wpf: 0.62 },
  "1-5/8\" Heliax (LDF7-50A)": { od: 2.00, wpf: 1.09 },
  "Custom": { od: 0.5, wpf: 0.15 },
};

let apps = [];
let feeds = [];
let idCounter = 1;

/* ---------------- utility ---------------- */
const $ = (id) => document.getElementById(id);
const num = (id, def = 0) => {
  const v = parseFloat($(id).value);
  return isNaN(v) ? def : v;
};

function kzAt(z_ft, exposure) {
  const p = EXPOSURE[exposure];
  const z = Math.max(z_ft, p.zmin);
  return 2.01 * Math.pow(z / p.zg, 2 / p.alpha);
}

function qzAt(z_ft, V, exposure, kzt, kd, ke) {
  return 0.00256 * kzAt(z_ft, exposure) * kzt * kd * ke * V * V; // psf
}

/* ---------------- tab switching ---------------- */
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "results") renderResults();
    });
  });
}

/* ---------------- tower tab ---------------- */
function initTowerTab() {
  $("t_studyDate").value = new Date().toISOString().slice(0, 10);
  $("footerDate").textContent = new Date().toLocaleDateString();

  const recalcAge = () => {
    const yr = num("t_yearBuilt", new Date().getFullYear());
    $("t_age").value = Math.max(0, new Date().getFullYear() - yr);
  };
  const recalcWind = () => {
    const v = num("t_origWind", 0);
    const basis = $("t_origBasis").value;
    const v3s = basis === "fastestmile" ? v * 1.2 : v;
    $("t_origWind3s").value = v3s.toFixed(1);

    const cur = num("t_currentWind", 0);
    const chip = $("t_windCompareResult");
    if (v3s === 0 || cur === 0) {
      chip.textContent = "Enter both wind speeds to compare";
      chip.style.color = "";
    } else if (cur > v3s) {
      const pct = (((cur - v3s) / v3s) * 100).toFixed(0);
      chip.textContent = `Current code exceeds original design by ${pct}% — PE review recommended`;
      chip.style.color = "var(--fail)";
    } else {
      const pct = (((v3s - cur) / v3s) * 100).toFixed(0);
      chip.textContent = `Original design meets/exceeds current code by ${pct}%`;
      chip.style.color = "var(--ok)";
    }
  };

  ["t_yearBuilt"].forEach((id) => $(id).addEventListener("input", recalcAge));
  ["t_origWind", "t_origBasis", "t_currentWind"].forEach((id) =>
    $(id).addEventListener("input", recalcWind)
  );
  recalcAge();
  recalcWind();

  document.querySelectorAll("#tab-tower input, #tab-tower select").forEach((el) =>
    el.addEventListener("input", () => { if ($("tab-results").classList.contains("active")) renderResults(); })
  );
}

/* ---------------- appurtenance table ---------------- */
const SHAPE_OPTS = [
  ["flat", "Flat Panel (W×H)"],
  ["cylinder", "Cylindrical (D×L)"],
  ["dish", "Parabolic Dish (D)"],
  ["custom", "Direct EPA Entry"],
];
const SHAPE_FACTOR = { flat: 1.0, cylinder: 0.65, dish: 0.85, custom: 1.0 };

function addApp(preset = {}) {
  const row = Object.assign({
    id: idCounter++,
    desc: "",
    category: "Antenna",
    shape: "flat",
    dim1: 0,
    dim2: 0,
    epa: 0,
    weight: 0,
    height: 0,
    qty: 1,
  }, preset);
  apps.push(row);
  renderAppTable();
}

function removeApp(id) {
  apps = apps.filter((a) => a.id !== id);
  renderAppTable();
}

function recomputeAppEPA(row) {
  if (row.shape === "custom") return; // EPA entered directly
  const sf = SHAPE_FACTOR[row.shape];
  if (row.shape === "dish") {
    row.epa = (Math.PI / 4) * row.dim1 * row.dim1 * sf;
  } else {
    row.epa = row.dim1 * row.dim2 * sf;
  }
}

function renderAppTable() {
  const tbody = $("appTableBody");
  tbody.innerHTML = "";
  apps.forEach((row) => {
    const tr = document.createElement("tr");

    const shapeOptions = SHAPE_OPTS.map(
      ([v, l]) => `<option value="${v}" ${row.shape === v ? "selected" : ""}>${l}</option>`
    ).join("");

    tr.innerHTML = `
      <td class="desc-cell"><input type="text" data-f="desc" value="${row.desc}" placeholder="e.g. VHF Yagi"></td>
      <td><select data-f="category">
            ${["Antenna", "Dish", "Mount/Platform", "Lighting", "Other"]
              .map((c) => `<option ${row.category === c ? "selected" : ""}>${c}</option>`)
              .join("")}
          </select></td>
      <td><select data-f="shape">${shapeOptions}</select></td>
      <td><input type="number" step="0.01" data-f="dim1" value="${row.dim1}" ${row.shape === "custom" ? "disabled" : ""}></td>
      <td><input type="number" step="0.01" data-f="dim2" value="${row.dim2}" ${row.shape === "custom" || row.shape === "dish" ? "disabled" : ""}></td>
      <td><input type="number" step="0.01" data-f="epa" value="${row.epa.toFixed(2)}" ${row.shape === "custom" ? "" : "readonly"}></td>
      <td><input type="number" step="0.1" data-f="weight" value="${row.weight}"></td>
      <td><input type="number" step="1" data-f="height" value="${row.height}"></td>
      <td><input type="number" step="1" min="1" data-f="qty" value="${row.qty}"></td>
      <td><button class="btn-danger-sm" data-del="${row.id}">✕</button></td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll("[data-f]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = el.dataset.f;
        row[f] = el.type === "number" ? parseFloat(el.value) || 0 : el.value;
        if (f === "shape") {
          recomputeAppEPA(row);
          renderAppTable();
          return;
        }
        if (f === "dim1" || f === "dim2") recomputeAppEPA(row);
        if (f === "epa") row.epa = parseFloat(el.value) || 0;
        syncEpaField(tr, row);
      });
    });
    tr.querySelector("[data-del]").addEventListener("click", () => removeApp(row.id));
  });
}

function syncEpaField(tr, row) {
  const epaInput = tr.querySelector('[data-f="epa"]');
  if (row.shape !== "custom") epaInput.value = row.epa.toFixed(2);
}

/* ---------------- feedline table ---------------- */
function addFeed(preset = {}) {
  const row = Object.assign({
    id: idCounter++,
    desc: "",
    cableType: "1/2\" Heliax (LDF4-50A)",
    od: CABLE_PRESETS["1/2\" Heliax (LDF4-50A)"].od,
    wpf: CABLE_PRESETS["1/2\" Heliax (LDF4-50A)"].wpf,
    bottom: 0,
    top: 100,
    qty: 1,
  }, preset);
  feeds.push(row);
  renderFeedTable();
}

function removeFeed(id) {
  feeds = feeds.filter((f) => f.id !== id);
  renderFeedTable();
}

function renderFeedTable() {
  const tbody = $("feedTableBody");
  tbody.innerHTML = "";
  feeds.forEach((row) => {
    const tr = document.createElement("tr");
    const opts = Object.keys(CABLE_PRESETS)
      .map((k) => `<option ${row.cableType === k ? "selected" : ""}>${k}</option>`)
      .join("");
    const custom = row.cableType === "Custom";
    tr.innerHTML = `
      <td class="desc-cell"><input type="text" data-f="desc" value="${row.desc}" placeholder="e.g. Main feed to top antenna"></td>
      <td><select data-f="cableType">${opts}</select></td>
      <td><input type="number" step="0.001" data-f="od" value="${row.od}" ${custom ? "" : "readonly"}></td>
      <td><input type="number" step="0.001" data-f="wpf" value="${row.wpf}" ${custom ? "" : "readonly"}></td>
      <td><input type="number" step="1" data-f="bottom" value="${row.bottom}"></td>
      <td><input type="number" step="1" data-f="top" value="${row.top}"></td>
      <td><input type="number" step="1" min="1" data-f="qty" value="${row.qty}"></td>
      <td><button class="btn-danger-sm" data-del="${row.id}">✕</button></td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll("[data-f]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = el.dataset.f;
        if (f === "desc" || f === "cableType") row[f] = el.value;
        else row[f] = parseFloat(el.value) || 0;
        if (f === "cableType") {
          if (el.value !== "Custom") {
            row.od = CABLE_PRESETS[el.value].od;
            row.wpf = CABLE_PRESETS[el.value].wpf;
          }
          renderFeedTable();
        }
      });
    });
    tr.querySelector("[data-del]").addEventListener("click", () => removeFeed(row.id));
  });
}

/* ---------------- calculation engine ---------------- */
function getTowerParams() {
  return {
    height: num("t_height", 0),
    faceWidth: num("t_faceWidth", 0) / 12, // ft
    solidity: Math.min(0.5, Math.max(0.05, num("t_solidity", 0.2))),
    selfWeight: num("t_selfWeight", 0),
    exposure: $("t_exposure").value,
    kzt: num("t_kzt", 1),
    kd: num("t_kd", 0.85),
    ke: num("t_ke", 1),
    gh: num("t_gh", 1.25),
    allowMoment: num("t_allowMoment", 0),
    allowWeight: num("t_allowWeight", 0),
    derating: num("t_derating", 0),
  };
}

function cfLattice(eps) {
  return 4 * eps * eps - 5.9 * eps + 4.0;
}

// per-foot bare EPA of the tower structure, and iced EPA/weight-add helpers
function structurePerFt(tp, t_ft) {
  const epaBare = tp.faceWidth * tp.solidity * cfLattice(tp.solidity);
  const growth = tp.faceWidth > 0 ? 1 + (2 * t_ft) / tp.faceWidth : 1;
  const epaIced = epaBare * growth;
  const weightAddPerFt = (epaIced - epaBare) * t_ft * ICE_DENSITY * ICE_WEIGHT_FACTOR;
  return { epaBare, epaIced, weightAddPerFt };
}

function appIced(row, t_ft) {
  if (row.shape === "dish") {
    const dIced = row.dim1 + 2 * t_ft;
    const epaIced = (Math.PI / 4) * dIced * dIced * SHAPE_FACTOR.dish;
    const weightAdd = (epaIced - row.epa) * t_ft * ICE_DENSITY * ICE_WEIGHT_FACTOR;
    return { epaIced, weightAdd };
  }
  const lEq = Math.sqrt(Math.max(row.epa, 0));
  const lIced = lEq + 2 * t_ft;
  const epaIced = lIced * lIced;
  const weightAdd = (epaIced - row.epa) * t_ft * ICE_DENSITY * ICE_WEIGHT_FACTOR;
  return { epaIced, weightAdd };
}

function feedIced(row, t_ft) {
  const dBare = row.od / 12;
  const dIced = dBare + 2 * t_ft;
  const epaPerFtIced = dIced * CF_ROUND;
  const weightAddPerFt = ICE_DENSITY * (Math.PI / 4) * (dIced * dIced - dBare * dBare);
  return { epaPerFtIced, weightAddPerFt: weightAddPerFt * ICE_WEIGHT_FACTOR };
}

function computeCase(tp, V, t_in) {
  const t_ft = t_in / 12;
  let totalEPA = 0, totalMoment = 0, totalWeight = tp.selfWeight;

  // structure (integrated over height)
  if (tp.height > 0) {
    const { epaIced, weightAddPerFt } = structurePerFt(tp, t_ft);
    totalWeight += weightAddPerFt * tp.height;
    const dz = tp.height / N_SLICES;
    for (let i = 0; i < N_SLICES; i++) {
      const zMid = (i + 0.5) * dz;
      const qz = qzAt(zMid, V, tp.exposure, tp.kzt, tp.kd, tp.ke);
      const F = qz * tp.gh * epaIced * dz;
      totalMoment += F * zMid;
    }
    totalEPA += epaIced * tp.height;
  }

  // appurtenances (lumped)
  apps.forEach((row) => {
    const { epaIced, weightAdd } = appIced(row, t_ft);
    const qty = row.qty || 1;
    totalWeight += (row.weight + weightAdd) * qty;
    totalEPA += epaIced * qty;
    const qz = qzAt(row.height, V, tp.exposure, tp.kzt, tp.kd, tp.ke);
    const F = qz * tp.gh * epaIced * qty;
    totalMoment += F * row.height;
  });

  // feedlines (integrated over run length)
  feeds.forEach((row) => {
    const bottom = Math.min(row.bottom, row.top);
    const top = Math.max(row.bottom, row.top);
    const runLen = top - bottom;
    if (runLen <= 0) return;
    const { epaPerFtIced, weightAddPerFt } = feedIced(row, t_ft);
    const qty = row.qty || 1;
    totalWeight += (row.wpf + weightAddPerFt) * runLen * qty;
    totalEPA += epaPerFtIced * runLen * qty;
    const slices = Math.max(4, Math.min(N_SLICES, Math.round(runLen / 5)));
    const dz = runLen / slices;
    for (let i = 0; i < slices; i++) {
      const zMid = bottom + (i + 0.5) * dz;
      const qz = qzAt(zMid, V, tp.exposure, tp.kzt, tp.kd, tp.ke);
      const F = qz * tp.gh * epaPerFtIced * dz * qty;
      totalMoment += F * zMid;
    }
  });

  const derateFactor = 1 - tp.derating / 100;
  const momentRatio = tp.allowMoment > 0 ? (totalMoment / (tp.allowMoment * derateFactor)) * 100 : null;
  const weightRatio = tp.allowWeight > 0 ? (totalWeight / (tp.allowWeight * derateFactor)) * 100 : null;

  return { V, t_in, totalEPA, totalMoment, totalWeight, momentRatio, weightRatio };
}

function computeMatrix() {
  const tp = getTowerParams();
  const results = [];
  WIND_SPEEDS.forEach((V) => {
    ICE_THICKNESSES.forEach((t) => {
      results.push(computeCase(tp, V, t));
    });
  });
  return { tp, results };
}

/* ---------------- results rendering ---------------- */
function fmt(n) {
  if (n === null || n === undefined) return "N/A";
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
  return n.toFixed(1);
}

function cellClass(ratio) {
  if (ratio === null) return "na";
  if (ratio > 100) return "fail";
  if (ratio >= 80) return "warn";
  return "ok";
}

function renderResults() {
  const { tp, results } = computeMatrix();
  const metric = $("r_metric").value;

  const table = $("matrixTable");
  let html = "<thead><tr><th>Ice \\ Wind (mph)</th>" +
    WIND_SPEEDS.map((v) => `<th>${v}</th>`).join("") + "</tr></thead><tbody>";

  ICE_THICKNESSES.forEach((t) => {
    html += `<tr><td class="rowhead">${t.toFixed(2)}"</td>`;
    WIND_SPEEDS.forEach((v) => {
      const r = results.find((x) => x.V === v && x.t_in === t);
      let val, cls = "";
      if (metric === "momentRatio") { val = r.momentRatio === null ? "N/A" : fmt(r.momentRatio) + "%"; cls = cellClass(r.momentRatio); }
      else if (metric === "weightRatio") { val = r.weightRatio === null ? "N/A" : fmt(r.weightRatio) + "%"; cls = cellClass(r.weightRatio); }
      else if (metric === "moment") { val = fmt(r.totalMoment); }
      else if (metric === "weight") { val = fmt(r.totalWeight); }
      else if (metric === "epa") { val = fmt(r.totalEPA); }
      html += `<td class="${cls}">${val}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  table.innerHTML = html;

  // governing case
  let gov = null;
  results.forEach((r) => {
    const ratio = Math.max(r.momentRatio ?? -Infinity, r.weightRatio ?? -Infinity);
    if (ratio === -Infinity) return;
    if (!gov || ratio > gov.ratio) gov = { ratio, r };
  });
  $("r_govCase").textContent = gov
    ? `Governing case: ${gov.r.V} mph / ${gov.r.t_in}" ice → ${fmt(gov.ratio)}% of allowable`
    : "Enter allowable moment/weight to see governing case";
  $("r_govCase").style.color = gov ? (gov.ratio > 100 ? "var(--fail)" : gov.ratio >= 80 ? "var(--warn)" : "var(--ok)") : "";

  const v3s = ($("t_origBasis").value === "fastestmile" ? num("t_origWind") * 1.2 : num("t_origWind"));
  const cur = num("t_currentWind");
  $("r_windCode").textContent = (v3s && cur)
    ? (cur > v3s ? `Site requires ${cur} mph vs original ${v3s.toFixed(0)} mph design` : `Original design (${v3s.toFixed(0)} mph) covers current requirement (${cur} mph)`)
    : "Set design/current wind speeds on Tower tab";

  populateSelectors();
  renderBreakdown();
}

function populateSelectors() {
  const wSel = $("r_selWind"), iSel = $("r_selIce");
  if (wSel.options.length === 0) {
    WIND_SPEEDS.forEach((v) => wSel.appendChild(new Option(v + " mph", v)));
    ICE_THICKNESSES.forEach((t) => iSel.appendChild(new Option(t.toFixed(2) + '"', t)));
    wSel.addEventListener("change", renderBreakdown);
    iSel.addEventListener("change", renderBreakdown);
  }
}

function renderBreakdown() {
  if (!$("r_selWind").options.length) return;
  const V = parseFloat($("r_selWind").value);
  const t = parseFloat($("r_selIce").value);
  const tp = getTowerParams();
  const t_ft = t / 12;

  let rows = [];
  if (tp.height > 0) {
    const { epaIced, weightAddPerFt } = structurePerFt(tp, t_ft);
    const qzMid = qzAt(tp.height * 0.67, V, tp.exposure, tp.kzt, tp.kd, tp.ke);
    rows.push(["Tower Structure", epaIced.toFixed(2) + " ft²/ft", (tp.selfWeight + weightAddPerFt * tp.height).toFixed(0) + " lb", "avg " + Math.round(tp.height * 0.67) + " ft", (qzMid * tp.gh * epaIced).toFixed(1) + " lb/ft"]);
  }
  apps.forEach((row) => {
    const { epaIced, weightAdd } = appIced(row, t_ft);
    const qz = qzAt(row.height, V, tp.exposure, tp.kzt, tp.kd, tp.ke);
    const F = qz * tp.gh * epaIced;
    rows.push([row.desc || "(unnamed)", epaIced.toFixed(2) + " ft²", ((row.weight + weightAdd) * (row.qty || 1)).toFixed(0) + " lb", row.height + " ft", (F * (row.qty || 1)).toFixed(1) + " lb"]);
  });
  feeds.forEach((row) => {
    const runLen = Math.max(0, row.top - row.bottom);
    if (runLen <= 0) return;
    const { epaPerFtIced, weightAddPerFt } = feedIced(row, t_ft);
    const qzMid = qzAt((row.top + row.bottom) / 2, V, tp.exposure, tp.kzt, tp.kd, tp.ke);
    const F = qzMid * tp.gh * epaPerFtIced * runLen * (row.qty || 1);
    rows.push([row.desc || row.cableType, epaPerFtIced.toFixed(3) + " ft²/ft", ((row.wpf + weightAddPerFt) * runLen * (row.qty || 1)).toFixed(0) + " lb", `${row.bottom}-${row.top} ft`, F.toFixed(1) + " lb"]);
  });

  const table = $("breakdownTable");
  table.innerHTML = "<thead><tr><th>Item</th><th>EPA</th><th>Weight (incl. ice)</th><th>Height</th><th>Wind Force</th></tr></thead><tbody>" +
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + "</tbody>";
}

/* ---------------- save / load / export ---------------- */
function collectState() {
  const state = { tower: {}, apps, feeds };
  document.querySelectorAll("#tab-tower input, #tab-tower select").forEach((el) => {
    state.tower[el.id] = el.value;
  });
  return state;
}

function applyState(state) {
  apps = state.apps || [];
  feeds = state.feeds || [];
  idCounter = Math.max(1, ...[...apps, ...feeds].map((r) => r.id + 1), 1);
  if (state.tower) {
    Object.entries(state.tower).forEach(([id, val]) => {
      const el = $(id);
      if (el) el.value = val;
    });
  }
  renderAppTable();
  renderFeedTable();
  $("t_yearBuilt").dispatchEvent(new Event("input"));
  $("t_origWind").dispatchEvent(new Event("input"));
  renderResults();
}

function newStudy() {
  if (!confirm("Start a new study? Unsaved changes will be lost.")) return;
  apps = []; feeds = [];
  addApp({ desc: "Example VHF Yagi", category: "Antenna", shape: "flat", dim1: 1, dim2: 4, weight: 15, height: 100, qty: 1 });
  recomputeAppEPA(apps[0]);
  renderAppTable();
  addFeed({ desc: "Main feedline", top: 100 });
  renderFeedTable();
  renderResults();
}

function saveToLocalStorage() {
  localStorage.setItem("towerLoadingStudy", JSON.stringify(collectState()));
  alert("Study saved to this browser.");
}
function loadFromLocalStorage() {
  const raw = localStorage.getItem("towerLoadingStudy");
  if (raw) applyState(JSON.parse(raw));
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(collectState(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (($("t_siteName").value || "tower-loading-study").replace(/[^a-z0-9-_]+/gi, "_")) + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- methodology content ---------------- */
function renderMethodology() {
  $("methodologyContent").innerHTML = `
    <h3>Wind Pressure</h3>
    <p>Velocity pressure at height z: <code>qz = 0.00256 × Kz × Kzt × Kd × Ke × V²</code> (psf, V in mph, 3-second gust).</p>
    <p><code>Kz = 2.01 × (z / zg)^(2/α)</code> using ASCE 7 / TIA-222-H Case 2 exposure constants:</p>
    <table><thead><tr><th>Exposure</th><th>α</th><th>zg (ft)</th><th>z min (ft)</th></tr></thead>
    <tbody><tr><td>B</td><td>7.0</td><td>1200</td><td>30</td></tr>
    <tr><td>C</td><td>9.5</td><td>900</td><td>15</td></tr>
    <tr><td>D</td><td>11.5</td><td>700</td><td>7</td></tr></tbody></table>

    <h3>Structure Wind Load</h3>
    <p>Per-foot EPA of the lattice face: <code>EPA/ft = faceWidth × ε × Cf</code>, where ε is the solidity ratio
    and <code>Cf = 4ε² − 5.9ε + 4.0</code> (curve-fit approximation of ASCE 7 Fig. 29.4-1 for square lattice
    towers). Force and overturning moment are found by numerically integrating pressure over
    ${N_SLICES} height slices: <code>F = Σ qz(z) × Gh × EPA/ft × Δz</code>, <code>M = Σ F × z</code>.</p>

    <h3>Appurtenance (Antenna/Dish/Mount) Wind Load</h3>
    <p>Bare EPA is computed from entered dimensions and a shape factor (Flat = 1.00, Cylindrical = 0.65,
    Parabolic Dish = 0.85), or entered directly. Force: <code>F = qz(height) × Gh × EPA</code>, applied at the
    stated mounting height.</p>

    <h3>Feedline Wind Load</h3>
    <p>Each run is treated as a round member: <code>EPA/ft = D × Cf_round</code> with <code>Cf_round = ${CF_ROUND}</code>,
    integrated over the run's height range the same way as the structure.</p>

    <h3>Ice Accretion</h3>
    <p>Radial ice thickness t is applied 0–2 inches in 0.25 inch steps. Ice density = ${ICE_DENSITY} lb/ft³
    (ASCE 7 / TIA-222 glaze ice).</p>
    <ul>
      <li><strong>Round members (feedlines):</strong> exact — <code>D_iced = D + 2t</code>;
        added weight/ft = <code>ρ_ice × (π/4) × (D_iced² − D²)</code>.</li>
      <li><strong>Dish:</strong> <code>D_iced = D + 2t</code> applied to the projected circular area.</li>
      <li><strong>Other lumped appurtenances &amp; the tower structure:</strong> a planning-level approximation —
        an equivalent linear dimension <code>L_eq = √EPA</code> is grown by 2t per side
        (<code>EPA_iced = (L_eq + 2t)²</code>). This is a simplification (true geometry is usually unknown) and
        is documented here for transparency — replace with a rigorous method if you know the item's exact profile.</li>
      <li><strong>Ice weight on lumped items:</strong> approximated as <code>ΔEPA × t × ρ_ice</code> (increased
        frontal area × thickness × density) since depth/profile is typically not available.</li>
    </ul>

    <h3>Capacity &amp; Ratios</h3>
    <p>This tool does <strong>not</strong> include manufacturer tower capacity charts. You must supply an
    Allowable Base Overturning Moment and/or Allowable Total Supported Weight from the tower's original
    engineering data, manufacturer literature, or a PE evaluation. An age-based derating percentage (user set,
    default a placeholder — not an engineering determination) reduces the allowable capacity to approximate
    corrosion/fatigue loss. Ratio = Demand ÷ (Allowable × (1 − derating%)).</p>

    <h3>Design Standard / Wind Speed Comparison</h3>
    <p>Older towers were often rated using "fastest-mile" wind speed rather than the current 3-second gust
    convention. An approximate conversion <code>V(3-sec) ≈ 1.2 × V(fastest-mile)</code> (per ASCE 7 commentary)
    is used only to support planning-level discussion — it is not a substitute for a proper code-basis
    conversion.</p>

    <h3>Limitations</h3>
    <ul>
      <li>Guy cable wind/ice load and guy tension are not modeled — guyed tower guy system loads should be
        evaluated separately (by the manufacturer or a PE) if relevant.</li>
      <li>Gust Response Factor (Gh) is a user-adjustable planning-level constant, not a full dynamic analysis
        per TIA-222-H Section 2.6.9.</li>
      <li>Tower foundations, guy anchors, and other supporting structures are assumed adequate, per the scope
        of this study.</li>
      <li>This tool is for preliminary planning and screening only. Any tower found to exceed, or come close
        to, its allowable capacity should be evaluated by a licensed Professional Engineer before any physical
        changes are made.</li>
    </ul>
  `;
}

/* ---------------- wire up ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initTowerTab();
  renderMethodology();

  $("btnAddApp").addEventListener("click", () => addApp());
  $("btnAddFeed").addEventListener("click", () => addFeed());
  $("r_metric").addEventListener("change", renderResults);

  $("btnNew").addEventListener("click", newStudy);
  $("btnSave").addEventListener("click", saveToLocalStorage);
  $("btnExport").addEventListener("click", exportJSON);
  $("btnPrint").addEventListener("click", () => { renderResults(); window.print(); });
  $("fileLoad").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyState(JSON.parse(reader.result));
    reader.readAsText(file);
    e.target.value = "";
  });

  // seed example data
  addApp({ desc: "Example VHF Yagi", category: "Antenna", shape: "flat", dim1: 1, dim2: 4, weight: 15, height: 100, qty: 1 });
  recomputeAppEPA(apps[0]);
  renderAppTable();
  addFeed({ desc: "Main feedline", top: 100 });
  renderFeedTable();

  renderResults();
});
