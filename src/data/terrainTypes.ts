import { Pl1992Coords, Pl2000Coords, Wgs84Point, formatCoordMetersPl, formatDmsPl } from './polishCoords';

export interface SpatialHit {
  name: string;
  category: string;
  code?: string;
  detail?: string;
  inside: boolean;
  distanceM: number;
  /** Direction from the point TO the object (e.g. "na zachód") */
  directionToObject: string;
  /** Direction from the object TO the point (e.g. "na wschód od ...") */
  directionFromObject: string;
}

export interface MiningHit {
  kind: 'OG' | 'TG' | 'Zloze';
  name: string;
  registryNo?: string;
  mineral?: string;
  validUntil?: string;
  authority?: string;
  inside: boolean;
  distanceM: number;
  directionToObject: string;
}

export interface SopoLandslideDetails {
  approxLengthM?: number;
  approxWidthM?: number;
  axisOrientation?: string;
  elevMaxM?: number;
  elevMinM?: number;
  reliefM?: number;
  pointElevM?: number;
  avgSlopeDeg?: number;
  activityZones?: Array<{ activity: string; areaHa: number; sharePct: number }>;
  boundaryTypes?: string[];
  mainScarps?: string[];
  secondaryScarps?: string[];
  toes?: string[];
  trenches?: string[];
  accumulationRidges?: string[];
  cracks?: string[];
  springsAndSeeps?: string[];
  wetlandsAndPonds?: string[];
  debrisAreas?: string[];
  depressions?: string[];
}

export interface SopoHit {
  kind: 'osuwisko' | 'tzrm';
  number: string;
  activity?: string;
  pointActivityZone?: string;
  areaHa?: number;
  areaM2?: number;
  perimeterM?: number;
  cardVersion?: string;
  filledDate?: string;
  establishedDate?: string;
  details?: SopoLandslideDetails;
  inside: boolean;
  distanceM: number;
  directionToObject: string;
}

export interface NearbyFeature {
  kind: 'road' | 'rail' | 'water';
  name: string;
  ref?: string;
  distanceM: number;
  /** e.g. "na wschód" meaning the terrain lies east of the object */
  terrainDirectionFromObject: string;
  /** e.g. "na zachód" meaning the object lies west of the terrain */
  objectDirectionFromTerrain: string;
}

export interface SopoCitationMeta {
  mappedCommune: boolean | null;
  commune: string | null;
  county: string | null;
  voivodeship: string | null;
  mappingYear: string | null;
  fieldCurrency: string | null;
  author: string | null;
  coordinator: string | null;
}

export interface SmgpLegendUnit {
  code: string;
  unit: string;
  stratigraphy: string | null;
  genesis: string | null;
  swatchDataUrl: string | null;
}

export interface SmgpCrossSectionInfo {
  symbol: string;
  name: string;
  lengthM: number;
  distanceM: number;
  projectionPercent: number;
  pathsWgs84?: Array<Array<{ lat: number; lon: number }>>;
}

export interface SmgpMapMeta {
  sheetNumber: string | null;
  sheetName: string | null;
  mapAuthors: string | null;
  mapYear: string | null;
  mapPrintYear: string | null;
  textAuthors: string | null;
  textPrintYear: string | null;
  portalAvailable: boolean;
  scanUrl?: string | null;
  savedScanUrl?: string | null;
  sheetNotes?: string | null;
  sheetBounds?: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  } | null;
  pointInSheetPercent?: {
    uPercent: number;
    vPercentFromTop: number;
  } | null;
  legendUnits: SmgpLegendUnit[];
  crossSections: SmgpCrossSectionInfo[];
}

export type GeologyDescriptionSource =
  | 'smgp-vector'
  | 'scan-and-pig'
  | 'mgp-500k-fallback';

export interface GeologyDescriptionResponse {
  description: string;
  sourceMode: GeologyDescriptionSource;
  sheetNumber: string | null;
  sheetName: string | null;
  portalAvailable: boolean;
  warning?: string;
}

export interface SmgpSharedAssets {
  mapImageUrl: string | null;
  markerXPercent: number;
  markerYPercent: number;
  legendCol1ImageUrl: string | null;
  legendCol2ImageUrl: string | null;
  crossSectionImageUrl: string | null;
  portalAvailable: boolean | null;
}

export type MgpBoard = 'A' | 'B';

export interface MgpEditionInfo {
  edition: 'III' | 'II' | 'I';
  sheetNumber: string;
  sheetName: string | null;
  godlo: string | null;
  yearA: string | null;
  yearB: string | null;
  authorsA: string | null;
  authorsB: string | null;
  coordSystemLabel: string;
  sheetBounds: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  } | null;
  pointInSheetPercent: {
    uPercent: number;
    vPercentFromTop: number;
  } | null;
}

export interface MgpMapMeta {
  sheetNumber: string | null;
  sheetName: string | null;
  godlo: string | null;
  editions: MgpEditionInfo[];
  activeEdition: 'III' | 'II' | 'I' | null;
  authorsA: string | null;
  authorsB: string | null;
  yearA: string | null;
  yearB: string | null;
  resourceUrl: string | null;
  emgspUrl: string;
  savedScanUrlA: string | null;
  savedScanUrlB: string | null;
  sheetBounds: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  } | null;
  pointInSheetPercent: {
    uPercent: number;
    vPercentFromTop: number;
  } | null;
}

export interface TerrainReportResponse {
  coords: {
    wgs84: Wgs84Point;
    pl1992: Pl1992Coords;
    pl2000: Pl2000Coords;
  };
  admin: {
    voivodeship: string | null;
    county: string | null;
    commune: string | null;
    precinct: string | null;
    parcelNo: string | null;
    parcelId: string | null;
    locality: string | null;
    error?: string;
  };
  geography: {
    prowincja: string | null;
    podprowincja: string | null;
    makroregion: string | null;
    mezoregion: string | null;
    mezoregionCode: string | null;
    error?: string;
  };
  nearbyInfrastructure: {
    roadsAndRail: NearbyFeature[];
    communeOffice?: {
      name: string;
      distanceM: number;
      /** e.g. "na wschód" meaning the terrain lies east of the office */
      terrainDirectionFromObject: string;
      /** e.g. "na zachód" meaning the office lies west of the terrain */
      objectDirectionFromTerrain: string;
    } | null;
    error?: string;
  };
  protectedAreas: {
    inside: SpatialHit[];
    nearest: SpatialHit[];
    error?: string;
  };
  mining: {
    inside: MiningHit[];
    nearest: MiningHit[];
    error?: string;
  };
  sopo: {
    mappedCommune: boolean | null;
    mappingYear: string | null;
    fieldCurrency: string | null;
    author?: string | null;
    coordinator?: string | null;
    insideLandslide: SopoHit[];
    insideTzrm: SopoHit[];
    nearestLandslides: SopoHit[];
    nearestTzrm: SopoHit[];
    error?: string;
  };
  hydro: {
    nearestWaterways: NearbyFeature[];
    jcwpd: {
      number: string;
      euCode: string;
      basin: string;
      waterRegion: string;
      status: string;
      risk: string;
    } | null;
    gzwp: {
      inside: boolean;
      name: string | null;
      number: string | null;
      nearestName: string | null;
      nearestNumber: string | null;
      nearestDistanceM: number | null;
      nearestDirection: string | null;
    };
    error?: string;
  };
  smgp: {
    sheetNumber: string | null;
    sheetName: string | null;
    mapAuthors: string | null;
    mapYear: string | null;
    mapPrintYear: string | null;
    textAuthors: string | null;
    textPrintYear: string | null;
    error?: string;
  };
}

export function formatDistancePl(meters: number): string {
  if (meters <= 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

/** Rounds distance to full tens of meters (e.g. 43 m -> 40 m, 2146 m -> 2,15 km). */
export function formatDistanceRounded10Pl(meters: number): string {
  if (meters <= 0) return '0 m';
  const rounded = Math.max(10, Math.round(meters / 10) * 10);
  if (rounded < 1000) return `${rounded} m`;
  return `${(rounded / 1000).toFixed(2).replace('.', ',')} km`;
}

/** Converts Polish municipal office name to genitive case after "od" (e.g. "Urząd Gminy Grybów" -> "Urzędu Gminy Grybów"). */
export function toGenitiveOfficeNamePl(name: string): string {
  const trimmed = name.trim();
  if (/^Urząd\s+Miejski\b/i.test(trimmed)) {
    return trimmed.replace(/^Urząd\s+Miejski\b/i, 'Urzędu Miejskiego');
  }
  if (/^Urząd\s+Miasta\s+i\s+Gminy\b/i.test(trimmed)) {
    return trimmed.replace(/^Urząd\s+Miasta\s+i\s+Gminy\b/i, 'Urzędu Miasta i Gminy');
  }
  if (/^Urząd\s+Miasta\b/i.test(trimmed)) {
    return trimmed.replace(/^Urząd\s+Miasta\b/i, 'Urzędu Miasta');
  }
  if (/^Urząd\s+Gminy\b/i.test(trimmed)) {
    return trimmed.replace(/^Urząd\s+Gminy\b/i, 'Urzędu Gminy');
  }
  if (/^Urząd\b/i.test(trimmed)) {
    return trimmed.replace(/^Urząd\b/i, 'Urzędu');
  }
  return trimmed;
}

export const PRG_DOC_TYPE = 'projekt robót geologicznych';

export const DEFAULT_PRG_GOAL =
  'określenie głębokości zalegania podłoża nośnego i ustalenie jego parametru wiodącego – w zależności od rodzaju i stanu podłoża wytrzymałości na ściskanie lub ścinanie';

export const PRG_LEGAL_BASIS =
  'Projekt robót geologicznych sporządzono na podstawie Rozporządzenia Ministra Środowiska z dn. 20 grudnia 2011 r. w sprawie szczegółowych wymagań dotyczących projektów robót geologicznych, w tym robót, których wykonywanie wymaga uzyskania koncesji (Dz.U. 2023, poz.155).';

export interface PrgProjectInfo {
  investorNameLine1: string;
  investorNameLine2: string;
  investorAddressLine1: string;
  investorAddressLine2: string;
  taskName: string;
  goal?: string;
}

export function joinInvestorLines(info?: PrgProjectInfo | null): string {
  if (!info) return '';
  const name1 = info.investorNameLine1.trim().replace(/,+\s*$/, '');
  const name2 = info.investorNameLine2.trim().replace(/,+\s*$/, '');
  const addr1 = info.investorAddressLine1.trim().replace(/,+\s*$/, '');
  const addr2 = info.investorAddressLine2.trim().replace(/,+\s*$/, '');

  const namePart = [name1, name2].filter(Boolean).join(' ');
  const addrPart = [addr1, addr2].filter(Boolean).join(', ');
  return [namePart, addrPart].filter(Boolean).join(', ');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPrgChapter1PlainText(projectInfo?: PrgProjectInfo | null): string {
  const investorStr = joinInvestorLines(projectInfo) || '—';
  const taskStr = projectInfo?.taskName?.trim() || '—';
  const goalStr = projectInfo?.goal?.trim() || DEFAULT_PRG_GOAL;

  return [
    '1. Informacje ogólne',
    `• typ opracowania: ${PRG_DOC_TYPE}`,
    `• zadanie: ${taskStr}`,
    `• cel: ${goalStr}`,
    `• inwestor: ${investorStr}`,
    PRG_LEGAL_BASIS,
  ].join('\n');
}

export function buildPrgChapter1Html(projectInfo?: PrgProjectInfo | null): string {
  const investorStr = joinInvestorLines(projectInfo) || '—';
  const taskStr = projectInfo?.taskName?.trim() || '—';
  const goalStr = projectInfo?.goal?.trim() || DEFAULT_PRG_GOAL;

  return [
    `<div style="font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.35; color: #000000;">`,
    `<p style="margin: 0 0 4pt 0; font-weight: bold;">1. Informacje ogólne</p>`,
    `<ul style="margin: 0 0 6pt 18pt; padding: 0;">`,
    `<li style="margin: 0 0 2pt 0;">typ opracowania: ${escapeHtml(PRG_DOC_TYPE)}</li>`,
    `<li style="margin: 0 0 2pt 0;">zadanie: ${escapeHtml(taskStr)}</li>`,
    `<li style="margin: 0 0 2pt 0;">cel: ${escapeHtml(goalStr)}</li>`,
    `<li style="margin: 0 0 2pt 0;">inwestor: ${escapeHtml(investorStr)}</li>`,
    `</ul>`,
    `<p style="margin: 0;">${escapeHtml(PRG_LEGAL_BASIS)}</p>`,
    `</div>`,
  ].join('');
}

const POLISH_MALE_NAMES_ENDING_IN_A = new Set([
  'kuba',
  'barnaba',
  'kosma',
  'bonawentura',
  'dyzma',
  'jarema',
]);

function formatSingleAuthorWithInitials(
  entry: string,
  order: 'surname-first' | 'given-first'
): string {
  const tokens = entry.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return entry.trim();

  // Already starts with initial(s) like "Z. Paul" or "J. A. Kowalski"
  if (/^[A-ZĄĆĘŁŃÓŚŹŻ]\.$/.test(tokens[0])) {
    return tokens.join(' ');
  }

  if (order === 'surname-first') {
    // e.g. "Paul Zbigniew", "Chrząstowski J.", "Radwanek-Bąk Barbara"
    const last = tokens[tokens.length - 1];
    const surname = tokens.slice(0, -1).join(' ');
    const initial = `${last[0].toUpperCase()}.`;
    return `${initial} ${surname}`;
  }

  // given-first, e.g. "Izabela Laskowicz", "Barbara Radwanek-Bąk"
  const first = tokens[0];
  const surname = tokens.slice(1).join(' ');
  const initial = `${first[0].toUpperCase()}.`;
  return `${initial} ${surname}`;
}

export function formatAuthorsWithInitials(
  raw: string,
  order: 'surname-first' | 'given-first'
): string {
  const entries = raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return raw.trim();
  return entries.map((e) => formatSingleAuthorWithInitials(e, order)).join(', ');
}

export function getOpracowalVerb(
  raw: string,
  order: 'surname-first' | 'given-first'
): 'opracował' | 'opracowała' | 'opracowali' {
  const entries = raw
    .split(/[,;]|(?:\s+i\s+)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length > 1) return 'opracowali';
  if (entries.length === 0) return 'opracował';

  const tokens = entries[0].split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const givenToken = order === 'surname-first' ? tokens[tokens.length - 1] : tokens[0];
    const surnameToken = order === 'surname-first' ? tokens[0] : tokens[tokens.length - 1];
    const givenLower = givenToken.toLowerCase();
    if (!givenToken.endsWith('.') && givenToken.length > 2) {
      if (givenLower.endsWith('a') && !POLISH_MALE_NAMES_ENDING_IN_A.has(givenLower)) {
        return 'opracowała';
      }
      return 'opracował';
    }
    const surnameLower = surnameToken.toLowerCase();
    if (/(ska|cka|dzka|owa|ewa|yna|ina)$/.test(surnameLower)) {
      return 'opracowała';
    }
  }
  return 'opracował';
}

export function buildPrgChapter1_1Items(
  report: TerrainReportResponse,
  mgpMeta?: MgpMapMeta | null
): string[] {
  // 2. SMGP 1:50 000 line
  let smgpItem = 'szczegółowej mapy geologicznej Polski w skali 1:50000 arkusz <uzupełnij>';
  if (report.smgp.sheetNumber || report.smgp.sheetName) {
    const sheetPart = [report.smgp.sheetNumber, report.smgp.sheetName].filter(Boolean).join(' ');
    const smgpYear = report.smgp.mapYear || report.smgp.mapPrintYear;
    if (report.smgp.mapAuthors) {
      const verb = getOpracowalVerb(report.smgp.mapAuthors, 'surname-first');
      const authorsFmt = formatAuthorsWithInitials(report.smgp.mapAuthors, 'surname-first');
      const authorMeta = [authorsFmt, smgpYear].filter(Boolean).join(', ');
      smgpItem = `szczegółowej mapy geologicznej Polski w skali 1:50000 arkusz ${sheetPart} (${verb}: ${authorMeta})`;
    } else if (smgpYear) {
      smgpItem = `szczegółowej mapy geologicznej Polski w skali 1:50000 arkusz ${sheetPart} (${smgpYear})`;
    } else {
      smgpItem = `szczegółowej mapy geologicznej Polski w skali 1:50000 arkusz ${sheetPart}`;
    }
  }

  // 3. MGśP 1:50 000 line (Plansza A & Plansza B)
  let mgpItem =
    'mapy geośrodowiskowej arkusz <uzupełnij> w skali 1:50000, plansza A (<uzupełnij>) i plansza B (<uzupełnij>)';
  if (mgpMeta && (mgpMeta.godlo || mgpMeta.sheetName || mgpMeta.sheetNumber)) {
    const sheetCode = mgpMeta.godlo || (mgpMeta.sheetNumber ? `nr ${mgpMeta.sheetNumber}` : '');
    const nameParens = mgpMeta.sheetName ? ` (${mgpMeta.sheetName})` : '';
    const sheetRef = `${sheetCode}${nameParens}`.trim();

    const formatBoardCitation = (authors: string | null, year: string | null): string => {
      if (authors) {
        const verb = getOpracowalVerb(authors, 'given-first');
        const authorsFmt = formatAuthorsWithInitials(authors, 'given-first');
        const inner = [authorsFmt, year].filter(Boolean).join(', ');
        return `${verb}: ${inner}`;
      }
      return year ?? '<uzupełnij>';
    };

    const citA = formatBoardCitation(mgpMeta.authorsA, mgpMeta.yearA);
    const citB = formatBoardCitation(mgpMeta.authorsB, mgpMeta.yearB);
    mgpItem = `mapy geośrodowiskowej arkusz ${sheetRef} w skali 1:50000, plansza A (${citA}) i plansza B (${citB})`;
  }

  return [
    'map topograficznych w skali 1:50000 i 1:10000',
    smgpItem,
    mgpItem,
    'mapy do celów projektowych w skali <wpisz skalę>',
    'obowiązujących norm i przepisów',
    'literatury fachowej',
    '<uzupełnij>',
    '<uzupełnij>',
  ];
}

export function buildPrgChapter2_1Items(projectInfo?: PrgProjectInfo | null): string[] {
  const investorStr = joinInvestorLines(projectInfo);
  return [
    'numery działek na których będą prowadzone roboty geologiczne: <uzupełnij>',
    'właściciel działki: <uzupełnij>',
    `inwestor: ${investorStr || '<uzupełnij>'}`,
    'użytkowanie terenu: <uzupełnij>',
  ];
}

export const PRG_CHAPTER_2_5_ITEMS: readonly string[] = [
  'położenie: <uzupełnij>',
  'różnica wysokości w miejscu inwestycji wynosi około <uzupełnij> m',
  'średni spadek terenu w miejscu inwestycji ok. <uzupełnij> %',
];

export interface PrgChapter2_6Content {
  protectedIntro: string;
  protectedInsideItems: string[];
  protectedNearestItems: string[];
  miningIntro: string;
  miningInsideItems: string[];
  miningNearestItems: string[];
}

export function buildPrgChapter2_6Content(report: TerrainReportResponse): PrgChapter2_6Content {
  let protectedIntro: string;
  let protectedInsideItems: string[] = [];

  if (report.protectedAreas.error) {
    protectedIntro = report.protectedAreas.error;
  } else if (report.protectedAreas.inside.length === 1) {
    protectedIntro = 'Teren projektowanych robót położony jest w granicach obszaru chronionego:';
    protectedInsideItems = report.protectedAreas.inside.map(
      (a) => `${a.category} – ${a.name}${a.code ? ` (${a.code})` : ''}`
    );
  } else if (report.protectedAreas.inside.length > 1) {
    protectedIntro = 'Teren projektowanych robót położony jest w granicach obszarów chronionych:';
    protectedInsideItems = report.protectedAreas.inside.map(
      (a) => `${a.category} – ${a.name}${a.code ? ` (${a.code})` : ''}`
    );
  } else {
    protectedIntro = 'Teren projektowanych robót położony jest poza obszarami chronionymi (GDOŚ).';
  }

  const protectedNearestItems = report.protectedAreas.nearest.map(
    (a) =>
      `${a.category} – ${a.name}${a.code ? ` (${a.code})` : ''} – ok. ${formatDistanceRounded10Pl(a.distanceM)} ${a.directionToObject}`
  );

  let miningIntro: string;
  let miningInsideItems: string[] = [];

  if (report.mining.error) {
    miningIntro = report.mining.error;
  } else if (report.mining.inside.length === 1) {
    const m = report.mining.inside[0];
    const kindGenitive =
      m.kind === 'OG'
        ? 'obszaru górniczego'
        : m.kind === 'TG'
          ? 'terenu górniczego'
          : 'udokumentowanego złoża';
    const extras = [
      m.registryNo ? `nr rej. ${m.registryNo}` : null,
      m.mineral ? `kopalina: ${m.mineral.toLowerCase()}` : null,
      m.validUntil ? `ważny do ${m.validUntil}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    miningIntro = `Teren projektowanych robót położony jest w granicach ${kindGenitive}:`;
    miningInsideItems = [`${m.name}${extras ? ` (${extras})` : ''}`];
  } else if (report.mining.inside.length > 1) {
    const allOg = report.mining.inside.every((m) => m.kind === 'OG');
    const allTg = report.mining.inside.every((m) => m.kind === 'TG');
    const allZloze = report.mining.inside.every((m) => m.kind === 'Zloze');
    const pluralLabel = allOg
      ? 'obszarów górniczych'
      : allTg
        ? 'terenów górniczych'
        : allZloze
          ? 'udokumentowanych złóż kopalin'
          : 'obszarów i terenów górniczych';
    miningIntro = `Teren projektowanych robót położony jest w granicach ${pluralLabel}:`;
    miningInsideItems = report.mining.inside.map((m) => {
      const label =
        m.kind === 'OG'
          ? 'obszar górniczy'
          : m.kind === 'TG'
            ? 'teren górniczy'
            : 'udokumentowane złoże';
      const extras = [
        m.registryNo ? `nr rej. ${m.registryNo}` : null,
        m.mineral ? `kopalina: ${m.mineral.toLowerCase()}` : null,
        m.validUntil ? `ważny do ${m.validUntil}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `${label} ${m.name}${extras ? ` (${extras})` : ''}`;
    });
  } else {
    miningIntro =
      'Teren projektowanych robót położony jest poza obszarami górniczymi, terenami górniczymi oraz udokumentowanymi złożami kopalin (MIDAS).';
  }

  const miningNearestItems = report.mining.nearest.map((m) => {
    const label =
      m.kind === 'OG'
        ? 'obszar górniczy'
        : m.kind === 'TG'
          ? 'teren górniczy'
          : 'udokumentowane złoże';
    return `${label} ${m.name}${m.mineral ? ` (${m.mineral.toLowerCase()})` : ''} – ok. ${formatDistanceRounded10Pl(m.distanceM)} ${m.directionToObject}`;
  });

  return {
    protectedIntro,
    protectedInsideItems,
    protectedNearestItems,
    miningIntro,
    miningInsideItems,
    miningNearestItems,
  };
}

function formatHtmlWithPlaceholders(text: string): string {
  return escapeHtml(text).replace(
    /&lt;(uzupełnij|wpisz skalę|sprawdzić)&gt;/g,
    '<em style="font-weight: normal;">&lt;$1&gt;</em>'
  );
}

export function buildTerrainReportHtml(
  report: TerrainReportResponse,
  projectInfo?: PrgProjectInfo | null,
  mgpMeta?: MgpMapMeta | null,
  geologyDescription?: string | null
): string {
  const plain = buildTerrainReportPlainText(report, projectInfo, mgpMeta, geologyDescription);
  const lines = plain.split('\n');
  const htmlParts: string[] = [
    `<div style="font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.35; color: #000000;">`,
  ];

  let inBulletList = false;
  for (const line of lines) {
    if (line.startsWith('• ')) {
      if (!inBulletList) {
        htmlParts.push(`<ul style="margin: 0 0 6pt 18pt; padding: 0;">`);
        inBulletList = true;
      }
      htmlParts.push(
        `<li style="margin: 0 0 2pt 0;">${formatHtmlWithPlaceholders(line.slice(2))}</li>`
      );
      continue;
    }

    if (inBulletList) {
      htmlParts.push(`</ul>`);
      inBulletList = false;
    }

    if (line.trim() === '') {
      htmlParts.push(`<p style="margin: 0 0 6pt 0;">&nbsp;</p>`);
    } else if (
      /^\d+(?:\.\d+)*\.\s/.test(line) ||
      line === 'PROJEKT ROBÓT GEOLOGICZNYCH' ||
      line === 'Położenie administracyjne' ||
      line === 'Położenie geograficzne' ||
      line === 'Odległości od najbliższych ulic, dróg, linii kolejowych i cieków wodnych' ||
      line === 'Obszary chronione i górnicze' ||
      line === 'Osuwiska i tereny zagrożone ruchami masowymi (SOPO)' ||
      line === 'Najbliższy ciek wodny, JCWPd i GZWP' ||
      line === 'Arkusz SMGP 1:50 000'
    ) {
      htmlParts.push(
        `<p style="margin: 6pt 0 3pt 0; font-weight: bold;">${formatHtmlWithPlaceholders(line)}</p>`
      );
    } else if (line.startsWith('Inwestor: ')) {
      htmlParts.push(
        `<p style="margin: 0 0 3pt 0;"><strong>Inwestor:</strong> ${escapeHtml(line.slice('Inwestor: '.length))}</p>`
      );
    } else {
      htmlParts.push(`<p style="margin: 0 0 2pt 0;">${formatHtmlWithPlaceholders(line)}</p>`);
    }
  }

  if (inBulletList) {
    htmlParts.push(`</ul>`);
  }
  htmlParts.push(`</div>`);
  return htmlParts.join('');
}

/**
 * Generates clean Polish plain text for the Geological Works Project (PRG),
 * starting with Investor + Chapter 1 ("1. Informacje ogólne") + 1.1 followed by sections 2–8,
 * ready to paste directly into Word / geological reports.
 */
export function buildTerrainReportPlainText(
  report: TerrainReportResponse,
  projectInfo?: PrgProjectInfo | null,
  mgpMeta?: MgpMapMeta | null,
  geologyDescription?: string | null
): string {
  const { wgs84, pl1992, pl2000 } = report.coords;
  const dmsStr = `${formatDmsPl(wgs84.lat, 'N', 'S')} ${formatDmsPl(wgs84.lon, 'E', 'W')}`;
  const ddStr = `${wgs84.lat.toFixed(6).replace('.', ',')}° N, ${wgs84.lon.toFixed(6).replace('.', ',')}° E`;
  const investorStr = joinInvestorLines(projectInfo);

  const lines: string[] = [];

  lines.push('PROJEKT ROBÓT GEOLOGICZNYCH');
  if (investorStr) {
    lines.push(`Inwestor: ${investorStr}`);
  }
  lines.push('');

  // 1. Informacje ogólne
  lines.push(buildPrgChapter1PlainText(projectInfo));
  lines.push('');

  // 1.1. Materiały wykorzystane do opracowania
  lines.push('1.1. Materiały wykorzystane do opracowania');
  lines.push('Projekt wykonano na podstawie:');
  for (const item of buildPrgChapter1_1Items(report, mgpMeta)) {
    lines.push(`• ${item}`);
  }
  lines.push('');

  // 1.2. Opis techniczny inwestycji
  lines.push('1.2. Opis techniczny inwestycji');
  lines.push('<uzupełnij>');
  lines.push('');

  // 2. Informacje o terenie badań
  lines.push('2. Informacje o terenie badań');
  lines.push('2.1. Informacje ogólne');
  for (const item of buildPrgChapter2_1Items(projectInfo)) {
    lines.push(`• ${item}`);
  }
  lines.push('');

  // 2.2. Położenie administracyjne
  lines.push('2.2. Położenie administracyjne');
  if (report.admin.voivodeship || report.admin.commune) {
    const loc = report.admin.locality || report.admin.precinct || '—';
    const obreb =
      report.admin.precinct && report.admin.precinct !== loc
        ? ` (obręb ewidencyjny: ${report.admin.precinct})`
        : '';
    lines.push(`- miejscowość: ${loc}${obreb}`);
    if (report.admin.parcelNo) {
      lines.push(
        `- działka ewidencyjna: nr ${report.admin.parcelNo}${report.admin.parcelId ? ` (ID: ${report.admin.parcelId})` : ''}`
      );
    }
    lines.push(`- gmina: ${report.admin.commune ?? '—'}`);
    lines.push(`- powiat: ${(report.admin.county ?? '—').replace(/^powiat\s+/i, '')}`);
    lines.push(`- województwo: ${report.admin.voivodeship ?? '—'}`);
  } else {
    lines.push(`- ${report.admin.error ?? 'Brak danych z usługi GUGiK ULDK.'}`);
  }
  lines.push('');

  // 2.3. Położenie geograficzne
  lines.push('2.3. Położenie geograficzne');
  if (report.geography.mezoregion) {
    lines.push(`- prowincja: ${report.geography.prowincja ?? '—'}`);
    lines.push(`- podprowincja: ${report.geography.podprowincja ?? '—'}`);
    lines.push(`- makroregion: ${report.geography.makroregion ?? '—'}`);
    lines.push(
      `- mezoregion: ${report.geography.mezoregion}${report.geography.mezoregionCode ? ` (${report.geography.mezoregionCode})` : ''}`
    );
  } else {
    lines.push(`- ${report.geography.error ?? 'Brak danych z usługi mezoregionów GDOŚ.'}`);
  }
  lines.push('Współrzędne geograficzne:');
  lines.push(`- WGS-84 (stopnie): ${dmsStr}`);
  lines.push(`- WGS-84 (dziesiętne): ${ddStr}`);
  lines.push(
    `- PUWG 1992 (${pl1992.epsg}): X = ${formatCoordMetersPl(pl1992.x)}, Y = ${formatCoordMetersPl(pl1992.y)}`
  );
  lines.push(
    `- PUWG 2000 strefa ${pl2000.zone} (${pl2000.epsg}): X = ${formatCoordMetersPl(pl2000.x)}, Y = ${formatCoordMetersPl(pl2000.y)}`
  );
  lines.push('');

  // 2.4. Odległości od najbliższych ulic, dróg, linii kolejowych i cieków wodnych
  lines.push('2.4. Odległości od najbliższych ulic, dróg, linii kolejowych i cieków wodnych');
  lines.push('Teren badań położony jest:');
  if (report.nearbyInfrastructure.roadsAndRail.length > 0) {
    for (const item of report.nearbyInfrastructure.roadsAndRail) {
      const refSuffix = item.ref ? ` (${item.kind === 'rail' ? `nr ${item.ref}` : item.ref})` : '';
      const objectLabel =
        item.kind === 'road'
          ? `ulicy / drogi ${item.name}`
          : item.name.toLowerCase() === 'linia kolejowa'
            ? 'linii kolejowej'
            : item.name;
      lines.push(
        `- około ${formatDistanceRounded10Pl(item.distanceM)} ${item.terrainDirectionFromObject} od ${objectLabel}${refSuffix}`
      );
    }
  } else {
    lines.push(
      `- ${
        report.nearbyInfrastructure.error ??
        'nie znaleziono nazwanych ulic, dróg ani linii kolejowych w promieniu ok. 550 m'
      }`
    );
  }
  if (report.hydro.nearestWaterways.length > 0) {
    for (const w of report.hydro.nearestWaterways) {
      lines.push(
        `- około ${formatDistanceRounded10Pl(w.distanceM)} ${w.terrainDirectionFromObject} od cieku ${w.name}`
      );
    }
  } else {
    lines.push('- brak nazwanych cieków wodnych w promieniu ok. 550 m');
  }
  if (report.nearbyInfrastructure.communeOffice) {
    const office = report.nearbyInfrastructure.communeOffice;
    lines.push(
      `- około ${formatDistanceRounded10Pl(office.distanceM)} ${office.terrainDirectionFromObject} od ${toGenitiveOfficeNamePl(office.name)}`
    );
  }
  lines.push('');

  // 2.5. Morfologia
  lines.push('2.5. Morfologia');
  for (const item of PRG_CHAPTER_2_5_ITEMS) {
    lines.push(`• ${item}`);
  }
  lines.push('');

  // 2.6. Położenie terenu robót względem obiektów i obszarów chronionych
  lines.push('2.6. Położenie terenu robót względem obiektów i obszarów chronionych');
  const ch26 = buildPrgChapter2_6Content(report);
  lines.push(ch26.protectedIntro);
  for (const item of ch26.protectedInsideItems) {
    lines.push(`• ${item}`);
  }
  if (ch26.protectedNearestItems.length > 0) {
    lines.push('Najbliższe pozostałe obszary i obiekty chronione:');
    for (const item of ch26.protectedNearestItems) {
      lines.push(`• ${item}`);
    }
  }
  lines.push(ch26.miningIntro);
  for (const item of ch26.miningInsideItems) {
    lines.push(`• ${item}`);
  }
  if (ch26.miningNearestItems.length > 0) {
    lines.push('Najbliższe sąsiednie obiekty górnicze (MIDAS):');
    for (const item of ch26.miningNearestItems) {
      lines.push(`• ${item}`);
    }
  }
  lines.push('');

  // 3. Budowa geologiczna <sprawdzić>
  lines.push('3. Budowa geologiczna <sprawdzić>');
  const trimmedGeology = geologyDescription?.trim();
  if (trimmedGeology) {
    for (const pLine of trimmedGeology.split(/\r?\n/)) {
      const cleanLine = pLine.trim();
      if (cleanLine) lines.push(cleanLine);
    }
  } else {
    lines.push('<uzupełnij>');
  }
  lines.push('');

  // Osuwiska i TZRM (SOPO)
  lines.push('Osuwiska i tereny zagrożone ruchami masowymi (SOPO)');
  if (report.sopo.error) {
    lines.push(`- ${report.sopo.error}`);
  } else {
    if (report.sopo.mappedCommune === true) {
      const metaParts = [
        report.sopo.mappingYear ? `zakończenie prac: ${report.sopo.mappingYear}` : null,
        report.sopo.fieldCurrency ? `aktualność terenowa: ${report.sopo.fieldCurrency}` : null,
        report.sopo.author ? `autorzy: ${report.sopo.author}` : null,
        report.sopo.coordinator ? `koordynator: ${report.sopo.coordinator}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(`- gmina skartowana w SOPO${metaParts ? ` (${metaParts})` : ''}`);
    } else if (report.sopo.mappedCommune === false) {
      lines.push('- brak potwierdzenia pełnego kartowania SOPO dla tej gminy w warstwie stanu prac PIG-PIB');
    }

    if (report.sopo.insideLandslide.length > 0 || report.sopo.insideTzrm.length > 0) {
      for (const s of report.sopo.insideLandslide) {
        lines.push(`- UWAGA: punkt leży wewnątrz osuwiska SOPO nr ${s.number}`);
        if (s.activity) {
          lines.push(`- stopień aktywności całego osuwiska: ${s.activity}`);
        }
        if (s.pointActivityZone) {
          lines.push(`- strefa aktywności w miejscu punktu: ${s.pointActivityZone}`);
        }
        const d = s.details;
        if (d?.activityZones && d.activityZones.length > 0) {
          const zonesStr = d.activityZones
            .map(
              (z) =>
                `${z.activity}: ${z.areaHa.toFixed(2).replace('.', ',')} ha (${z.sharePct}%)`
            )
            .join('; ');
          lines.push(`- strefy aktywności w obrębie osuwiska: ${zonesStr}`);
        }
        if (s.areaHa !== undefined && s.areaM2 !== undefined) {
          lines.push(
            `- powierzchnia osuwiska: ${s.areaHa.toFixed(2).replace('.', ',')} ha (${Math.round(s.areaM2)} m²)`
          );
        }
        if (s.perimeterM !== undefined) {
          lines.push(`- obwód osuwiska: ${Math.round(s.perimeterM)} m`);
        }
        if (d?.approxLengthM !== undefined && d?.approxWidthM !== undefined) {
          lines.push(
            `- wymiary orientacyjne osuwiska (z geometrii SOPO): długość ok. ${d.approxLengthM} m, szerokość ok. ${d.approxWidthM} m${d.axisOrientation ? ` (rozciągłość ${d.axisOrientation})` : ''}`
          );
        }
        if (d?.elevMinM !== undefined && d?.elevMaxM !== undefined) {
          const reliefPart = d.reliefM !== undefined ? `, deniwelacja: ok. ${d.reliefM} m` : '';
          const slopePart =
            d.avgSlopeDeg !== undefined
              ? `, średnie nachylenie ok. ${d.avgSlopeDeg.toFixed(1).replace('.', ',')}°`
              : '';
          lines.push(
            `- rzędne terenu osuwiska (NMT GUGiK): od ${d.elevMinM} do ${d.elevMaxM} m n.p.m.${reliefPart}${slopePart}`
          );
        }
        if (d?.pointElevM !== undefined) {
          lines.push(`- rzędna terenu w punkcie inwestycji (NMT GUGiK): ok. ${d.pointElevM} m n.p.m.`);
        }
        if (d?.boundaryTypes && d.boundaryTypes.length > 0) {
          lines.push(`- rozpoznanie granic osuwiska: ${d.boundaryTypes.join('; ')}`);
        }
        if (d?.mainScarps && d.mainScarps.length > 0) {
          lines.push(`- skarpy główne: ${d.mainScarps.join('; ')}`);
        }
        if (d?.secondaryScarps && d.secondaryScarps.length > 0) {
          lines.push(`- skarpy wtórne: ${d.secondaryScarps.join('; ')}`);
        }
        if (d?.toes && d.toes.length > 0) {
          lines.push(`- czoła osuwiska: ${d.toes.join('; ')}`);
        }
        if (d?.trenches && d.trenches.length > 0) {
          lines.push(`- rowy osuwiskowe: ${d.trenches.join('; ')}`);
        }
        if (d?.accumulationRidges && d.accumulationRidges.length > 0) {
          lines.push(`- progi akumulacyjne: ${d.accumulationRidges.join('; ')}`);
        }
        if (d?.cracks && d.cracks.length > 0) {
          lines.push(`- szczeliny: ${d.cracks.join('; ')}`);
        }
        if (d?.springsAndSeeps && d.springsAndSeeps.length > 0) {
          lines.push(`- źródła i wysięki na osuwisku: ${d.springsAndSeeps.join('; ')}`);
        }
        if (d?.wetlandsAndPonds && d.wetlandsAndPonds.length > 0) {
          lines.push(`- zbiorniki i podmokłości: ${d.wetlandsAndPonds.join('; ')}`);
        }
        if (d?.debrisAreas && d.debrisAreas.length > 0) {
          lines.push(`- rumosze i blokowiska: ${d.debrisAreas.join('; ')}`);
        }
        if (d?.depressions && d.depressions.length > 0) {
          lines.push(`- zagłębienia wewnątrzosuwiskowe: ${d.depressions.join('; ')}`);
        }
        if (s.cardVersion) {
          lines.push(`- wersja karty rejestracyjnej: ${s.cardVersion}`);
        }
        if (s.filledDate) {
          lines.push(`- data wypełnienia karty: ${s.filledDate}`);
        }
        if (s.establishedDate) {
          lines.push(`- data ustalenia: ${s.establishedDate}`);
        }
      }
      for (const t of report.sopo.insideTzrm) {
        lines.push(
          `- UWAGA: punkt leży wewnątrz terenu zagrożonego ruchami masowymi (TZRM) nr ${t.number}`
        );
        if (t.areaHa !== undefined && t.areaM2 !== undefined) {
          lines.push(
            `- powierzchnia TZRM: ${t.areaHa.toFixed(2).replace('.', ',')} ha (${Math.round(t.areaM2)} m²)`
          );
        }
        if (t.perimeterM !== undefined) {
          lines.push(`- obwód TZRM: ${Math.round(t.perimeterM)} m`);
        }
        const td = t.details;
        if (td?.approxLengthM !== undefined && td?.approxWidthM !== undefined) {
          lines.push(
            `- wymiary orientacyjne TZRM (z geometrii SOPO): długość ok. ${td.approxLengthM} m, szerokość ok. ${td.approxWidthM} m${td.axisOrientation ? ` (rozciągłość ${td.axisOrientation})` : ''}`
          );
        }
        if (td?.elevMinM !== undefined && td?.elevMaxM !== undefined) {
          const reliefPart = td.reliefM !== undefined ? `, deniwelacja: ok. ${td.reliefM} m` : '';
          lines.push(
            `- rzędne terenu TZRM (NMT GUGiK): od ${td.elevMinM} do ${td.elevMaxM} m n.p.m.${reliefPart}`
          );
        }
        if (td?.pointElevM !== undefined) {
          lines.push(`- rzędna terenu w punkcie inwestycji (NMT GUGiK): ok. ${td.pointElevM} m n.p.m.`);
        }
        if (t.cardVersion) {
          lines.push(`- wersja karty TZRM: ${t.cardVersion}`);
        }
        if (t.filledDate) {
          lines.push(`- data wypełnienia karty TZRM: ${t.filledDate}`);
        }
        if (t.establishedDate) {
          lines.push(`- data ustalenia TZRM: ${t.establishedDate}`);
        }
      }
    } else {
      lines.push(
        '- wg mapy SOPO (PIG-PIB) punkt nie znajduje się w obrębie osuwiska ani terenu zagrożonego ruchami masowymi'
      );
    }

    if (report.sopo.nearestLandslides.length > 0) {
      lines.push('Najbliższe osuwiska SOPO:');
      for (const s of report.sopo.nearestLandslides) {
        lines.push(
          `- osuwisko nr ${s.number}${s.activity ? ` (${s.activity})` : ''} – ok. ${formatDistancePl(s.distanceM)} ${s.directionToObject}`
        );
      }
    } else {
      lines.push('- brak skartowanych osuwisk SOPO w promieniu 2 km');
    }

    if (report.sopo.nearestTzrm.length > 0) {
      lines.push('Najbliższe tereny zagrożone ruchami masowymi (TZRM):');
      for (const t of report.sopo.nearestTzrm) {
        lines.push(`- TZRM nr ${t.number} – ok. ${formatDistancePl(t.distanceM)} ${t.directionToObject}`);
      }
    } else {
      lines.push('- brak skartowanych terenów zagrożonych (TZRM) w promieniu 2 km');
    }
  }
  lines.push('');

  // Najbliższy ciek wodny, JCWPd i GZWP
  lines.push('Najbliższy ciek wodny, JCWPd i GZWP');
  if (report.hydro.nearestWaterways.length > 0) {
    lines.push('Najbliższe cieki wodne:');
    for (const w of report.hydro.nearestWaterways) {
      lines.push(`- ${w.name} – ok. ${formatDistancePl(w.distanceM)} ${w.objectDirectionFromTerrain}`);
    }
  } else {
    lines.push('- nie znaleziono nazwanych cieków wodnych w promieniu ok. 550 m');
  }

  if (report.hydro.jcwpd) {
    const j = report.hydro.jcwpd;
    lines.push(`- JCWPd: nr ${j.number} (kod UE: ${j.euCode})`);
    lines.push(`- dorzecze: ${j.basin}, region wodny: ${j.waterRegion}`);
    lines.push(`- stan ogólny: ${j.status}, ryzyko: ${j.risk}`);
  } else {
    lines.push('- brak danych JCWPd dla wskazanego punktu');
  }

  if (report.hydro.gzwp.inside) {
    lines.push(
      `- GZWP: punkt leży w granicach Głównego Zbiornika Wód Podziemnych nr ${report.hydro.gzwp.number ?? '—'} – ${report.hydro.gzwp.name ?? '—'}`
    );
  } else {
    lines.push('- GZWP: punkt leży poza granicami Głównych Zbiorników Wód Podziemnych');
    if (report.hydro.gzwp.nearestName && report.hydro.gzwp.nearestDistanceM !== null) {
      lines.push(
        `- najbliższy GZWP: nr ${report.hydro.gzwp.nearestNumber ?? '—'} – ${report.hydro.gzwp.nearestName} – ok. ${formatDistancePl(report.hydro.gzwp.nearestDistanceM)} ${report.hydro.gzwp.nearestDirection ?? ''}`
      );
    }
  }
  lines.push('');

  // Arkusz SMGP 1:50 000
  lines.push('Arkusz SMGP 1:50 000');
  if (report.smgp.sheetNumber || report.smgp.sheetName) {
    lines.push(
      `- arkusz: nr ${report.smgp.sheetNumber ?? '—'} – ${report.smgp.sheetName ?? '—'} (SMGP 1:50 000)`
    );
    if (report.smgp.mapAuthors) {
      const yearPart = [
        report.smgp.mapYear ? `oprac. ${report.smgp.mapYear}` : null,
        report.smgp.mapPrintYear ? `druk ${report.smgp.mapPrintYear}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(`- autorzy mapy: ${report.smgp.mapAuthors}${yearPart ? ` (${yearPart})` : ''}`);
    }
    if (report.smgp.textAuthors) {
      lines.push(
        `- autorzy objaśnień: ${report.smgp.textAuthors}${report.smgp.textPrintYear ? ` (druk ${report.smgp.textPrintYear})` : ''}`
      );
    }
  } else {
    lines.push(`- ${report.smgp.error ?? 'Brak danych o arkuszu SMGP 1:50 000.'}`);
  }

  return lines.join('\n');
}

