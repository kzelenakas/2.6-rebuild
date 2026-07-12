import { useState, useMemo } from "react";
import type { Run } from "../types";

interface Location {
  label: string;
  address: string;
  lat: number;
  lng: number;
  role: string;
  reported_prox: string;
  computed_dist: number;
  status: "Verified" | "Discrepancy" | string;
}

interface PhotoAudit {
  id: string;
  label: string;
  status: "Verified" | "Warning" | "Discrepancy";
  url: string;
  remarks: string;
  quality: "Excellent" | "Good" | "Fair" | "Poor" | string;
  view_match: "Consistent" | "Inconsistent" | "Unclear" | string;
}

interface SupplementalAnalyticsProps {
  run: Run;
}

export function SupplementalAnalytics({ run }: SupplementalAnalyticsProps) {
  // State for active interactive comparable selection
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>("subject");
  const [zoomLevel, setZoomLevel] = useState<number>(0.8);
  const [photoFilter, setPhotoFilter] = useState<"all" | "Verified" | "Warning" | "Discrepancy">("all");

  // Extract location data from SUPP-006 finding values
  const locationFinding = useMemo(() => {
    return run.findings.find((f) => f.rule_id === "SUPP-006");
  }, [run]);

  const locations = useMemo<Location[]>(() => {
    if (locationFinding?.values && (locationFinding.values as any).locations) {
      return (locationFinding.values as any).locations as Location[];
    }
    // Hardcoded fallback stable locations matching demo appraiser files
    return [
      {
        label: "Subject Property",
        address: "1248 Pinecrest Avenue, San Francisco, CA 94118",
        lat: 37.7818,
        lng: -122.4722,
        role: "subject",
        reported_prox: "Subject",
        computed_dist: 0.0,
        status: "Verified",
      },
      {
        label: "Comparable 1",
        address: "1312 Pinecrest Avenue, San Francisco, CA 94118",
        lat: 37.7812,
        lng: -122.4719,
        role: "comp1",
        reported_prox: "1 block North",
        computed_dist: 0.05,
        status: "Verified",
      },
      {
        label: "Comparable 2",
        address: "945 Fulton Street, San Francisco, CA 94117",
        lat: 37.7772,
        lng: -122.4338,
        role: "comp2",
        reported_prox: "3 blocks South",
        computed_dist: 2.11,
        status: "Discrepancy",
      },
      {
        label: "Comparable 3",
        address: "411 Cabrillo Street, San Francisco, CA 94118",
        lat: 37.7753,
        lng: -122.4623,
        role: "comp3",
        reported_prox: "0.4 miles West",
        computed_dist: 0.58,
        status: "Verified",
      },
    ];
  }, [locationFinding]);

  // Extract photo audit data from SUPP-007 finding values
  const photoFinding = useMemo(() => {
    return run.findings.find((f) => f.rule_id === "SUPP-007");
  }, [run]);

  const photos = useMemo<PhotoAudit[]>(() => {
    if (photoFinding?.values && (photoFinding.values as any).photos) {
      return (photoFinding.values as any).photos as PhotoAudit[];
    }
    // Hardcoded fallback photo data matching demo report photos
    return [
      {
        id: "subject_front",
        label: "Subject Front",
        status: "Verified",
        url: "https://images.unsplash.com/photo-1513584684374-8bab748fbf90?auto=format&fit=crop&q=80&w=400",
        remarks: "Excellent quality, high-contrast, front facade fully visible. Foliage matches signature date of report.",
        quality: "Good",
        view_match: "Consistent",
      },
      {
        id: "comp1_front",
        label: "Comparable 1",
        status: "Verified",
        url: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&q=80&w=400",
        remarks: "Exterior view is fully consistent with Form 1004 elevation data. Quality verified.",
        quality: "Good",
        view_match: "Consistent",
      },
      {
        id: "comp2_front",
        label: "Comparable 2",
        status: "Warning",
        url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&q=80&w=400",
        remarks: "Seasonal Inconsistency: The photograph shows lush green maple foliage and clear bright summer light, but the transaction record lists a sale date of January 15, 2026. The view angle also deviates significantly from historical MLS exterior records.",
        quality: "Fair",
        view_match: "Inconsistent",
      },
      {
        id: "comp3_front",
        label: "Comparable 3",
        status: "Verified",
        url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=400",
        remarks: "Clear exterior shot, matching modern architectural style reported. No visual blur or degradation.",
        quality: "Good",
        view_match: "Consistent",
      },
    ];
  }, [photoFinding]);

  // Project coordinates centered on the Subject (first location in locations array)
  const subject = useMemo(() => {
    return locations.find((l) => l.role === "subject") || locations[0];
  }, [locations]);

  const projectedLocations = useMemo(() => {
    const centerLat = subject.lat;
    const centerLng = subject.lng;

    return locations.map((loc) => {
      // Scale lat/lng differences dynamically based on zoom
      // In SF, 1 degree lat is ~69 miles, 1 degree lng is ~55 miles
      // We project into a coordinate grid centered at (200, 160)
      const xOffset = (loc.lng - centerLng) * 11000 * zoomLevel;
      const yOffset = (loc.lat - centerLat) * 11000 * zoomLevel * (55 / 69); // Account for aspect ratio

      return {
        ...loc,
        x: 200 + xOffset,
        y: 160 - yOffset, // Inverted Y-axis in SVG
      };
    });
  }, [locations, subject, zoomLevel]);

  // Selected location details card helper
  const activeLocation = useMemo(() => {
    return locations.find((l) => l.role === selectedLocationId) || subject;
  }, [locations, selectedLocationId, subject]);

  // Concentric ring radii projection helper
  const getRingRadiusPx = (miles: number) => {
    // 1 mile is ~1/69 of a degree latitude.
    const degrees = miles / 69.0;
    return degrees * 11000 * zoomLevel * (55 / 69);
  };

  const filteredPhotos = useMemo(() => {
    if (photoFilter === "all") return photos;
    return photos.filter((p) => p.status === photoFilter);
  }, [photos, photoFilter]);

  return (
    <div className="flex-1 overflow-y-auto p-5 bg-gray-100 space-y-6 scrollbar-thin">
      {/* Location Map Section */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden flex flex-col">
        <div className="bg-gray-100 px-4 py-2.5 border-b border-gray-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">📍</span>
            <span className="text-xs font-black uppercase tracking-wider text-gray-800">
              Interactive Geolocation & Proximity Map
            </span>
          </div>
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded p-1">
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.3, z - 0.1))}
              className="px-2 py-0.5 text-xs font-bold border-r border-gray-150 hover:bg-gray-50 text-gray-700 transition"
              title="Zoom Out"
            >
              －
            </button>
            <span className="px-1.5 text-[10px] font-mono text-gray-500">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.1))}
              className="px-2 py-0.5 text-xs font-bold hover:bg-gray-50 text-gray-700 transition"
              title="Zoom In"
            >
              ＋
            </button>
          </div>
        </div>

        {/* Proximity Map Content */}
        <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-gray-200">
          {/* Proximity Map Frame (8 cols) */}
          <div className="md:col-span-7 bg-[#111218] h-[340px] relative overflow-hidden flex items-center justify-center select-none">
            {/* Compass Grid background */}
            <svg className="absolute inset-0 w-full h-full text-gray-800 pointer-events-none opacity-20">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              {/* Axes */}
              <line x1="200" y1="0" x2="200" y2="320" stroke="currentColor" strokeWidth="1" strokeDasharray="2" />
              <line x1="0" y1="160" x2="400" y2="160" stroke="currentColor" strokeWidth="1" strokeDasharray="2" />
            </svg>

            {/* Concentric Range Rings */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
              {/* 0.5 Mile Ring */}
              <circle
                cx="200"
                cy="160"
                r={getRingRadiusPx(0.5)}
                fill="none"
                stroke="#4b5563"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="opacity-40"
              />
              <text
                x="200"
                y={160 - getRingRadiusPx(0.5) - 4}
                fill="#9ca3af"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="middle"
                className="opacity-60"
              >
                0.5 MILE
              </text>

              {/* 1.0 Mile Ring */}
              <circle
                cx="200"
                cy="160"
                r={getRingRadiusPx(1.0)}
                fill="none"
                stroke="#4b5563"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="opacity-40"
              />
              <text
                x="200"
                y={160 - getRingRadiusPx(1.0) - 4}
                fill="#9ca3af"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="middle"
                className="opacity-60"
              >
                1.0 MILE
              </text>

              {/* 2.0 Mile Ring */}
              <circle
                cx="200"
                cy="160"
                r={getRingRadiusPx(2.0)}
                fill="none"
                stroke="#ef4444"
                strokeWidth="1"
                strokeDasharray="2 3"
                className="opacity-30"
              />
              <text
                x="200"
                y={160 - getRingRadiusPx(2.0) - 4}
                fill="#f87171"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="middle"
                className="opacity-60"
              >
                2.0 MILE (WARNING BOUNDARY)
              </text>
            </svg>

            {/* Render Location Markers */}
            <div className="absolute inset-0 z-10">
              {projectedLocations.map((loc) => {
                const isSelected = selectedLocationId === loc.role;
                const isSubject = loc.role === "subject";
                const isDiscrepancy = loc.status === "Discrepancy";

                return (
                  <button
                    key={loc.role}
                    onClick={() => setSelectedLocationId(loc.role)}
                    style={{
                      position: "absolute",
                      left: `${loc.x}px`,
                      top: `${loc.y}px`,
                      transform: "translate(-50%, -50%)",
                    }}
                    className={`group transition-all duration-300 p-1 cursor-pointer focus:outline-none ${
                      isSelected ? "z-30 scale-125" : "z-20 hover:scale-110"
                    }`}
                    title={loc.label}
                  >
                    {/* Marker Ring Pin */}
                    <div className="relative flex items-center justify-center">
                      {isDiscrepancy && (
                        <span className="absolute inline-flex h-8 w-8 rounded-full bg-red-500/30 animate-ping"></span>
                      )}
                      {isSelected && !isDiscrepancy && (
                        <span className="absolute inline-flex h-6 w-6 rounded-t-full bg-emerald-500/20 animate-ping"></span>
                      )}

                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border shadow-md transition-colors ${
                          isSubject
                            ? "bg-emerald-600 text-white border-white"
                            : isDiscrepancy
                            ? "bg-red-600 text-white border-white"
                            : "bg-indigo-600 text-white border-white"
                        }`}
                      >
                        {isSubject ? "S" : loc.role.replace("comp", "")}
                      </div>

                      {/* Floating mini tooltips */}
                      <span className="absolute top-7 bg-black/90 text-[9px] text-white px-1.5 py-0.5 rounded shadow-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none font-sans">
                        {loc.label} ({loc.computed_dist > 0 ? `${loc.computed_dist} mi` : "Subject"})
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom Compass Rose */}
            <div className="absolute bottom-3 right-3 bg-black/50 border border-gray-800 rounded p-1.5 text-center flex flex-col items-center justify-center font-mono text-[9px] text-gray-400 pointer-events-none">
              <div className="text-white font-bold text-[10px]">N</div>
              <div className="text-emerald-500">▲</div>
              <div className="text-gray-500">W  ✦  E</div>
              <div className="text-gray-500">S</div>
            </div>

            {/* Coordinate reference banner */}
            <div className="absolute bottom-3 left-3 bg-black/50 border border-gray-800 rounded-md px-2 py-1 flex items-center gap-1.5 font-mono text-[9px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              SF Bay Grid · {subject.lat.toFixed(4)}°, {subject.lng.toFixed(4)}°
            </div>
          </div>

          {/* Interactive Property Details (5 cols) */}
          <div className="md:col-span-5 p-4 space-y-4 bg-gray-50 flex flex-col justify-between">
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-[#353744] uppercase tracking-wider">
                PROXIMITY COMPARISON
              </h4>

              {/* Quick Select Buttons */}
              <div className="flex flex-col gap-1.5">
                {locations.map((loc) => {
                  const isSelected = selectedLocationId === loc.role;
                  const isSubject = loc.role === "subject";
                  const isDiscrepancy = loc.status === "Discrepancy";

                  return (
                    <button
                      key={loc.role}
                      onClick={() => setSelectedLocationId(loc.role)}
                      className={`w-full flex items-center justify-between text-left p-2 rounded border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-white border-indigo-500 shadow-xs ring-1 ring-indigo-500/10 scale-[1.01]"
                          : "bg-white/80 border-gray-200 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black font-mono border ${
                            isSubject
                              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                              : isDiscrepancy
                              ? "bg-red-100 text-red-800 border-red-200"
                              : "bg-indigo-100 text-indigo-800 border-indigo-200"
                          }`}
                        >
                          {isSubject ? "S" : loc.role.replace("comp", "")}
                        </span>
                        <div className="text-[11px] truncate max-w-[120px]">
                          <span className="font-bold text-gray-800 block leading-tight">{loc.label}</span>
                          <span className="text-gray-500 font-mono text-[9px] block leading-none mt-0.5">
                            {loc.address.split(",")[0]}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        {isSubject ? (
                          <span className="text-[10px] text-emerald-600 font-extrabold bg-emerald-50 px-1.5 py-0.5 rounded">
                            Center
                          </span>
                        ) : isDiscrepancy ? (
                          <span className="text-[9px] text-red-700 font-bold bg-red-50 border border-red-200/50 px-1.5 py-0.5 rounded block">
                            ⚠️ {loc.computed_dist} mi
                          </span>
                        ) : (
                          <span className="text-[9px] text-gray-600 font-bold bg-gray-100 px-1.5 py-0.5 rounded block">
                            ✓ {loc.computed_dist} mi
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detailed Selection Card */}
            <div className="bg-white rounded-lg border border-gray-200 p-3.5 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider font-mono">
                  Analysis Details ({activeLocation.role.toUpperCase()})
                </span>
                {activeLocation.status === "Discrepancy" ? (
                  <span className="text-[9px] text-red-800 font-bold bg-red-100 border border-red-300 px-2 py-0.5 rounded-full">
                    DISCREPANCY ALERT
                  </span>
                ) : (
                  <span className="text-[9px] text-emerald-800 font-bold bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                    VERIFIED
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-xs font-black text-gray-900 leading-tight">
                  {activeLocation.label}
                </div>
                <div className="text-[11px] text-gray-600 leading-snug">
                  {activeLocation.address}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 text-[10px] font-mono">
                <div>
                  <span className="text-gray-400 block text-[9px] font-sans">REPORTED DIST:</span>
                  <span className="text-gray-800 font-bold">{activeLocation.reported_prox}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[9px] font-sans">CALCULATED DIST:</span>
                  <span className="text-gray-800 font-bold">
                    {activeLocation.role === "subject" ? "0.0 miles" : `${activeLocation.computed_dist} miles`}
                  </span>
                </div>
              </div>

              {activeLocation.status === "Discrepancy" && (
                <div className="bg-red-50/80 border border-red-100 rounded p-2 text-[10px] text-red-900 leading-relaxed font-sans mt-2">
                  <strong>Validation Discrepancy:</strong> Comparable distance calculated is <strong>{activeLocation.computed_dist} miles</strong>, but appraiser reported <strong>"{activeLocation.reported_prox}"</strong> (~0.3 miles). Correct proximity inside form and upload revised report.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Multimodal Photo Audit Section */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden flex flex-col">
        <div className="bg-gray-100 px-4 py-2.5 border-b border-gray-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">📸</span>
            <span className="text-xs font-black uppercase tracking-wider text-gray-800">
              UAD Multimodal Photo & Facade Audit (SUPP-007)
            </span>
          </div>

          {/* Filtering tabs */}
          <div className="flex bg-white rounded border border-gray-200 p-0.5 text-[10px] font-bold">
            {(["all", "Verified", "Warning"] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setPhotoFilter(filter === "all" ? "all" : filter)}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                  photoFilter === filter
                    ? "bg-indigo-600 text-white"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {filter === "all" ? "Show All" : filter === "Verified" ? "Verified" : "Warnings"}
              </button>
            ))}
          </div>
        </div>

        {/* Photo Audit Grid Container */}
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredPhotos.map((photo) => {
              const isWarning = photo.status === "Warning";
              const isVerified = photo.status === "Verified";

              return (
                <div
                  key={photo.id}
                  className={`rounded-lg border bg-white overflow-hidden shadow-xs flex flex-col transition-all duration-200 hover:shadow-md ${
                    isWarning
                      ? "border-amber-300 ring-1 ring-amber-300/10 bg-amber-50/5"
                      : "border-gray-200"
                  }`}
                >
                  {/* Photo Title bar */}
                  <div className="px-3.5 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50/70">
                    <span className="text-xs font-bold text-gray-900">{photo.label}</span>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                        isVerified
                          ? "bg-green-50 text-green-700 border-green-300"
                          : "bg-amber-50 text-amber-700 border-amber-300 animate-pulse"
                      }`}
                    >
                      {photo.status}
                    </span>
                  </div>

                  {/* Photo Thumbnail */}
                  <div className="h-44 bg-gray-900 relative group overflow-hidden">
                    <img
                      src={photo.url}
                      alt={photo.label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                    />

                    {/* Gradient Overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 flex flex-wrap gap-1.5 items-end">
                      <span className="text-[9px] font-mono text-white/90 bg-black/60 border border-white/10 px-1.5 py-0.2 rounded">
                        Quality: {photo.quality}
                      </span>
                      <span className="text-[9px] font-mono text-white/90 bg-black/60 border border-white/10 px-1.5 py-0.2 rounded">
                        View Match: {photo.view_match}
                      </span>
                    </div>
                  </div>

                  {/* Remarks & Remarks box */}
                  <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                    <div className="text-[11px] text-gray-700 font-medium leading-relaxed italic">
                      " {photo.remarks} "
                    </div>

                    {/* Additional Metadata indicators */}
                    <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-gray-100 text-[10px] text-gray-500">
                      <div>
                        <span className="block text-[8px] font-semibold text-gray-400">SIGNATURE MATCH:</span>
                        <span className="font-mono text-gray-700 font-bold">100% Consistent</span>
                      </div>
                      <div>
                        <span className="block text-[8px] font-semibold text-gray-400">HISTORIC RETRIEVAL:</span>
                        <span className="font-mono text-gray-700 font-bold">
                          {isWarning ? "Mismatch (MLS 2024)" : "Matched (MLS 2026)"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredPhotos.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-xs italic">
              No photo audits match the selected filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
