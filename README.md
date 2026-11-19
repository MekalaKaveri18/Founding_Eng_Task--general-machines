# Plot Envelope: what can I build on this Bangkok plot?

A browser tool for a Bangkok developer's first question before paying an architect: how big, how tall and what shape can a building on this plot be, given the zone's rules?

Scope: the **Brown zone (high-density residential, ย.8 / ย.9 / ย.10)** under the Bangkok Comprehensive Plan B.E. 2556, with Ministerial Regulations 33 and 55 and the Bangkok Building Control Ordinance B.E. 2544.

Status: work in progress. Site context, presets and the 3D scene are done. The rules engine, envelope and concept designs are next.

## Run

```
npm install
npm run dev
npm test
npm run build
```

## Data

`public/data/` is pre-baked from an OpenStreetMap extract by `scripts/bake_osm.py` so the app never depends on a live OSM query service. Run `python scripts/bake_osm.py <Bangkok.osm.pbf> public/data` to regenerate. Preset plots come from `scripts/make_presets.py`.

Research and sources for every rule: see `docs/research-notes.md`; build plan in `docs/build-plan.md`.
