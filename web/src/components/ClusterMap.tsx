import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { type Map, type GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

interface Cluster {
  id?: string;
  name?: string;
  dataCenter?: string;
  site?: string;
  lat: number;
  lng: number;
  gpuLoad?: number;
  gpu?: number;
  temperature?: number;
  cooling?: number;
  power?: number;
  status: string;
  spikeActive?: boolean;
}

export default function ClusterMap({ clusters }: { clusters: Cluster[] }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const mapLoadedRef = useRef(false);
  const roRef = useRef<ResizeObserver | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const selectedCluster = clusters.find(
    (c) => c.id === selectedClusterId || c.name === selectedClusterId
  );

  const hasFitBoundsRef = useRef(false);

  // GeoJSON for clusters
  const geojson = useMemo(() => {
    const features = (clusters || [])
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => {
        // Extract cluster letter from name (e.g., "Cluster A" -> "A")
        const clusterLetter = c.name?.replace('Cluster ', '') || '';
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
          properties: {
            id: c.id || c.name || "",
            name: c.name || "",
            clusterLetter,
            site: c.site || "",
            status: c.status,
            load: (c.gpuLoad ?? c.gpu ?? 0) as number,
            spikeActive: Boolean(c.spikeActive),
          },
        };
      });
    return { type: "FeatureCollection" as const, features };
  }, [clusters]);

  // Initialize map once
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token) {
      console.error("❌ Missing Mapbox access token - add VITE_MAPBOX_ACCESS_TOKEN to .env");
      return;
    }
    if (mapRef.current || !mapContainerRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [30, 20], // Centered globally to show all continents
      zoom: 1.5, // Zoomed out to show worldwide distribution
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("load", () => {
      mapLoadedRef.current = true;
      // source + layer
      if (!map.getSource("clusters")) {
        map.addSource("clusters", { type: "geojson", data: geojson as any });
      }
      if (!map.getLayer("clusters-layer")) {
        map.addLayer({
          id: "clusters-layer",
          type: "circle",
          source: "clusters",
          paint: {
            "circle-color": [
              "case",
              ["==", ["get", "status"], "offline"], "#ff4d4d",
              [">", ["get", "load"], 75], "#ffa500",
              "#00ff88",
            ],
            "circle-radius": ["case", ["==", ["get", "spikeActive"], true], 9, 7],
            "circle-stroke-color": [
              "case",
              ["==", ["get", "spikeActive"], true], "#ffff00",
              "#ffffff",
            ],
            "circle-stroke-width": ["case", ["==", ["get", "spikeActive"], true], 3, 2],
            "circle-opacity": 0.95,
          },
        });
      }
      
      // Add text labels for cluster letters
      if (!map.getLayer("clusters-labels")) {
        map.addLayer({
          id: "clusters-labels",
          type: "symbol",
          source: "clusters",
          layout: {
            "text-field": ["get", "clusterLetter"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 14,
            "text-offset": [0, -1.5],
            "text-anchor": "bottom",
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#000000",
            "text-halo-width": 2,
          },
        });
      }

      // interactions
      map.on("mouseenter", "clusters-layer", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "clusters-layer", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "clusters-layer", (e: any) => {
        const feature = e.features && e.features[0];
        if (!feature) return;
        const props = (feature.properties || {}) as any;
        
        // Show popup with cluster info
        const clusterLetter = props.clusterLetter || "";
        const siteName = props.site || "";
        const load = props.load || 0;
        
        new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family: system-ui; padding: 4px;">
              <div style="font-weight: bold; font-size: 16px; color: #00d4ff; margin-bottom: 4px;">
                Cluster ${clusterLetter}
              </div>
              <div style="font-size: 13px; color: #e0e6ed; margin-bottom: 2px;">
                📍 ${siteName}
              </div>
              <div style="font-size: 12px; color: #a0aec0;">
                GPU Load: ${load}%
              </div>
            </div>
          `)
          .addTo(map);
        
        // Also select the cluster in the detail panel
        const id = (props.id as string) || (props.name as string) || "";
        if (id) setSelectedClusterId(id);
      });

      // initial fit
      if (!hasFitBoundsRef.current && geojson.features.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        geojson.features.forEach((f) => {
          // @ts-expect-error tuple coords
          bounds.extend(f.geometry.coordinates);
        });
        map.fitBounds(bounds, { padding: 80 });
        hasFitBoundsRef.current = true;
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(mapContainerRef.current);
    roRef.current = ro;

    return () => {
      try {
        roRef.current?.disconnect();
      } catch {}
      roRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      mapLoadedRef.current = false;
      hasFitBoundsRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when clusters change
  useEffect(() => {
    if (!mapRef.current || !mapLoadedRef.current) return;
    const src = mapRef.current.getSource("clusters") as GeoJSONSource | undefined;
    if (src) src.setData(geojson as any);

    if (!hasFitBoundsRef.current && geojson.features.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      geojson.features.forEach((f) => {
        // @ts-expect-error tuple coords
        bounds.extend(f.geometry.coordinates);
      });
      mapRef.current.fitBounds(bounds, { padding: 80 });
      hasFitBoundsRef.current = true;
    }
  }, [geojson]);

  return (
    <div className="space-y-4">
      {/* 🗺️ Map */}
      <div
        ref={mapContainerRef}
        className="h-[400px] w-full rounded-lg border border-cyan-400/20 relative"
        style={{ position: "relative" }}
      />

      {selectedCluster && (
        <div className="tm-glass p-5 rounded-lg border border-cyan-400/30">
          <div className="flex justify-between items-center mb-3">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-cyan-400">
                {selectedCluster.site || selectedCluster.name}
              </h3>
              {selectedCluster.site && (
                <div className="text-xs text-slate-400 mt-1">
                  {selectedCluster.name}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedCluster.spikeActive && (
                <span className="px-2 py-1 rounded-full text-xs font-semibold bg-amber-400/20 text-amber-300 animate-pulse">
                  ⚡ SPIKE
                </span>
              )}
              <span
                className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  selectedCluster.status === "offline"
                    ? "bg-red-400/20 text-red-300"
                    : "bg-emerald-400/20 text-emerald-300"
                }`}
              >
                {selectedCluster.status.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-slate-400 text-xs mb-1">Avg GPU</div>
              <div className="font-semibold text-emerald-400 text-lg">
                {selectedCluster.gpuLoad ?? selectedCluster.gpu ?? "—"}%
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Avg Cooling</div>
              <div className="font-semibold text-cyan-400 text-lg">
                {selectedCluster.cooling ?? "—"}%
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Total Power</div>
              <div className="font-semibold text-slate-300 text-lg">
                {selectedCluster.power ?? "—"}
                <span className="text-xs text-slate-400 ml-1">kW</span>
              </div>
            </div>
          </div>

          <div className="mt-4 h-[1px] bg-cyan-400/20" />

          <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-slate-400 text-xs">Location</div>
              <div className="font-semibold text-slate-300">
                {selectedCluster.site ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Latitude</div>
              <div className="font-semibold text-slate-300">
                {selectedCluster.lat.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Longitude</div>
              <div className="font-semibold text-slate-300">
                {selectedCluster.lng.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
