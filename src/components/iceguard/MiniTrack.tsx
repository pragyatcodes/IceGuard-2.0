/**
 * Server-rendered SVG of one berg's history, forecast centre line and
 * conformal cone.
 *
 * Local equirectangular projection over the track's own bounding box. Good
 * enough for a single-berg snapshot, and it needs no JavaScript — so a shared
 * link still shows the track when it is opened in a plain browser or an
 * embedded webview on a station link.
 */
export function MiniTrack({
  history,
  centre,
  cone,
  start,
}: {
  history: { lat: number; lon: number }[];
  centre: { lat: number; lon: number }[];
  cone: { lat: number; lon: number }[];
  start: { lat: number; lon: number };
}) {
  const W = 800;
  const H = 340;
  const PAD = 34;

  const all: { lat: number; lon: number }[] = [
    ...history,
    ...centre,
    ...cone,
    start,
  ];
  if (all.length === 0) return null;

  const lats = all.map((p) => p.lat);
  const lons = all.map((p) => p.lon);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);

  // Never let a degenerate (near-stationary) berg produce a divide-by-zero.
  const spanLat = Math.max(maxLat - minLat, 0.15);
  const spanLon = Math.max(maxLon - minLon, 0.15);
  minLat -= spanLat * 0.12;
  maxLat += spanLat * 0.12;
  minLon -= spanLon * 0.12;
  maxLon += spanLon * 0.12;

  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const x = (lon: number) => PAD + ((lon - minLon) / (maxLon - minLon)) * (W - PAD * 2);
  // Aspect-corrected so the track shape is not squashed at high latitude.
  const ySpan = (maxLat - minLat) / Math.max(cosLat, 0.05);
  const y = (lat: number) =>
    H - PAD - ((lat - minLat) / Math.max(cosLat, 0.05) / Math.max(ySpan, 1e-6)) * (H - PAD * 2);

  const path = (pts: { lat: number; lon: number }[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`)
      .join(" ");

  const conePath = cone.length
    ? cone
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`)
        .join(" ") + " Z"
    : "";

  const end = centre[centre.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      role="img"
      aria-label="Observed history, predicted track and 90 percent uncertainty cone"
    >
      <rect width={W} height={H} fill="#050b18" />

      {/* grid */}
      {Array.from({ length: 7 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={PAD + (i * (W - PAD * 2)) / 6}
          y1={PAD}
          x2={PAD + (i * (W - PAD * 2)) / 6}
          y2={H - PAD}
          stroke="#17294a"
          strokeWidth="0.5"
        />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line
          key={`h${i}`}
          x1={PAD}
          y1={PAD + (i * (H - PAD * 2)) / 4}
          x2={W - PAD}
          y2={PAD + (i * (H - PAD * 2)) / 4}
          stroke="#17294a"
          strokeWidth="0.5"
        />
      ))}

      {conePath && (
        <>
          <path d={conePath} fill="rgba(146,112,240,0.16)" stroke="rgba(183,155,255,0.5)" strokeWidth="1" strokeDasharray="4 3" />
        </>
      )}

      {history.length > 1 && (
        <path d={path(history)} fill="none" stroke="#5f90bd" strokeWidth="1.6" strokeDasharray="2 3" />
      )}

      {centre.length > 1 && (
        <path d={path(centre)} fill="none" stroke="#38d3f5" strokeWidth="2.4" />
      )}

      {/* start marker */}
      <circle cx={x(start.lon)} cy={y(start.lat)} r="5" fill="#f2f8ff" stroke="#030711" strokeWidth="1.5" />

      {/* end marker */}
      {end && (
        <>
          <circle cx={x(end.lon)} cy={y(end.lat)} r="8" fill="rgba(56,211,245,0.18)" />
          <circle cx={x(end.lon)} cy={y(end.lat)} r="3.5" fill="#38d3f5" />
        </>
      )}

      {/* axis labels */}
      <text x={PAD} y={H - 12} fontSize="9" fill="#5f90bd" fontFamily="ui-monospace, monospace">
        {minLon.toFixed(1)}°
      </text>
      <text
        x={W - PAD}
        y={H - 12}
        fontSize="9"
        fill="#5f90bd"
        textAnchor="end"
        fontFamily="ui-monospace, monospace"
      >
        {maxLon.toFixed(1)}°
      </text>
      <text x={10} y={PAD + 4} fontSize="9" fill="#5f90bd" fontFamily="ui-monospace, monospace">
        {maxLat.toFixed(1)}°
      </text>
      <text x={10} y={H - PAD} fontSize="9" fill="#5f90bd" fontFamily="ui-monospace, monospace">
        {minLat.toFixed(1)}°
      </text>
      {end && (
        <text
          x={x(end.lon)}
          y={y(end.lat) - 14}
          fontSize="10"
          fill="#7de8ff"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
        >
          T+72 h
        </text>
      )}
    </svg>
  );
}
