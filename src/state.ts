import type { LngLat } from "./geo/local";
import type { Bonus, RuleId } from "./engine/envelope";
import type { BuildingUse, ZoneId } from "./engine/constants";
import type { SchemeKind } from "./engine/designs";
import { DEFAULT_PRESET, PRESETS } from "./presets";

export interface FrontageState {
  edge: number;
  row: number;
  name: string;
}

export interface AppState {
  presetId: string | null;
  /** Open ring (first vertex not repeated), WGS84. */
  ring: LngLat[];
  frontage: FrontageState[];
  zone: ZoneId;
  use: BuildingUse;
  bonus: Bonus;
  disabled: RuleId[];
  view: "low" | "high";
  /** Rule whose removed volume is drawn as a translucent ghost. */
  ghost: RuleId | null;
  /** Concept design shown in 3D (replaces the envelope volume while selected). */
  design: SchemeKind | null;
  mode: "idle" | "draw" | "edit";
}

export const DEFAULT_BONUS: Bonus = { energyLevel: 0, waterUnits: 0, affordableArea: 0 };

export function stateFromPreset(id: string): AppState {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS.find((x) => x.id === DEFAULT_PRESET)!;
  return {
    presetId: p.id,
    ring: p.coords.map((c) => [...c] as LngLat),
    frontage: p.roads.map((r) => ({ ...r })),
    zone: p.zone,
    use: "condo",
    bonus: { ...DEFAULT_BONUS },
    disabled: [],
    view: "high",
    ghost: null,
    design: null,
    mode: "idle",
  };
}

type Listener = (s: AppState, prev: AppState) => void;

export class Store {
  private s: AppState;
  private listeners: Listener[] = [];
  constructor(initial: AppState) {
    this.s = initial;
  }
  get(): AppState {
    return this.s;
  }
  set(patch: Partial<AppState>) {
    const prev = this.s;
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l(this.s, prev);
  }
  subscribe(l: Listener) {
    this.listeners.push(l);
  }
}

/** Shareable URL: `#p=<preset>` for an untouched preset, otherwise `#s=<base64 json>` of the whole scenario. */
export function writeHash(s: AppState) {
  const preset = PRESETS.find((p) => p.id === s.presetId);
  const untouched =
    preset &&
    s.zone === preset.zone &&
    s.use === "condo" &&
    s.disabled.length === 0 &&
    s.design === null &&
    s.bonus.energyLevel === 0 && s.bonus.waterUnits === 0 && s.bonus.affordableArea === 0 &&
    JSON.stringify(s.ring) === JSON.stringify(preset.coords) &&
    JSON.stringify(s.frontage.map((f) => [f.edge, f.row])) === JSON.stringify(preset.roads.map((r) => [r.edge, r.row]));
  let h: string;
  if (untouched) h = `#p=${s.presetId}`;
  else {
    const payload = {
      r: s.ring.map((c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]),
      f: s.frontage.map((f) => [f.edge, f.row, f.name]),
      z: s.zone, u: s.use, b: [s.bonus.energyLevel, s.bonus.waterUnits, s.bonus.affordableArea], d: s.disabled, v: s.view, p: s.presetId, k: s.design,
    };
    h = `#s=${btoa(unescape(encodeURIComponent(JSON.stringify(payload))))}`;
  }
  if (location.hash !== h) history.replaceState(null, "", h);
}

export function readHash(): AppState | null {
  const h = location.hash;
  const sm = h.match(/^#s=(.+)$/);
  if (sm) {
    try {
      const j = JSON.parse(decodeURIComponent(escape(atob(sm[1]))));
      if (!Array.isArray(j.r) || j.r.length < 3) return null;
      const st = stateFromPreset(DEFAULT_PRESET);
      return {
        ...st,
        presetId: j.p ?? null,
        ring: j.r.map((c: number[]) => [c[0], c[1]] as LngLat),
        frontage: (j.f ?? []).map((f: [number, number, string]) => ({ edge: f[0], row: f[1], name: f[2] })),
        zone: j.z ?? st.zone,
        use: j.u ?? "condo",
        bonus: { energyLevel: j.b?.[0] ?? 0, waterUnits: j.b?.[1] ?? 0, affordableArea: j.b?.[2] ?? 0 },
        disabled: j.d ?? [],
        view: j.v === "low" ? "low" : "high",
        design: j.k ?? null,
      };
    } catch {
      return null;
    }
  }
  const pm = h.match(/^#p=([a-z0-9]+)$/);
  return pm ? stateFromPreset(pm[1]) : null;
}
