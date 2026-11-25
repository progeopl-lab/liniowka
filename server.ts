import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  isWithinPoland,
  pl1992ToWgs84,
  wgs84ToPl1992,
  wgs84ToPl2000,
} from './src/data/polishCoords.ts';
import { resolvePhysioHierarchy } from './src/data/physioRegions.ts';
import type {
  GeologyDescriptionResponse,
  GeologyDescriptionSource,
  MgpBoard,
  MgpEditionInfo,
  MgpMapMeta,
  MiningHit,
  NearbyFeature,
  SmgpCrossSectionInfo,
  SmgpLegendUnit,
  SmgpMapMeta,
  SopoCitationMeta,
  SopoHit,
  SopoLandslideDetails,
  SpatialHit,
  TerrainReportResponse,
} from './src/data/terrainTypes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'PRO-GEO-Geotech/1.0 (progeo.pl)';

interface DistResult {
  inside: boolean;
  dist: number;
  dirToObj: string;
  dirFromObj: string;
}

function compassPl(dE: number, dN: number): string {
  const ang = ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
  const dirs = [
    'na północ',
    'na północny wschód',
    'na wschód',
    'na południowy wschód',
    'na południe',
    'na południowy zachód',
    'na zachód',
    'na północny zachód',
  ];
  return dirs[Math.round(ang / 45) % 8];
}

function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { d: number; nx: number; ny: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return { d: Math.hypot(px - nx, py - ny), nx, ny };
}

function distToRings(px: number, py: number, rings: number[][][]): DistResult {
  let insideCount = 0;
  let best = { d: Infinity, nx: px, ny: py };
  for (const ring of rings) {
    if (ring.length < 2) continue;
    if (pointInRing(px, py, ring)) insideCount++;
    for (let i = 0; i < ring.length - 1; i++) {
      const r = pointToSegDist(px, py, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
      if (r.d < best.d) best = r;
    }
  }
  if (insideCount % 2 === 1) {
    return { inside: true, dist: 0, dirToObj: '', dirFromObj: '' };
  }
  const dE = best.nx - px;
  const dN = best.ny - py;
  return {
    inside: false,
    dist: Math.round(best.d),
    dirToObj: compassPl(dE, dN),
    dirFromObj: compassPl(-dE, -dN),
  };
}

function distToGeoJsonGeometry(
  px: number,
  py: number,
  geom: { type?: string; coordinates?: unknown } | null | undefined
): DistResult {
  if (!geom || !geom.type || !geom.coordinates) {
    return { inside: false, dist: Infinity, dirToObj: '', dirFromObj: '' };
  }
  if (geom.type === 'Polygon') {
    return distToRings(px, py, geom.coordinates as number[][][]);
  }
  if (geom.type === 'MultiPolygon') {
    let best: DistResult = { inside: false, dist: Infinity, dirToObj: '', dirFromObj: '' };
    for (const poly of geom.coordinates as number[][][][]) {
      const r = distToRings(px, py, poly);
      if (r.inside) return r;
      if (r.dist < best.dist) best = r;
    }
    return best;
  }
  if (geom.type === 'Point') {
    const [gx, gy] = geom.coordinates as [number, number];
    const dE = gx - px;
    const dN = gy - py;
    return {
      inside: false,
      dist: Math.round(Math.hypot(dE, dN)),
      dirToObj: compassPl(dE, dN),
      dirFromObj: compassPl(-dE, -dN),
    };
  }
  return { inside: false, dist: Infinity, dirToObj: '', dirFromObj: '' };
}

async function fetchJsonWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchTextWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function cleanStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null' || s === '-') return null;
  return s;
}

/** 1. GUGiK ULDK + Nominatim locality */
async function fetchAdmin(lat: number, lon: number): Promise<TerrainReportResponse['admin']> {
  try {
    const uldkUrl =
      'https://uldk.gugik.gov.pl/?request=GetParcelByXY&xy=' +
      encodeURIComponent(`${lon},${lat},4326`) +
      '&result=voivodeship,county,commune,region,parcel,id';

    const [uldkText, nomData] = await Promise.all([
      fetchTextWithTimeout(uldkUrl, 9000),
      fetchJsonWithTimeout(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`,
        7000
      ).catch(() => null),
    ]);

    const lines = uldkText.trim().split(/\r?\n/);
    const dataLine = lines.length >= 2 ? lines[1] : '';
    const [voivodeship, county, commune, precinct, parcelNo, parcelId] = dataLine.split('|');

    const addr = (nomData as { address?: Record<string, string> } | null)?.address;
    const nomLocality =
      addr?.city || addr?.town || addr?.village || addr?.hamlet || addr?.suburb || null;

    if (!voivodeship && !commune && !nomLocality) {
      return {
        voivodeship: null,
        county: null,
        commune: null,
        precinct: null,
        parcelNo: null,
        parcelId: null,
        locality: null,
        error: 'Brak odpowiedzi z usługi GUGiK ULDK dla podanych współrzędnych.',
      };
    }

    return {
      voivodeship: cleanStr(voivodeship),
      county: cleanStr(county),
      commune: cleanStr(commune),
      precinct: cleanStr(precinct),
      parcelNo: cleanStr(parcelNo),
      parcelId: cleanStr(parcelId),
      locality: cleanStr(nomLocality) ?? cleanStr(precinct) ?? cleanStr(commune),
    };
  } catch {
    return {
      voivodeship: null,
      county: null,
      commune: null,
      precinct: null,
      parcelNo: null,
      parcelId: null,
      locality: null,
      error: 'Usługa GUGiK ULDK chwilowo nie odpowiada.',
    };
  }
}

type NominatimSearchHit = {
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
};

/** 1b. Administratively belonging Urząd Miasta / Urząd Gminy / Urząd Miasta i Gminy */
async function fetchCommuneOffice(
  lat: number,
  lon: number,
  admin: TerrainReportResponse['admin']
): Promise<NonNullable<TerrainReportResponse['nearbyInfrastructure']['communeOffice']> | null> {
  const rawCommune = admin.commune?.trim();
  if (!rawCommune) return null;

  const baseCommune = rawCommune
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*[-–]\s*(obszar wiejski|miasto|gmina wiejska|dzielnica).*$/i, '')
    .replace(/^(gmina|m\.\s*st\.|miasto)\s+/i, '')
    .trim();
  if (!baseCommune) return null;

  const terytMatch = admin.parcelId?.match(/^\d{6}_(\d)\./);
  const terytDigit = terytMatch ? terytMatch[1] : null;
  const communeType: 'urban' | 'rural' | 'urban-rural' | 'unknown' =
    terytDigit === '1'
      ? 'urban'
      : terytDigit === '2'
        ? 'rural'
        : terytDigit === '3' || terytDigit === '4' || terytDigit === '5'
          ? 'urban-rural'
          : /obszar wiejski/i.test(rawCommune)
            ? 'urban-rural'
            : 'unknown';

  const viewbox = `${(lon - 0.45).toFixed(4)},${(lat + 0.35).toFixed(4)},${(lon + 0.45).toFixed(4)},${(lat - 0.35).toFixed(4)}`;
  const queries: string[] =
    communeType === 'rural'
      ? [`Urząd Gminy ${baseCommune}`, `Urząd ${baseCommune}`]
      : communeType === 'urban'
        ? [`Urząd Miasta ${baseCommune}`, `Urząd Miejski ${baseCommune}`, `Urząd ${baseCommune}`]
        : [`Urząd ${baseCommune}`, `Urząd Miejski ${baseCommune}`];

  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const norm = (s: string) => s.toLowerCase().replace(/^powiat\s+|^województwo\s+/i, '').trim();
  const targetCounty = admin.county ? norm(admin.county) : null;
  const targetVoiv = admin.voivodeship ? norm(admin.voivodeship) : null;
  const communeStem = norm(baseCommune).slice(0, Math.min(5, baseCommune.length));

  const excludeRe =
    /pocztow|skarbow|pracy|stanu cywilnego|celn|marszałkowsk|wojewódzk|starostw|statystyczn|dozoru|komunikacji|wód polskich|prokuratur|sąd/i;

  const pickBest = (hits: NominatimSearchHit[]) => {
    let best: {
      score: number;
      name: string;
      distanceM: number;
      dx: number;
      dy: number;
    } | null = null;

    for (const h of hits) {
      const hLat = Number(h.lat);
      const hLon = Number(h.lon);
      if (!Number.isFinite(hLat) || !Number.isFinite(hLon)) continue;

      const rawName = (h.name || h.display_name?.split(',')[0] || '').trim();
      if (!rawName || excludeRe.test(rawName)) continue;

      const isTownhall = h.category === 'amenity' && h.type === 'townhall';
      const isMunicipalName = /(urząd\s+(gminy|miasta|miejski)|ratusz)/i.test(rawName);
      if (!isTownhall && !isMunicipalName) continue;

      const dx = (hLon - lon) * mLon;
      const dy = (hLat - lat) * mLat;
      const distM = Math.hypot(dx, dy);
      if (distM > 45_000) continue;

      let score = 0;
      if (isTownhall) score += 60;
      if (isMunicipalName) score += 50;

      const addr = h.address ?? {};
      const stateStr = addr.state ? norm(addr.state) : '';
      const countyStr = addr.county ? norm(addr.county) : '';
      const dispLower = (h.display_name || '').toLowerCase();
      const nameLower = rawName.toLowerCase();

      if (targetVoiv && stateStr && stateStr.includes(targetVoiv)) score += 120;
      if (targetCounty && countyStr && countyStr.includes(targetCounty)) score += 100;
      if (communeStem && (nameLower.includes(communeStem) || dispLower.includes(communeStem))) {
        score += 90;
      }

      const isUrGminy = /urząd\s+gminy/i.test(rawName) && !/miasta\s+i\s+gminy/i.test(rawName);
      const isUrMiastaIGminy = /urząd\s+miasta\s+i\s+gminy/i.test(rawName);
      const isUrMiejski = /urząd\s+(miasta|miejski)/i.test(rawName) && !isUrMiastaIGminy;

      if (communeType === 'rural') {
        if (isUrGminy) score += 80;
        else if (isUrMiejski) score -= 70;
      } else if (communeType === 'urban') {
        if (isUrMiejski) score += 80;
        else if (isUrGminy) score -= 70;
      } else if (communeType === 'urban-rural') {
        if (isUrMiastaIGminy || isUrMiejski) score += 70;
        else if (isUrGminy) score += 30;
      }

      score -= distM / 1000;

      if (!best || score > best.score) {
        best = { score, name: rawName, distanceM: distM, dx, dy };
      }
    }

    return best;
  };

  for (const q of queries) {
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=pl&limit=8&addressdetails=1` +
        `&viewbox=${encodeURIComponent(viewbox)}&q=${encodeURIComponent(q)}`;
      const data = await fetchJsonWithTimeout(url, 7000);
      if (!Array.isArray(data) || data.length === 0) continue;

      const best = pickBest(data as NominatimSearchHit[]);
      if (best) {
        const displayName =
          communeStem && best.name.toLowerCase().includes(communeStem)
            ? best.name
            : `${best.name} (${baseCommune})`;
        return {
          name: displayName,
          distanceM: Math.round(best.distanceM),
          terrainDirectionFromObject: compassPl(-best.dx, -best.dy),
          objectDirectionFromTerrain: compassPl(best.dx, best.dy),
        };
      }
    } catch {
      // try next query fallback
    }
  }

  return null;
}

/** 2. GDOŚ Mezoregiony + Kondracki/Solon hierarchy */
async function fetchGeography(
  e2180: number,
  n2180: number
): Promise<TerrainReportResponse['geography']> {
  try {
    const bbox = `${e2180 - 500},${n2180 - 500},${e2180 + 500},${n2180 + 500},EPSG:2180`;
    const url =
      'https://sdi.gdos.gov.pl/wfs?service=WFS&version=1.1.0&request=GetFeature' +
      '&typeName=GDOS:Mezoregiony&srsName=EPSG:2180&outputFormat=application/json' +
      '&maxFeatures=10&bbox=' +
      encodeURIComponent(bbox);
    const data = (await fetchJsonWithTimeout(url, 10_000)) as {
      features?: Array<{
        geometry?: { type?: string; coordinates?: unknown };
        properties?: Record<string, unknown>;
      }>;
    };

    const hits = (data.features ?? [])
      .map((f) => ({
        props: f.properties ?? {},
        dist: distToGeoJsonGeometry(e2180, n2180, f.geometry),
      }))
      .sort((a, b) => a.dist.dist - b.dist.dist);

    const best = hits[0];
    if (!best) {
      return {
        prowincja: null,
        podprowincja: null,
        makroregion: null,
        mezoregion: null,
        mezoregionCode: null,
        error: 'Brak danych o mezoregionie dla tego punktu.',
      };
    }

    const code = cleanStr(best.props.mezo_k);
    const name = cleanStr(best.props.mezo_n);
    const hierarchy = resolvePhysioHierarchy(code);

    return {
      prowincja: hierarchy?.prowincja ?? null,
      podprowincja: hierarchy?.podprowincja ?? null,
      makroregion: hierarchy?.makroregion ?? null,
      mezoregion: name,
      mezoregionCode: code,
    };
  } catch {
    return {
      prowincja: null,
      podprowincja: null,
      makroregion: null,
      mezoregion: null,
      mezoregionCode: null,
      error: 'Usługa mezoregionów GDOŚ chwilowo nie odpowiada.',
    };
  }
}

/** 3 & 6a. OSM nearby roads, railway lines, and waterways */
async function fetchOsmNearby(
  lat: number,
  lon: number
): Promise<{
  roadsAndRail: NearbyFeature[];
  waterways: NearbyFeature[];
  error?: string;
}> {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);

  const dLat = 550 / mLat;
  const dLon = 550 / mLon;
  const bbox = `${(lon - dLon).toFixed(6)},${(lat - dLat).toFixed(6)},${(lon + dLon).toFixed(6)},${(lat + dLat).toFixed(6)}`;

  try {
    const osm = (await fetchJsonWithTimeout(
      `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`,
      10_000
    )) as {
      elements?: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        nodes?: number[];
        tags?: Record<string, string>;
      }>;
    };

    const nodes = new Map<number, [number, number]>();
    for (const el of osm.elements ?? []) {
      if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
        nodes.set(el.id, [el.lat, el.lon]);
      }
    }

    const bestRoadRail = new Map<string, NearbyFeature>();
    const bestWater = new Map<string, NearbyFeature>();

    for (const el of osm.elements ?? []) {
      if (el.type !== 'way' || !el.tags || !el.nodes || el.nodes.length < 2) continue;
      const isWater = Boolean(el.tags.waterway && el.tags.name);
      const isRail = el.tags.railway === 'rail';
      const isRoad = Boolean(el.tags.highway && (el.tags.name || el.tags.ref));
      if (!isWater && !isRail && !isRoad) continue;

      const kind: NearbyFeature['kind'] = isWater ? 'water' : isRail ? 'rail' : 'road';
      const name = isWater
        ? el.tags.name
        : isRail
          ? el.tags.name || 'linia kolejowa'
          : el.tags.name || `droga ${el.tags.ref}`;
      const ref = el.tags.ref && !name.includes(el.tags.ref) ? el.tags.ref : undefined;

      let bestDist = Infinity;
      let bestNx = 0;
      let bestNy = 0;

      for (let i = 0; i < el.nodes.length - 1; i++) {
        const a = nodes.get(el.nodes[i]);
        const b = nodes.get(el.nodes[i + 1]);
        if (!a || !b) continue;
        const x1 = (a[1] - lon) * mLon;
        const y1 = (a[0] - lat) * mLat;
        const x2 = (b[1] - lon) * mLon;
        const y2 = (b[0] - lat) * mLat;
        const seg = pointToSegDist(0, 0, x1, y1, x2, y2);
        if (seg.d < bestDist) {
          bestDist = seg.d;
          bestNx = seg.nx;
          bestNy = seg.ny;
        }
      }

      if (!Number.isFinite(bestDist)) continue;
      const feature: NearbyFeature = {
        kind,
        name,
        ref,
        distanceM: Math.round(bestDist),
        terrainDirectionFromObject: compassPl(-bestNx, -bestNy),
        objectDirectionFromTerrain: compassPl(bestNx, bestNy),
      };

      const targetMap = isWater ? bestWater : bestRoadRail;
      const key = `${kind}:${name.toLowerCase()}`;
      const prev = targetMap.get(key);
      if (!prev || feature.distanceM < prev.distanceM) {
        targetMap.set(key, feature);
      }
    }

    return {
      roadsAndRail: [...bestRoadRail.values()]
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 6),
      waterways: [...bestWater.values()]
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 3),
    };
  } catch {
    return {
      roadsAndRail: [],
      waterways: [],
      error: 'Usługa OpenStreetMap (ulice i cieki) chwilowo nie odpowiada.',
    };
  }
}

/** 4a. GDOŚ protected areas (10 layers in parallel) */
async function fetchProtectedAreas(
  e2180: number,
  n2180: number
): Promise<TerrainReportResponse['protectedAreas']> {
  const layers: Array<{ category: string; typeName: string; radiusM: number }> = [
    { category: 'Park narodowy', typeName: 'GDOS:ParkiNarodowe', radiusM: 35_000 },
    { category: 'Park krajobrazowy', typeName: 'GDOS:ParkiKrajobrazowe', radiusM: 15_000 },
    { category: 'Rezerwat przyrody', typeName: 'GDOS:Rezerwaty', radiusM: 15_000 },
    {
      category: 'Obszar chronionego krajobrazu',
      typeName: 'GDOS:ObszaryChronionegoKrajobrazu',
      radiusM: 15_000,
    },
    {
      category: 'Natura 2000 OSO (ptasi)',
      typeName: 'GDOS:ObszarySpecjalnejOchrony',
      radiusM: 15_000,
    },
    {
      category: 'Natura 2000 SOO (siedliskowy)',
      typeName: 'GDOS:SpecjalneObszaryOchrony',
      radiusM: 15_000,
    },
    { category: 'Użytek ekologiczny', typeName: 'GDOS:UzytkiEkologiczne', radiusM: 8_000 },
    {
      category: 'Zespół przyrodniczo-krajobrazowy',
      typeName: 'GDOS:ZespolyPrzyrodniczoKrajobrazowe',
      radiusM: 10_000,
    },
    {
      category: 'Stanowisko dokumentacyjne',
      typeName: 'GDOS:StanowiskaDokumentacyjne',
      radiusM: 10_000,
    },
    { category: 'Pomnik przyrody', typeName: 'GDOS:PomnikiPrzyrodyPunktowe', radiusM: 3_000 },
  ];

  const inside: SpatialHit[] = [];
  const nearestCandidates: SpatialHit[] = [];
  let succeededCount = 0;

  await Promise.all(
    layers.map(async ({ category, typeName, radiusM }) => {
      try {
        const bbox = `${e2180 - radiusM},${n2180 - radiusM},${e2180 + radiusM},${n2180 + radiusM},EPSG:2180`;
        const url =
          'https://sdi.gdos.gov.pl/wfs?service=WFS&version=1.1.0&request=GetFeature' +
          `&typeName=${encodeURIComponent(typeName)}&srsName=EPSG:2180&outputFormat=application/json` +
          `&maxFeatures=25&bbox=${encodeURIComponent(bbox)}`;
        const data = (await fetchJsonWithTimeout(url, 11_000)) as {
          features?: Array<{
            geometry?: { type?: string; coordinates?: unknown };
            properties?: Record<string, unknown>;
          }>;
        };
        succeededCount++;

        const scored = (data.features ?? [])
          .map((f) => {
            const p = f.properties ?? {};
            const dist = distToGeoJsonGeometry(e2180, n2180, f.geometry);
            const rawName =
              cleanStr(p.nazwa) ||
              cleanStr(p.gatunek) ||
              cleanStr(p.obiekt) ||
              cleanStr(p.podtyp) ||
              category;
            const code = cleanStr(p.kod);
            const detail = cleanStr(p.podtyp) ?? undefined;
            return {
              category,
              name: rawName,
              code: code ?? undefined,
              detail,
              inside: dist.inside,
              distanceM: dist.dist,
              directionToObject: dist.dirToObj,
              directionFromObject: dist.dirFromObj,
            } satisfies SpatialHit;
          })
          .filter((x) => Number.isFinite(x.distanceM))
          .sort((a, b) => a.distanceM - b.distanceM);

        // Deduplicate by name within same category
        const seenNames = new Set<string>();
        const unique = scored.filter((item) => {
          const k = `${item.name.toLowerCase()}:${item.code ?? ''}`;
          if (seenNames.has(k)) return false;
          seenNames.add(k);
          return true;
        });

        for (const item of unique) {
          if (item.inside) {
            inside.push(item);
          }
        }
        const firstOutside = unique.find((x) => !x.inside);
        if (firstOutside) {
          nearestCandidates.push(firstOutside);
        }
      } catch {
        // tolerate individual layer timeout
      }
    })
  );

  nearestCandidates.sort((a, b) => a.distanceM - b.distanceM);

  return {
    inside,
    nearest: nearestCandidates.slice(0, 7),
    error:
      succeededCount === 0
        ? 'Usługa GDOŚ (obszary chronione) chwilowo nie odpowiada.'
        : undefined,
  };
}

/** 4b. PIG-PIB MIDAS (OG, TG, Złoża) */
async function fetchMining(
  e2180: number,
  n2180: number
): Promise<TerrainReportResponse['mining']> {
  const radiusM = 10_000;
  const env = `${e2180 - radiusM},${n2180 - radiusM},${e2180 + radiusM},${n2180 + radiusM}`;

  const queryLayer = async (layerId: number, kind: MiningHit['kind']): Promise<MiningHit[]> => {
    const params = new URLSearchParams({
      f: 'json',
      geometry: env,
      geometryType: 'esriGeometryEnvelope',
      inSR: '2180',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '2180',
      resultRecordCount: '40',
    });
    const data = (await fetchJsonWithTimeout(
      `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/midas/MapServer/${layerId}/query?${params}`,
      10_000
    )) as {
      features?: Array<{
        geometry?: { rings?: number[][][] };
        attributes?: Record<string, unknown>;
      }>;
    };

    return (data.features ?? [])
      .map((f) => {
        const a = f.attributes ?? {};
        const dist = f.geometry?.rings
          ? distToRings(e2180, n2180, f.geometry.rings)
          : { inside: false, dist: Infinity, dirToObj: '', dirFromObj: '' };
        const name =
          cleanStr(a.NAZWA_OG) || cleanStr(a.NAZWA_TG) || cleanStr(a.NAZWA_ZL) || 'bez nazwy';
        const pole = cleanStr(a.POLE_ZLOZA);
        return {
          kind,
          name: pole && kind === 'Zloze' ? `${name} (${pole})` : name,
          registryNo: cleanStr(a.NR_REJESTR) ?? cleanStr(a.NR_ZLOZA) ?? undefined,
          mineral: cleanStr(a.KOPALINA) ?? undefined,
          validUntil: cleanStr(a.DATA_WAZNOSCI) ?? undefined,
          authority: cleanStr(a.NADZOR_OUG) ?? cleanStr(a.NADZ_GOR) ?? undefined,
          inside: dist.inside,
          distanceM: dist.dist,
          directionToObject: dist.dirToObj,
        } satisfies MiningHit;
      })
      .filter((x) => Number.isFinite(x.distanceM))
      .sort((a, b) => a.distanceM - b.distanceM);
  };

  try {
    const [og, tg, zloza] = await Promise.all([
      queryLayer(1, 'OG'),
      queryLayer(2, 'TG'),
      queryLayer(0, 'Zloze'),
    ]);

    const all = [...og, ...tg, ...zloza];
    const inside = all.filter((x) => x.inside);

    // Closest outside objects (prefer OG & TG, deduplicate same OG+TG pair by showing OG/TG cleanly)
    const outsideOg = og.filter((x) => !x.inside).slice(0, 3);
    const outsideTg = tg
      .filter((x) => !x.inside && !outsideOg.some((o) => o.name === x.name && Math.abs(o.distanceM - x.distanceM) < 20))
      .slice(0, 2);
    const outsideZloza = zloza
      .filter((x) => !x.inside && !outsideOg.some((o) => x.name.startsWith(o.name)))
      .slice(0, 2);

    const nearest = [...outsideOg, ...outsideTg, ...outsideZloza]
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 5);

    return { inside, nearest };
  } catch {
    return {
      inside: [],
      nearest: [],
      error: 'Usługa PIG-PIB MIDAS chwilowo nie odpowiada.',
    };
  }
}

function parsePlNum(raw: unknown): number | null {
  const s = cleanStr(raw);
  if (!s) return null;
  const n = parseFloat(s.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function axisOrientationPl(angleRadFromEast: number): string {
  // Normalize angle to [0, 180) degrees measured clockwise from North
  const degFromEast = (angleRadFromEast * 180) / Math.PI;
  const azim = ((90 - degFromEast) % 180 + 180) % 180;
  if (azim < 22.5 || azim >= 157.5) return 'N–S';
  if (azim < 67.5) return 'NE–SW';
  if (azim < 112.5) return 'E–W';
  return 'NW–SE';
}

function computePolygonExtentAndSamplePts(rings: number[][][]): {
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number };
  approxLengthM?: number;
  approxWidthM?: number;
  axisOrientation?: string;
  samplePts: Array<{ e: number; n: number }>;
} | null {
  const outer = rings[0];
  if (!outer || outer.length < 3) return null;

  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  const pts: Array<[number, number]> = [];
  for (const ring of rings) {
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const e = Number(p[0]);
      const n = Number(p[1]);
      if (!Number.isFinite(e) || !Number.isFinite(n)) continue;
      if (e < xmin) xmin = e;
      if (e > xmax) xmax = e;
      if (n < ymin) ymin = n;
      if (n > ymax) ymax = n;
      pts.push([e, n]);
    }
  }
  if (pts.length < 3 || !Number.isFinite(xmin)) return null;

  // Principal axis via 2D covariance on vertices
  let meanE = 0;
  let meanN = 0;
  for (const [e, n] of pts) {
    meanE += e;
    meanN += n;
  }
  meanE /= pts.length;
  meanN /= pts.length;

  let sEE = 0;
  let sNN = 0;
  let sEN = 0;
  for (const [e, n] of pts) {
    const de = e - meanE;
    const dn = n - meanN;
    sEE += de * de;
    sNN += dn * dn;
    sEN += de * dn;
  }
  const theta = 0.5 * Math.atan2(2 * sEN, sEE - sNN);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [e, n] of pts) {
    const de = e - meanE;
    const dn = n - meanN;
    const u = de * cosT + dn * sinT;
    const v = -de * sinT + dn * cosT;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  let spanU = maxU - minU;
  let spanV = maxV - minV;
  let majorAngle = theta;
  if (spanV > spanU) {
    const tmp = spanU;
    spanU = spanV;
    spanV = tmp;
    majorAngle = theta + Math.PI / 2;
  }

  // Pick up to 10 evenly spaced outer perimeter points for fast GUGiK NMT elevation sampling
  const samplePts: Array<{ e: number; n: number }> = [];
  const step = Math.max(1, Math.floor(outer.length / 10));
  for (let i = 0; i < outer.length && samplePts.length < 10; i += step) {
    const e = Number(outer[i][0]);
    const n = Number(outer[i][1]);
    if (Number.isFinite(e) && Number.isFinite(n)) {
      samplePts.push({ e, n });
    }
  }
  samplePts.push({ e: meanE, n: meanN });

  return {
    bbox: { xmin, ymin, xmax, ymax },
    approxLengthM: spanU >= 1 ? Math.round(spanU) : undefined,
    approxWidthM: spanV >= 1 ? Math.round(spanV) : undefined,
    axisOrientation: spanU >= 1 ? axisOrientationPl(majorAngle) : undefined,
    samplePts,
  };
}

async function fetchNmtElevationSingle(e2180: number, n2180: number): Promise<number | null> {
  if (!Number.isFinite(e2180) || !Number.isFinite(n2180)) return null;
  const params = new URLSearchParams({
    request: 'GetHByXY',
    x: n2180.toFixed(1),
    y: e2180.toFixed(1),
  });
  try {
    const res = await fetch(`https://services.gugik.gov.pl/nmt/?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    const val = parseFloat(txt.replace(',', '.'));
    return Number.isFinite(val) && val > -50 && val < 2600 ? val : null;
  } catch {
    return null;
  }
}

async function enrichSopoHitDetails(
  hit: SopoHit,
  rings: number[][][] | undefined,
  e2180: number,
  n2180: number
): Promise<SopoLandslideDetails | undefined> {
  if (!rings || rings.length === 0) return undefined;
  const geom = computePolygonExtentAndSamplePts(rings);
  if (!geom) return undefined;

  const details: SopoLandslideDetails = {
    approxLengthM: geom.approxLengthM,
    approxWidthM: geom.approxWidthM,
    axisOrientation: geom.axisOrientation,
  };

  // Run detailed SOPO elements identify (for landslides) + GUGiK NMT elevation samples in parallel
  const elemPromise: Promise<{
    results?: Array<{ layerId: number; attributes?: Record<string, unknown> }>;
  } | null> =
    hit.kind === 'osuwisko'
      ? (() => {
          const pad = 25;
          const xmin = geom.bbox.xmin - pad;
          const ymin = geom.bbox.ymin - pad;
          const xmax = geom.bbox.xmax + pad;
          const ymax = geom.bbox.ymax + pad;
          const p = new URLSearchParams({
            f: 'json',
            geometry: JSON.stringify({
              xmin,
              ymin,
              xmax,
              ymax,
              spatialReference: { wkid: 2180 },
            }),
            geometryType: 'esriGeometryEnvelope',
            sr: '2180',
            layers: 'all:1,2,3,4,5,6,7,8,9,10,11,13',
            tolerance: '1',
            mapExtent: `${xmin},${ymin},${xmax},${ymax}`,
            imageDisplay: '1000,1000,96',
            returnGeometry: 'false',
          });
          return (
            fetchJsonWithTimeout(
              `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/sopo_obszary/MapServer/identify?${p}`,
              8000
            ) as Promise<{
              results?: Array<{ layerId: number; attributes?: Record<string, unknown> }>;
            }>
          ).catch(() => null);
        })()
      : Promise.resolve(null);

  const nmtPromise = Promise.all([
    fetchNmtElevationSingle(e2180, n2180),
    ...geom.samplePts.map((pt) => fetchNmtElevationSingle(pt.e, pt.n)),
  ]).catch(() => []);

  const [elemRes, nmtVals] = await Promise.all([elemPromise, nmtPromise]);

  // Process NMT elevations
  if (nmtVals.length > 0) {
    const ptElev = nmtVals[0];
    if (typeof ptElev === 'number' && Number.isFinite(ptElev)) {
      details.pointElevM = Math.round(ptElev);
    }
    const validElevs: number[] = [];
    for (const v of nmtVals) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        validElevs.push(v);
      }
    }
    if (validElevs.length >= 2) {
      const minE = Math.min(...validElevs);
      const maxE = Math.max(...validElevs);
      details.elevMinM = Math.round(minE);
      details.elevMaxM = Math.round(maxE);
      const relief = Math.round(maxE - minE);
      details.reliefM = relief;
      if (details.approxLengthM && details.approxLengthM >= 10 && relief > 0) {
        details.avgSlopeDeg = Number(
          ((Math.atan(relief / details.approxLengthM) * 180) / Math.PI).toFixed(1)
        );
      }
    }
  }

  // Process SOPO detail layers strictly matching hit.number
  if (elemRes?.results?.length) {
    const seen = new Set<string>();
    const activityAreaMap = new Map<string, number>();
    const boundaryLenMap = new Map<string, number>();
    const mainScarpMap = new Map<string, { count: number; lenM: number }>();
    const secScarpMap = new Map<string, { count: number; lenM: number }>();
    const toeMap = new Map<string, { count: number; lenM: number }>();
    const trenchMap = new Map<string, { count: number; lenM: number }>();
    let ridgeCount = 0;
    let ridgeLen = 0;
    let crackCount = 0;
    let crackLen = 0;
    const springMap = new Map<string, number>();
    const wetlandMap = new Map<string, { count: number; areaM2: number }>();
    let debrisCount = 0;
    let debrisArea = 0;
    let depCount = 0;
    let depArea = 0;

    for (const r of elemRes.results) {
      const a = r.attributes ?? {};
      const num = cleanStr(a['Numer osuwiska']);
      if (num !== hit.number) continue;
      const oid = cleanStr(a.ID) ?? cleanStr(a.OBJECTID) ?? JSON.stringify(a);
      const uniq = `${r.layerId}:${oid}`;
      if (seen.has(uniq)) continue;
      seen.add(uniq);

      const lenM = parsePlNum(a['SHAPE.LEN']) ?? 0;
      const areaM2 = parsePlNum(a['SHAPE.AREA']) ?? 0;

      switch (r.layerId) {
        case 13: {
          const act = cleanStr(a['Stopień aktywności']);
          if (act && areaM2 > 0) {
            activityAreaMap.set(act, (activityAreaMap.get(act) ?? 0) + areaM2);
          }
          break;
        }
        case 8: {
          const recog = cleanStr(a['Rozpoznanie granicy']) ?? cleanStr(a['Rodzaj granicy']);
          if (recog) {
            boundaryLenMap.set(recog, (boundaryLenMap.get(recog) ?? 0) + lenM);
          }
          break;
        }
        case 2: {
          const parts = [
            cleanStr(a['Rodzaj formy']),
            cleanStr(a['Stan zachowania formy']),
            cleanStr(a['Wysokość formy']) ? `wysokość: ${cleanStr(a['Wysokość formy'])}` : null,
          ].filter(Boolean);
          const key = parts.join(', ') || 'skarpa główna';
          const cur = mainScarpMap.get(key) ?? { count: 0, lenM: 0 };
          cur.count += 1;
          cur.lenM += lenM;
          mainScarpMap.set(key, cur);
          break;
        }
        case 3: {
          const parts = [
            cleanStr(a['Stan zachowania formy']),
            cleanStr(a['Wysokość formy']) ? `wysokość: ${cleanStr(a['Wysokość formy'])}` : null,
          ].filter(Boolean);
          const key = parts.join(', ') || 'skarpa wtórna';
          const cur = secScarpMap.get(key) ?? { count: 0, lenM: 0 };
          cur.count += 1;
          cur.lenM += lenM;
          secScarpMap.set(key, cur);
          break;
        }
        case 6: {
          const hRaw = cleanStr(a['Wysokość formy']);
          const hNum = parsePlNum(hRaw);
          const hLabel =
            hNum !== null
              ? `wysokość ok. ${hNum.toString().replace('.', ',')} m`
              : hRaw
                ? `wysokość: ${hRaw}`
                : 'czoło osuwiska';
          const cur = toeMap.get(hLabel) ?? { count: 0, lenM: 0 };
          cur.count += 1;
          cur.lenM += lenM;
          toeMap.set(hLabel, cur);
          break;
        }
        case 4: {
          const parts = [
            cleanStr(a['Stan zachowania formy']),
            cleanStr(a['Wysokość formy']) ? `wysokość: ${cleanStr(a['Wysokość formy'])}` : null,
          ].filter(Boolean);
          const key = parts.join(', ') || 'rów osuwiskowy';
          const cur = trenchMap.get(key) ?? { count: 0, lenM: 0 };
          cur.count += 1;
          cur.lenM += lenM;
          trenchMap.set(key, cur);
          break;
        }
        case 5: {
          ridgeCount += 1;
          ridgeLen += lenM;
          break;
        }
        case 7: {
          crackCount += 1;
          crackLen += lenM;
          break;
        }
        case 1: {
          const typ = cleanStr(a['Typ obiektu']) ?? 'źródło/wysięk';
          springMap.set(typ, (springMap.get(typ) ?? 0) + 1);
          break;
        }
        case 11: {
          const typ = cleanStr(a['Typ obiektu']) ?? 'podmokłość/zbiornik';
          const cur = wetlandMap.get(typ) ?? { count: 0, areaM2: 0 };
          cur.count += 1;
          cur.areaM2 += areaM2;
          wetlandMap.set(typ, cur);
          break;
        }
        case 9: {
          debrisCount += 1;
          debrisArea += areaM2;
          break;
        }
        case 10: {
          depCount += 1;
          depArea += areaM2;
          break;
        }
      }
    }

    const fmtLen = (m: number) => (m >= 1 ? `dł. ok. ${Math.round(m)} m` : '');
    const fmtArea = (m2: number) =>
      m2 >= 10_000
        ? `pow. ok. ${(m2 / 10_000).toFixed(2).replace('.', ',')} ha`
        : m2 >= 1
          ? `pow. ok. ${Math.round(m2)} m²`
          : '';
    const formatMapLen = (m: Map<string, { count: number; lenM: number }>): string[] =>
      Array.from(m.entries()).map(([k, v]) => {
        const meta = [v.count > 1 ? `${v.count} odc.` : null, fmtLen(v.lenM)]
          .filter(Boolean)
          .join(', ');
        return meta ? `${k} (${meta})` : k;
      });

    if (activityAreaMap.size > 0) {
      const totalA =
        hit.areaM2 && hit.areaM2 > 0
          ? hit.areaM2
          : Array.from(activityAreaMap.values()).reduce((s, v) => s + v, 0);
      details.activityZones = Array.from(activityAreaMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([activity, aM2]) => ({
          activity,
          areaHa: Number((aM2 / 10_000).toFixed(2)),
          sharePct: Math.max(1, Math.min(100, Math.round((aM2 / Math.max(1, totalA)) * 100))),
        }));
    }
    if (boundaryLenMap.size > 0) {
      details.boundaryTypes = Array.from(boundaryLenMap.entries()).map(([k, len]) =>
        len >= 1 ? `${k} (ok. ${Math.round(len)} m)` : k
      );
    }
    if (mainScarpMap.size > 0) details.mainScarps = formatMapLen(mainScarpMap);
    if (secScarpMap.size > 0) details.secondaryScarps = formatMapLen(secScarpMap);
    if (toeMap.size > 0) details.toes = formatMapLen(toeMap);
    if (trenchMap.size > 0) details.trenches = formatMapLen(trenchMap);
    if (ridgeCount > 0) {
      const meta = [ridgeCount > 1 ? `${ridgeCount} szt.` : '1 szt.', fmtLen(ridgeLen)]
        .filter(Boolean)
        .join(', ');
      details.accumulationRidges = [meta];
    }
    if (crackCount > 0) {
      const meta = [crackCount > 1 ? `${crackCount} odc.` : '1 odc.', fmtLen(crackLen)]
        .filter(Boolean)
        .join(', ');
      details.cracks = [meta];
    }
    if (springMap.size > 0) {
      details.springsAndSeeps = Array.from(springMap.entries()).map(
        ([k, cnt]) => `${k} (${cnt} szt.)`
      );
    }
    if (wetlandMap.size > 0) {
      details.wetlandsAndPonds = Array.from(wetlandMap.entries()).map(([k, v]) => {
        const meta = [v.count > 1 ? `${v.count} szt.` : null, fmtArea(v.areaM2)]
          .filter(Boolean)
          .join(', ');
        return meta ? `${k} (${meta})` : k;
      });
    }
    if (debrisCount > 0) {
      const meta = [debrisCount > 1 ? `${debrisCount} obsz.` : '1 obsz.', fmtArea(debrisArea)]
        .filter(Boolean)
        .join(', ');
      details.debrisAreas = [meta];
    }
    if (depCount > 0) {
      const meta = [depCount > 1 ? `${depCount} szt.` : '1 szt.', fmtArea(depArea)]
        .filter(Boolean)
        .join(', ');
      details.depressions = [meta];
    }
  }

  return details;
}

/** 5. PIG-PIB SOPO (Osuwiska & TZRM via MapServer/identify) */
async function fetchSopo(
  e2180: number,
  n2180: number
): Promise<TerrainReportResponse['sopo']> {
  const radiusM = 2000;
  const idParams = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({
      xmin: e2180 - radiusM,
      ymin: n2180 - radiusM,
      xmax: e2180 + radiusM,
      ymax: n2180 + radiusM,
      spatialReference: { wkid: 2180 },
    }),
    geometryType: 'esriGeometryEnvelope',
    sr: '2180',
    layers: 'all:12,13,14',
    tolerance: '1',
    mapExtent: `${e2180 - radiusM},${n2180 - radiusM},${e2180 + radiusM},${n2180 + radiusM}`,
    imageDisplay: '1000,1000,96',
    returnGeometry: 'true',
  });

  const stanParams = new URLSearchParams({
    f: 'json',
    geometry: `${e2180},${n2180}`,
    geometryType: 'esriGeometryPoint',
    inSR: '2180',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'GMINA,POWIAT,WOJEWODZTWO,ROK_ZAKONCZENIA,APLIKACJA_SOPO,AKTUALNOSC_TERENOWA,AUTOR,KOORDYNATOR',
    returnGeometry: 'false',
  });

  try {
    const [obszary, stan] = await Promise.all([
      fetchJsonWithTimeout(
        `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/sopo_obszary/MapServer/identify?${idParams}`,
        11_000
      ) as Promise<{
        results?: Array<{
          layerId: number;
          attributes?: Record<string, unknown>;
          geometry?: { rings?: number[][][] };
        }>;
      }>,
      fetchJsonWithTimeout(
        `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/sopo_stan/MapServer/0/query?${stanParams}`,
        9_000
      ).catch(() => null) as Promise<{
        features?: Array<{ attributes?: Record<string, unknown> }>;
      } | null>,
    ]);

    const stanAttrs = stan?.features?.[0]?.attributes;
    const mappedCommune = stanAttrs
      ? String(stanAttrs.APLIKACJA_SOPO ?? '').toLowerCase() === 'tak'
      : null;

    const landslides: SopoHit[] = [];
    const tzrms: SopoHit[] = [];
    const pointActivityZones = new Map<string, string>();
    const ringsByKey = new Map<string, number[][][]>();

    // First pass: capture Layer 13 activity zones containing the exact terrain point
    for (const r of obszary.results ?? []) {
      if (r.layerId !== 13 || !r.geometry?.rings) continue;
      const dist = distToRings(e2180, n2180, r.geometry.rings);
      if (!dist.inside) continue;
      const a = r.attributes ?? {};
      const num = cleanStr(a['Numer osuwiska']);
      const zoneAct = cleanStr(a['Stopień aktywności']);
      if (num && zoneAct) {
        pointActivityZones.set(num, zoneAct);
      }
    }

    for (const r of obszary.results ?? []) {
      const a = r.attributes ?? {};
      if (r.layerId !== 14 && r.layerId !== 12) continue;
      const dist = r.geometry?.rings
        ? distToRings(e2180, n2180, r.geometry.rings)
        : { inside: false, dist: Infinity, dirToObj: '', dirFromObj: '' };
      if (!Number.isFinite(dist.dist)) continue;

      const areaM2Raw = parsePlNum(a['SHAPE.AREA']) ?? NaN;
      const areaM2 = Number.isFinite(areaM2Raw) ? Math.round(areaM2Raw) : undefined;
      const areaHa = Number.isFinite(areaM2Raw)
        ? Number((areaM2Raw / 10_000).toFixed(2))
        : undefined;

      const lenRaw = parsePlNum(a['SHAPE.LEN']) ?? NaN;
      const perimeterM = Number.isFinite(lenRaw) ? Math.round(lenRaw) : undefined;

      const cardVersion = cleanStr(a['Wersja karty']) ?? undefined;
      const filledDate = cleanStr(a['Data wypelnienia']) ?? undefined;
      const establishedDate = cleanStr(a['Data ustalenia']) ?? undefined;

      if (r.layerId === 14) {
        const number = cleanStr(a['Numer identyfikacyjny']) ?? cleanStr(a.ID) ?? '—';
        if (dist.inside && r.geometry?.rings && !ringsByKey.has(`osuwisko:${number}`)) {
          ringsByKey.set(`osuwisko:${number}`, r.geometry.rings);
        }
        landslides.push({
          kind: 'osuwisko',
          number,
          activity: cleanStr(a['Stopień aktywności']) ?? undefined,
          pointActivityZone: dist.inside ? pointActivityZones.get(number) : undefined,
          areaHa,
          areaM2,
          perimeterM,
          cardVersion,
          filledDate,
          establishedDate,
          inside: dist.inside,
          distanceM: dist.dist,
          directionToObject: dist.dirToObj,
        });
      } else if (r.layerId === 12) {
        const number = cleanStr(a['Numer identyfikacyjny']) ?? cleanStr(a.ID) ?? '—';
        if (dist.inside && r.geometry?.rings && !ringsByKey.has(`tzrm:${number}`)) {
          ringsByKey.set(`tzrm:${number}`, r.geometry.rings);
        }
        tzrms.push({
          kind: 'tzrm',
          number,
          areaHa,
          areaM2,
          perimeterM,
          cardVersion,
          filledDate,
          establishedDate,
          inside: dist.inside,
          distanceM: dist.dist,
          directionToObject: dist.dirToObj,
        });
      }
    }

    const dedup = (arr: SopoHit[]) => {
      const seen = new Set<string>();
      return arr
        .sort((a, b) => a.distanceM - b.distanceM)
        .filter((x) => {
          if (seen.has(x.number)) return false;
          seen.add(x.number);
          return true;
        });
    };

    const sortedL = dedup(landslides);
    const sortedT = dedup(tzrms);

    const insideLandslide = sortedL.filter((x) => x.inside);
    const insideTzrm = sortedT.filter((x) => x.inside);

    // Enrich any landslide or TZRM containing the terrain point with full SOPO detail layers + NMT elevations
    if (insideLandslide.length > 0 || insideTzrm.length > 0) {
      await Promise.all([
        ...insideLandslide.slice(0, 3).map(async (hit) => {
          hit.details = await enrichSopoHitDetails(
            hit,
            ringsByKey.get(`osuwisko:${hit.number}`),
            e2180,
            n2180
          );
        }),
        ...insideTzrm.slice(0, 3).map(async (hit) => {
          hit.details = await enrichSopoHitDetails(
            hit,
            ringsByKey.get(`tzrm:${hit.number}`),
            e2180,
            n2180
          );
        }),
      ]);
    }

    return {
      mappedCommune,
      mappingYear: cleanStr(stanAttrs?.ROK_ZAKONCZENIA),
      fieldCurrency: cleanStr(stanAttrs?.AKTUALNOSC_TERENOWA),
      author: cleanStr(stanAttrs?.AUTOR),
      coordinator: cleanStr(stanAttrs?.KOORDYNATOR),
      insideLandslide,
      insideTzrm,
      nearestLandslides: sortedL.filter((x) => !x.inside).slice(0, 5),
      nearestTzrm: sortedT.filter((x) => !x.inside).slice(0, 4),
    };
  } catch {
    return {
      mappedCommune: null,
      mappingYear: null,
      fieldCurrency: null,
      insideLandslide: [],
      insideTzrm: [],
      nearestLandslides: [],
      nearestTzrm: [],
      error: 'Usługa PIG-PIB SOPO chwilowo nie odpowiada.',
    };
  }
}

/** 6b. PIG-PIB JCWPd + GZWP */
async function fetchHydroPgi(
  e2180: number,
  n2180: number
): Promise<{
  jcwpd: TerrainReportResponse['hydro']['jcwpd'];
  gzwp: TerrainReportResponse['hydro']['gzwp'];
  error?: string;
}> {
  const jcwpdParams = new URLSearchParams({
    f: 'json',
    geometry: `${e2180},${n2180}`,
    geometryType: 'esriGeometryPoint',
    sr: '2180',
    layers: 'all',
    tolerance: '2',
    mapExtent: `${e2180 - 500},${n2180 - 500},${e2180 + 500},${n2180 + 500}`,
    imageDisplay: '1000,1000,96',
    returnGeometry: 'false',
  });

  const gzwpRadius = 20_000;
  const gzwpEnv = `${e2180 - gzwpRadius},${n2180 - gzwpRadius},${e2180 + gzwpRadius},${n2180 + gzwpRadius}`;

  const queryGzwpLayer = async (layerId: number) => {
    const p = new URLSearchParams({
      f: 'json',
      geometry: gzwpEnv,
      geometryType: 'esriGeometryEnvelope',
      inSR: '2180',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'NAZWA,NR_GZWP',
      returnGeometry: 'true',
      outSR: '2180',
      resultRecordCount: '25',
    });
    const data = (await fetchJsonWithTimeout(
      `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/hydrogeologia/gzwp/MapServer/${layerId}/query?${p}`,
      10_000
    )) as {
      features?: Array<{
        geometry?: { rings?: number[][][] };
        attributes?: Record<string, unknown>;
      }>;
    };
    return (data.features ?? []).map((f) => {
      const dist = f.geometry?.rings
        ? distToRings(e2180, n2180, f.geometry.rings)
        : { inside: false, dist: Infinity, dirToObj: '', dirFromObj: '' };
      return {
        name: cleanStr(f.attributes?.NAZWA) ?? '—',
        number: cleanStr(f.attributes?.NR_GZWP) ?? '—',
        ...dist,
      };
    });
  };

  try {
    const [jcwpdData, gzwp0, gzwp1] = await Promise.all([
      fetchJsonWithTimeout(
        `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/hydrogeologia/jcwpd/MapServer/identify?${jcwpdParams}`,
        10_000
      ) as Promise<{
        results?: Array<{ layerName: string; attributes?: Record<string, unknown> }>;
      }>,
      queryGzwpLayer(0).catch(() => []),
      queryGzwpLayer(1).catch(() => []),
    ]);

    // Prefer 2022-2027 or 2028-2033 planning cycle
    const results = jcwpdData.results ?? [];
    const preferred =
      results.find((r) => r.layerName.includes('2022-2027')) ??
      results.find((r) => r.layerName.includes('2028-2033')) ??
      results.find((r) => r.layerName.includes('2016-2021')) ??
      results[0];

    const ja = preferred?.attributes;
    const jcwpd: TerrainReportResponse['hydro']['jcwpd'] = ja
      ? {
          number: cleanStr(ja['Nr JCWPd']) ?? cleanStr(ja.JCWPd) ?? '—',
          euCode: cleanStr(ja['Kod UE']) ?? '—',
          basin: cleanStr(ja.Dorzecze) ?? '—',
          waterRegion: cleanStr(ja['Region wodny']) ?? '—',
          status:
            cleanStr(ja['Stan ogólny 2022']) ??
            cleanStr(ja['Stan ogólny 2019']) ??
            cleanStr(ja['Stan ogólny']) ??
            '—',
          risk: cleanStr(ja['Ryzyko 2025']) ?? cleanStr(ja.Ryzyko) ?? '—',
        }
      : null;

    const allGzwp = [...gzwp0, ...gzwp1]
      .filter((x) => Number.isFinite(x.dist))
      .sort((a, b) => a.dist - b.dist);

    const insideGzwp = allGzwp.find((x) => x.inside);
    const nearestGzwp = allGzwp.find((x) => !x.inside);

    return {
      jcwpd,
      gzwp: {
        inside: Boolean(insideGzwp),
        name: insideGzwp?.name ?? null,
        number: insideGzwp?.number ?? null,
        nearestName: nearestGzwp?.name ?? null,
        nearestNumber: nearestGzwp?.number ?? null,
        nearestDistanceM: nearestGzwp ? nearestGzwp.dist : null,
        nearestDirection: nearestGzwp ? nearestGzwp.dirToObj : null,
      },
    };
  } catch {
    return {
      jcwpd: null,
      gzwp: {
        inside: false,
        name: null,
        number: null,
        nearestName: null,
        nearestNumber: null,
        nearestDistanceM: null,
        nearestDirection: null,
      },
      error: 'Usługi hydrogeologiczne PIG-PIB (JCWPd/GZWP) chwilowo nie odpowiadają.',
    };
  }
}

/** 7. PIG-PIB SMGP 1:50 000 sheet index */
async function fetchSmgp(
  e2180: number,
  n2180: number
): Promise<TerrainReportResponse['smgp']> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${e2180},${n2180}`,
    geometryType: 'esriGeometryPoint',
    sr: '2180',
    layers: 'all:0',
    tolerance: '2',
    mapExtent: `${e2180 - 500},${n2180 - 500},${e2180 + 500},${n2180 + 500}`,
    imageDisplay: '1000,1000,96',
    returnGeometry: 'false',
  });

  try {
    const data = (await fetchJsonWithTimeout(
      `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/identify?${params}`,
      10_000
    )) as {
      results?: Array<{ attributes?: Record<string, unknown> }>;
    };
    const a = data.results?.[0]?.attributes;
    if (!a) {
      return {
        sheetNumber: null,
        sheetName: null,
        mapAuthors: null,
        mapYear: null,
        mapPrintYear: null,
        textAuthors: null,
        textPrintYear: null,
        error: 'Nie znaleziono arkusza SMGP 1:50 000 dla podanych współrzędnych.',
      };
    }

    return {
      sheetNumber: cleanStr(a['Nr arkusza']),
      sheetName: cleanStr(a.Nazwa),
      mapAuthors: cleanStr(a['Autor mapy']),
      mapYear: cleanStr(a['Rok opracowania mapy']),
      mapPrintYear: cleanStr(a['Rok druku mapy']),
      textAuthors: cleanStr(a['Autor tekstu']),
      textPrintYear: cleanStr(a['Rok druku tekstu']),
    };
  } catch {
    return {
      sheetNumber: null,
      sheetName: null,
      mapAuthors: null,
      mapYear: null,
      mapPrintYear: null,
      textAuthors: null,
      textPrintYear: null,
      error: 'Usługa skorowidza SMGP 1:50 000 chwilowo nie odpowiada.',
    };
  }
}

interface GeologyUnitRecord {
  code: string | null;
  unit: string;
  stratigraphy: string | null;
  genesis: string | null;
  form?: string | null;
}

interface GeologyPigContext {
  sheetNumber: string | null;
  sheetName: string | null;
  portalAvailable: boolean;
  exactUnit: GeologyUnitRecord | null;
  nearbyUnits: GeologyUnitRecord[];
  mgp200kBedrock: string[];
  mgp500kLayers: Array<{
    layer: string;
    description: string;
    lithology: string | null;
    stratigraphy: string | null;
    genesis: string | null;
  }>;
}

async function fetchGeologyContext(e2180: number, n2180: number): Promise<GeologyPigContext> {
  const sheetParams = new URLSearchParams({
    f: 'json',
    geometry: `${e2180.toFixed(1)},${n2180.toFixed(1)}`,
    geometryType: 'esriGeometryPoint',
    sr: '2180',
    layers: 'all:0',
    tolerance: '2',
    mapExtent: `${(e2180 - 500).toFixed(1)},${(n2180 - 500).toFixed(1)},${(e2180 + 500).toFixed(1)},${(n2180 + 500).toFixed(1)}`,
    imageDisplay: '1000,1000,96',
    returnGeometry: 'false',
  });

  const mgp200bParams = new URLSearchParams({
    f: 'json',
    geometry: `${e2180.toFixed(1)},${n2180.toFixed(1)}`,
    geometryType: 'esriGeometryPoint',
    sr: '2180',
    layers: 'all:8',
    tolerance: '4',
    mapExtent: `${(e2180 - 2000).toFixed(1)},${(n2180 - 2000).toFixed(1)},${(e2180 + 2000).toFixed(1)},${(n2180 + 2000).toFixed(1)}`,
    imageDisplay: '1000,1000,96',
    returnGeometry: 'false',
  });

  const mgp500Params = new URLSearchParams({
    f: 'json',
    geometry: `${e2180.toFixed(1)},${n2180.toFixed(1)}`,
    geometryType: 'esriGeometryPoint',
    sr: '2180',
    layers: 'all:6,11,16',
    tolerance: '5',
    mapExtent: `${(e2180 - 3000).toFixed(1)},${(n2180 - 3000).toFixed(1)},${(e2180 + 3000).toFixed(1)},${(n2180 + 3000).toFixed(1)}`,
    imageDisplay: '1000,1000,96',
    returnGeometry: 'false',
  });

  const [sheetRes, mgp200bRes, mgp500Res] = await Promise.all([
    fetchJsonWithTimeout(
      `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/identify?${sheetParams}`,
      10_000
    ).catch(() => null) as Promise<{
      results?: Array<{ attributes?: Record<string, unknown> }>;
    } | null>,
    fetchJsonWithTimeout(
      `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/mgp200k_b/MapServer/identify?${mgp200bParams}`,
      9_000
    ).catch(() => null) as Promise<{
      results?: Array<{ attributes?: Record<string, unknown> }>;
    } | null>,
    fetchJsonWithTimeout(
      `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/mgp500k_2022/MapServer/identify?${mgp500Params}`,
      9_000
    ).catch(() => null) as Promise<{
      results?: Array<{ layerName?: string; attributes?: Record<string, unknown> }>;
    } | null>,
  ]);

  const sa = sheetRes?.results?.[0]?.attributes;
  const sheetNumber = cleanStr(sa?.['Nr arkusza']);
  const sheetName = cleanStr(sa?.Nazwa);
  const portalAvailable = String(sa?.Portal ?? '').toLowerCase() === 'tak';

  let exactUnit: GeologyUnitRecord | null = null;
  const nearbyUnits: GeologyUnitRecord[] = [];

  if (portalAvailable) {
    const pointParams = new URLSearchParams({
      f: 'json',
      geometry: `${e2180.toFixed(1)},${n2180.toFixed(1)}`,
      geometryType: 'esriGeometryPoint',
      sr: '2180',
      layers: 'all:5',
      tolerance: '2',
      mapExtent: `${(e2180 - 1000).toFixed(1)},${(n2180 - 1000).toFixed(1)},${(e2180 + 1000).toFixed(1)},${(n2180 + 1000).toFixed(1)}`,
      imageDisplay: '1000,1000,96',
      returnGeometry: 'false',
    });

    const radius = 700;
    const envParams = new URLSearchParams({
      f: 'json',
      geometry: JSON.stringify({
        xmin: e2180 - radius,
        ymin: n2180 - radius,
        xmax: e2180 + radius,
        ymax: n2180 + radius,
        spatialReference: { wkid: 2180 },
      }),
      geometryType: 'esriGeometryEnvelope',
      sr: '2180',
      layers: 'all:5',
      tolerance: '1',
      mapExtent: `${(e2180 - radius).toFixed(1)},${(n2180 - radius).toFixed(1)},${(e2180 + radius).toFixed(1)},${(n2180 + radius).toFixed(1)}`,
      imageDisplay: '1000,1000,96',
      returnGeometry: 'false',
    });

    const [ptData, envData] = await Promise.all([
      fetchJsonWithTimeout(
        `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/identify?${pointParams}`,
        9_000
      ).catch(() => null) as Promise<{
        results?: Array<{ attributes?: Record<string, unknown> }>;
      } | null>,
      fetchJsonWithTimeout(
        `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/identify?${envParams}`,
        11_000
      ).catch(() => null) as Promise<{
        results?: Array<{ attributes?: Record<string, unknown> }>;
      } | null>,
    ]);

    const parseUnit = (a: Record<string, unknown> | undefined): GeologyUnitRecord | null => {
      if (!a) return null;
      const unit = cleanStr(a.Wydzielenia) ?? cleanStr(a.NAZWA);
      if (!unit) return null;
      return {
        code: cleanStr(a['Kod generalizacji']) ?? cleanStr(a.SYMBOL_GEN),
        unit,
        stratigraphy: cleanStr(a.Stratygrafia) ?? cleanStr(a.WIEK_OPIS),
        genesis: cleanStr(a.Geneza) ?? cleanStr(a.GENEZA),
        form: cleanStr(a.Forma) ?? cleanStr(a.FORMA),
      };
    };

    exactUnit = parseUnit(ptData?.results?.[0]?.attributes);

    const seenKeys = new Set<string>();
    if (exactUnit) {
      seenKeys.add(`${exactUnit.code ?? ''}|${exactUnit.unit.toLowerCase()}`);
    }
    for (const r of envData?.results ?? []) {
      const parsed = parseUnit(r.attributes);
      if (!parsed) continue;
      const key = `${parsed.code ?? ''}|${parsed.unit.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      nearbyUnits.push(parsed);
      if (nearbyUnits.length >= 12) break;
    }
  }

  const mgp200kBedrock: string[] = [];
  for (const r of mgp200bRes?.results ?? []) {
    const a = r.attributes ?? {};
    const desc = [
      cleanStr(a.Wydzielenia) ?? cleanStr(a.NAZWA) ?? cleanStr(a['Opis wydzielenia']),
      cleanStr(a.Stratygrafia) ?? cleanStr(a.WIEK_OPIS),
      cleanStr(a.Geneza) ?? cleanStr(a.GENEZA),
    ]
      .filter(Boolean)
      .join(' — ');
    if (desc && !mgp200kBedrock.includes(desc)) {
      mgp200kBedrock.push(desc);
    }
  }

  const mgp500kLayers: GeologyPigContext['mgp500kLayers'] = [];
  for (const r of mgp500Res?.results ?? []) {
    const a = r.attributes ?? {};
    const description =
      cleanStr(a['Opis wydzielenia']) ?? cleanStr(a.Legenda) ?? cleanStr(a.Litologia);
    if (!description) continue;
    mgp500kLayers.push({
      layer: cleanStr(r.layerName) ?? 'MGP 1:500 000',
      description,
      lithology: cleanStr(a.Litologia),
      stratigraphy: cleanStr(a.Stratygrafia),
      genesis: cleanStr(a.Geneza),
    });
  }

  return {
    sheetNumber,
    sheetName,
    portalAvailable,
    exactUnit,
    nearbyUnits,
    mgp200kBedrock,
    mgp500kLayers,
  };
}

const ALLOWED_IMAGE_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/;
const MAX_SINGLE_IMAGE_BYTES = 8 * 1024 * 1024;

function parseValidatedImageDataUrl(
  raw: unknown
): { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = ALLOWED_IMAGE_DATA_URL_RE.exec(trimmed);
  if (!match) return null;
  const mimeType = match[1] as 'image/png' | 'image/jpeg' | 'image/webp';
  const base64Clean = match[2].replace(/\s+/g, '');
  const approxBytes = Math.floor((base64Clean.length * 3) / 4);
  if (approxBytes < 32 || approxBytes > MAX_SINGLE_IMAGE_BYTES) return null;
  return { mimeType, data: base64Clean };
}

let cachedGeminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cachedGeminiClient) {
    cachedGeminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedGeminiClient;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/terrain-report', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (typeof req.query.lat !== 'string' || typeof req.query.lon !== 'string') {
      res.status(400).json({
        error: 'Podaj poprawne parametry współrzędnych (lat, lon).',
      });
      return;
    }

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);

    if (!isWithinPoland(lat, lon)) {
      res.status(400).json({
        error: 'Współrzędne muszą leżeć w granicach Polski (48,8–55,2° N; 13,8–24,5° E).',
      });
      return;
    }

    try {
      const pl1992 = wgs84ToPl1992(lat, lon);
      const pl2000 = wgs84ToPl2000(lat, lon);
      // GIS services in EPSG:2180 use mathematical X=Easting(pl1992.y), Y=Northing(pl1992.x)
      const e2180 = pl1992.y;
      const n2180 = pl1992.x;

      const adminPromise = fetchAdmin(lat, lon);
      const communeOfficePromise = adminPromise.then((a) => fetchCommuneOffice(lat, lon, a));

      const [admin, communeOffice, geography, osm, protectedAreas, mining, sopo, hydroPgi, smgp] =
        await Promise.all([
          adminPromise,
          communeOfficePromise,
          fetchGeography(e2180, n2180),
          fetchOsmNearby(lat, lon),
          fetchProtectedAreas(e2180, n2180),
          fetchMining(e2180, n2180),
          fetchSopo(e2180, n2180),
          fetchHydroPgi(e2180, n2180),
          fetchSmgp(e2180, n2180),
        ]);

      const payload: TerrainReportResponse = {
        coords: {
          wgs84: { lat, lon },
          pl1992,
          pl2000,
        },
        admin,
        geography,
        nearbyInfrastructure: {
          roadsAndRail: osm.roadsAndRail,
          communeOffice,
          error: osm.error,
        },
        protectedAreas,
        mining,
        sopo,
        hydro: {
          nearestWaterways: osm.waterways,
          jcwpd: hydroPgi.jcwpd,
          gzwp: hydroPgi.gzwp,
          error: hydroPgi.error ?? osm.error,
        },
        smgp,
      };

      res.json(payload);
    } catch {
      res.status(500).json({
        error: 'Wystąpił nieoczekiwany błąd podczas pobierania danych GIS.',
      });
    }
  });

  app.post('/api/geology-description', express.json({ limit: '25mb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const body = (req.body ?? {}) as {
      lat?: unknown;
      lon?: unknown;
      mapImageDataUrl?: unknown;
      legendImageDataUrls?: unknown;
      crossSectionImageDataUrl?: unknown;
      userNotes?: unknown;
    };

    const lat = Number(body.lat);
    const lon = Number(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isWithinPoland(lat, lon)) {
      res.status(400).json({
        error: 'Podaj poprawne współrzędne na terenie Polski (lat, lon).',
      });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'Brak skonfigurowanego klucza GEMINI_API_KEY na serwerze. Ustaw klucz w Settings > Secrets.',
      });
      return;
    }

    const mapImg = parseValidatedImageDataUrl(body.mapImageDataUrl);
    if (body.mapImageDataUrl && !mapImg) {
      res.status(400).json({
        error: 'Nieprawidłowy format obrazu wycinka mapy (dozwolone PNG, JPG, WebP do 8 MB).',
      });
      return;
    }

    const legendImgs: Array<{ mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }> =
      [];
    if (Array.isArray(body.legendImageDataUrls)) {
      for (const rawItem of body.legendImageDataUrls.slice(0, 2)) {
        if (!rawItem) continue;
        const parsed = parseValidatedImageDataUrl(rawItem);
        if (!parsed) {
          res.status(400).json({
            error: 'Nieprawidłowy format obrazu legendy (dozwolone PNG, JPG, WebP do 8 MB).',
          });
          return;
        }
        legendImgs.push(parsed);
      }
    }

    const crossImg = parseValidatedImageDataUrl(body.crossSectionImageDataUrl);
    if (body.crossSectionImageDataUrl && !crossImg) {
      res.status(400).json({
        error: 'Nieprawidłowy format obrazu przekroju (dozwolone PNG, JPG, WebP do 8 MB).',
      });
      return;
    }

    const userNotes =
      typeof body.userNotes === 'string' ? body.userNotes.trim().slice(0, 1000) : '';

    const pl1992 = wgs84ToPl1992(lat, lon);
    const e2180 = pl1992.y;
    const n2180 = pl1992.x;

    try {
      const ctx = await fetchGeologyContext(e2180, n2180);
      const hasImages = Boolean(mapImg || legendImgs.length > 0 || crossImg);

      const sourceMode: GeologyDescriptionSource = hasImages
        ? 'scan-and-pig'
        : ctx.portalAvailable && ctx.exactUnit
          ? 'smgp-vector'
          : 'mgp-500k-fallback';

      const formatUnitLine = (u: GeologyUnitRecord) =>
        [
          u.code ? `[${u.code}]` : null,
          u.unit,
          u.stratigraphy ? `(stratygrafia: ${u.stratigraphy})` : null,
          u.genesis ? `(geneza: ${u.genesis})` : null,
          u.form ? `(forma: ${u.form})` : null,
        ]
          .filter(Boolean)
          .join(' ');

      const contextLines: string[] = [
        `Arkusz SMGP 1:50 000: ${ctx.sheetNumber ?? 'nieznany'} ${ctx.sheetName ?? ''}`.trim(),
        `Dostępność wektorowa SMGP w PIG-PIB: ${ctx.portalAvailable ? 'TAK' : 'NIE'}`,
      ];

      if (ctx.exactUnit) {
        contextLines.push(`Wydzielenie SMGP 1:50 000 dokładnie w punkcie badań: ${formatUnitLine(ctx.exactUnit)}`);
      }
      if (ctx.nearbyUnits.length > 0) {
        contextLines.push('Sąsiednie wydzielenia SMGP 1:50 000 w promieniu ok. 700 m:');
        for (const u of ctx.nearbyUnits) {
          contextLines.push(`- ${formatUnitLine(u)}`);
        }
      }
      if (ctx.mgp200kBedrock.length > 0) {
        contextLines.push('Starsze podłoże wg MGP 1:200 000 (mapa odkryta bez czwartorzędu):');
        for (const b of ctx.mgp200kBedrock) {
          contextLines.push(`- ${b}`);
        }
      }
      if (ctx.mgp500kLayers.length > 0) {
        contextLines.push('Dane przeglądowe wg MGP 1:500 000 (2022):');
        for (const l of ctx.mgp500kLayers) {
          contextLines.push(
            `- ${l.layer}: ${l.description}${l.stratigraphy ? ` (stratygrafia: ${l.stratigraphy})` : ''}${l.genesis ? ` (geneza: ${l.genesis})` : ''}`
          );
        }
      }
      if (userNotes) {
        contextLines.push(`Dodatkowe uwagi geologa: ${userNotes}`);
      }

      const systemInstruction = [
        'Jesteś doświadczonym polskim geologiem inżynierskim sporządzającym rozdział „3. Budowa geologiczna” do Projektu Robót Geologicznych (PRG).',
        'Zredaguj JEDEN spójny, fachowy akapit w języku polskim (3–5 zdań), wzorowany dokładnie na stylu poniższego przykładu:',
        '„Według szczegółowej mapy geologicznej starsze podłoże geologiczne badanego terenu budują utwory serii magurskiej (strefy facjalnej raczańskiej), wykształcone w postaci piaskowców gruboławicowych i cienkoławicowych oraz łupków warstw ropianieckich (inoceramowych), datowane na górną kredę / paleogen (senon / paleocen). Nad nimi zalegają plejstoceńskie osady zlodowacenia wykształcone jako iły, gliny, piaski, żwiry i głazy rzeczne tarasów nadzalewowych. Lokalnie mogą wystąpić holoceńskie iły, gliny i gliny z rumoszem skalnym oraz bloki i głazy (pakiety fliszu) koluwialne.”',
        'Zasady bezwzględne:',
        '1. Zachowaj kolejność stratygraficzną od najstarszego podłoża geologicznego („starsze podłoże geologiczne badanego terenu budują...”) ku młodszym osadom nakładu („Nad nimi zalegają...”, „Lokalnie mogą wystąpić...”).',
        '2. Gdy przekazano obrazy wycinka SMGP (z zaznaczonym czerwonym celem/punktem lokalizacji) oraz legendy (i ewentualnie przekroju), odczytaj z nich dokładne wydzielenie w punkcie lokalizacji, bezpośrednio przyległe wydzielenia (np. koluwia, aluwia, tarasy, utwory starszego podłoża) oraz przyporządkuj je do opisów w legendzie (jednostka/seria, litologia, warstwy, wiek).',
        '3. Gdy brak obrazów, a dostępne są wektorowe dane SMGP 1:50 000, oprzyj opis ściśle na wydzieleniu w punkcie, wydzieleniach sąsiednich oraz podłożu z MGP.',
        '4. Gdy brak obrazów i arkusz SMGP nie jest dostępny wektorowo, napisz wstępny opis na podstawie MGP 1:500 000, rozpoczynając od „Według Mapy Geologicznej Polski w skali 1:500 000...” (nie udawaj szczegółowych danych z SMGP 1:50 000, których nie podano).',
        '5. NIE zmyślaj nazw serii, stref facjalnych ani litologii, których nie ma na przekazanych obrazach lub w danych PIG-PIB.',
        '6. Zwróć wyłącznie czysty tekst akapitu — bez nagłówka „3. Budowa geologiczna”, bez wypunktowań, bez markdownu, bez cudzysłowów i bez komentarzy meta.',
      ].join('\n');

      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [];

      if (mapImg) {
        parts.push({
          text: 'OBRAZ 1 — Wycinek szczegółowej mapy geologicznej Polski (SMGP 1:50 000). Czerwony celownik / kółko wskazuje dokładną lokalizację terenu badań:',
        });
        parts.push({ inlineData: mapImg });
      }
      legendImgs.forEach((img, i) => {
        parts.push({
          text: `OBRAZ LEGENDY ${i + 1} — Objaśnienia wydzieleń z tego arkusza SMGP 1:50 000:`,
        });
        parts.push({ inlineData: img });
      });
      if (crossImg) {
        parts.push({
          text: 'OBRAZ PRZEKROJU — Przekrój geologiczny z tego arkusza SMGP (pomocniczo do rozpoznania starszego podłoża pod osadami czwartorzędowymi):',
        });
        parts.push({ inlineData: crossImg });
      }

      parts.push({
        text: `Dane pomocnicze z baz PIG-PIB dla lokalizacji:\n${contextLines.join('\n')}\n\nNapisz gotowy akapit opisu budowy geologicznej do rozdziału 3 PRG.`,
      });

      let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts },
            config: {
              systemInstruction,
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.MEDIUM,
              },
            },
          });
          break;
        } catch (attemptErr) {
          lastErr = attemptErr;
          const m = attemptErr instanceof Error ? attemptErr.message : '';
          if (attempt === 0 && /RESOURCE_EXHAUSTED|429|503|UNAVAILABLE/i.test(m)) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          throw attemptErr;
        }
      }
      if (!response) {
        throw lastErr ?? new Error('Brak odpowiedzi z modelu Gemini.');
      }

      const description = (response.text ?? '').trim().replace(/^["„]+|["”]+$/g, '').trim();
      if (!description) {
        res.status(502).json({
          error: 'Model nie zwrócił opisu budowy geologicznej. Spróbuj ponownie.',
        });
        return;
      }

      const payload: GeologyDescriptionResponse = {
        description,
        sourceMode,
        sheetNumber: ctx.sheetNumber,
        sheetName: ctx.sheetName,
        portalAvailable: ctx.portalAvailable,
        warning:
          sourceMode === 'mgp-500k-fallback'
            ? `Arkusz SMGP nr ${ctx.sheetNumber ?? '—'}${ctx.sheetName ? ` (${ctx.sheetName})` : ''} nie jest udostępniany wektorowo w PIG-PIB — wstępny opis oparto o MGP 1:500 000. Aby uzyskać szczegółowy opis z SMGP 1:50 000, wgraj wycinek mapy i legendę (albo użyj wycinków z panelu ZAŁ. 3 poniżej).`
            : undefined,
      };

      res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/API_KEY_INVALID|PERMISSION_DENIED|403|401/i.test(msg)) {
        res.status(403).json({
          error:
            'Błąd autoryzacji klucza Gemini API. Sprawdź klucz w panelu Settings > Secrets.',
        });
        return;
      }
      if (/RESOURCE_EXHAUSTED|429/i.test(msg)) {
        res.status(429).json({
          error:
            'Przekroczono limit zapytań Gemini API. Spróbuj ponownie za chwilę lub wybierz klucz z aktywnym rozliczaniem w panelu Settings > Secrets.',
        });
        return;
      }
      res.status(502).json({
        error: 'Nie udało się wygenerować opisu budowy geologicznej. Spróbuj ponownie.',
      });
    }
  });

  app.get('/api/sopo-meta', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (typeof req.query.lat !== 'string' || typeof req.query.lon !== 'string') {
      res.status(400).json({ error: 'Brak parametrów lat/lon.' });
      return;
    }
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!isWithinPoland(lat, lon)) {
      res.status(400).json({ error: 'Współrzędne muszą leżeć w granicach Polski.' });
      return;
    }

    const pl1992 = wgs84ToPl1992(lat, lon);
    const e2180 = pl1992.y;
    const n2180 = pl1992.x;

    const stanParams = new URLSearchParams({
      f: 'json',
      geometry: `${e2180},${n2180}`,
      geometryType: 'esriGeometryPoint',
      inSR: '2180',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'GMINA,POWIAT,WOJEWODZTWO,ROK_ZAKONCZENIA,APLIKACJA_SOPO,AKTUALNOSC_TERENOWA,AUTOR,KOORDYNATOR',
      returnGeometry: 'false',
    });

    try {
      const stan = (await fetchJsonWithTimeout(
        `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/sopo_stan/MapServer/0/query?${stanParams}`,
        9_000
      )) as { features?: Array<{ attributes?: Record<string, unknown> }> };

      const a = stan.features?.[0]?.attributes;
      if (a) {
        const meta: SopoCitationMeta = {
          mappedCommune: String(a.APLIKACJA_SOPO ?? '').toLowerCase() === 'tak',
          commune: cleanStr(a.GMINA),
          county: cleanStr(a.POWIAT),
          voivodeship: cleanStr(a.WOJEWODZTWO),
          mappingYear: cleanStr(a.ROK_ZAKONCZENIA),
          fieldCurrency: cleanStr(a.AKTUALNOSC_TERENOWA),
          author: cleanStr(a.AUTOR),
          coordinator: cleanStr(a.KOORDYNATOR),
        };
        res.json(meta);
        return;
      }

      // Fallback to ULDK administrative boundaries when outside SOPO mapped commune
      const admin = await fetchAdmin(lat, lon);
      const fallback: SopoCitationMeta = {
        mappedCommune: false,
        commune: admin.commune,
        county: admin.county ? admin.county.replace(/^powiat\s+/i, '') : null,
        voivodeship: admin.voivodeship,
        mappingYear: null,
        fieldCurrency: null,
        author: null,
        coordinator: null,
      };
      res.json(fallback);
    } catch {
      res.status(502).json({ error: 'Nie udało się pobrać metadanych SOPO.' });
    }
  });

  // Cached SMGP 1:50 000 legend swatches (Kod generalizacji -> base64 PNG data URL)
  let smgpSwatchCache: Map<string, string> | null = null;
  let smgpSwatchPromise: Promise<Map<string, string>> | null = null;

  async function getSmgpLegendSwatches(): Promise<Map<string, string>> {
    if (smgpSwatchCache) return smgpSwatchCache;
    if (smgpSwatchPromise) return smgpSwatchPromise;

    smgpSwatchPromise = (async () => {
      const map = new Map<string, string>();
      try {
        const leg = (await fetchJsonWithTimeout(
          'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/legend?f=json',
          12_000
        )) as {
          layers?: Array<{
            layerId: number;
            legend?: Array<{ label?: string; values?: string[]; imageData?: string }>;
          }>;
        };
        const layer5 = leg.layers?.find((l) => l.layerId === 5);
        for (const item of layer5?.legend ?? []) {
          if (!item.imageData) continue;
          const dataUrl = `data:image/png;base64,${item.imageData}`;
          for (const v of item.values ?? []) {
            if (v) map.set(String(v).trim(), dataUrl);
          }
          if (item.label) map.set(String(item.label).trim(), dataUrl);
        }
        if (map.size > 0) smgpSwatchCache = map;
      } catch {
        // leave uncached so next call can retry
      } finally {
        smgpSwatchPromise = null;
      }
      return map;
    })();

    return smgpSwatchPromise;
  }

  function projectPointOntoPaths(
    px: number,
    py: number,
    paths: number[][][]
  ): { lengthM: number; distanceM: number; projectionPercent: number } {
    let totalLen = 0;
    let bestDist = Infinity;
    let bestAlong = 0;

    for (const pathPts of paths) {
      if (pathPts.length < 2) continue;
      for (let i = 0; i < pathPts.length - 1; i++) {
        const [x1, y1] = pathPts[i];
        const [x2, y2] = pathPts[i + 1];
        const segLen = Math.hypot(x2 - x1, y2 - y1);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const nx = x1 + t * dx;
        const ny = y1 + t * dy;
        const d = Math.hypot(px - nx, py - ny);
        if (d < bestDist) {
          bestDist = d;
          bestAlong = totalLen + t * segLen;
        }
        totalLen += segLen;
      }
    }

    const projectionPercent =
      totalLen > 0 ? Math.max(0, Math.min(100, (bestAlong / totalLen) * 100)) : 50;
    return {
      lengthM: Math.round(totalLen),
      distanceM: Math.round(bestDist),
      projectionPercent: Number(projectionPercent.toFixed(1)),
    };
  }

  app.get('/api/smgp-map-meta', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (typeof req.query.lat !== 'string' || typeof req.query.lon !== 'string') {
      res.status(400).json({ error: 'Brak parametrów lat/lon.' });
      return;
    }
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!isWithinPoland(lat, lon)) {
      res.status(400).json({ error: 'Współrzędne muszą leżeć w granicach Polski.' });
      return;
    }

    const pl1992 = wgs84ToPl1992(lat, lon);
    const e2180 = pl1992.y;
    const n2180 = pl1992.x;

    // 150 mm x 70 mm map @ 1:50 000 = 7500 m x 3500 m
    const groundW = 7500;
    const groundH = 3500;
    const minX = e2180 - groundW / 2;
    const minY = n2180 - groundH / 2;
    const maxX = e2180 + groundW / 2;
    const maxY = n2180 + groundH / 2;
    const bboxStr = `${minX.toFixed(2)},${minY.toFixed(2)},${maxX.toFixed(2)},${maxY.toFixed(2)}`;

    const smgpSheetsDir = path.resolve(__dirname, 'smgp-sheets');
    const findSavedSmgpScan = (sheetNo: string | null): { filePath: string; ext: 'jpg' | 'png' | 'webp' } | null => {
      if (!sheetNo || !/^\d{1,4}$/.test(sheetNo)) return null;
      if (!fs.existsSync(smgpSheetsDir)) return null;
      const padded = sheetNo.padStart(4, '0');
      const candidates = padded === sheetNo ? [sheetNo] : [padded, sheetNo];
      const exts: Array<'jpg' | 'png' | 'webp'> = ['jpg', 'png', 'webp'];
      for (const base of candidates) {
        for (const ext of exts) {
          const p = path.join(smgpSheetsDir, `smgp${base}.${ext}`);
          if (fs.existsSync(p)) return { filePath: p, ext };
          if (ext === 'jpg') {
            const jpegPath = path.join(smgpSheetsDir, `smgp${base}.jpeg`);
            if (fs.existsSync(jpegPath)) return { filePath: jpegPath, ext: 'jpg' };
          }
        }
      }
      return null;
    };

    try {
      const sheetParams = new URLSearchParams({
        f: 'json',
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        sr: '4326',
        layers: 'all:0',
        tolerance: '1',
        mapExtent: `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`,
        imageDisplay: '1000,1000,96',
        returnGeometry: 'true',
      });

      const skorParams = new URLSearchParams({
        f: 'json',
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        sr: '4326',
        layers: 'all:0',
        tolerance: '1',
        mapExtent: `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`,
        imageDisplay: '1000,1000,96',
        returnGeometry: 'false',
      });

      const [sheetData, skorData] = await Promise.all([
        fetchJsonWithTimeout(
          `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/identify?${sheetParams}`,
          10_000
        ) as Promise<{
          results?: Array<{
            attributes?: Record<string, unknown>;
            geometry?: { rings?: number[][][] };
          }>;
        }>,
        fetchJsonWithTimeout(
          `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/skor_smgp/MapServer/identify?${skorParams}`,
          9_000
        ).catch(() => null) as Promise<{
          results?: Array<{ attributes?: Record<string, unknown> }>;
        } | null>,
      ]);

      const sheetResult = sheetData.results?.[0];
      const sa = sheetResult?.attributes;
      const skorAttrs = skorData?.results?.[0]?.attributes;
      const sheetNumber = cleanStr(sa?.['Nr arkusza']) ?? cleanStr(skorAttrs?.['Nr arkusza']);
      const portalAvailable = String(sa?.Portal ?? '').toLowerCase() === 'tak';

      const rawScanUrl = cleanStr(skorAttrs?.['Skan mapy']);
      const scanUrl =
        rawScanUrl && (rawScanUrl.startsWith('http://') || rawScanUrl.startsWith('https://'))
          ? rawScanUrl
          : null;
      const sheetNotes = cleanStr(skorAttrs?.Uwagi);
      const savedScan = findSavedSmgpScan(sheetNumber);

      let sheetBounds: SmgpMapMeta['sheetBounds'] = null;
      let pointInSheetPercent: SmgpMapMeta['pointInSheetPercent'] = null;
      const sheetRing = sheetResult?.geometry?.rings?.[0];
      if (sheetRing && sheetRing.length > 2) {
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        for (const [gx, gy] of sheetRing) {
          if (gx < minLon) minLon = gx;
          if (gx > maxLon) maxLon = gx;
          if (gy < minLat) minLat = gy;
          if (gy > maxLat) maxLat = gy;
        }
        if (maxLon > minLon && maxLat > minLat) {
          sheetBounds = {
            minLon: Number(minLon.toFixed(6)),
            maxLon: Number(maxLon.toFixed(6)),
            minLat: Number(minLat.toFixed(6)),
            maxLat: Number(maxLat.toFixed(6)),
          };
          const uPercent = Math.max(0, Math.min(100, ((lon - minLon) / (maxLon - minLon)) * 100));
          const vPercentFromTop = Math.max(
            0,
            Math.min(100, ((maxLat - lat) / (maxLat - minLat)) * 100)
          );
          pointInSheetPercent = {
            uPercent: Number(uPercent.toFixed(2)),
            vPercentFromTop: Number(vPercentFromTop.toFixed(2)),
          };
        }
      }

      let legendUnits: SmgpLegendUnit[] = [];
      let crossSections: SmgpCrossSectionInfo[] = [];

      if (portalAvailable) {
        const unitsParams = new URLSearchParams({
          f: 'json',
          geometry: JSON.stringify({
            xmin: minX,
            ymin: minY,
            xmax: maxX,
            ymax: maxY,
            spatialReference: { wkid: 2180 },
          }),
          geometryType: 'esriGeometryEnvelope',
          sr: '2180',
          layers: 'all:5',
          tolerance: '1',
          mapExtent: bboxStr,
          imageDisplay: '1350,630,229',
          returnGeometry: 'false',
        });

        const sheetInt = sheetNumber ? parseInt(sheetNumber, 10) : NaN;
        const linesPromise =
          Number.isFinite(sheetInt) && sheetInt > 0
            ? (fetchJsonWithTimeout(
                `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/2/query?${new URLSearchParams(
                  {
                    f: 'json',
                    where: `NR_ARKUSZA=${sheetInt}`,
                    outFields: 'NAZWA,SYMBOL',
                    returnGeometry: 'true',
                    outSR: '2180',
                  }
                )}`,
                10_000
              ).catch(() => null) as Promise<{
                features?: Array<{
                  attributes?: Record<string, unknown>;
                  geometry?: { paths?: number[][][] };
                }>;
              } | null>)
            : Promise.resolve(null);

        const pointUnitParams = new URLSearchParams({
          f: 'json',
          geometry: `${e2180},${n2180}`,
          geometryType: 'esriGeometryPoint',
          sr: '2180',
          layers: 'all:5',
          tolerance: '2',
          mapExtent: bboxStr,
          imageDisplay: '1350,630,229',
          returnGeometry: 'false',
        });

        const [unitsData, pointUnitData, linesData, swatches] = await Promise.all([
          fetchJsonWithTimeout(
            `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/identify?${unitsParams}`,
            12_000
          ).catch(() => null) as Promise<{
            results?: Array<{ attributes?: Record<string, unknown> }>;
          } | null>,
          fetchJsonWithTimeout(
            `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/identify?${pointUnitParams}`,
            8_000
          ).catch(() => null) as Promise<{
            results?: Array<{ attributes?: Record<string, unknown> }>;
          } | null>,
          linesPromise,
          getSmgpLegendSwatches(),
        ]);

        const centerCode = cleanStr(pointUnitData?.results?.[0]?.attributes?.['Kod generalizacji']);
        const unitMap = new Map<
          string,
          SmgpLegendUnit & { totalArea: number; containsCenter: boolean }
        >();

        for (const r of unitsData?.results ?? []) {
          const a = r.attributes ?? {};
          const code = cleanStr(a['Kod generalizacji']);
          const unit = cleanStr(a.Wydzielenia);
          if (!code || !unit) continue;

          const areaRaw = cleanStr(a['SHAPE.STArea()']);
          const area = areaRaw ? parseFloat(areaRaw.replace(',', '.')) || 0 : 0;
          const existing = unitMap.get(code);
          if (existing) {
            existing.totalArea += area;
          } else {
            unitMap.set(code, {
              code,
              unit,
              stratigraphy: cleanStr(a.Stratygrafia),
              genesis: cleanStr(a.Geneza),
              swatchDataUrl: swatches.get(code) ?? null,
              totalArea: area,
              containsCenter: code === centerCode,
            });
          }
        }

        legendUnits = [...unitMap.values()]
          .sort((a, b) => {
            if (a.containsCenter !== b.containsCenter) return a.containsCenter ? -1 : 1;
            return b.totalArea - a.totalArea;
          })
          .slice(0, 18)
          .map(({ code, unit, stratigraphy, genesis, swatchDataUrl }) => ({
            code,
            unit,
            stratigraphy,
            genesis,
            swatchDataUrl,
          }));

        const rawSections: SmgpCrossSectionInfo[] = [];
        for (const f of linesData?.features ?? []) {
          const name = cleanStr(f.attributes?.NAZWA) ?? '';
          if (!name.toLowerCase().includes('przekroj') && !name.toLowerCase().includes('przekrój')) {
            continue;
          }
          const paths = f.geometry?.paths;
          if (!paths || paths.length === 0) continue;
          const proj = projectPointOntoPaths(e2180, n2180, paths);
          const pathsWgs84 = paths.map((pts) =>
            pts.map(([ex, ny]) => {
              const wgs = pl1992ToWgs84(ny, ex);
              return {
                lat: Number(wgs.lat.toFixed(6)),
                lon: Number(wgs.lon.toFixed(6)),
              };
            })
          );
          rawSections.push({
            symbol: cleanStr(f.attributes?.SYMBOL) ?? 'A–B',
            name,
            lengthM: proj.lengthM,
            distanceM: proj.distanceM,
            projectionPercent: proj.projectionPercent,
            pathsWgs84,
          });
        }
        crossSections = rawSections.sort((a, b) => a.distanceM - b.distanceM);
      }

      const payload: SmgpMapMeta = {
        sheetNumber,
        sheetName: cleanStr(sa?.Nazwa) ?? cleanStr(skorAttrs?.Nazwa),
        mapAuthors: cleanStr(sa?.['Autor mapy']) ?? cleanStr(skorAttrs?.['Autor mapy']),
        mapYear:
          cleanStr(sa?.['Rok opracowania mapy']) ?? cleanStr(skorAttrs?.['Rok opracowania mapy']),
        mapPrintYear: cleanStr(sa?.['Rok druku mapy']) ?? cleanStr(skorAttrs?.['Rok druku mapy']),
        textAuthors: cleanStr(sa?.['Autor tekstu']) ?? cleanStr(skorAttrs?.['Autor tekstu']),
        textPrintYear: cleanStr(sa?.['Rok druku tekstu']) ?? cleanStr(skorAttrs?.['Rok druku tekstu']),
        portalAvailable,
        scanUrl,
        savedScanUrl:
          savedScan && sheetNumber
            ? `/api/smgp-sheet-scan?sheet=${encodeURIComponent(sheetNumber)}&v=${Math.round(fs.statSync(savedScan.filePath).mtimeMs)}`
            : null,
        sheetNotes,
        sheetBounds,
        pointInSheetPercent,
        legendUnits,
        crossSections,
      };
      res.json(payload);
    } catch {
      res.status(502).json({ error: 'Nie udało się pobrać metadanych arkusza SMGP 1:50 000.' });
    }
  });

  const smgpStorageDir = path.resolve(__dirname, 'smgp-sheets');
  fs.mkdirSync(smgpStorageDir, { recursive: true });

  function detectImageExtFromMagic(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
    if (buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'webp';
    }
    return null;
  }

  function resolveStoredSheetFile(sheetNo: string): { filePath: string; mime: string } | null {
    const padded = sheetNo.padStart(4, '0');
    const names = padded === sheetNo ? [sheetNo] : [padded, sheetNo];
    const map: Array<{ ext: string; mime: string }> = [
      { ext: 'jpg', mime: 'image/jpeg' },
      { ext: 'jpeg', mime: 'image/jpeg' },
      { ext: 'png', mime: 'image/png' },
      { ext: 'webp', mime: 'image/webp' },
    ];
    for (const base of names) {
      for (const { ext, mime } of map) {
        const candidate = path.join(smgpStorageDir, `smgp${base}.${ext}`);
        if (fs.existsSync(candidate)) return { filePath: candidate, mime };
      }
    }
    return null;
  }

  app.get('/api/smgp-sheet-scan', (req, res) => {
    const sheet = typeof req.query.sheet === 'string' ? req.query.sheet.trim() : '';
    if (!/^\d{1,4}$/.test(sheet)) {
      res.status(400).json({ error: 'Nieprawidłowy numer arkusza SMGP.' });
      return;
    }
    const found = resolveStoredSheetFile(sheet);
    if (!found) {
      res.status(404).json({ error: 'Brak zapisanego skanu tego arkusza w katalogu aplikacji.' });
      return;
    }
    res.setHeader('Content-Type', found.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(found.filePath);
  });

  app.post(
    '/api/smgp-sheet-scan',
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
      limit: '45mb',
    }),
    (req, res) => {
      const sheet = typeof req.query.sheet === 'string' ? req.query.sheet.trim() : '';
      if (!/^\d{1,4}$/.test(sheet)) {
        res.status(400).json({ error: 'Nieprawidłowy numer arkusza SMGP.' });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length < 32) {
        res.status(400).json({ error: 'Przesłano pusty lub nieprawidłowy plik obrazu.' });
        return;
      }
      const ext = detectImageExtFromMagic(req.body);
      if (!ext) {
        res.status(400).json({ error: 'Plik musi być prawidłowym obrazem JPG, PNG lub WebP.' });
        return;
      }

      const padded = sheet.padStart(4, '0');
      for (const oldExt of ['jpg', 'jpeg', 'png', 'webp']) {
        for (const base of [padded, sheet]) {
          const oldPath = path.join(smgpStorageDir, `smgp${base}.${oldExt}`);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      }

      const targetPath = path.join(smgpStorageDir, `smgp${padded}.${ext}`);
      fs.writeFileSync(targetPath, req.body);

      res.json({
        savedScanUrl: `/api/smgp-sheet-scan?sheet=${encodeURIComponent(sheet)}&v=${Date.now()}`,
        filename: `smgp${padded}.${ext}`,
      });
    }
  );

  app.delete('/api/smgp-sheet-scan', (req, res) => {
    const sheet = typeof req.query.sheet === 'string' ? req.query.sheet.trim() : '';
    if (!/^\d{1,4}$/.test(sheet)) {
      res.status(400).json({ error: 'Nieprawidłowy numer arkusza SMGP.' });
      return;
    }
    const padded = sheet.padStart(4, '0');
    for (const oldExt of ['jpg', 'jpeg', 'png', 'webp']) {
      for (const base of [padded, sheet]) {
        const oldPath = path.join(smgpStorageDir, `smgp${base}.${oldExt}`);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }
    res.json({ removed: true });
  });

  const mgpStorageDir = path.resolve(__dirname, 'mgp-sheets');
  fs.mkdirSync(mgpStorageDir, { recursive: true });

  function parseMgpBoard(raw: unknown): MgpBoard | null {
    if (typeof raw !== 'string') return null;
    const up = raw.trim().toUpperCase();
    return up === 'A' || up === 'B' ? up : null;
  }

  function resolveStoredMgpFile(
    sheetNo: string,
    board: MgpBoard
  ): { filePath: string; mime: string } | null {
    if (!/^\d{1,4}$/.test(sheetNo)) return null;
    const padded = sheetNo.padStart(4, '0');
    const names = padded === sheetNo ? [sheetNo] : [padded, sheetNo];
    const map: Array<{ ext: string; mime: string }> = [
      { ext: 'jpg', mime: 'image/jpeg' },
      { ext: 'jpeg', mime: 'image/jpeg' },
      { ext: 'png', mime: 'image/png' },
      { ext: 'webp', mime: 'image/webp' },
    ];
    for (const base of names) {
      for (const { ext, mime } of map) {
        const candidate = path.resolve(mgpStorageDir, `mgp${base}_${board}.${ext}`);
        if (candidate.startsWith(mgpStorageDir + path.sep) && fs.existsSync(candidate)) {
          return { filePath: candidate, mime };
        }
      }
    }
    return null;
  }

  app.get('/api/mgp-map-meta', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (typeof req.query.lat !== 'string' || typeof req.query.lon !== 'string') {
      res.status(400).json({ error: 'Brak parametrów lat/lon.' });
      return;
    }
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!isWithinPoland(lat, lon)) {
      res.status(400).json({ error: 'Współrzędne muszą leżeć w granicach Polski.' });
      return;
    }

    const pl1992 = wgs84ToPl1992(lat, lon);
    const e2180 = pl1992.y;
    const n2180 = pl1992.x;

    try {
      const identifyParams = new URLSearchParams({
        f: 'json',
        geometry: `${e2180.toFixed(2)},${n2180.toFixed(2)}`,
        geometryType: 'esriGeometryPoint',
        sr: '2180',
        layers: 'all:3,1,0',
        tolerance: '1',
        mapExtent: `${(e2180 - 2000).toFixed(1)},${(n2180 - 2000).toFixed(1)},${(e2180 + 2000).toFixed(1)},${(n2180 + 2000).toFixed(1)}`,
        imageDisplay: '800,800,96',
        returnGeometry: 'true',
      });

      const data = (await fetchJsonWithTimeout(
        `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/mgsp50k_skorowidz/MapServer/identify?${identifyParams}`,
        10_000
      )) as {
        results?: Array<{
          layerId: number;
          attributes?: Record<string, unknown>;
          geometry?: { rings?: number[][][] };
        }>;
      };

      const computeBoundsFromPl1992Rings = (
        rings: number[][][] | undefined
      ): {
        sheetBounds: MgpEditionInfo['sheetBounds'];
        pointInSheetPercent: MgpEditionInfo['pointInSheetPercent'];
      } => {
        const ring = rings?.[0];
        if (!ring || ring.length < 3) {
          return { sheetBounds: null, pointInSheetPercent: null };
        }
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        for (const [ex, ny] of ring) {
          if (!Number.isFinite(ex) || !Number.isFinite(ny)) continue;
          const wgs = pl1992ToWgs84(ny, ex);
          if (wgs.lon < minLon) minLon = wgs.lon;
          if (wgs.lon > maxLon) maxLon = wgs.lon;
          if (wgs.lat < minLat) minLat = wgs.lat;
          if (wgs.lat > maxLat) maxLat = wgs.lat;
        }
        if (!(maxLon > minLon && maxLat > minLat)) {
          return { sheetBounds: null, pointInSheetPercent: null };
        }
        const sheetBounds = {
          minLon: Number(minLon.toFixed(6)),
          maxLon: Number(maxLon.toFixed(6)),
          minLat: Number(minLat.toFixed(6)),
          maxLat: Number(maxLat.toFixed(6)),
        };
        const uPercent = Math.max(0, Math.min(100, ((lon - minLon) / (maxLon - minLon)) * 100));
        const vPercentFromTop = Math.max(
          0,
          Math.min(100, ((maxLat - lat) / (maxLat - minLat)) * 100)
        );
        return {
          sheetBounds,
          pointInSheetPercent: {
            uPercent: Number(uPercent.toFixed(2)),
            vPercentFromTop: Number(vPercentFromTop.toFixed(2)),
          },
        };
      };

      const cleanAttr = (val: unknown): string | null => {
        const s = cleanStr(val);
        if (!s || s.toLowerCase() === 'null' || s === '-') return null;
        return s;
      };

      const editions: MgpEditionInfo[] = [];
      const orderLayers: Array<{ id: number; edition: 'III' | 'II' | 'I'; cs: string }> = [
        { id: 3, edition: 'III', cs: 'PUWG 1992' },
        { id: 1, edition: 'II', cs: 'PUWG 1992' },
        { id: 0, edition: 'I', cs: 'Pułkowo 1942' },
      ];

      for (const spec of orderLayers) {
        const match = data.results?.find((r) => r.layerId === spec.id);
        if (!match?.attributes) continue;
        const a = match.attributes;
        const sheetNo = cleanAttr(a['Numer arkusza']) ?? cleanAttr(a['Nr arkusza']);
        if (!sheetNo) continue;
        const { sheetBounds, pointInSheetPercent } = computeBoundsFromPl1992Rings(
          match.geometry?.rings
        );
        const commonYear = cleanAttr(a['Rok opracowania']);
        const yearA = cleanAttr(a['Rok opracowania planszy A']) ?? commonYear;
        const yearB =
          cleanAttr(a['Rok opracowania planszy B']) ??
          cleanAttr(a['Rok poracowania planszy B']) ??
          commonYear;
        const commonAuthor = cleanAttr(a.Autor);
        const authorsA = cleanAttr(a['Autor planszy A']) ?? commonAuthor;
        const authorsB = cleanAttr(a['Autor planszy B']) ?? commonAuthor;

        editions.push({
          edition: spec.edition,
          sheetNumber: sheetNo,
          sheetName: cleanAttr(a['Nazwa arkusza']),
          godlo:
            cleanAttr(a['Godło 92']) ?? cleanAttr(a['Godło 42']) ?? cleanAttr(a['Godło']),
          yearA,
          yearB,
          authorsA,
          authorsB,
          coordSystemLabel: spec.cs,
          sheetBounds,
          pointInSheetPercent,
        });
      }

      // Prefer newest elaborated edition (III if authors/year exist, otherwise II, otherwise I)
      const primary =
        editions.find((e) => e.edition === 'III' && (e.authorsA || e.yearA)) ??
        editions.find((e) => e.edition === 'II') ??
        editions.find((e) => e.edition === 'I') ??
        editions[0] ??
        null;

      const sheetNumber = primary?.sheetNumber ?? null;
      const savedA = sheetNumber ? resolveStoredMgpFile(sheetNumber, 'A') : null;
      const savedB = sheetNumber ? resolveStoredMgpFile(sheetNumber, 'B') : null;

      const payload: MgpMapMeta = {
        sheetNumber,
        sheetName: primary?.sheetName ?? null,
        godlo: primary?.godlo ?? null,
        editions,
        activeEdition: primary?.edition ?? null,
        authorsA: primary?.authorsA ?? null,
        authorsB: primary?.authorsB ?? null,
        yearA: primary?.yearA ?? null,
        yearB: primary?.yearB ?? null,
        resourceUrl: sheetNumber
          ? `https://baza.pgi.gov.pl/resources.html?type=map50&id=${encodeURIComponent(sheetNumber)}`
          : null,
        emgspUrl: 'https://emgsp.pgi.gov.pl/emgsp/',
        savedScanUrlA:
          savedA && sheetNumber
            ? `/api/mgp-sheet-scan?sheet=${encodeURIComponent(sheetNumber)}&board=A&v=${Math.round(fs.statSync(savedA.filePath).mtimeMs)}`
            : null,
        savedScanUrlB:
          savedB && sheetNumber
            ? `/api/mgp-sheet-scan?sheet=${encodeURIComponent(sheetNumber)}&board=B&v=${Math.round(fs.statSync(savedB.filePath).mtimeMs)}`
            : null,
        sheetBounds: primary?.sheetBounds ?? null,
        pointInSheetPercent: primary?.pointInSheetPercent ?? null,
      };
      res.json(payload);
    } catch {
      res.status(502).json({
        error: 'Nie udało się pobrać metadanych arkusza Mapy Geośrodowiskowej Polski (MGśP 1:50 000).',
      });
    }
  });

  app.get('/api/mgp-sheet-scan', (req, res) => {
    const sheet = typeof req.query.sheet === 'string' ? req.query.sheet.trim() : '';
    const board = parseMgpBoard(req.query.board);
    if (!/^\d{1,4}$/.test(sheet) || !board) {
      res.status(400).json({ error: 'Nieprawidłowy numer arkusza lub oznaczenie planszy (A/B).' });
      return;
    }
    const found = resolveStoredMgpFile(sheet, board);
    if (!found) {
      res.status(404).json({ error: 'Brak zapisanego skanu tej planszy MGśP w katalogu aplikacji.' });
      return;
    }
    res.setHeader('Content-Type', found.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(found.filePath);
  });

  app.post(
    '/api/mgp-sheet-scan',
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
      limit: '45mb',
    }),
    (req, res) => {
      const sheet = typeof req.query.sheet === 'string' ? req.query.sheet.trim() : '';
      const board = parseMgpBoard(req.query.board);
      if (!/^\d{1,4}$/.test(sheet) || !board) {
        res.status(400).json({ error: 'Nieprawidłowy numer arkusza lub oznaczenie planszy (A/B).' });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length < 32) {
        res.status(400).json({ error: 'Przesłano pusty lub nieprawidłowy plik obrazu.' });
        return;
      }
      const ext = detectImageExtFromMagic(req.body);
      if (!ext) {
        res.status(400).json({ error: 'Plik musi być prawidłowym obrazem JPG, PNG lub WebP.' });
        return;
      }

      const padded = sheet.padStart(4, '0');
      for (const oldExt of ['jpg', 'jpeg', 'png', 'webp']) {
        for (const base of [padded, sheet]) {
          const oldPath = path.resolve(mgpStorageDir, `mgp${base}_${board}.${oldExt}`);
          if (oldPath.startsWith(mgpStorageDir + path.sep) && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
      }

      const targetPath = path.resolve(mgpStorageDir, `mgp${padded}_${board}.${ext}`);
      if (!targetPath.startsWith(mgpStorageDir + path.sep)) {
        res.status(400).json({ error: 'Nieprawidłowa ścieżka pliku.' });
        return;
      }
      fs.writeFileSync(targetPath, req.body);

      res.json({
        savedScanUrl: `/api/mgp-sheet-scan?sheet=${encodeURIComponent(sheet)}&board=${board}&v=${Date.now()}`,
        filename: `mgp${padded}_${board}.${ext}`,
      });
    }
  );

  app.delete('/api/mgp-sheet-scan', (req, res) => {
    const sheet = typeof req.query.sheet === 'string' ? req.query.sheet.trim() : '';
    const board = parseMgpBoard(req.query.board);
    if (!/^\d{1,4}$/.test(sheet) || !board) {
      res.status(400).json({ error: 'Nieprawidłowy numer arkusza lub oznaczenie planszy (A/B).' });
      return;
    }
    const padded = sheet.padStart(4, '0');
    for (const oldExt of ['jpg', 'jpeg', 'png', 'webp']) {
      for (const base of [padded, sheet]) {
        const oldPath = path.resolve(mgpStorageDir, `mgp${base}_${board}.${oldExt}`);
        if (oldPath.startsWith(mgpStorageDir + path.sep) && fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    }
    res.json({ removed: true });
  });

  app.get('/api/wms-map', async (req, res) => {
    if (
      typeof req.query.lat !== 'string' ||
      typeof req.query.lon !== 'string' ||
      typeof req.query.scale !== 'string'
    ) {
      res.status(400).json({ error: 'Brak wymaganych parametrów mapy (lat, lon, scale).' });
      return;
    }

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const scale = Number(req.query.scale);
    const layer = typeof req.query.layer === 'string' ? req.query.layer : 'topo';
    const frame = typeof req.query.frame === 'string' ? req.query.frame : 'standard';

    if (!isWithinPoland(lat, lon)) {
      res.status(400).json({ error: 'Współrzędne muszą leżeć w granicach Polski.' });
      return;
    }

    if (scale !== 50000 && scale !== 25000 && scale !== 10000) {
      res.status(400).json({ error: 'Obsługiwane skale to wyłącznie 50000, 25000 i 10000.' });
      return;
    }

    if (layer !== 'topo' && layer !== 'orto' && layer !== 'sopo' && layer !== 'smgp') {
      res.status(400).json({ error: 'Obsługiwane warstwy to wyłącznie topo, orto, sopo i smgp.' });
      return;
    }

    if (
      frame !== 'standard' &&
      frame !== 'compact' &&
      frame !== 'sopo-single' &&
      frame !== 'smgp-top'
    ) {
      res.status(400).json({ error: 'Nieprawidłowy wariant ramki mapy.' });
      return;
    }

    const width = frame === 'smgp-top' ? 1350 : 1530;
    const height =
      frame === 'smgp-top' ? 630 : frame === 'sopo-single' ? 1350 : frame === 'compact' ? 792 : 900;
    const frameWidthMetersOnPaper = frame === 'smgp-top' ? 0.15 : 0.17;
    const frameHeightMetersOnPaper =
      frame === 'smgp-top'
        ? 0.07
        : frame === 'sopo-single'
          ? 0.15
          : frame === 'compact'
            ? 0.088
            : 0.1;

    const pl1992 = wgs84ToPl1992(lat, lon);
    const e2180 = pl1992.y;
    const n2180 = pl1992.x;

    // Physical frame on A4: 170 mm x 100 mm, 170 mm x 150 mm (SOPO), or 150 mm x 70 mm (SMGP top)
    const groundW = scale * frameWidthMetersOnPaper;
    const groundH = scale * frameHeightMetersOnPaper;
    const bbox = [
      (e2180 - groundW / 2).toFixed(2),
      (n2180 - groundH / 2).toFixed(2),
      (e2180 + groundW / 2).toFixed(2),
      (n2180 + groundH / 2).toFixed(2),
    ].join(',');

    let targetUrl: string;
    if (layer === 'sopo') {
      // Exact 228.6 DPI matches 1530px / 170mm so ArcGIS applies true 1:10 000 / 1:50 000 SOPO symbology
      const sopoParams = new URLSearchParams({
        bbox,
        bboxSR: '2180',
        imageSR: '2180',
        size: `${width},${height}`,
        dpi: '229',
        format: 'png32',
        transparent: 'true',
        f: 'image',
      });
      targetUrl = `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/sopo_obszary/MapServer/export?${sopoParams.toString()}`;
    } else if (layer === 'smgp') {
      const smgpParams = new URLSearchParams({
        bbox,
        bboxSR: '2180',
        imageSR: '2180',
        size: `${width},${height}`,
        dpi: '229',
        layers: 'show:1,2,3,4,5',
        format: 'png32',
        transparent: 'true',
        f: 'image',
      });
      targetUrl = `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/export?${smgpParams.toString()}`;
    } else {
      const baseUrl =
        layer === 'orto'
          ? 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution'
          : 'https://mapy.geoportal.gov.pl/wss/service/img/guest/TOPO/MapServer/WMSServer';
      const wmsParams = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetMap',
        LAYERS: 'Raster',
        STYLES: '',
        SRS: 'EPSG:2180',
        BBOX: bbox,
        WIDTH: String(width),
        HEIGHT: String(height),
        FORMAT: 'image/png',
      });
      targetUrl = `${baseUrl}?${wmsParams.toString()}`;
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const upstream = await fetch(targetUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(18_000),
        });
        const contentType = upstream.headers.get('content-type') ?? '';
        if (!upstream.ok || !contentType.startsWith('image/')) {
          if (attempt === 2) {
            res.status(502).json({
              error: 'Serwer map nie zwrócił poprawnego obrazu. Spróbuj ponownie.',
            });
            return;
          }
          continue;
        }

        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(buf);
        return;
      } catch {
        if (attempt === 2) {
          res.status(504).json({
            error: 'Przekroczono limit czasu odpowiedzi serwera map.',
          });
          return;
        }
      }
    }
  });

  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`PRO GEO server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
