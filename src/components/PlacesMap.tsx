"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { LongHaulPlace } from "@/lib/longhaul";

// Clickable world map of long-haul places for "Further away". Browser-only
// (Leaflet needs `window`), so it's loaded with next/dynamic and ssr: false.
// The countries are drawn from a bundled outline (Natural Earth via
// world-atlas), so there are no map tiles, keys or outside services.

const isDark = () => document.documentElement.classList.contains("dark");
const landStyle = (): L.PathOptions =>
  isDark()
    ? { fillColor: "#334155", fillOpacity: 1, color: "#0f172a", weight: 0.6 }
    : { fillColor: "#e2e8f0", fillOpacity: 1, color: "#ffffff", weight: 0.8 };
const SEA = { light: "#f0f9ff", dark: "#0b1220" };
/** Roughly everywhere people live, so the map opens on the whole world. */
const WORLD: L.LatLngBoundsExpression = [
  [-48, -125],
  [62, 178],
];

export default function PlacesMap({
  places,
  selected,
  dimmed,
  onToggle,
}: {
  places: LongHaulPlace[];
  /** Codes of the places picked. */
  selected: string[];
  /** Codes of places that don't match the chosen holiday types. */
  dimmed: Set<string>;
  onToggle: (place: LongHaulPlace) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const toggle = useRef(onToggle);

  useEffect(() => {
    toggle.current = onToggle;
  }, [onToggle]);

  // Create the map once; follow the light/dark theme.
  useEffect(() => {
    if (!container.current) return;
    const el = container.current;
    const m = L.map(el, {
      minZoom: 1,
      maxZoom: 7,
      zoomSnap: 0.25,
      maxBounds: [
        [-75, -200],
        [85, 200],
      ],
      maxBoundsViscosity: 1,
      scrollWheelZoom: false, // don't hijack page scrolling; use the +/- buttons or pinch
      attributionControl: true,
    }).fitBounds(WORLD);
    m.attributionControl.setPrefix(false).addAttribution("Map: Natural Earth");
    const paintSea = () => (el.style.background = isDark() ? SEA.dark : SEA.light);
    paintSea();
    let land: L.GeoJSON | null = null;
    let gone = false;
    // ~750 KB of outlines, so only fetched when the map is shown.
    Promise.all([import("world-atlas/countries-50m.json"), import("topojson-client")]).then(
      ([world, topo]) => {
        if (gone) return;
        const topology = (world.default ?? world) as unknown as Parameters<typeof topo.feature>[0];
        const countries = topo.feature(topology, topology.objects.countries);
        land = L.geoJSON(countries, { style: landStyle, interactive: false }).addTo(m);
        land.bringToBack();
      },
    );
    markers.current = L.layerGroup().addTo(m);
    map.current = m;

    const observer = new MutationObserver(() => {
      paintSea();
      land?.setStyle(landStyle);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      gone = true;
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // Redraw the dots when the places or choices change.
  useEffect(() => {
    const layer = markers.current;
    if (!layer) return;
    layer.clearLayers();
    const picked = new Set(selected);
    // Dimmed first, picked last, so picked dots sit on top.
    const order = (p: LongHaulPlace) => (picked.has(p.code) ? 2 : dimmed.has(p.code) ? 0 : 1);
    for (const p of [...places].sort((a, b) => order(a) - order(b))) {
      const on = picked.has(p.code);
      const faded = !on && dimmed.has(p.code);
      L.circleMarker([p.lat, p.lon], {
        radius: on ? 8 : 6,
        weight: 2,
        color: faded ? "#94a3b8" : "#0284c7",
        fillColor: on ? "#0284c7" : faded ? "#cbd5e1" : "#ffffff",
        fillOpacity: faded ? 0.5 : 1,
        opacity: faded ? 0.6 : 1,
      })
        .bindTooltip(`${p.name}, ${p.country}${on ? " ✓" : ""}`, { direction: "top", offset: [0, -6] })
        .on("click", () => toggle.current(p))
        .addTo(layer);
    }
  }, [places, selected, dimmed]);

  return (
    <div
      ref={container}
      className="h-72 w-full overflow-hidden rounded-xl border border-slate-200 sm:h-80 dark:border-slate-700"
      role="application"
      aria-label="Map of destinations: click a dot to add or remove it"
    />
  );
}
