import * as THREE from "three";

const LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";
const BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";

export interface LiveSatResult {
  texture: THREE.CanvasTexture;
  capturedAt: string | null;
}

/**
 * Live satellite imagery, no API key: composes the latest-pass NASA GIBS
 * WMTS tiles (EPSG:4326, `/default/` time = most recent available pass)
 * into a single equirectangular canvas texture for the globe.
 * Tries zoom 2 (8×4 = 32 tiles of 512 px → 4096×2048) then zoom 1.
 */
export async function fetchLiveSatTexture(): Promise<LiveSatResult> {
  let lastErr: unknown = null;
  for (const z of [2, 1]) {
    try {
      const cols = 2 ** (z + 1);
      const rows = 2 ** z;
      const canvas = document.createElement("canvas");
      canvas.width = cols * 512;
      canvas.height = rows * 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#02060e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const jobs: Promise<{ r: number; c: number; bmp: ImageBitmap; when: string | null }>[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          jobs.push(
            fetch(`${BASE}/${LAYER}/default/250m/${z}/${r}/${c}.jpeg`).then(async (res) => {
              if (!res.ok) throw new Error(`tile ${z}/${r}/${c} → ${res.status}`);
              return {
                r,
                c,
                bmp: await createImageBitmap(await res.blob()),
                when: res.headers.get("layer-time-actual"),
              };
            }),
          );
        }
      }
      const tiles = await Promise.all(jobs);
      for (const t of tiles) ctx.drawImage(t.bmp, t.c * 512, t.r * 512);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      return { texture, capturedAt: tiles[0]?.when ?? null };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("GIBS unreachable");
}
