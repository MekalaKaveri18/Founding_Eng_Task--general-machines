import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { addLayers, COLORS, createMap, loadContext, showPlot, type ContextData } from "./map/setup";
import { addEnvelopeLayers, highlightEdge, MODE_COLORS, showEnvelope, showGhost, showScheme } from "./map/envelopeLayers";
import { PlotDrawer } from "./map/draw";
import { guessFrontage, loadRoads, nearestStationM } from "./map/roads";
import { PRESETS } from "./presets";
import { makeFrame, type LngLat } from "./geo/local";
import { Store, readHash, stateFromPreset, writeHash, type AppState } from "./state";
import { analyze } from "./engine/rules";
import { ghostFor, type PlotInput, type RuleId } from "./engine/envelope";
import { edgesOf, isSelfIntersecting, regionArea, regionFromRing, toCCW } from "./engine/geom";
import { renderBanner, renderDesigns, renderFloors, renderInputs, renderResult, renderRules, renderSite, type ViewModel } from "./ui/panel";
import { designSchemes, type Scheme } from "./engine/designs";

const DATA_BBOX = { w: 100.545, e: 100.59, s: 13.712, n: 13.752 };

const qaErrors: string[] = [];
const qaCount = { render: 0, designs: 0 };
(window as unknown as { __count: typeof qaCount }).__count = qaCount;
window.addEventListener("error", (e) => qaErrors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => qaErrors.push(String((e.reason && e.reason.message) || e.reason)));
(window as unknown as { __errs: string[] }).__errs = qaErrors;

const map = createMap("map");
(window as unknown as { __map: typeof map }).__map = map; // debug handle for QA

const store = new Store(readHash() ?? stateFromPreset("soi22"));
let ctx: ContextData | null = null;
let drawer: PlotDrawer | null = null;
let ready = false;

const $ = (id: string) => document.getElementById(id)!;

function renderLegend() {
  $("legend").innerHTML = `
    <div><span class="sw" style="background:${COLORS.context}"></span>OSM building, tagged height</div>
    <div><span class="sw" style="background:${COLORS.contextFallback}"></span>OSM building, height estimated</div>
    <div><span class="sw" style="background:${COLORS.contextOnPlot}"></span>Existing building on the plot</div>
    <div><span class="sw" style="background:${MODE_COLORS.high}"></span>Allowed envelope (high-rise)</div>
    <div><span class="sw" style="background:${MODE_COLORS.low}"></span>Allowed envelope (low-rise)</div>
    <div><span class="sw" style="background:${COLORS.frontage}"></span>Road frontage</div>
    <div><span class="sw" style="border:1.5px dashed ${COLORS.station}"></span>500 m from a rail station</div>`;
}

function renderPresetButtons() {
  const s = store.get();
  const nav = $("presets");
  nav.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.className = "preset";
    b.textContent = p.name;
    b.setAttribute("aria-pressed", String(p.id === s.presetId));
    b.onclick = () => selectPreset(p.id);
    nav.appendChild(b);
  }
}

function frameOf(s: AppState) {
  return makeFrame(s.ring[0]);
}

/** Everything derived from the state: engine input, analysis, banner. */
function compute(s: AppState): { vm: ViewModel; input: PlotInput | null } {
  const frame = frameOf(s);
  const xy = s.ring.map(frame.toXY);
  const ccw = toCCW(xy);
  const edgeLengths = edgesOf(ccw === xy ? xy : xy).map((e) => e.length);
  let banner: ViewModel["banner"] = null;
  let analysis: ViewModel["analysis"] = null;
  let input: PlotInput | null = null;
  let stationM: number | null = null;

  const c = s.ring[0];
  const inData = c[0] >= DATA_BBOX.w && c[0] <= DATA_BBOX.e && c[1] >= DATA_BBOX.s && c[1] <= DATA_BBOX.n;
  if (s.ring.length < 3) banner = { kind: "info", text: "Draw a plot to begin." };
  else if (isSelfIntersecting(xy)) banner = { kind: "error", text: "The outline crosses itself. Move a corner so the sides no longer cross." };
  else if (regionArea(regionFromRing(xy)) < 25) banner = { kind: "error", text: "This plot is too small to build on (under 25 m²)." };
  else if (s.frontage.length === 0) banner = { kind: "warn", text: "Tick the side(s) that face a road. A plot with no road frontage cannot be built on." };
  else {
    input = {
      ring: xy, roads: s.frontage.map((f) => ({ edge: f.edge, row: f.row })), zone: s.zone, use: s.use, bonus: s.bonus, disabled: s.disabled,
    };
    stationM = ctx ? nearestStationM(s.ring, ctx.stations.features) : null;
    analysis = analyze(input, stationM);
    if (!inData) banner = { kind: "warn", text: "This plot is outside the surveyed Sukhumvit area, so surrounding buildings are not available. The rules are still computed." };
    const minRow = Math.min(...s.frontage.map((f) => f.row));
    if (!banner && minRow < 6) banner = { kind: "info", text: "A right-of-way under 6 m needs a 3 m setback from the road centreline, and blocks high-rise (MR 33 art. 2)." };
  }
  return { vm: { s, analysis, edgeLengths, banner, stationM }, input };
}

// Concept designs take up to ~150 ms on a big plot, so they are computed after the cheap results, debounced while dragging.
let designTimer = 0;
let schemes: Scheme[] | null = null;
function scheduleDesigns(vm: ViewModel, input: PlotInput | null) {
  window.clearTimeout(designTimer);
  schemes = null;
  $("schemes-body").innerHTML = renderDesigns(vm, null, true);
  if (!input || !vm.analysis) return;
  designTimer = window.setTimeout(() => {
    const st = store.get();
    schemes = designSchemes(input, vm.analysis!, vm.stationM);
    if (st.design && !schemes.some((d) => d.kind === st.design && d.feasible)) store.set({ design: null });
    paintDesigns();
  }, 140);
}

function paintDesigns() {
  qaCount.designs++;
  const st = store.get();
  const { vm } = compute(st);
  $("schemes-body").innerHTML = renderDesigns(vm, schemes, false);
  const chosen = schemes?.find((d) => d.kind === st.design) ?? null;
  showScheme(map, frameOf(st), chosen);
  setEnvelopeVisible(!chosen);
}

/** The envelope volume and ghosts are hidden while a design is shown, so no two extrusions share a face. */
function setEnvelopeVisible(visible: boolean) {
  for (const id of ["env-solid", "env-beyond", "ghost-3d"]) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

// When a plot is first loaded or drawn, open on the low-rise tab if high-rise is not possible there.
let autoView = true;

let raf = 0;
let inputsDirty = true;
function schedule(inputs = true) {
  inputsDirty = inputsDirty || inputs;
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    render();
  });
}

function render() {
  if (!ready || !ctx) return;
  const s = store.get();
  const { vm, input } = compute(s);
  if (autoView && vm.analysis) {
    autoView = false;
    if (!vm.analysis.high.allowed && s.view === "high") {
      store.set({ view: "low" });
      schedule(false);
      return;
    }
  }

  // Map: plot outline, frontage edges, existing buildings
  if (s.ring.length >= 3) {
    const n = showPlot(map, ctx, s.ring, s.frontage);
    $("plot-name").textContent = `${s.presetId ? PRESETS.find((p) => p.id === s.presetId)?.name ?? "Plot" : "Your plot"} · ${n} existing building${n === 1 ? "" : "s"} on it`;
  }
  const hideOwn = s.mode === "edit" || s.mode === "draw";
  for (const id of ["plot-fill", "plot-line"]) map.setLayoutProperty(id, "visibility", hideOwn ? "none" : "visible");

  // Map: envelope and ghost
  const frame = frameOf(s);
  const drawing = s.mode === "draw"; // nothing to show for a plot that is not drawn yet
  const env = vm.analysis && !drawing ? vm.analysis[s.view] : null;
  showEnvelope(map, frame, env, MODE_COLORS[s.view]);
  showGhost(map, frame, input && s.ghost && !drawing ? ghostFor(input, s.view, s.ghost) : null, input ? s.ghost : null);

  // Panel
  $("banner").innerHTML = renderBanner(vm);
  $("site-body").innerHTML = renderSite(vm);
  if (inputsDirty) $("inputs-body").innerHTML = renderInputs(vm);
  inputsDirty = false;
  $("result-body").innerHTML = renderResult(vm);
  $("rules-body").innerHTML = renderRules(vm);
  $("floors-body").innerHTML = renderFloors(vm);
  renderPresetButtons();
  writeHash(s);
  scheduleDesigns(vm, input);
  qaCount.render++;
}

function selectPreset(id: string, fly = true) {
  drawer?.stop();
  const next = stateFromPreset(id);
  autoView = true;
  store.set({ ...next, view: "high" });
  inputsDirty = true;
  schedule();
  if (fly) flyToPlot();
}

function flyToPlot() {
  const s = store.get();
  const f = frameOf(s);
  const xy = s.ring.map(f.toXY);
  const cx = xy.reduce((a, q) => a + q[0], 0) / xy.length;
  const cy = xy.reduce((a, q) => a + q[1], 0) / xy.length;
  map.easeTo({ center: f.toLngLat([cx, cy]), zoom: 17.2, pitch: 58, duration: 900 });
}

function autoFrontage(ring: LngLat[]): AppState["frontage"] {
  return guessFrontage(ring).map((g) => ({ edge: g.edge, row: g.row, name: g.name }));
}

function onRing(ring: LngLat[], finished: boolean) {
  const s = store.get();
  const countChanged = ring.length !== s.ring.length;
  const patch: Partial<AppState> = { ring, presetId: null };
  if (finished || countChanged) patch.frontage = autoFrontage(ring);
  if (finished) {
    patch.mode = "edit";
    autoView = true;
  }
  store.set(patch);
  try {
    if (finished) drawer?.startEditing(ring);
  } finally {
    schedule(finished || countChanged); // always repaint, even if switching to edit mode failed
  }
}

function wirePanel() {
  const panel = $("panel");
  panel.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    const s = store.get();
    if (act === "draw") {
      store.set({ mode: "draw", ghost: null });
      drawer?.startDrawing();
      schedule();
    } else if (act === "edit") {
      store.set({ mode: "edit" });
      drawer?.startEditing(s.ring);
      schedule();
    } else if (act === "done") {
      drawer?.stop();
      store.set({ mode: "idle" });
      schedule();
    } else if (act === "view") {
      store.set({ view: t.dataset.view as "low" | "high" });
      schedule(false);
    } else if (act === "design") {
      const kind = t.dataset.kind as AppState["design"];
      store.set({ design: s.design === kind ? null : kind });
      paintDesigns();
      writeHash(store.get());
    } else if (act === "design-clear") {
      store.set({ design: null });
      paintDesigns();
      writeHash(store.get());
    } else if (act === "ghost") {
      const r = t.dataset.rule as RuleId;
      store.set({ ghost: s.ghost === r ? null : r });
      schedule(false);
    }
  });
  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const act = t.dataset.act;
    if (!act) return;
    const s = store.get();
    if (act === "zone") store.set({ zone: t.value as AppState["zone"] });
    else if (act === "use") store.set({ use: t.value as AppState["use"] });
    else if (act === "energy") store.set({ bonus: { ...s.bonus, energyLevel: Number(t.value) as 0 | 1 | 2 | 3 | 4 } });
    else if (act === "water") store.set({ bonus: { ...s.bonus, waterUnits: Math.max(0, Number(t.value) || 0) } });
    else if (act === "afford") store.set({ bonus: { ...s.bonus, affordableArea: Math.max(0, Number(t.value) || 0) } });
    else if (act === "rule") {
      const r = t.dataset.rule as RuleId;
      const on = (t as HTMLInputElement).checked;
      store.set({ disabled: on ? s.disabled.filter((x) => x !== r) : [...s.disabled, r] });
    } else if (act === "frontage") {
      const edge = Number(t.dataset.edge);
      const on = (t as HTMLInputElement).checked;
      const guess = autoFrontage(s.ring).find((g) => g.edge === edge);
      store.set({
        presetId: s.presetId,
        frontage: on
          ? [...s.frontage, { edge, row: guess?.row ?? 12, name: guess?.name ?? "Road" }].sort((a, b) => a.edge - b.edge)
          : s.frontage.filter((f) => f.edge !== edge),
      });
    } else if (act === "row") {
      const edge = Number(t.dataset.edge);
      const v = Math.min(120, Math.max(3, Number(t.value) || 3));
      store.set({ frontage: s.frontage.map((f) => (f.edge === edge ? { ...f, row: v } : f)) });
    }
    schedule(true);
  });
  panel.addEventListener("mouseover", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-edge-hl]");
    const s = store.get();
    if (!el) return;
    const i = Number(el.dataset.edgeHl);
    highlightEdge(map, s.ring[i] as [number, number], s.ring[(i + 1) % s.ring.length] as [number, number]);
  });
  panel.addEventListener("mouseout", (e) => {
    if ((e.target as HTMLElement).closest("[data-edge-hl]")) highlightEdge(map, null);
  });
}

renderLegend();
renderPresetButtons();
wirePanel();

map.on("load", async () => {
  ctx = await loadContext();
  addLayers(map, ctx);
  addEnvelopeLayers(map);
  await loadRoads();
  drawer = new PlotDrawer(map);
  drawer.onRing = onRing;
  (window as unknown as { __drawer: PlotDrawer }).__drawer = drawer; // debug handle for QA
  // QA hook: apply a state patch and repaint, as a user action would. Used by the break-it scripts.
  (window as unknown as { __qa: unknown }).__qa = {
    set: (patch: Partial<AppState>) => {
      autoView = true;
      store.set(patch);
      schedule(true);
    },
    state: () => store.get(),
  };
  ready = true;
  store.subscribe(() => {});
  render();
  flyToPlot();
});
