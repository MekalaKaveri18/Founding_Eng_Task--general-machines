import type { Map as MLMap } from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { LngLat } from "../geo/local";


/**
 * Polygon drawing and vertex editing (Terra Draw). The plot itself is owned by the app state;
 * Terra Draw only produces rings, which we read back from its snapshot.
 */
export class PlotDrawer {
  /** Exposed for QA scripts only. */
  draw: TerraDraw;
  private ready = false;
  onRing: (ring: LngLat[], finished: boolean) => void = () => {};

  constructor(map: MLMap) {
    this.draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: { fillColor: "#b45309", fillOpacity: 0.18, outlineColor: "#7c2d12", outlineWidth: 2, closingPointColor: "#7c2d12" },
        }),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                draggable: true,
                coordinates: { midpoints: true, draggable: true, deletable: true },
              },
            },
          },
          styles: { selectedPolygonColor: "#b45309", selectedPolygonFillOpacity: 0.12, selectedPolygonOutlineColor: "#7c2d12" },
        }),
      ],
    });
    this.draw.on("ready", () => (this.ready = true));
    this.draw.start();

    this.draw.on("finish", (id, ctx) => {
      if (ctx.mode === "polygon") {
        const ring = this.ringOf(id);
        this.draw.clear();
        if (ring) this.onRing(ring, true);
      }
    });
    this.draw.on("change", (ids, type) => {
      if (type !== "update") return;
      const mode = this.draw.getMode();
      if (mode !== "select") return;
      const ring = this.ringOf(ids[0]);
      if (ring) this.onRing(ring, false);
    });
  }

  private ringOf(id: string | number): LngLat[] | null {
    const f = this.draw.getSnapshotFeature(id);
    if (!f || f.geometry.type !== "Polygon") return null;
    const ring = f.geometry.coordinates[0].slice(0, -1) as LngLat[];
    return ring.length >= 3 ? ring : null;
  }

  startDrawing() {
    this.draw.clear();
    this.draw.setMode("polygon");
  }

  startEditing(ring: LngLat[]) {
    this.draw.clear();
    // Terra Draw only accepts UUID-style feature ids by default.
    const id = crypto.randomUUID();
    const res = this.draw.addFeatures([
      { id, type: "Feature", properties: { mode: "polygon" }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } },
    ]);
    if (res.some((r) => !r.valid)) {
      console.error("Terra Draw rejected the plot for editing", res);
      return;
    }
    this.draw.setMode("select");
    this.draw.selectFeature(id);
  }

  /** Replace the editable polygon (e.g. when a preset is picked while editing). */
  stop() {
    if (!this.ready) return;
    this.draw.clear();
    this.draw.setMode("static");
  }
}
