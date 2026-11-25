export interface Wgs84Point {
  lat: number;
  lon: number;
}

export interface Pl1992Coords {
  /** Współrzędna X geodezyjna (północ / Northing) [m] */
  x: number;
  /** Współrzędna Y geodezyjna (wschód / Easting) [m] */
  y: number;
  epsg: 'EPSG:2180';
}

export interface Pl2000Coords {
  /** Współrzędna X geodezyjna (północ / Northing) [m] */
  x: number;
  /** Współrzędna Y geodezyjna (wschód / Easting z cechą strefy) [m] */
  y: number;
  zone: 5 | 6 | 7 | 8;
  meridian: 15 | 18 | 21 | 24;
  epsg: 'EPSG:2176' | 'EPSG:2177' | 'EPSG:2178' | 'EPSG:2179';
}

const GRS80_A = 6378137.0;
const GRS80_F = 1 / 298.257222101;
const GRS80_E2 = 2 * GRS80_F - GRS80_F * GRS80_F;
const GRS80_EP2 = GRS80_E2 / (1 - GRS80_E2);

function gaussKrugerProjection(
  latDeg: number,
  lonDeg: number,
  lon0Deg: number,
  k0: number,
  falseEasting: number,
  falseNorthing: number
): { x: number; y: number } {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  const lon0 = (lon0Deg * Math.PI) / 180;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = GRS80_A / Math.sqrt(1 - GRS80_E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = GRS80_EP2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - lon0);

  const e2 = GRS80_E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const M =
    GRS80_A *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));

  const easting =
    falseEasting +
    k0 *
      N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * GRS80_EP2) * Math.pow(A, 5)) / 120);

  const northing =
    falseNorthing +
    k0 *
      (M +
        N *
          tanPhi *
          ((A * A) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * GRS80_EP2) * Math.pow(A, 6)) / 720));

  // Polska konwencja geodezyjna: X = północ (Northing), Y = wschód (Easting)
  return { x: northing, y: easting };
}

export function wgs84ToPl1992(lat: number, lon: number): Pl1992Coords {
  const { x, y } = gaussKrugerProjection(lat, lon, 19, 0.9993, 500000, -5300000);
  return { x, y, epsg: 'EPSG:2180' };
}

export function pl1992ToWgs84(xNorthing: number, yEasting: number): Wgs84Point {
  let lat = 52.0 + (xNorthing - 460000) / 111132;
  let lon = 19.0 + (yEasting - 500000) / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < 5; i++) {
    const fwd = wgs84ToPl1992(lat, lon);
    const dN = xNorthing - fwd.x;
    const dE = yEasting - fwd.y;
    lat += dN / 111132;
    lon += dE / (111320 * Math.cos((lat * Math.PI) / 180));
    if (Math.abs(dN) < 1e-4 && Math.abs(dE) < 1e-4) break;
  }
  return { lat, lon };
}

export function wgs84ToPl2000(lat: number, lon: number): Pl2000Coords {
  let zone: 5 | 6 | 7 | 8;
  let meridian: 15 | 18 | 21 | 24;
  let epsg: Pl2000Coords['epsg'];

  if (lon < 16.5) {
    zone = 5;
    meridian = 15;
    epsg = 'EPSG:2176';
  } else if (lon < 19.5) {
    zone = 6;
    meridian = 18;
    epsg = 'EPSG:2177';
  } else if (lon < 22.5) {
    zone = 7;
    meridian = 21;
    epsg = 'EPSG:2178';
  } else {
    zone = 8;
    meridian = 24;
    epsg = 'EPSG:2179';
  }

  const falseEasting = zone * 1_000_000 + 500_000;
  const { x, y } = gaussKrugerProjection(lat, lon, meridian, 0.999923, falseEasting, 0);
  return { x, y, zone, meridian, epsg };
}

export function isWithinPoland(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 48.8 &&
    lat <= 55.2 &&
    lon >= 13.8 &&
    lon <= 24.5
  );
}

function parseSingleCoordPart(part: string): number | null {
  const clean = part
    .trim()
    .replace(/,/g, '.')
    .replace(/[°˚º]/g, ' ')
    .replace(/[′'’]/g, ' ')
    .replace(/[″"”]/g, ' ')
    .trim();

  if (!clean) return null;

  let sign = 1;
  if (/[SWsw-]/.test(clean)) sign = -1;

  const nums = clean.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0 || nums.length > 3) return null;

  const d = parseFloat(nums[0]);
  const m = nums.length >= 2 ? parseFloat(nums[1]) : 0;
  const s = nums.length === 3 ? parseFloat(nums[2]) : 0;

  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  if (m >= 60 || s >= 60) return null;

  return sign * (d + m / 60 + s / 3600);
}

/**
 * Parses WGS-84 coordinates in Polish/international formats:
 * - "N 49 23 38.13 E 20 57 34.18"
 * - "49° 23' 38,13\" N, 20° 57' 34,18\" E"
 * - "49.393925, 20.959494" / "49,393925 20,959494"
 * - "49 23.635 N 20 57.570 E"
 */
export function parseWgs84Input(raw: string): Wgs84Point | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Case 1: Explicit hemisphere letters N/S and E/W
  const hemiFirst = trimmed.match(
    /([NSns])\s*([^EWew]+?)\s*([EWew])\s*(.+)$/
  );
  if (hemiFirst) {
    const lat = parseSingleCoordPart(`${hemiFirst[1]} ${hemiFirst[2]}`);
    const lon = parseSingleCoordPart(`${hemiFirst[3]} ${hemiFirst[4]}`);
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  const hemiAfter = trimmed.match(
    /^([^NSns]+?[NSns])\s*[,;/]?\s*([^EWew]+?[EWew])$/
  );
  if (hemiAfter) {
    const lat = parseSingleCoordPart(hemiAfter[1]);
    const lon = parseSingleCoordPart(hemiAfter[2]);
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  // Case 2: Separated by semicolon or slash
  if (/[;/]/.test(trimmed)) {
    const parts = trimmed.split(/[;/]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const lat = parseSingleCoordPart(parts[0]);
      const lon = parseSingleCoordPart(parts[1]);
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }
  }

  // Case 3: Comma separator between two decimal values ("49.393925, 20.959494")
  if (trimmed.includes(',')) {
    const commaParts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
    if (commaParts.length === 2 && !trimmed.includes('°') && commaParts.every((p) => /^-?\d+(?:\.\d+)?$/.test(p))) {
      const lat = parseFloat(commaParts[0]);
      const lon = parseFloat(commaParts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }
    // Check Polish decimal comma with space separator ("49,393925 20,959494")
    const spaceParts = trimmed.split(/\s+/).filter(Boolean);
    if (spaceParts.length === 2) {
      const lat = parseSingleCoordPart(spaceParts[0]);
      const lon = parseSingleCoordPart(spaceParts[1]);
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }
  }

  // Case 4: Whitespace-separated numbers (2, 4, or 6 numbers)
  const normalized = trimmed
    .replace(/,/g, '.')
    .replace(/[°˚º′'’″"”]/g, ' ')
    .trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.every((t) => /^-?\d+(?:\.\d+)?$/.test(t))) {
    if (tokens.length === 2) {
      const lat = parseFloat(tokens[0]);
      const lon = parseFloat(tokens[1]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    }
    if (tokens.length === 4) {
      const lat = parseSingleCoordPart(`${tokens[0]} ${tokens[1]}`);
      const lon = parseSingleCoordPart(`${tokens[2]} ${tokens[3]}`);
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }
    if (tokens.length === 6) {
      const lat = parseSingleCoordPart(`${tokens[0]} ${tokens[1]} ${tokens[2]}`);
      const lon = parseSingleCoordPart(`${tokens[3]} ${tokens[4]} ${tokens[5]}`);
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }
  }

  return null;
}

export function formatDmsPl(value: number, posHem: 'N' | 'E', negHem: 'S' | 'W'): string {
  const hem = value >= 0 ? posHem : negHem;
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const remMin = (abs - deg) * 60;
  let min = Math.floor(remMin);
  let sec = (remMin - min) * 60;
  if (sec >= 59.995) {
    sec = 0;
    min += 1;
    if (min >= 60) {
      min = 0;
      deg += 1;
    }
  }
  const secStr = sec.toFixed(2).replace('.', ',').padStart(5, '0');
  const minStr = String(min).padStart(2, '0');
  return `${hem} ${deg}° ${minStr}' ${secStr}"`;
}

export function formatCoordMetersPl(val: number): string {
  return val.toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
