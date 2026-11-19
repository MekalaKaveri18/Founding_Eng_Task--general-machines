import { ZONES, type ZoneId } from "../engine/constants";
import type { Envelope, RuleId } from "../engine/envelope";
import type { Analysis, RuleRow } from "../engine/rules";
import { AVG_UNIT, FLOOR_H, NET_EFFICIENCY, PARKING_AREA_PER_BAY, type BuildingUse } from "../engine/constants";
import type { Scheme, SchemeFloor } from "../engine/designs";
import { groupSlices, MODE_COLORS, RULE_COLORS, RULE_LABELS, USE_COLORS, USE_LABELS } from "../map/envelopeLayers";
import type { AppState } from "../state";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n0 = (x: number) => Math.round(x).toLocaleString("en");
const n1 = (x: number) => x.toLocaleString("en", { maximumFractionDigits: 1 });
const letter = (i: number) => String.fromCharCode(65 + (i % 26));

export interface ViewModel {
  s: AppState;
  analysis: Analysis | null;
  edgeLengths: number[];
  banner: { kind: "error" | "warn" | "info"; text: string } | null;
  stationM: number | null;
}

const USE_LABEL: Record<BuildingUse, string> = { condo: "Condominium", rental: "Rental apartments", office: "Office", hotel: "Hotel" };

export function renderSite(vm: ViewModel): string {
  const { s } = vm;
  const rows = vm.edgeLengths
    .map((len, i) => {
      const f = s.frontage.find((x) => x.edge === i);
      return `<div class="edge ${f ? "on" : ""}" data-edge-hl="${i}">
        <label class="edge-head"><input type="checkbox" data-act="frontage" data-edge="${i}" ${f ? "checked" : ""}>
          <span class="edge-id">${letter(i)}</span><span>${n1(len)} m</span>
          <span class="edge-tag">${f ? "faces a road" : "boundary"}</span></label>
        ${f ? `<div class="edge-row"><span class="edge-name">${esc(f.name)}</span>
          <label class="inline">ROW <input type="number" min="3" max="120" step="0.5" value="${f.row}" data-act="row" data-edge="${i}" aria-label="Right-of-way of edge ${letter(i)} in metres"> m</label></div>` : ""}
      </div>`;
    })
    .join("");
  const editing = s.mode !== "idle";
  return `
    <div class="btnrow">
      <button class="btn" data-act="draw" ${s.mode === "draw" ? "aria-pressed=true" : ""}>Draw a plot</button>
      ${editing ? `<button class="btn primary" data-act="done">Done</button>` : `<button class="btn" data-act="edit">Edit corners</button>`}
    </div>
    ${s.mode === "draw" ? `<p class="hint">Click each corner on the map, then click the first corner again (or double-click) to close the outline.</p>` : ""}
    ${s.mode === "edit" ? `<p class="hint">Drag a corner to move it. Drag a small midpoint dot to add a corner. Everything below updates as you drag.</p>` : ""}
    <div class="edges-title">Which sides face a road? <span class="muted">Tick them and set the road's right-of-way (ROW = boundary to boundary).</span></div>
    <div class="edges">${rows || `<div class="muted">Draw a plot first.</div>`}</div>`;
}

export function renderInputs(vm: ViewModel): string {
  const { s } = vm;
  const zone = (z: ZoneId) => `<option value="${z}" ${s.zone === z ? "selected" : ""}>${ZONES[z].label} · FAR ${ZONES[z].far}:1 · OSR ${(ZONES[z].osr * 100).toFixed(1)}%</option>`;
  const use = (u: BuildingUse) => `<option value="${u}" ${s.use === u ? "selected" : ""}>${USE_LABEL[u]}</option>`;
  const en = (l: number, t: string) => `<option value="${l}" ${s.bonus.energyLevel === l ? "selected" : ""}>${t}</option>`;
  return `
    <label class="field"><span>Zone (brown, <span class="th">ที่อยู่อาศัยหนาแน่นมาก</span>)</span>
      <select data-act="zone">${zone("Y8")}${zone("Y9")}${zone("Y10")}</select></label>
    <label class="field"><span>Building type</span>
      <select data-act="use">${use("condo")}${use("rental")}${use("office")}${use("hotel")}</select></label>
    <details class="bonus"><summary>FAR bonuses <span class="muted">(up to +20 % in total)</span></summary>
      <label class="field"><span>Energy-conserving building</span>
        <select data-act="energy">${en(0, "none")}${en(1, "level 1 · +5 %")}${en(2, "level 2 · +10 %")}${en(3, "level 3 · +15 %")}${en(4, "level 4 · +20 %")}</select></label>
      <label class="field"><span>Water retention, in units of 1 m³ per 50 m² of land <span class="muted">(+5 % each)</span></span>
        <input type="number" min="0" max="4" step="1" value="${s.bonus.waterUnits}" data-act="water"></label>
      <label class="field"><span>Affordable housing provided (m²) <span class="muted">(adds 4× its area)</span></span>
        <input type="number" min="0" step="50" value="${s.bonus.affordableArea}" data-act="afford"></label>
    </details>`;
}

function stat(k: string, v: string, sub = "") {
  return `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${v}</div>${sub ? `<div class="stat-s">${sub}</div>` : ""}</div>`;
}

export function renderResult(vm: ViewModel): string {
  const { s, analysis } = vm;
  const tab = (m: "low" | "high", t: string, sub: string) =>
    `<button class="tab" role="tab" data-act="view" data-view="${m}" aria-selected="${s.view === m}" style="--c:${MODE_COLORS[m]}"><b>${t}</b><small>${sub}</small></button>`;
  const tabs = `<div class="tabs" role="tablist">${tab("low", "Low-rise", "under 23 m")}${tab("high", "High-rise", "23 m and up")}</div>`;
  if (!analysis) return tabs + `<p class="muted">Results appear once the outline is valid and at least one side is marked as facing a road.</p>`;
  const env: Envelope = analysis[s.view];
  if (!env.allowed) {
    return `${tabs}<div class="blocked"><b>Not buildable in this mode.</b><br>${esc(env.reason ?? "")}</div>`;
  }
  const site = analysis.siteArea;
  const os = analysis.openSpace;
  const plate1 = env.slices[0].area;
  const coverageOk = plate1 <= os.maxCoverage + 1e-6;
  const farUsed = env.allowedGfa / site;
  const capNote = env.capFloor < env.slices.length ? `FAR line crosses at floor ${env.capFloor + 1}` : "";
  return `${tabs}
    <div class="stats">
      ${stat("Tallest allowed", `${n1(env.allowedHeight)} m`, `${env.allowedFloors} floors of 3.2 m${env.allowedFloors < env.slices.length ? ` · the shape alone would allow ${n1(env.maxHeight)} m` : ""}`)}
      ${stat("Allowed floor area", `${n0(env.allowedGfa)} m²`, `${farUsed.toFixed(2)} × the plot · cap ${n0(env.gfaCap)} m²`)}
      ${stat("Largest floor plate", `${n0(plate1)} m²`, `${((plate1 / site) * 100).toFixed(0)} % of the plot`)}
      ${stat("Geometric maximum", `${n0(env.geometricGfa)} m²`, capNote || "inside the FAR cap")}
    </div>
    ${Number.isFinite(analysis.usableCap) ? `<p class="note warn">Use limit: a ${s.use} on this plot may have at most ${n0(analysis.usableCap)} m² of usable floor area (see the Use rule below), far less than the envelope would hold. The concept designs stop there.</p>` : ""}
    ${coverageOk ? "" : `<p class="note warn">The full ground plate (${n0(plate1)} m²) covers more than the ${n0(os.maxCoverage)} m² that leaves the required open space (${n0(os.required)} m², ${os.binding === "osr" ? "zone OSR" : "30 % land share"}). The concept designs trim it.</p>`}
    <p class="legend-line"><span class="sw" style="background:${MODE_COLORS[s.view]}"></span>within FAR <span class="sw beyond"></span>above the FAR line</p>`;
}

function statusChip(r: RuleRow) {
  const t = { applies: "applies", binding: "binding", blocked: "blocked", info: "info" }[r.status];
  return `<span class="chip ${r.status}">${t}</span>`;
}

export function renderRules(vm: ViewModel): string {
  const { s, analysis } = vm;
  if (!analysis) return `<p class="muted">No rules to show yet.</p>`;
  const off = new Set(s.disabled);
  const groups = new Map<string, RuleRow[]>();
  for (const r of analysis.rows) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group)!.push(r);
  }
  let html = "";
  for (const [g, rows] of groups) {
    html += `<div class="rg"><div class="rg-title">${g}</div>`;
    for (const r of rows) {
      const t = r.toggle;
      const hasGhost = t && t !== "far-cap";
      html += `<div class="rule ${t && off.has(t) ? "off" : ""}">
        <div class="rule-top"><span class="rule-label">${esc(r.label)}</span>${statusChip(r)}</div>
        <div class="rule-val">${esc(r.value)}</div>
        <div class="rule-detail">${esc(r.detail)}</div>
        <div class="rule-foot"><span class="src">${esc(r.source)}</span>
          ${t ? `<span class="ctrls">
            ${hasGhost ? `<button class="mini ${s.ghost === t ? "on" : ""}" data-act="ghost" data-rule="${t}" title="Show the volume this rule removes" style="--c:${RULE_COLORS[t]}">show removed volume</button>` : ""}
            <label class="switch" title="Switch this rule off to see the envelope without it"><input type="checkbox" data-act="rule" data-rule="${t}" ${off.has(t) ? "" : "checked"}><span>${off.has(t) ? "off" : "on"}</span></label></span>` : ""}
        </div></div>`;
    }
    html += `</div>`;
  }
  return html;
}

export function renderFloors(vm: ViewModel): string {
  const { s, analysis } = vm;
  if (!analysis) return "";
  const env = analysis[s.view];
  if (!env.allowed) return `<p class="muted">No floors in this mode.</p>`;
  const groups = groupSlices(env);
  let cum = 0;
  let rows = "";
  for (const g of groups) {
    const count = g.block.floors[1] - g.block.floors[0] + 1;
    const plate = env.slices[g.block.floors[0] - 1].area;
    const sub = env.slices.slice(g.block.floors[0] - 1, g.block.floors[1]).reduce((a, x) => a + x.area, 0);
    cum += sub;
    rows += `<tr class="${g.block.beyond ? "beyond" : ""}"><td>${g.block.floors[0] === g.block.floors[1] ? g.block.floors[0] : `${g.block.floors[0]}–${g.block.floors[1]}`}</td>
      <td>${n1(g.block.floors[0] === 1 ? 0 : (g.block.floors[0] - 1) * 3.2)}–${n1(g.block.floors[1] * 3.2)}</td>
      <td>${n1(plate)}</td><td>${count}</td><td>${n0(sub)}</td><td>${n0(cum)}</td></tr>`;
  }
  return `<table class="ft"><thead><tr><th>Floor</th><th>Height m</th><th>Plate m²</th><th>×</th><th>Subtotal m²</th><th>Cumulative m²</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5">Geometric maximum (sum of all floors)</td><td>${n0(env.geometricGfa)}</td></tr>
    <tr><td colspan="5">Allowed after the FAR cap (${n0(env.gfaCap)} m²)</td><td><b>${n0(env.allowedGfa)}</b></td></tr></tfoot></table>
    <p class="note">Rows shaded grey are above the FAR line. Totals use the same numbers as the 3D model.</p>`;
}

export function renderBanner(vm: ViewModel): string {
  if (!vm.banner) return "";
  return `<div class="banner ${vm.banner.kind}" role="status">${esc(vm.banner.text)}</div>`;
}

export function ruleName(r: RuleId) {
  return RULE_LABELS[r];
}

function floorRuns(floors: SchemeFloor[]) {
  const key = (f: SchemeFloor) => f.parts.map((p) => `${p.use}:${p.area.toFixed(1)}`).join("|");
  const runs: { a: number; b: number; f: SchemeFloor }[] = [];
  for (const f of floors) {
    const last = runs[runs.length - 1];
    if (last && key(last.f) === key(f)) last.b = f.floor;
    else runs.push({ a: f.floor, b: f.floor, f });
  }
  return runs;
}

function checkIcon(pass: boolean | null) {
  return pass === null
    ? `<span class="ck na" title="Not applicable">–</span>`
    : pass
      ? `<span class="ck ok" title="Pass">✓</span>`
      : `<span class="ck bad" title="Fail">✗</span>`;
}

function assumptionsNote(use: BuildingUse): string {
  const net = `net area ${(NET_EFFICIENCY * 100).toFixed(0)} % of the usable gross area`;
  const unit = use === "office" ? "" : `; average net ${use === "hotel" ? "room" : "unit"} ${AVG_UNIT[use]} m²`;
  return `Assumptions: ${FLOOR_H} m per floor; ${net}${unit}; parking counts toward floor area; about ${PARKING_AREA_PER_BAY} m² of floor per car space.`;
}

function schemeDetail(s: Scheme, site: number, use: BuildingUse): string {
  const checks = s.checks
    .map(
      (c) => `<tr class="${c.pass === false ? "fail" : ""}"><td>${checkIcon(c.pass)}</td>
      <td><div class="ck-label">${esc(c.label)}</div><div class="ck-vals"><b>${esc(c.value)}</b> <span class="muted">· needs ${esc(c.limit)}</span></div>
      ${c.note ? `<div class="ck-note">${esc(c.note)}</div>` : ""}<div class="ck-src">${esc(c.source)}</div></td></tr>`,
    )
    .join("");
  const runs = floorRuns(s.floors);
  let cum = 0;
  const rows = runs
    .map((r) => {
      const count = r.b - r.a + 1;
      const sub = count * r.f.area;
      cum += sub;
      const uses = r.f.parts
        .map((p) => `<span class="dot" style="background:${USE_COLORS[p.use]}"></span>${USE_LABELS[p.use]} ${n0(p.area)}`)
        .join(" + ");
      return `<tr><td>${r.a === r.b ? r.a : `${r.a}–${r.b}`}</td><td class="l">${uses}</td><td>${n0(r.f.area)}</td><td>${count}</td><td>${n0(sub)}</td><td>${n0(cum)}</td></tr>`;
    })
    .join("");
  return `<div class="sd">
    <div class="sd-title">Checklist <span class="muted">${s.checks.filter((c) => c.pass === true).length} passed · ${s.checks.filter((c) => c.pass === false).length} failed</span></div>
    <table class="ck-table"><tbody>${checks}</tbody></table>
    <div class="sd-title">Floor by floor</div>
    <table class="ft"><thead><tr><th>Floor</th><th class="l">Use and plate (m²)</th><th>Plate</th><th>×</th><th>Subtotal</th><th>Cumulative</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5" class="l">Total floor area = ${(s.gfa / site).toFixed(2)} × the plot</td><td><b>${n0(s.gfa)}</b></td></tr></tfoot></table>
    <p class="note">${assumptionsNote(use)}</p></div>`;
}

export function renderDesigns(vm: ViewModel, schemes: Scheme[] | null, pending: boolean): string {
  const { s, analysis } = vm;
  if (!analysis) return `<p class="muted">Designs appear once the plot is valid and a road side is marked.</p>`;
  if (!schemes) return `<p class="muted">${pending ? "Working out designs…" : "No designs yet."}</p>`;
  const fits = schemes.filter((x) => x.feasible && x.passes).length;
  const site = analysis.siteArea;
  const cards = schemes
    .map((d) => {
      const sel = s.design === d.kind;
      if (!d.feasible) {
        return `<div class="scheme na"><div class="sc-top"><b>${esc(d.name)}</b><span class="badge na">not possible here</span></div><div class="sc-why">${esc(d.reason ?? "")}</div></div>`;
      }
      return `<div class="scheme ${sel ? "sel" : ""} ${d.passes ? "" : "failing"}">
        <button class="sc-btn" data-act="design" data-kind="${d.kind}" aria-pressed="${sel}">
          <div class="sc-top"><b>${esc(d.name)}</b><span class="badge ${d.passes ? "ok" : "bad"}">${d.passes ? "all checks pass" : "fails " + d.checks.filter((c) => c.pass === false).length}</span></div>
          <div class="sc-blurb">${esc(d.blurb)}</div>
          <div class="sc-stats"><span><b>${d.floors.length}</b> floors · ${n1(d.height)} m</span><span><b>${n0(d.gfa)}</b> m² (${(d.gfa / site).toFixed(2)}×)</span>
            <span><b>${d.units}</b> ${d.unitLabel}</span><span><b>${d.parkingProvided}</b>/${d.parkingRequired} car spaces</span></div>
        </button>${sel ? schemeDetail(d, site, s.use) : ""}</div>`;
    })
    .join("");
  const back = s.design ? ` <button class="mini on" data-act="design-clear" style="--c:#4458e0">back to the envelope</button>` : "";
  return `<p class="muted tight">${fits} of ${schemes.filter((x) => x.feasible).length} designs pass every check on this plot. Pick one to see it in 3D with its checklist.${back}</p>
    <div class="legend-line">${(["parking", "residential"] as const).map((u) => `<span class="dot" style="background:${USE_COLORS[u]}"></span>${USE_LABELS[u]}`).join(" &nbsp; ")}</div>
    <div class="schemes">${cards}</div>`;
}
