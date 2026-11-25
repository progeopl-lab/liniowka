import type { A4WhiteMaskRect } from './a4MapCanvas';
import { formatAccessDatePl } from './a4MapCanvas';
import type { MgpBoard, MgpEditionInfo, MgpMapMeta } from './terrainTypes';

export type A3Orientation = 'landscape' | 'portrait';

export interface MgpA3RenderOptions {
  board: MgpBoard;
  orientation: A3Orientation;
  headerLabel: string;
  mgpMeta: MgpMapMeta | null;
  activeEditionInfo: MgpEditionInfo | null;
  customMapImageUrl: string | null;
  legendImageUrl?: string | null;
  authorsImageUrl?: string | null;
  markerXPercent: number;
  markerYPercent: number;
  markerColor?: '#FFE600' | '#EF1D1D';
  mapWidthMm: number;
  mapHeightMm: number;
  whiteMasks?: A4WhiteMaskRect[];
}

export const A3_PX_PER_MM = 10; // 254 DPI print quality (10 px = 1 mm)
export const A3_LANDSCAPE_W = 4200; // 420 mm
export const A3_LANDSCAPE_H = 2970; // 297 mm
export const A3_PORTRAIT_W = 2970; // 297 mm
export const A3_PORTRAIT_H = 4200; // 420 mm

function loadImageFromSrc(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawLocationMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  fillHex: string,
  radius = 16
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

function drawSlimNorthArrow(ctx: CanvasRenderingContext2D, cx: number, bottomY: number) {
  ctx.save();
  const topY = bottomY - 190;
  const tailY = bottomY - 38;

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx, bottomY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx - 11, tailY);
  ctx.lineTo(cx, tailY - 20);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx + 11, tailY);
  ctx.lineTo(cx, tailY - 20);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  ctx.font = 'bold 26px Arial, "Liberation Sans", sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', cx, topY - 7);
  ctx.restore();
}

function drawCenteredWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: string,
  color: string
): number {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const words = text.split(/\s+/);
  let line = '';
  let curY = y;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, centerX, curY);
      curY += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    ctx.fillText(line, centerX, curY);
    curY += lineHeight;
  }

  ctx.restore();
  return curY;
}

function drawLeftWrappedText(
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

export async function renderMgpA3SheetCanvas(
  options: MgpA3RenderOptions
): Promise<HTMLCanvasElement> {
  const {
    board,
    orientation,
    headerLabel,
    mgpMeta,
    activeEditionInfo,
    customMapImageUrl,
    legendImageUrl,
    authorsImageUrl,
    markerXPercent = 50,
    markerYPercent = 50,
    markerColor = '#FFE600',
    mapWidthMm,
    mapHeightMm,
    whiteMasks = [],
  } = options;

  const pageWTotal = orientation === 'landscape' ? A3_LANDSCAPE_W : A3_PORTRAIT_W;
  const pageHTotal = orientation === 'landscape' ? A3_LANDSCAPE_H : A3_PORTRAIT_H;

  const [customMapImg, legendImg, authorsImg] = await Promise.all([
    customMapImageUrl ? loadImageFromSrc(customMapImageUrl) : Promise.resolve(null),
    legendImageUrl ? loadImageFromSrc(legendImageUrl) : Promise.resolve(null),
    authorsImageUrl ? loadImageFromSrc(authorsImageUrl) : Promise.resolve(null),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = pageWTotal;
  canvas.height = pageHTotal;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Przeglądarka nie obsługuje renderowania Canvas 2D.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, pageWTotal, pageHTotal);

  const marginX = 140; // 14 mm left/right margin
  const topMargin = 110; // 11 mm top margin
  const bottomMargin = 100; // 10 mm bottom margin
  const contentW = pageWTotal - marginX * 2;
  const rightEdge = pageWTotal - marginX;

  // Reserve clean right column for ZAŁ.X + single-column legend + yellow marker explanation
  const minRightColW = orientation === 'landscape' ? 960 : 760;
  const arrowAndColGapW = 104; // room for slim North arrow + gap to legend column
  const maxAllowedMapW = Math.max(900, contentW - minRightColW - arrowAndColGapW);
  const bottomCaptionReserve = 520; // room below map for centered map description + authors
  const maxAllowedMapH = Math.max(
    600,
    pageHTotal - topMargin - bottomMargin - bottomCaptionReserve
  );

  const targetMapW = Math.min(maxAllowedMapW, Math.max(500, Math.round(mapWidthMm * A3_PX_PER_MM)));
  const targetMapH = Math.min(maxAllowedMapH, Math.max(400, Math.round(mapHeightMm * A3_PX_PER_MM)));

  const mapX = marginX;
  const mapY = topMargin;
  let drawnMapW = targetMapW;
  let drawnMapH = targetMapH;

  if (customMapImg) {
    const scale = Math.min(targetMapW / customMapImg.width, targetMapH / customMapImg.height);
    drawnMapW = Math.round(customMapImg.width * scale);
    drawnMapH = Math.round(customMapImg.height * scale);
    ctx.drawImage(customMapImg, mapX, mapY, drawnMapW, drawnMapH);
  } else {
    ctx.save();
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(mapX, mapY, drawnMapW, drawnMapH);
    ctx.fillStyle = '#475569';
    ctx.font = '32px Arial, "Liberation Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `Arkusz MGśP nr ${mgpMeta?.sheetNumber ?? '—'} (Plansza ${board}) — wgraj raster JPG/PNG`,
      mapX + drawnMapW / 2,
      mapY + drawnMapH / 2
    );
    ctx.restore();
  }

  // Crisp black outline hugging the map cutout
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(mapX, mapY, drawnMapW, drawnMapH);

  // Slim vertical North arrow right next to the map's bottom-right edge
  drawSlimNorthArrow(ctx, mapX + drawnMapW + 38, mapY + drawnMapH);

  // Location marker inside the map cutout
  const mx = customMapImg
    ? mapX + (Math.max(0, Math.min(100, markerXPercent)) / 100) * drawnMapW
    : mapX + drawnMapW / 2;
  const my = customMapImg
    ? mapY + (Math.max(0, Math.min(100, markerYPercent)) / 100) * drawnMapH
    : mapY + drawnMapH / 2;
  drawLocationMarker(ctx, mx, my, markerColor, 16);

  // LEFT COLUMN BELOW MAP: Centered map description + centered Authors below it
  const mapCenterX = mapX + drawnMapW / 2;
  const descMaxW = Math.max(600, drawnMapW);
  let descY = mapY + drawnMapH + 38;

  descY = drawCenteredWrappedText(
    ctx,
    'MAPA GEOŚRODOWISKOWA POLSKI',
    mapCenterX,
    descY,
    descMaxW,
    46,
    'bold 40px Arial, "Liberation Sans", sans-serif',
    '#000000'
  );

  descY = drawCenteredWrappedText(
    ctx,
    `PLANSZA ${board} – Skala: 1:50 000`,
    mapCenterX,
    descY + 4,
    descMaxW,
    38,
    'bold 31px Arial, "Liberation Sans", sans-serif',
    '#000000'
  );

  const boardSubtitle =
    board === 'A'
      ? 'Kopaliny, wody, warunki podłoża budowlanego, ochrona przyrody i zabytków'
      : 'Zagrożenia powierzchni ziemi, geochemia, odpady i obszary predysponowane do składowania';
  descY = drawCenteredWrappedText(
    ctx,
    boardSubtitle,
    mapCenterX,
    descY + 4,
    descMaxW,
    30,
    'italic 24px Arial, "Liberation Sans", sans-serif',
    '#334155'
  );

  // Authors / Sheet citation centered directly beneath the map description
  const authorsStartY = descY + 18;
  const ed = activeEditionInfo;
  const sheetNo = ed?.sheetNumber ?? mgpMeta?.sheetNumber ?? null;
  const sheetName = ed?.sheetName ?? mgpMeta?.sheetName ?? null;
  const godlo = ed?.godlo ?? mgpMeta?.godlo ?? null;
  const authors =
    board === 'A' ? ed?.authorsA ?? mgpMeta?.authorsA : ed?.authorsB ?? mgpMeta?.authorsB;
  const year = board === 'A' ? ed?.yearA ?? mgpMeta?.yearA : ed?.yearB ?? mgpMeta?.yearB;
  const editionTag = ed?.edition ?? mgpMeta?.activeEdition ?? null;

  if (authorsImg) {
    const availAuthorsH = Math.max(120, pageHTotal - bottomMargin - authorsStartY);
    const availAuthorsW = Math.min(drawnMapW, Math.round(drawnMapW * 0.92));
    const sc = Math.min(availAuthorsW / authorsImg.width, availAuthorsH / authorsImg.height);
    const dw = authorsImg.width * sc;
    const dh = authorsImg.height * sc;
    ctx.drawImage(authorsImg, mapCenterX - dw / 2, authorsStartY, dw, dh);
  } else {
    let authY = authorsStartY;
    const sheetLine = sheetNo
      ? `Arkusz ${sheetName ?? ''} (nr ${sheetNo}${godlo ? `, ${godlo}` : ''})${
          editionTag ? ` · MGśP ${editionTag}` : ''
        }`.trim()
      : 'Arkusz MGśP 1:50 000 (PIG-PIB)';
    authY = drawCenteredWrappedText(
      ctx,
      sheetLine,
      mapCenterX,
      authY,
      descMaxW,
      34,
      'bold 26px Arial, "Liberation Sans", sans-serif',
      '#0F172A'
    );

    const yearStr = year ? `, ${year} r.` : '';
    const authText = authors
      ? `Opracowanie (Plansza ${board}): ${authors}${yearStr}`
      : `Źródło: Państwowy Instytut Geologiczny – PIB (${formatAccessDatePl()})`;
    drawCenteredWrappedText(
      ctx,
      authText,
      mapCenterX,
      authY + 4,
      descMaxW,
      32,
      '25px Arial, "Liberation Sans", sans-serif',
      '#1E293B'
    );
  }

  // RIGHT COLUMN: Attachment number (ZAŁ.4 / ZAŁ.5) -> Single-column Legend -> Yellow dot explanation
  const rightColX = mapX + drawnMapW + arrowAndColGapW;
  const rightColW = Math.max(460, rightEdge - rightColX);

  const defaultLabel = board === 'A' ? 'ZAŁ.4' : 'ZAŁ.5';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 91.73px Arial, "Liberation Sans", sans-serif'; // Arial 26 pt bold
  ctx.fillText(headerLabel.trim() || defaultLabel, rightEdge, topMargin - 10);

  const legendStartY = topMargin + 114;
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 33px Arial, "Liberation Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Objaśnienia:', rightColX, legendStartY);

  const legendBodyY = legendStartY + 48;
  const markerRowReserve = 82;
  const maxLegendBodyH = Math.max(
    260,
    pageHTotal - bottomMargin - markerRowReserve - legendBodyY
  );

  let legendBottomY = legendBodyY + 72;

  if (legendImg) {
    const sc = Math.min(rightColW / legendImg.width, maxLegendBodyH / legendImg.height);
    const dw = legendImg.width * sc;
    const dh = legendImg.height * sc;
    ctx.drawImage(legendImg, rightColX, legendBodyY, dw, dh);
    legendBottomY = legendBodyY + dh;
  } else {
    legendBottomY =
      drawLeftWrappedText(
        ctx,
        `Wytnij legendę (1 kolumna) z arkusza MGśP – Plansza ${board} powyżej lub wklej przez Ctrl+V.`,
        rightColX,
        legendBodyY,
        rightColW,
        34,
        '25px Arial, "Liberation Sans", sans-serif',
        '#475569'
      ) + 12;
  }

  // Yellow (or selected) circle with explanation directly below the legend in the right column
  const markerRowY = legendBottomY + 26;
  drawLocationMarker(ctx, rightColX + 18, markerRowY + 18, markerColor, 15);
  drawLeftWrappedText(
    ctx,
    '- lokalizacja inwestycji',
    rightColX + 46,
    markerRowY + 2,
    Math.max(240, rightColW - 46),
    36,
    'bold 31px Arial, "Liberation Sans", sans-serif',
    '#000000'
  );

  // User-drawn white artifact-masking rectangles on the A3 sheet
  if (whiteMasks && whiteMasks.length > 0) {
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    for (const mask of whiteMasks) {
      ctx.fillRect(
        mask.x * pageWTotal,
        mask.y * pageHTotal,
        mask.w * pageWTotal,
        mask.h * pageHTotal
      );
    }
    ctx.restore();
  }

  return canvas;
}
