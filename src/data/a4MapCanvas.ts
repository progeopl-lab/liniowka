import type { SmgpMapMeta, SopoCitationMeta } from './terrainTypes';

export interface TopoA4RenderOptions {
  headerLabel: string;
  bottomLayer: 'topo' | 'orto';
  lat: number;
  lon: number;
}

export interface SopoA4RenderOptions {
  headerLabel: string;
  basemapLayer: 'topo' | 'orto';
  sopoScale: 10000 | 25000;
  lat: number;
  lon: number;
  sopoMeta?: SopoCitationMeta | null;
}

export interface A4WhiteMaskRect {
  id: string;
  x: number; // normalized 0..1 of A4_WIDTH
  y: number; // normalized 0..1 of A4_HEIGHT
  w: number; // normalized 0..1 of A4_WIDTH
  h: number; // normalized 0..1 of A4_HEIGHT
}

export interface SmgpA4RenderOptions {
  headerLabel: string;
  smgpMeta: SmgpMapMeta | null;
  crossSectionImageUrl?: string | null;
  customMapImageUrl?: string | null;
  legendCol1ImageUrl?: string | null;
  legendCol2ImageUrl?: string | null;
  authorsImageUrl?: string | null;
  markerXPercent?: number;
  markerYPercent?: number;
  selectedSectionSymbol?: string | null;
  arrowPercent: number; // 0..100 along the cross-section width
  layoutOrder?: 'cross-below-map' | 'cross-at-bottom';
  sheetPxPerMm?: number | null;
  crossTargetScale?: 'auto-100k' | 'fit' | 'original-50k';
  crossScaleOverride?: string | null;
  crossHeaderMaskPercent?: number;
  whiteMasks?: A4WhiteMaskRect[];
}

const A4_WIDTH = 2100; // 210 mm @ 254 DPI (10 px = 1 mm)
const A4_HEIGHT = 2970; // 297 mm @ 254 DPI (10 px = 1 mm)

/**
 * Formats full names ("Krzysztof Karwacki, Edyta Rycio") into PIG-PIB bibliography style
 * ("Karwacki K., Rycio E.") when simple "First Last" pairs are provided.
 */
export function formatPibAuthors(raw: string | null | undefined): string {
  if (!raw) return 'Państwowy Instytut Geologiczny – PIB';
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((person) => {
      const tokens = person.split(/\s+/);
      if (tokens.length === 2 && /^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(tokens[0]) && /^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(tokens[1])) {
        return `${tokens[1]} ${tokens[0][0]}.`;
      }
      return person;
    })
    .join(', ');
}

export function formatAccessDatePl(date = new Date()): string {
  const months = [
    'stycznia',
    'lutego',
    'marca',
    'kwietnia',
    'maja',
    'czerwca',
    'lipca',
    'sierpnia',
    'września',
    'października',
    'listopada',
    'grudnia',
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} r.`;
}

export function buildPibSopoCitation(meta: SopoCitationMeta | null | undefined): {
  primaryCitation: string;
  statutoryNotice: string;
  technicalNote: string;
} {
  const accessDate = formatAccessDatePl();
  const statutoryNotice =
    'Dane pochodzą z zasobów witryny internetowej Projektu SOPO prowadzonej przez Państwowy Instytut Geologiczny – Państwowy Instytut Badawczy (PIG-PIB).';

  if (meta && meta.mappedCommune && meta.commune) {
    const authors = formatPibAuthors(meta.author);
    const year = meta.mappingYear || 'b.d.';
    const adminParts = [
      `gm. ${meta.commune}`,
      meta.county ? `pow. ${meta.county.replace(/^powiat\s+/i, '')}` : null,
      meta.voivodeship ? `woj. ${meta.voivodeship}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    const primaryCitation = `${authors}, ${year} – Mapa osuwisk i terenów zagrożonych ruchami masowymi w skali 1:10 000, ${adminParts}. https://mapa.osuwiska.pgi.gov.pl [dostęp: ${accessDate}].`;

    const techParts = [
      meta.fieldCurrency ? `Aktualność terenowa SOPO: ${meta.fieldCurrency}` : null,
      meta.coordinator ? `koordynator: ${meta.coordinator}` : null,
      'podkład topograficzny: GUGiK (Geoportal)',
    ].filter(Boolean);

    return {
      primaryCitation,
      statutoryNotice,
      technicalNote: `${techParts.join('; ')}.`,
    };
  }

  const areaParts = [
    meta?.commune ? `gm. ${meta.commune}` : null,
    meta?.county ? `pow. ${meta.county.replace(/^powiat\s+/i, '')}` : null,
    meta?.voivodeship ? `woj. ${meta.voivodeship}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const primaryCitation = `Państwowy Instytut Geologiczny – Państwowy Instytut Badawczy (PIG-PIB) – Mapa osuwisk i terenów zagrożonych ruchami masowymi (baza SOPO)${areaParts ? `, ${areaParts}` : ''}. https://mapa.osuwiska.pgi.gov.pl [dostęp: ${accessDate}].`;

  return {
    primaryCitation,
    statutoryNotice,
    technicalNote: 'Podkład topograficzny: GUGiK (Geoportal).',
  };
}

function drawLocationMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  fillHex: string,
  radius = 15
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fillHex;
  ctx.fill();
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.restore();
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();

  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0F172A';
  ctx.stroke();

  // Left half (solid black)
  ctx.beginPath();
  ctx.moveTo(cx, cy - 29);
  ctx.lineTo(cx - 13, cy + 11);
  ctx.lineTo(cx, cy + 3);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();

  // Right half (white with black outline)
  ctx.beginPath();
  ctx.moveTo(cx, cy - 29);
  ctx.lineTo(cx + 13, cy + 11);
  ctx.lineTo(cx, cy + 3);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy - 29);
  ctx.lineTo(cx - 13, cy + 11);
  ctx.lineTo(cx, cy + 3);
  ctx.stroke();

  ctx.font = 'bold 25px Arial, "Liberation Sans", sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', cx, cy + 13);

  ctx.restore();
}

function drawTopoMapBlock(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  caption: string
) {
  ctx.drawImage(img, x, y, w, h);

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(x, y, w, h);

  drawNorthArrow(ctx, x + w - 72, y + 72);

  const markerRadius = 15;
  drawLocationMarker(ctx, x + w / 2, y + h / 2, '#EF1D1D', markerRadius);

  const centerX = x + w / 2;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 42px Arial, "Liberation Sans", sans-serif';
  ctx.fillText(caption, centerX, y + h + 28);

  const legendFont = '38px Arial, "Liberation Sans", sans-serif';
  const legendBoldFont = 'bold 38px Arial, "Liberation Sans", sans-serif';
  const prefixText = 'Objaśnienia:';
  const suffixText = ' - lokalizacja terenu badań';
  const symbolGapLeft = 26;
  const symbolGapRight = 14;
  const symbolDiameter = markerRadius * 2;

  ctx.font = legendBoldFont;
  const prefixWidth = ctx.measureText(prefixText).width;
  ctx.font = legendFont;
  const suffixWidth = ctx.measureText(suffixText).width;

  const totalLegendWidth =
    prefixWidth + symbolGapLeft + symbolDiameter + symbolGapRight + suffixWidth;
  const startX = centerX - totalLegendWidth / 2;
  const legendBaselineY = y + h + 92;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = legendBoldFont;
  ctx.fillText(prefixText, startX, legendBaselineY);

  const symbolCx = startX + prefixWidth + symbolGapLeft + markerRadius;
  drawLocationMarker(ctx, symbolCx, legendBaselineY, '#EF1D1D', markerRadius);

  ctx.font = legendFont;
  ctx.fillText(suffixText, symbolCx + markerRadius + symbolGapRight, legendBaselineY);
}

function drawLegendSwatchBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline?: string,
  dashed = false
) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2.5;
    if (dashed) ctx.setLineDash([7, 5]);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function drawTzrmSwatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x, y, w, h);

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.strokeStyle = '#686868';
  ctx.lineWidth = 2.8;
  for (let offset = -h; offset < w + h; offset += 10) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + h);
    ctx.lineTo(x + offset + h, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.4;
  ctx.setLineDash([7, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawSopoLegendAndCitation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  citation: ReturnType<typeof buildPibSopoCitation>
) {
  const legendH = 305;
  ctx.save();
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(x, y, w, legendH);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, legendH);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 34px Arial, "Liberation Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Objaśnienia (legenda SOPO):', x + 26, y + 22);

  const colW = (w - 52) / 3;
  const startY = y + 84;
  const rowStep = 68;
  const swatchW = 46;
  const swatchH = 30;

  const items: Array<{ label: string; draw: (sx: number, sy: number) => void }> = [
    {
      label: 'lokalizacja terenu badań',
      draw: (sx, sy) =>
        drawLocationMarker(ctx, sx + swatchW / 2, sy + swatchH / 2, '#0066FF', 13),
    },
    {
      label: 'osuwisko aktywne ciągle',
      draw: (sx, sy) => drawLegendSwatchBox(ctx, sx, sy, swatchW, swatchH, '#FF3333', '#CC0000'),
    },
    {
      label: 'osuwisko aktywne okresowo',
      draw: (sx, sy) => drawLegendSwatchBox(ctx, sx, sy, swatchW, swatchH, '#FFB3B3', '#CC0000'),
    },
    {
      label: 'osuwisko nieaktywne',
      draw: (sx, sy) => drawLegendSwatchBox(ctx, sx, sy, swatchW, swatchH, '#BFBFBF', '#CC0000'),
    },
    {
      label: 'teren zagrożony (TZRM)',
      draw: (sx, sy) => drawTzrmSwatch(ctx, sx, sy, swatchW, swatchH),
    },
    {
      label: 'granica osuwiska pewna',
      draw: (sx, sy) => {
        ctx.save();
        ctx.strokeStyle = '#CC0000';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy + swatchH / 2);
        ctx.lineTo(sx + swatchW, sy + swatchH / 2);
        ctx.stroke();
        ctx.restore();
      },
    },
    {
      label: 'granica przypuszczalna',
      draw: (sx, sy) => {
        ctx.save();
        ctx.strokeStyle = '#CC0000';
        ctx.lineWidth = 4.5;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(sx, sy + swatchH / 2);
        ctx.lineTo(sx + swatchW, sy + swatchH / 2);
        ctx.stroke();
        ctx.restore();
      },
    },
    {
      label: 'skarpa główna / wtórna',
      draw: (sx, sy) => {
        ctx.save();
        ctx.strokeStyle = '#CC0000';
        ctx.fillStyle = '#CC0000';
        ctx.lineWidth = 3.2;
        const midY = sy + swatchH / 2 - 4;
        ctx.beginPath();
        ctx.moveTo(sx, midY);
        ctx.lineTo(sx + swatchW, midY);
        ctx.stroke();
        for (const tx of [sx + 10, sx + 23, sx + 36]) {
          ctx.beginPath();
          ctx.moveTo(tx - 5, midY);
          ctx.lineTo(tx + 5, midY);
          ctx.lineTo(tx, midY + 12);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      },
    },
    {
      label: 'podmokłość / źródło, wysięk',
      draw: (sx, sy) => {
        drawLegendSwatchBox(ctx, sx, sy + 2, 22, 26, '#0080FF', '#005CE6');
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx + 36, sy + swatchH / 2, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#0070FF';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#003C9E';
        ctx.stroke();
        ctx.restore();
      },
    },
  ];

  ctx.font = '31px Arial, "Liberation Sans", sans-serif';
  ctx.textBaseline = 'middle';
  items.forEach((item, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const ix = x + 26 + col * colW;
    const iy = startY + row * rowStep;
    item.draw(ix, iy);
    ctx.fillStyle = '#0F172A';
    ctx.fillText(item.label, ix + swatchW + 14, iy + swatchH / 2);
  });

  ctx.restore();

  // Official PIG-PIB Citation block below legend
  const citeY = y + legendH + 34;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = 'bold 31px Arial, "Liberation Sans", sans-serif';
  ctx.fillText('Źródło danych i cytowanie (zgodnie z zasadami PIG-PIB):', x, citeY);

  let cursorY = citeY + 44;
  cursorY = drawWrappedText(
    ctx,
    citation.primaryCitation,
    x,
    cursorY,
    w,
    40,
    '30px Arial, "Liberation Sans", sans-serif',
    '#0F172A'
  );
  cursorY += 8;
  cursorY = drawWrappedText(
    ctx,
    citation.statutoryNotice,
    x,
    cursorY,
    w,
    38,
    'italic 29px Arial, "Liberation Sans", sans-serif',
    '#1E293B'
  );
  cursorY += 8;
  drawWrappedText(
    ctx,
    citation.technicalNote,
    x,
    cursorY,
    w,
    36,
    '27px Arial, "Liberation Sans", sans-serif',
    '#475569'
  );

  ctx.restore();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: string,
  color: string
): number {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const words = text.split(/\s+/);
  let line = '';
  let curY = y;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      curY += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }

  ctx.restore();
  return curY;
}

export async function loadImageFromApi(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url);
  if (!res.ok) {
    let errMsg = 'Nie udało się pobrać wycinka mapy z serwera.';
    try {
      const json = await res.json();
      if (json?.error) errMsg = json.error;
    } catch {
      // ignore JSON parse error
    }
    throw new Error(errMsg);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Nie udało się wczytać obrazu mapy.'));
    };
    img.src = objUrl;
  });
}

export async function renderTopoA4SheetCanvas(
  options: TopoA4RenderOptions
): Promise<HTMLCanvasElement> {
  const { lat, lon, headerLabel, bottomLayer } = options;

  const map50kUrl = `/api/wms-map?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}&scale=50000&layer=topo&frame=standard`;
  const map10kUrl = `/api/wms-map?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}&scale=10000&layer=${bottomLayer}&frame=standard`;

  const [img50k, img10k] = await Promise.all([
    loadImageFromApi(map50kUrl),
    loadImageFromApi(map10kUrl),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = A4_WIDTH;
  canvas.height = A4_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Przeglądarka nie obsługuje renderowania Canvas 2D.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  const mapX = 200; // 20 mm left margin
  const mapW = 1700; // 170 mm width
  const mapH = 1000; // 100 mm height

  // Top-right corner: ZAŁ.1 (Arial, 26 pt, bold)
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 91.73px Arial, "Liberation Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(headerLabel.trim() || 'ZAŁ.1', mapX + mapW, 135);

  drawTopoMapBlock(ctx, img50k, mapX, 285, mapW, mapH, 'Mapa topograficzna w skali 1:50 000');

  const bottomCaption =
    bottomLayer === 'orto'
      ? 'Ortofotomapa w skali 1:10 000'
      : 'Mapa topograficzna w skali 1:10 000';
  drawTopoMapBlock(ctx, img10k, mapX, 1525, mapW, mapH, bottomCaption);

  return canvas;
}

export async function renderSopoA4SheetCanvas(
  options: SopoA4RenderOptions
): Promise<HTMLCanvasElement> {
  const { lat, lon, headerLabel, basemapLayer, sopoScale, sopoMeta } = options;

  const baseUrl = `/api/wms-map?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}&scale=${sopoScale}&layer=${basemapLayer}&frame=sopo-single`;
  const sopoUrl = `/api/wms-map?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}&scale=${sopoScale}&layer=sopo&frame=sopo-single`;

  const [baseImg, sopoImg] = await Promise.all([
    loadImageFromApi(baseUrl),
    loadImageFromApi(sopoUrl),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = A4_WIDTH;
  canvas.height = A4_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Przeglądarka nie obsługuje renderowania Canvas 2D.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  const mapX = 200; // 20 mm left margin
  const mapY = 250; // starts below top-right label
  const mapW = 1700; // 170 mm width
  const mapH = 1500; // 150 mm height (170 x 150 mm)

  // Top-right corner: ZAŁ.2 (Arial, 26 pt, bold)
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 91.73px Arial, "Liberation Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(headerLabel.trim() || 'ZAŁ.2', mapX + mapW, 120);

  // Single large SOPO map: basemap + transparent PIG-PIB SOPO overlay
  ctx.drawImage(baseImg, mapX, mapY, mapW, mapH);

  ctx.save();
  ctx.globalAlpha = 0.76;
  ctx.drawImage(sopoImg, mapX, mapY, mapW, mapH);
  ctx.restore();

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // North arrow in top-right inside map
  drawNorthArrow(ctx, mapX + mapW - 72, mapY + 72);

  // Blue dot with black outline at exact center of the map
  drawLocationMarker(ctx, mapX + mapW / 2, mapY + mapH / 2, '#0066FF', 16);

  // Map caption centered under map frame
  const scaleLabel = sopoScale === 25000 ? '1:25 000' : '1:10 000';
  const caption = `Mapa osuwisk i terenów zagrożonych ruchami masowymi (SOPO) w skali ${scaleLabel}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 40px Arial, "Liberation Sans", sans-serif';
  ctx.fillText(caption, mapX + mapW / 2, mapY + mapH + 28);

  // Full SOPO legend + PIG-PIB citation below map
  const citation = buildPibSopoCitation(sopoMeta);
  drawSopoLegendAndCitation(ctx, mapX, mapY + mapH + 98, mapW, citation);

  return canvas;
}

function loadImageFromSrc(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawSlimNorthArrow(ctx: CanvasRenderingContext2D, cx: number, bottomY: number) {
  ctx.save();
  const topY = bottomY - 175;
  const tailY = bottomY - 35;

  // Vertical shaft extending to base
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx, bottomY);
  ctx.stroke();

  // Left half of slim needle (solid black)
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx - 10, tailY);
  ctx.lineTo(cx, tailY - 18);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();

  // Right half of slim needle (white with black outline)
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx + 10, tailY);
  ctx.lineTo(cx, tailY - 18);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  ctx.font = 'bold 24px Arial, "Liberation Sans", sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', cx, topY - 6);
  ctx.restore();
}

function detectCrossSectionProfileBottomNorm(
  img: HTMLImageElement,
  arrowPercent: number
): number {
  const w = Math.min(800, Math.max(40, img.width));
  const h = Math.max(30, Math.round((img.height * w) / Math.max(1, img.width)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0.96;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const centerCol = Math.round((Math.max(0, Math.min(100, arrowPercent)) / 100) * (w - 1));
  const halfBand = Math.max(8, Math.round(w * 0.08));
  const x0 = Math.max(0, centerCol - halfBand);
  const x1 = Math.min(w - 1, centerCol + halfBand);
  const span = Math.max(1, x1 - x0 + 1);

  const rowHasProfile = (y: number): boolean => {
    let active = 0;
    for (let x = x0; x <= x1; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (luma < 228 || chroma > 16) active++;
    }
    return active / span >= 0.3;
  };

  for (let y = h - 1; y >= Math.floor(h * 0.3); y--) {
    if (rowHasProfile(y) && (y === 0 || rowHasProfile(y - 1))) {
      return Math.max(0.4, Math.min(1, (y + 1) / h));
    }
  }
  return 0.95;
}

function drawBottomProjectionArrow(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  minX: number,
  maxX: number
) {
  ctx.save();
  // Upward yellow triangle with black outline pointing directly below the colored profile edge
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - 12, tipY + 19);
  ctx.lineTo(tipX + 12, tipY + 19);
  ctx.closePath();
  ctx.fillStyle = '#FFE600';
  ctx.fill();
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  // Short vertical shaft below arrowhead
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY + 19);
  ctx.lineTo(tipX, tipY + 35);
  ctx.stroke();

  // Compact two-line centered label underneath arrow, clamped inside printable margins
  const line1 = 'rzut lokalizacji';
  const line2 = 'na przekrój geologiczny';
  ctx.font = 'bold 23px Arial, "Liberation Sans", sans-serif';
  const halfW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) / 2 + 8;
  const labelX = Math.max(minX + halfW, Math.min(maxX - halfW, tipX));

  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(line1, labelX, tipY + 40);
  ctx.fillText(line2, labelX, tipY + 66);
  ctx.restore();
}

function drawRightAlignedWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  rightX: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: string,
  color: string
): number {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';

  const words = text.split(/\s+/);
  let line = '';
  let curY = y;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, rightX, curY);
      curY += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    ctx.fillText(line, rightX, curY);
    curY += lineHeight;
  }

  ctx.restore();
  return curY;
}

export async function renderSmgpA4SheetCanvas(
  options: SmgpA4RenderOptions
): Promise<HTMLCanvasElement> {
  const {
    headerLabel,
    smgpMeta,
    crossSectionImageUrl,
    customMapImageUrl,
    legendCol1ImageUrl,
    legendCol2ImageUrl,
    authorsImageUrl,
    markerXPercent = 50,
    markerYPercent = 50,
    selectedSectionSymbol,
    arrowPercent,
    layoutOrder = 'cross-below-map',
    sheetPxPerMm = null,
    crossTargetScale = 'auto-100k',
    crossScaleOverride = null,
    crossHeaderMaskPercent = 0,
    whiteMasks = [],
  } = options;

  const [
    customMapImg,
    crossImg,
    legendImg1,
    legendImg2,
    authorsImg,
    swatchImgs,
  ] = await Promise.all([
    customMapImageUrl ? loadImageFromSrc(customMapImageUrl) : Promise.resolve(null),
    crossSectionImageUrl ? loadImageFromSrc(crossSectionImageUrl) : Promise.resolve(null),
    legendCol1ImageUrl ? loadImageFromSrc(legendCol1ImageUrl) : Promise.resolve(null),
    legendCol2ImageUrl ? loadImageFromSrc(legendCol2ImageUrl) : Promise.resolve(null),
    authorsImageUrl ? loadImageFromSrc(authorsImageUrl) : Promise.resolve(null),
    Promise.all(
      (smgpMeta?.legendUnits ?? []).slice(0, 18).map((u) =>
        u.swatchDataUrl ? loadImageFromSrc(u.swatchDataUrl) : Promise.resolve(null)
      )
    ),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = A4_WIDTH;
  canvas.height = A4_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Przeglądarka nie obsługuje renderowania Canvas 2D.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  const pageX = 130; // 13 mm left margin
  const pageW = 1840; // 184 mm content width
  const rightEdge = pageX + pageW; // 1970

  // 1. TOP BLOCK: Compact SMGP raster cutout on top-left + North arrow + ZAŁ.3 / Title / Authors on top-right
  const mapMaxW = 1320;
  const mapMaxH = 570;
  const mapX = pageX;
  const mapY = 105;

  let drawnMapW = mapMaxW;
  let drawnMapH = mapMaxH;

  if (customMapImg) {
    const scale = Math.min(mapMaxW / customMapImg.width, mapMaxH / customMapImg.height);
    drawnMapW = Math.round(customMapImg.width * scale);
    drawnMapH = Math.round(customMapImg.height * scale);
    ctx.drawImage(customMapImg, mapX, mapY, drawnMapW, drawnMapH);
  } else {
    ctx.save();
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(mapX, mapY, drawnMapW, drawnMapH);
    ctx.fillStyle = '#475569';
    ctx.font = '26px Arial, "Liberation Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `Arkusz nr ${smgpMeta?.sheetNumber ?? '—'} — wgraj raster JPG/PNG i wskaż ramkę mapy`,
      mapX + drawnMapW / 2,
      mapY + drawnMapH / 2
    );
    ctx.restore();
  }

  // Crisp black outline hugging the map cutout
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(mapX, mapY, drawnMapW, drawnMapH);

  // Slim vertical North arrow right next to the map's bottom-right edge
  drawSlimNorthArrow(ctx, mapX + drawnMapW + 34, mapY + drawnMapH);

  // Yellow circle with black outline (#FFE600 + #000000)
  const mx = customMapImg
    ? mapX + (Math.max(0, Math.min(100, markerXPercent)) / 100) * drawnMapW
    : mapX + drawnMapW / 2;
  const my = customMapImg
    ? mapY + (Math.max(0, Math.min(100, markerYPercent)) / 100) * drawnMapH
    : mapY + drawnMapH / 2;
  drawLocationMarker(ctx, mx, my, '#FFE600', 14);

  // Top-right metadata column (ZAŁ.3 + MAPA GEOLOGICZNA 1:50 000 + Arkusz + Authors)
  const metaMaxW = Math.max(360, rightEdge - (mapX + drawnMapW + 64));
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 91.73px Arial, "Liberation Sans", sans-serif';
  ctx.fillText(headerLabel.trim() || 'ZAŁ.3', rightEdge, 95);

  ctx.font = 'bold 38px Arial, "Liberation Sans", sans-serif';
  ctx.fillText('MAPA GEOLOGICZNA', rightEdge, 208);

  ctx.font = 'bold 28px Arial, "Liberation Sans", sans-serif';
  ctx.fillText('Skala: 1:50 000', rightEdge, 255);

  let metaCursorY = 315;
  if (authorsImg) {
    const availH = Math.max(120, mapY + drawnMapH - metaCursorY);
    const sc = Math.min(metaMaxW / authorsImg.width, availH / authorsImg.height);
    const dw = authorsImg.width * sc;
    const dh = authorsImg.height * sc;
    ctx.drawImage(authorsImg, rightEdge - dw, metaCursorY, dw, dh);
  } else {
    metaCursorY = drawRightAlignedWrappedText(
      ctx,
      'Wycinek szczegółowej mapy geologicznej Polski',
      rightEdge,
      metaCursorY,
      metaMaxW,
      32,
      '25px Arial, "Liberation Sans", sans-serif',
      '#0F172A'
    );
    const sheetLine = smgpMeta?.sheetNumber
      ? `arkusz ${smgpMeta.sheetName ?? ''} (${smgpMeta.sheetNumber})`.trim()
      : 'arkusz SMGP PIG-PIB';
    metaCursorY = drawRightAlignedWrappedText(
      ctx,
      sheetLine,
      rightEdge,
      metaCursorY + 4,
      metaMaxW,
      32,
      'bold 25px Arial, "Liberation Sans", sans-serif',
      '#0F172A'
    );

    const yearText = smgpMeta?.mapYear ? `, ${smgpMeta.mapYear}` : '';
    const authText = smgpMeta?.mapAuthors
      ? `Opracował: ${smgpMeta.mapAuthors}${yearText}`
      : `Źródło: PIG-PIB (${formatAccessDatePl()})`;
    drawRightAlignedWrappedText(
      ctx,
      authText,
      rightEdge,
      metaCursorY + 8,
      metaMaxW,
      30,
      '23px Arial, "Liberation Sans", sans-serif',
      '#1E293B'
    );
  }

  const topBlockBottom = Math.max(mapY + drawnMapH, 675);

  const activeSection =
    smgpMeta?.crossSections.find((c) => c.symbol === selectedSectionSymbol) ??
    smgpMeta?.crossSections[0] ??
    null;
  const resolvedSectionSymbol = selectedSectionSymbol?.trim() || activeSection?.symbol || '';
  const units = (smgpMeta?.legendUnits ?? []).slice(0, 18);

  const formatScaleDenom = (denom: number): string =>
    `1:${Math.max(1000, Math.round(denom / 1000) * 1000)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

  const drawCrossSectionBlock = (startY: number, maxImgH: number): number => {
    const titleGap = 46;
    const imgTopY = startY + titleGap;
    let drawnW = pageW;
    let drawnX = pageX;
    let drawnH = 250;
    let computedScaleText = crossScaleOverride?.trim() || '1:100 000';

    if (crossImg) {
      const fitScale = Math.min(pageW / crossImg.width, maxImgH / crossImg.height);
      let sc = fitScale;
      if (sheetPxPerMm && sheetPxPerMm > 0) {
        if (crossTargetScale === 'original-50k') {
          sc = Math.min(fitScale, 10 / sheetPxPerMm);
        } else if (crossTargetScale === 'auto-100k') {
          const sc100k = 5 / sheetPxPerMm; // exact 1:100 000 on 10 px/mm A4 canvas
          sc = Math.min(fitScale, sc100k);
        }
        if (!crossScaleOverride?.trim()) {
          const realDenom = 500000 / (sc * sheetPxPerMm);
          computedScaleText = formatScaleDenom(realDenom);
        }
      } else if (!crossScaleOverride?.trim()) {
        computedScaleText = '1:100 000 (dopasowana)';
      }

      drawnW = crossImg.width * sc;
      drawnH = crossImg.height * sc;
      drawnX = pageX + (pageW - drawnW) / 2;
      ctx.drawImage(crossImg, drawnX, imgTopY, drawnW, drawnH);
    } else {
      ctx.save();
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(pageX, imgTopY, pageW, drawnH);
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 2;
      ctx.strokeRect(pageX, imgTopY, pageW, drawnH);

      const lineY = imgTopY + drawnH * 0.5;
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(pageX + 90, lineY);
      ctx.lineTo(pageX + pageW - 90, lineY);
      ctx.stroke();

      const endLabels = resolvedSectionSymbol
        ? resolvedSectionSymbol.split(/[-–]/).map((s) => s.trim())
        : ['A', 'B'];
      ctx.font = 'bold 30px Arial, "Liberation Sans", sans-serif';
      ctx.fillStyle = '#0F172A';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText(endLabels[0] || 'A', pageX + 74, lineY);
      ctx.textAlign = 'left';
      ctx.fillText(endLabels[1] || 'B', pageX + pageW - 74, lineY);

      ctx.font = '24px Arial, "Liberation Sans", sans-serif';
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Wytnij przekrój geologiczny z dolnej obramówki arkusza SMGP JPG/PNG (lub wklej Ctrl+V)',
        pageX + pageW / 2,
        lineY + 56
      );
      ctx.restore();
      drawnX = pageX + 90;
      drawnW = pageW - 180;
    }

    // White opaque overlay ("nakładka") covering original SMGP title/scale above profile if requested
    const clampedMaskPct = Math.max(0, Math.min(40, crossHeaderMaskPercent));
    const maskH = crossImg && clampedMaskPct > 0 ? drawnH * (clampedMaskPct / 100) : 0;
    if (maskH > 0) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(drawnX - 4, imgTopY - 4, drawnW + 8, maskH + 4);
    }

    // Draw clean corrected title centered above visible geological profile (overlapping masked zone cleanly)
    const secSym = resolvedSectionSymbol ? ` ${resolvedSectionSymbol}` : '';
    const secTitle = `PRZEKRÓJ GEOLOGICZNY${secSym}, skala ${computedScaleText}`;
    const titleY = maskH >= 38 ? Math.max(startY, imgTopY + maskH - 42) : startY;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 30px Arial, "Liberation Sans", sans-serif';
    ctx.fillText(secTitle, pageX + pageW / 2, titleY);

    const clampedPct = Math.max(0, Math.min(100, arrowPercent));
    const arrowX = drawnX + (clampedPct / 100) * drawnW;

    // Short vertical dashed projection line across lower profile, stopping right at the colored strata baseline
    const profileBotFrac = crossImg
      ? detectCrossSectionProfileBottomNorm(crossImg, clampedPct)
      : 0.72;
    const profileBotY = imgTopY + drawnH * profileBotFrac;
    const dashTopY = Math.min(profileBotY - 24, imgTopY + Math.max(maskH + 8, drawnH * 0.45));
    const dashBotY = profileBotY + 3;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(arrowX, dashTopY);
    ctx.lineTo(arrowX, dashBotY);
    ctx.stroke();
    ctx.restore();

    // Upward arrow right next to the colored cross-section bottom edge + label underneath
    const arrowTipY = profileBotY + 5;
    drawBottomProjectionArrow(ctx, arrowX, arrowTipY, pageX, rightEdge);

    return Math.max(imgTopY + drawnH, arrowTipY + 96);
  };

  const drawLegendBlock = (startY: number, maxBlockH: number): number => {
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 33px Arial, "Liberation Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Objaśnienia:', pageX, startY);

    const headerOffset = 50;
    const bodyY = startY + headerOffset;
    const maxBodyH = Math.max(260, maxBlockH - headerOffset);
    let bodyBottomY = bodyY + 60;

    if (legendImg1 || legendImg2) {
      const colGap = 36;
      if (legendImg1 && legendImg2) {
        // One single shared scale factor guarantees identical legend boxes & font sizes across left & right columns
        const totalAvailW = pageW - colGap;
        const sharedSc = Math.min(
          totalAvailW / (legendImg1.width + legendImg2.width),
          maxBodyH / Math.max(legendImg1.height, legendImg2.height)
        );
        const dw1 = legendImg1.width * sharedSc;
        const dh1 = legendImg1.height * sharedSc;
        const dw2 = legendImg2.width * sharedSc;
        const dh2 = legendImg2.height * sharedSc;
        const col2X = pageX + dw1 + colGap;
        ctx.drawImage(legendImg1, pageX, bodyY, dw1, dh1);
        ctx.drawImage(legendImg2, col2X, bodyY, dw2, dh2);
        bodyBottomY = bodyY + Math.max(dh1, dh2);
      } else {
        // Single legend column: expand cleanly up to full page width & full available height
        const singleImg = legendImg1 ?? legendImg2!;
        const sc = Math.min(pageW / singleImg.width, maxBodyH / singleImg.height);
        const dw = singleImg.width * sc;
        const dh = singleImg.height * sc;
        ctx.drawImage(singleImg, pageX, bodyY, dw, dh);
        bodyBottomY = bodyY + dh;
      }
    } else if (units.length > 0) {
      const colGap = 48;
      const colW = (pageW - colGap) / 2;
      const rows = Math.ceil(units.length / 2);
      const rowH = Math.min(96, Math.max(72, Math.floor(maxBodyH / rows)));
      const swatchW = 54;
      const swatchH = 34;

      for (let i = 0; i < units.length; i++) {
        const col = Math.floor(i / rows);
        const row = i % rows;
        const ix = pageX + col * (colW + colGap);
        const iy = bodyY + row * rowH;

        const unit = units[i];
        const swImg = swatchImgs[i];

        ctx.save();
        ctx.fillStyle = '#F1F5F9';
        ctx.fillRect(ix, iy + 4, swatchW, swatchH);
        if (swImg) {
          const pat = ctx.createPattern(swImg, 'repeat');
          if (pat) {
            ctx.fillStyle = pat;
            ctx.fillRect(ix, iy + 4, swatchW, swatchH);
          } else {
            ctx.drawImage(swImg, ix, iy + 4, swatchW, swatchH);
          }
        }
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 2;
        ctx.strokeRect(ix, iy + 4, swatchW, swatchH);
        ctx.restore();

        const textX = ix + swatchW + 16;
        const textMaxW = colW - swatchW - 20;
        const labelLine = unit.stratigraphy ? `${unit.unit} (${unit.stratigraphy})` : unit.unit;
        drawWrappedText(
          ctx,
          labelLine,
          textX,
          iy,
          textMaxW,
          30,
          '25px Arial, "Liberation Sans", sans-serif',
          '#0F172A'
        );
      }
      bodyBottomY = bodyY + rows * rowH;
    } else {
      ctx.font = '25px Arial, "Liberation Sans", sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(
        'Wytnij jedną lub dwie kolumny legendy z pliku JPG/PNG arkusza SMGP powyżej.',
        pageX,
        bodyY
      );
      bodyBottomY = bodyY + 52;
    }

    return bodyBottomY;
  };

  const drawLokalizacjaRow = (rowY: number): number => {
    drawLocationMarker(ctx, pageX + 20, rowY + 18, '#FFE600', 14);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 33px Arial, "Liberation Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('- lokalizacja inwestycji', pageX + 48, rowY + 19);
    return rowY + 46;
  };

  const bottomMargin = 80;
  const markerBlockReserve = 68; // 22px gap below legend + 46px marker row

  if (layoutOrder === 'cross-at-bottom') {
    const maxCrossImgH = 410;
    let estCrossImgH = 250;
    if (crossImg) {
      const fitScale = Math.min(pageW / crossImg.width, maxCrossImgH / crossImg.height);
      let sc = fitScale;
      if (sheetPxPerMm && sheetPxPerMm > 0) {
        if (crossTargetScale === 'original-50k') sc = Math.min(fitScale, 10 / sheetPxPerMm);
        else if (crossTargetScale === 'auto-100k') sc = Math.min(fitScale, 5 / sheetPxPerMm);
      }
      estCrossImgH = crossImg.height * sc;
    }
    const estCrossTotalH = 46 + estCrossImgH + 104; // title + image + bottom arrow & 2-line label
    const legendStartY = topBlockBottom + 24;
    const maxLegendBlockH = Math.max(
      420,
      A4_HEIGHT - bottomMargin - estCrossTotalH - 28 - markerBlockReserve - legendStartY
    );
    const legendBottom = drawLegendBlock(legendStartY, maxLegendBlockH);
    const markerEnd = drawLokalizacjaRow(legendBottom + 22);
    drawCrossSectionBlock(markerEnd + 28, maxCrossImgH);
  } else {
    // Default order: Map top -> Cross-section below map -> Legend -> Yellow circle "- lokalizacja inwestycji" right below legend
    const crossBottom = drawCrossSectionBlock(topBlockBottom + 28, 430);
    const legendStartY = crossBottom + 28;
    const maxLegendBlockH = Math.max(
      420,
      A4_HEIGHT - bottomMargin - markerBlockReserve - legendStartY
    );
    const legendBottom = drawLegendBlock(legendStartY, maxLegendBlockH);
    drawLokalizacjaRow(legendBottom + 22);
  }

  // User-drawn white artifact-masking rectangles on the A4 page
  if (whiteMasks && whiteMasks.length > 0) {
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    for (const mask of whiteMasks) {
      ctx.fillRect(
        mask.x * A4_WIDTH,
        mask.y * A4_HEIGHT,
        mask.w * A4_WIDTH,
        mask.h * A4_HEIGHT
      );
    }
    ctx.restore();
  }

  return canvas;
}
