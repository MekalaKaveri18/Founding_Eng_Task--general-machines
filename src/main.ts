import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { addLayers, COLORS, createMap, loadContext, showPlot, type ContextData } from "./map/setup";
import { DEFAULT_PRESET, PRESETS, type Preset } from "./presets";
import { makeFrame, signedArea } from "./geo/local";

const ZONE_LABEL: Record<string, string> = { Y8: "ย.8", Y9: "ย.9", Y10: "ย.10" };

const map = createMap("map");
(window as unknown as { __map: typeof map }).__map = map; // debug handle for QA
let ctx: ContextData | null = null;
let current: Preset = PRESETS.find((p) => p.id === readHashPreset()) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET)!;

function readHashPreset(): string | null {
  const m = location.hash.match(/p=([a-z0-9]+)/);
  return m ? m[1] : null;
}

function renderPresetButtons() {
  const nav = document.getElementById("presets")!;
  nav.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.className = "preset";
    b.textContent = p.name;
    b.setAttribute("aria-pressed", String(p.id === current.id));
    b.onclick = () => selectPreset(p, true);
    nav.appendChild(b);
  }
}

function renderSite(onPlot: number) {
  const f = makeFrame(current.coords[0]);
  const area = Math.abs(signedArea(current.coords.map(f.toXY)));
  const body = document.getElementById("site-body")!;
  body.innerHTML = `
    <dl class="kv">
      <dt>Plot</dt><dd>${current.name}</dd>
      <dt>Site area</dt><dd>${area.toLocaleString("en", { maximumFractionDigits: 0 })} m² · ${(area / 1600).toFixed(2)} rai</dd>
      <dt>Zone</dt><dd><span class="th">${ZONE_LABEL[current.zone]}</span> (brown, high-density residential)</dd>
      ${current.roads.map((r) => `<dt>Faces</dt><dd>${r.name} · ROW ${r.row} m</dd>`).join("")}
      <dt>Existing buildings on plot</dt><dd>${onPlot}</dd>
    </dl>
    <p class="note">${current.note}</p>`;
}

function renderLegend() {
  document.getElementById("legend")!.innerHTML = `
    <div><span class="sw" style="background:${COLORS.context}"></span>OSM building, tagged height</div>
    <div><span class="sw" style="background:${COLORS.contextFallback}"></span>OSM building, height estimated</div>
    <div><span class="sw" style="background:${COLORS.contextOnPlot}"></span>Existing building on the plot</div>
    <div><span class="sw" style="background:${COLORS.frontage}"></span>Road frontage</div>
    <div><span class="sw" style="border:1.5px dashed ${COLORS.station}"></span>500 m from a rail station</div>`;
}

function selectPreset(p: Preset, fly: boolean) {
  current = p;
  history.replaceState(null, "", `#p=${p.id}`);
  renderPresetButtons();
  if (!ctx) return;
  const n = showPlot(map, ctx, p.coords, p.roads);
  renderSite(n);
  if (fly) {
    const f = makeFrame(p.coords[0]);
    const xy = p.coords.map(f.toXY);
    const cx = xy.reduce((s, q) => s + q[0], 0) / xy.length;
    const cy = xy.reduce((s, q) => s + q[1], 0) / xy.length;
    map.easeTo({ center: f.toLngLat([cx, cy]), zoom: 17.4, duration: 900 });
  }
}

renderPresetButtons();
renderLegend();

map.on("load", async () => {
  ctx = await loadContext();
  addLayers(map, ctx);
  selectPreset(current, true);
});
