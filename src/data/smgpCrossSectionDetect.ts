export interface NormPt {
  x: number;
  y: number;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CrossSectionLineDef {
  symbol: string;
  points: NormPt[];
  source: 'vector' | 'auto' | 'manual';
  reversed?: boolean;
}

export interface DetectedBand {
  index: number;
  yTop: number;
  yBot: number;
  centerY: number;
  defaultSymbol: string;
  cropRect: NormRect;
}

export interface CrossSectionCutoutAnalysis {
  recognizedSymbol: string | null;
  confidence: 'high' | 'medium' | 'low';
  axisLeftNorm: number;
  axisRightNorm: number;
}

const SECTION_PAIRS: Array<{ symbol: string; left: 'A' | 'C' | 'E' | 'G'; right: 'B' | 'D' | 'F' | 'H' }> = [
  { symbol: 'A–B', left: 'A', right: 'B' },
  { symbol: 'C–D', left: 'C', right: 'D' },
  { symbol: 'E–F', left: 'E', right: 'F' },
  { symbol: 'G–H', left: 'G', right: 'H' },
];

type GlyphChar = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
const GLYPH_SIZE = 16;

let cachedTemplates: Record<GlyphChar, Float32Array> | null = null;

function getGlyphTemplates(): Record<GlyphChar, Float32Array> {
  if (cachedTemplates) return cachedTemplates;
  const chars: GlyphChar[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const out = {} as Record<GlyphChar, Float32Array>;

  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  for (const ch of chars) {
    const vec = new Float32Array(GLYPH_SIZE * GLYPH_SIZE);
    if (!ctx) {
      out[ch] = vec;
      continue;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 48, 48);
    ctx.fillStyle = '#000000';
    ctx.font = '26px Arial, "Liberation Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 24, 24);

    const data = ctx.getImageData(0, 0, 48, 48).data;
    let minX = 48,
      maxX = -1,
      minY = 48,
      maxY = -1;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const l = data[(y * 48 + x) * 4];
        if (l < 210) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX && maxY >= minY) {
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      for (let gy = 0; gy < GLYPH_SIZE; gy++) {
        const sy = minY + Math.min(bh - 1, Math.floor(((gy + 0.5) / GLYPH_SIZE) * bh));
        for (let gx = 0; gx < GLYPH_SIZE; gx++) {
          const sx = minX + Math.min(bw - 1, Math.floor(((gx + 0.5) / GLYPH_SIZE) * bw));
          vec[gy * GLYPH_SIZE + gx] = (255 - data[(sy * 48 + sx) * 4]) / 255;
        }
      }
    }
    out[ch] = vec;
  }

  cachedTemplates = out;
  return out;
}

function nccScore(a: Float32Array, b: Float32Array): number {
  let meanA = 0,
    meanB = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let num = 0,
    denA = 0,
    denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom > 1e-6 ? num / denom : 0;
}

function structuralBonus(vec: Float32Array, ch: GlyphChar): number {
  const at = (x0: number, x1: number, y0: number, y1: number): number => {
    let sum = 0;
    let cnt = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        sum += vec[y * GLYPH_SIZE + x];
        cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : 0;
  };

  const leftEdge = at(0, 2, 2, 13);
  const rightMid = at(13, 15, 6, 9);
  const centerCore = at(5, 10, 6, 9);
  const topLeftCorner = at(0, 2, 0, 2);
  const topRightCorner = at(13, 15, 0, 2);
  const botMid = at(5, 10, 12, 15);
  const botRight = at(12, 15, 12, 15);
  const midBar = at(4, 11, 6, 9);

  switch (ch) {
    case 'A':
      // Narrow/triangular top corners white, open bottom center
      return (
        (topLeftCorner < 0.25 && topRightCorner < 0.25 ? 0.2 : -0.15) +
        (botMid < 0.25 ? 0.14 : -0.1) +
        (leftEdge < 0.65 ? 0.08 : -0.08)
      );
    case 'C':
      // Open right middle, open center, curved bottom & top
      return (
        (rightMid < 0.18 ? 0.24 : -0.22) +
        (centerCore < 0.18 ? 0.15 : -0.1) +
        (botRight > 0.2 ? 0.06 : 0)
      );
    case 'E':
      // Straight left spine + open middle-right at 2 pockets + bottom horizontal bar
      return (
        (leftEdge > 0.5 ? 0.16 : -0.12) +
        (botRight > 0.35 ? 0.14 : -0.15) +
        (midBar > 0.22 ? 0.1 : -0.05)
      );
    case 'B':
      // Left spine + middle bar + right outer walls
      return (
        (leftEdge > 0.45 ? 0.14 : -0.1) +
        (midBar > 0.25 ? 0.16 : -0.15) +
        (rightMid < 0.65 ? 0.05 : 0)
      );
    case 'D':
      // Left spine + completely empty center + solid right curve wall + bottom horizontal
      return (
        (leftEdge > 0.45 ? 0.14 : -0.1) +
        (centerCore < 0.16 ? 0.22 : -0.22) +
        (rightMid > 0.4 ? 0.14 : -0.12)
      );
    case 'F':
      // Open bottom right corner!
      return (
        (leftEdge > 0.45 ? 0.14 : -0.1) +
        (botRight < 0.16 ? 0.26 : -0.22) +
        (midBar > 0.22 ? 0.08 : 0)
      );
    case 'G':
      return (centerCore < 0.18 ? 0.1 : 0) + (rightMid > 0.25 ? 0.06 : 0);
    case 'H':
      return (leftEdge > 0.45 && rightMid > 0.45 && midBar > 0.25 ? 0.2 : -0.05);
  }
}

function scoreGlyphRaster(
  raster16: Float32Array,
  candidates: GlyphChar[]
): Record<GlyphChar, number> {
  const templates = getGlyphTemplates();
  const scores = {} as Record<GlyphChar, number>;
  for (const ch of candidates) {
    scores[ch] = nccScore(raster16, templates[ch]) + structuralBonus(raster16, ch);
  }
  return scores;
}

function resamplePatchTo16x16(
  lumaAt: (x: number, y: number) => number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): Float32Array {
  let minL = 255,
    maxL = 0;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const v = lumaAt(x, y);
      if (v < minL) minL = v;
      if (v > maxL) maxL = v;
    }
  }
  const range = Math.max(30, maxL - minL);
  const vec = new Float32Array(GLYPH_SIZE * GLYPH_SIZE);
  for (let gy = 0; gy < GLYPH_SIZE; gy++) {
    const sy = by + Math.min(bh - 1, Math.floor(((gy + 0.5) / GLYPH_SIZE) * bh));
    for (let gx = 0; gx < GLYPH_SIZE; gx++) {
      const sx = bx + Math.min(bw - 1, Math.floor(((gx + 0.5) / GLYPH_SIZE) * bw));
      vec[gy * GLYPH_SIZE + gx] = Math.max(0, Math.min(1, (maxL - lumaAt(sx, sy)) / range));
    }
  }
  return vec;
}

export function normalizeSectionSymbol(raw: string | null | undefined): string {
  if (!raw) return '';
  const letters = raw.toUpperCase().match(/[A-Z]/g);
  if (letters && letters.length >= 2) {
    return `${letters[0]}–${letters[1]}`;
  }
  return raw.trim();
}

/**
 * Detects horizontal geological cross-section strata bands below the map neatline
 * on a full SMGP sheet raster (e.g., Band 0 = A–B, Band 1 = C–D, Band 2 = E–F).
 */
export function detectCrossSectionBandsOnRaster(
  img: HTMLImageElement,
  neatline: NormRect | null
): DetectedBand[] {
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  if (natW < 200 || natH < 200) return [];

  const targetW = Math.min(1200, natW);
  const scale = targetW / natW;
  const w = Math.max(80, Math.round(natW * scale));
  const h = Math.max(80, Math.round(natH * scale));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const yStart = neatline
    ? Math.min(h - 20, Math.max(0, Math.floor((neatline.y + neatline.h + 0.012) * h)))
    : Math.floor(h * 0.65);

  const scanX0 = neatline
    ? Math.max(0, Math.floor((neatline.x - 0.05) * w))
    : Math.floor(w * 0.04);
  const scanX1 = neatline
    ? Math.min(w - 1, Math.ceil((neatline.x + neatline.w + 0.05) * w))
    : Math.floor(w * 0.96);
  const scanSpanW = Math.max(20, scanX1 - scanX0);

  const activeRow = new Uint8Array(h);
  for (let y = yStart; y < h - 4; y++) {
    let chCnt = 0;
    for (let x = scanX0; x < scanX1; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const ch = Math.max(r, g, b) - Math.min(r, g, b);
      if (ch > 18 && l < 236) chCnt++;
    }
    if (chCnt / scanSpanW > 0.075) activeRow[y] = 1;
  }

  // Merge small blank row gaps (<= 1.2% of image height)
  const maxGap = Math.max(2, Math.round(h * 0.012));
  let lastOn = -1;
  for (let y = yStart; y < h; y++) {
    if (activeRow[y]) {
      if (lastOn >= 0 && y - lastOn <= maxGap) {
        for (let k = lastOn + 1; k < y; k++) activeRow[k] = 1;
      }
      lastOn = y;
    }
  }

  const rawBands: Array<[number, number]> = [];
  let start = -1;
  const minBandH = Math.max(10, Math.round(h * 0.022));
  for (let y = yStart; y < h; y++) {
    if (activeRow[y] && start === -1) start = y;
    else if (!activeRow[y] && start !== -1) {
      if (y - start >= minBandH) rawBands.push([start, y - 1]);
      start = -1;
    }
  }
  if (start !== -1 && h - start >= minBandH) rawBands.push([start, h - 1]);

  const lumaAt = (x: number, y: number): number => {
    const idx = (y * w + x) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  };

  const limitedBands = rawBands.slice(0, SECTION_PAIRS.length);

  return limitedBands.map(([ya, yb], idx) => {
    const strataH = Math.max(12, yb - ya + 1);

    // 1. Horizontal extent of this cross-section band (including m n.p.m. & A/B labels)
    const wideX0 = neatline ? Math.max(0, Math.floor((neatline.x - 0.14) * w)) : Math.floor(w * 0.02);
    const wideX1 = neatline
      ? Math.min(w - 1, Math.ceil((neatline.x + neatline.w + 0.14) * w))
      : Math.floor(w * 0.98);
    const probeY0 = Math.max(yStart, ya - Math.round(strataH * 0.65));
    const probeY1 = Math.min(h - 1, yb + Math.round(strataH * 0.2));

    const colInk = new Uint8Array(w);
    for (let x = wideX0; x <= wideX1; x++) {
      let darkCnt = 0;
      for (let y = probeY0; y <= probeY1; y++) {
        if (lumaAt(x, y) < 205) darkCnt++;
      }
      if (darkCnt >= 2) colInk[x] = 1;
    }

    // Start from the core middle under the map and walk outward stopping at large white gaps (> 3.2% width)
    const coreCenter = Math.round((scanX0 + scanX1) / 2);
    const maxColGap = Math.max(10, Math.round(w * 0.032));
    let xa = coreCenter;
    let gap = 0;
    for (let x = coreCenter; x >= wideX0; x--) {
      if (colInk[x]) {
        xa = x;
        gap = 0;
      } else {
        gap++;
        if (gap > maxColGap && xa < coreCenter - scanSpanW * 0.15) break;
      }
    }
    let xb = coreCenter;
    gap = 0;
    for (let x = coreCenter; x <= wideX1; x++) {
      if (colInk[x]) {
        xb = x;
        gap = 0;
      } else {
        gap++;
        if (gap > maxColGap && xb > coreCenter + scanSpanW * 0.15) break;
      }
    }
    if (xb - xa < scanSpanW * 0.35) {
      xa = scanX0;
      xb = scanX1;
    }
    const hPad = Math.max(6, Math.round(w * 0.008));
    xa = Math.max(0, xa - hPad);
    xb = Math.min(w - 1, xb + hPad);

    // 2. Vertical top crop: capture A/B letters + zone headers, stop cleanly at separator gap below sheet header
    const bandWidth = Math.max(20, xb - xa + 1);
    const minRowInk = Math.max(3, Math.round(bandWidth * 0.0035));
    const ceilY =
      idx === 0
        ? Math.max(yStart + Math.round(h * 0.006), ya - Math.round(Math.max(strataH * 1.45, h * 0.068)))
        : Math.max(
            Math.floor((limitedBands[idx - 1][1] + ya) / 2),
            ya - Math.round(Math.max(strataH * 1.35, h * 0.06))
          );

    const minRequiredClimb = Math.round(strataH * 0.55);
    const blankStopRows = Math.max(5, Math.round(h * 0.01));
    let bestTopInkY = ya;
    let blankRun = 0;
    for (let y = ya - 1; y >= ceilY; y--) {
      let darkCnt = 0;
      for (let x = xa; x <= xb; x++) {
        if (lumaAt(x, y) < 192) darkCnt++;
      }
      if (darkCnt >= minRowInk) {
        bestTopInkY = y;
        blankRun = 0;
      } else {
        blankRun++;
        if (ya - y >= minRequiredClimb && blankRun >= blankStopRows) {
          break;
        }
      }
    }
    const cropYa = Math.max(0, bestTopInkY - Math.round(h * 0.004));

    // 3. Vertical bottom crop: capture bottom m n.p.m. scale line & unit labels without spilling into next band
    const floorY =
      idx < limitedBands.length - 1
        ? Math.min(
            Math.floor((yb + limitedBands[idx + 1][0]) / 2),
            yb + Math.round(Math.max(strataH * 0.45, h * 0.022))
          )
        : Math.min(h - 1, yb + Math.round(Math.max(strataH * 0.42, h * 0.02)));

    let bestBotInkY = yb;
    blankRun = 0;
    const botStopRows = Math.max(4, Math.round(h * 0.007));
    for (let y = yb + 1; y <= floorY; y++) {
      let darkCnt = 0;
      for (let x = xa; x <= xb; x++) {
        if (lumaAt(x, y) < 192) darkCnt++;
      }
      if (darkCnt >= minRowInk) {
        bestBotInkY = y;
        blankRun = 0;
      } else {
        blankRun++;
        if (blankRun >= botStopRows) break;
      }
    }
    const cropYb = Math.min(h - 1, bestBotInkY + Math.round(h * 0.004));

    return {
      index: idx,
      yTop: ya / h,
      yBot: yb / h,
      centerY: (ya + yb) / (2 * h),
      defaultSymbol:
        SECTION_PAIRS[idx]?.symbol ??
        `${String.fromCharCode(65 + idx * 2)}–${String.fromCharCode(66 + idx * 2)}`,
      cropRect: {
        x: Number((xa / w).toFixed(5)),
        y: Number((cropYa / h).toFixed(5)),
        w: Number(((xb - xa + 1) / w).toFixed(5)),
        h: Number((Math.max(12, cropYb - cropYa + 1) / h).toFixed(5)),
      },
    };
  });
}

export function inferSectionBandFromCropRect(
  bands: DetectedBand[],
  cropRect: NormRect
): string | null {
  if (bands.length === 0) return null;
  const cropY0 = cropRect.y;
  const cropY1 = cropRect.y + cropRect.h;
  const cropMid = (cropY0 + cropY1) / 2;

  let best: DetectedBand | null = null;
  let bestScore = -1e9;
  for (const band of bands) {
    const overlap = Math.max(0, Math.min(cropY1, band.yBot) - Math.max(cropY0, band.yTop));
    const dist = Math.abs(cropMid - band.centerY);
    const score = overlap * 10 - dist;
    if (score > bestScore) {
      bestScore = score;
      best = band;
    }
  }
  return best?.defaultSymbol ?? null;
}

export function extractBandCutoutFromRaster(
  img: HTMLImageElement,
  band: DetectedBand,
  availableSymbols?: string[]
): {
  dataUrl: string;
  analysis: CrossSectionCutoutAnalysis;
} | null {
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  if (natW < 100 || natH < 100) return null;

  const sx = Math.max(0, Math.round(band.cropRect.x * natW));
  const sy = Math.max(0, Math.round(band.cropRect.y * natH));
  const sw = Math.max(20, Math.min(natW - sx, Math.round(band.cropRect.w * natW)));
  const sh = Math.max(20, Math.min(natH - sy, Math.round(band.cropRect.h * natH)));

  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const analysis = analyzeCrossSectionCutout(c, {
    bandSymbolHint: band.defaultSymbol,
    availableSymbols,
  });

  return {
    dataUrl: c.toDataURL('image/png'),
    analysis,
  };
}

/**
 * Analyzes any cropped or pasted cross-section image:
 * - Locates exact left & right vertical elevation axes (`m n.p.m.`) for exact [0..100%] arrow alignment
 * - Recognizes printed endpoint letters (A–B, C–D, E–F, G–H) via NCC + topology
 */
export function analyzeCrossSectionCutout(
  img: HTMLImageElement | HTMLCanvasElement,
  options?: {
    bandSymbolHint?: string | null;
    availableSymbols?: string[];
  }
): CrossSectionCutoutAnalysis {
  const natW = img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
  const natH = img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
  const fallback: CrossSectionCutoutAnalysis = {
    recognizedSymbol: options?.bandSymbolHint ?? null,
    confidence: options?.bandSymbolHint ? 'medium' : 'low',
    axisLeftNorm: 0.03,
    axisRightNorm: 0.97,
  };
  if (natW < 80 || natH < 30) return fallback;

  const w = Math.min(1400, natW);
  const scale = w / natW;
  const h = Math.max(30, Math.round(natH * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lumaAt = (x: number, y: number): number => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  // 1. Strata top/bottom
  let strataTop = h;
  let strataBot = 0;
  for (let y = 0; y < h; y++) {
    let chCnt = 0;
    for (let x = Math.floor(w * 0.05); x < Math.floor(w * 0.95); x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = (r + g + b) / 3;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18 && l < 236) chCnt++;
    }
    if (chCnt / (w * 0.9) > 0.075) {
      if (y < strataTop) strataTop = y;
      if (y > strataBot) strataBot = y;
    }
  }
  if (strataBot <= strataTop + 6) {
    strataTop = Math.floor(h * 0.45);
    strataBot = Math.floor(h * 0.94);
  }

  // 2. Vertical elevation axis lines on left & right margins
  const strataH = Math.max(16, strataBot - strataTop);
  const ay0 = Math.max(0, strataTop - Math.round(strataH * 0.5));
  const ay1 = Math.min(h - 1, strataBot);

  let leftX = Math.round(w * 0.03);
  let leftBestRun = 0;
  for (let x = 2; x < Math.round(w * 0.16); x++) {
    let run = 0;
    let best = 0;
    for (let y = ay0; y <= ay1; y++) {
      if (lumaAt(x, y) < 150) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    if (best > leftBestRun) {
      leftBestRun = best;
      leftX = x;
    }
  }

  let rightX = Math.round(w * 0.97);
  let rightBestRun = 0;
  for (let x = Math.round(w * 0.84); x < w - 2; x++) {
    let run = 0;
    let best = 0;
    for (let y = ay0; y <= ay1; y++) {
      if (lumaAt(x, y) < 150) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    if (best > rightBestRun) {
      rightBestRun = best;
      rightX = x;
    }
  }

  const minAxisRun = Math.max(12, Math.round(strataH * 0.35));
  const validAxes =
    leftBestRun >= minAxisRun &&
    rightBestRun >= minAxisRun &&
    rightX - leftX >= w * 0.62;
  const axisLeftNorm = validAxes ? leftX / w : 0.03;
  const axisRightNorm = validAxes ? rightX / w : 0.97;

  // 3. Extract single uppercase endpoint letters above left & right axis lines
  const extractAxisGlyph = (axX: number): Float32Array | null => {
    const x0 = Math.max(0, axX - Math.round(w * 0.032));
    const x1 = Math.min(w - 1, axX + Math.round(w * 0.032));
    const y0 = 0;
    const y1 = Math.max(10, strataTop - 6);
    const gw = x1 - x0 + 1;
    const gh = y1 - y0 + 1;
    if (gw < 10 || gh < 10) return null;

    const vis = new Uint8Array(gw * gh);
    const comps: Array<{
      bx: number;
      by: number;
      bw: number;
      bh: number;
      score: number;
    }> = [];

    for (let ly = 0; ly < gh; ly++) {
      for (let lx = 0; lx < gw; lx++) {
        if (vis[ly * gw + lx]) continue;
        if (lumaAt(x0 + lx, y0 + ly) >= 175) continue;

        const q: number[] = [lx, ly];
        vis[ly * gw + lx] = 1;
        let minX = lx,
          maxX = lx,
          minY = ly,
          maxY = ly,
          cnt = 0;

        for (let qi = 0; qi < q.length; qi += 2) {
          const cx = q[qi];
          const cy = q[qi + 1];
          cnt++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < gw && ny >= 0 && ny < gh && !vis[ny * gw + nx]) {
                if (lumaAt(x0 + nx, y0 + ny) < 185) {
                  vis[ny * gw + nx] = 1;
                  q.push(nx, ny);
                }
              }
            }
          }
        }

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        if (
          bh >= 7 &&
          bh <= 38 &&
          bw >= 4 &&
          bw <= 36 &&
          bw / bh >= 0.35 &&
          bw / bh <= 1.55 &&
          cnt >= 10
        ) {
          const cxGlobal = x0 + (minX + maxX) / 2;
          const distAx = Math.abs(cxGlobal - axX);
          if (distAx <= w * 0.028) {
            // Favor taller uppercase letter near axis and well above "m n.p.m."
            const score = bh * 2.2 - distAx * 1.4 + (y1 - (y0 + maxY)) * 0.15;
            comps.push({
              bx: x0 + minX,
              by: y0 + minY,
              bw,
              bh,
              score,
            });
          }
        }
      }
    }

    if (comps.length === 0) return null;
    comps.sort((a, b) => b.score - a.score);
    const top = comps[0];
    return resamplePatchTo16x16(lumaAt, top.bx, top.by, top.bw, top.bh);
  };

  const gLeft = extractAxisGlyph(leftX);
  const gRight = extractAxisGlyph(rightX);

  const allowedSet = options?.availableSymbols?.length
    ? new Set(options.availableSymbols.map((s) => normalizeSectionSymbol(s)))
    : null;
  const candidatePairs = SECTION_PAIRS.filter(
    (p) => !allowedSet || allowedSet.has(p.symbol)
  );
  const activePairs = candidatePairs.length > 0 ? candidatePairs : SECTION_PAIRS.slice(0, 3);

  if (gLeft || gRight) {
    const leftScores = gLeft
      ? scoreGlyphRaster(
          gLeft,
          activePairs.map((p) => p.left)
        )
      : null;
    const rightScores = gRight
      ? scoreGlyphRaster(
          gRight,
          activePairs.map((p) => p.right)
        )
      : null;

    const ranked = activePairs
      .map((p) => {
        const ls = leftScores ? leftScores[p.left] : 0;
        const rs = rightScores ? rightScores[p.right] : 0;
        const count = (leftScores ? 1 : 0) + (rightScores ? 1 : 0);
        return {
          symbol: p.symbol,
          score: (ls + rs) / Math.max(1, count),
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const second = ranked[1];
    const margin = second ? best.score - second.score : best.score;

    if (best && best.score > 0.28 && margin >= 0.09) {
      return {
        recognizedSymbol: best.symbol,
        confidence: margin >= 0.18 && best.score >= 0.45 ? 'high' : 'medium',
        axisLeftNorm,
        axisRightNorm,
      };
    }
    if (options?.bandSymbolHint) {
      return {
        recognizedSymbol: normalizeSectionSymbol(options.bandSymbolHint),
        confidence: 'medium',
        axisLeftNorm,
        axisRightNorm,
      };
    }
    if (best && best.score > 0.2) {
      return {
        recognizedSymbol: best.symbol,
        confidence: 'low',
        axisLeftNorm,
        axisRightNorm,
      };
    }
  }

  return {
    recognizedSymbol: options?.bandSymbolHint
      ? normalizeSectionSymbol(options.bandSymbolHint)
      : null,
    confidence: options?.bandSymbolHint ? 'medium' : 'low',
    axisLeftNorm,
    axisRightNorm,
  };
}

/**
 * Computes exact perpendicular projection of investment point onto cross-section polyline
 * in isotropic pixel/ground space, returning tAlong [0..1], visual foot point on map,
 * and arrowPercent [0..100] calibrated to left/right m n.p.m. vertical axes of crossImg.
 */
export function computePerpendicularProjectionOnLine(
  pt: NormPt,
  polyline: NormPt[],
  aspectRatioWOverH: number,
  axisLeftNorm = 0.03,
  axisRightNorm = 0.97,
  reversed = false
): {
  tAlong: number;
  arrowPercent: number;
  projPt: NormPt;
  distNorm: number;
} | null {
  if (!polyline || polyline.length < 2) return null;
  const axScale = Math.max(0.2, Math.min(5, aspectRatioWOverH || 1));

  const px = pt.x * axScale;
  const py = pt.y;

  let totalLen = 0;
  let bestDist2 = Infinity;
  let bestAlong = 0;
  let bestFootX = px;
  let bestFootY = py;

  for (let i = 0; i < polyline.length - 1; i++) {
    const x1 = polyline[i].x * axScale;
    const y1 = polyline[i].y;
    const x2 = polyline[i + 1].x * axScale;
    const y2 = polyline[i + 1].y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const segLen = Math.sqrt(len2);

    const rawT = len2 > 1e-12 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    const t = Math.max(0, Math.min(1, rawT));
    const fx = x1 + t * dx;
    const fy = y1 + t * dy;
    const d2 = (px - fx) * (px - fx) + (py - fy) * (py - fy);

    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestAlong = totalLen + t * segLen;
      bestFootX = fx;
      bestFootY = fy;
    }
    totalLen += segLen;
  }

  const rawTAlong = totalLen > 1e-9 ? Math.max(0, Math.min(1, bestAlong / totalLen)) : 0.5;
  const tAlong = reversed ? 1 - rawTAlong : rawTAlong;
  const clampedL = Math.max(0, Math.min(0.45, axisLeftNorm));
  const clampedR = Math.max(clampedL + 0.2, Math.min(1, axisRightNorm));
  const arrowPercent = Number(((clampedL + tAlong * (clampedR - clampedL)) * 100).toFixed(1));

  return {
    tAlong,
    arrowPercent,
    projPt: {
      x: bestFootX / axScale,
      y: bestFootY,
    },
    distNorm: Math.sqrt(bestDist2),
  };
}

/**
 * Inverse of computePerpendicularProjectionOnLine: maps tAlong [0..1] (e.g. derived from arrowPercent)
 * back to the exact point on the cross-section polyline in normalized [0..1] sheet coordinates.
 */
export function evaluatePointAtTAlongPolyline(
  polyline: NormPt[],
  aspectRatioWOverH: number,
  tAlong: number,
  reversed = false
): NormPt | null {
  if (!polyline || polyline.length < 2) return null;
  const axScale = Math.max(0.2, Math.min(5, aspectRatioWOverH || 1));
  const clampedT = Math.max(0, Math.min(1, tAlong));
  const rawT = reversed ? 1 - clampedT : clampedT;

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dx = (polyline[i + 1].x - polyline[i].x) * axScale;
    const dy = polyline[i + 1].y - polyline[i].y;
    const len = Math.hypot(dx, dy);
    segLengths.push(len);
    totalLen += len;
  }

  if (totalLen <= 1e-9) {
    return { x: polyline[0].x, y: polyline[0].y };
  }

  const targetDist = rawT * totalLen;
  let acc = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const len = segLengths[i];
    if (acc + len >= targetDist || i === polyline.length - 2) {
      const localT = len > 1e-9 ? Math.max(0, Math.min(1, (targetDist - acc) / len)) : 0;
      const p1 = polyline[i];
      const p2 = polyline[i + 1];
      return {
        x: p1.x + localT * (p2.x - p1.x),
        y: p1.y + localT * (p2.y - p1.y),
      };
    }
    acc += len;
  }

  const last = polyline[polyline.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Automatically detects main geological cross-section lines (e.g. A–B, C–D) on a scanned
 * SMGP map sheet raster using local-ridge Hough detection + endpoint letter matching in neatline borders.
 */
export function detectCrossSectionLinesOnRaster(
  img: HTMLImageElement,
  neatline: NormRect,
  expectedSymbols: string[] = ['A–B', 'C–D']
): CrossSectionLineDef[] {
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  if (natW < 300 || natH < 300 || neatline.w < 0.1 || neatline.h < 0.1) return [];

  // Pad neatline by 2.2% around edges so outside endpoint letters (B, D) & ticks are visible
  const padX = Math.min(0.025, neatline.w * 0.045);
  const padY = Math.min(0.025, neatline.h * 0.045);
  const roiX = Math.max(0, neatline.x - padX);
  const roiY = Math.max(0, neatline.y - padY);
  const roiW = Math.min(1 - roiX, neatline.w + padX * 2);
  const roiH = Math.min(1 - roiY, neatline.h + padY * 2);

  const sx = Math.round(roiX * natW);
  const sy = Math.round(roiY * natH);
  const swOrig = Math.max(50, Math.round(roiW * natW));
  const shOrig = Math.max(50, Math.round(roiH * natH));

  const targetSide = 1000;
  const scale = Math.min(1, targetSide / Math.max(swOrig, shOrig));
  const W = Math.max(120, Math.round(swOrig * scale));
  const H = Math.max(120, Math.round(shOrig * scale));

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, sx, sy, swOrig, shOrig, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const luma = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    luma[i] = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
  }

  // Neatline bounds inside W x H ROI
  const inX0 = Math.round(((neatline.x - roiX) / roiW) * W);
  const inY0 = Math.round(((neatline.y - roiY) / roiH) * H);
  const inX1 = Math.round(((neatline.x + neatline.w - roiX) / roiW) * W);
  const inY1 = Math.round(((neatline.y + neatline.h - roiY) / roiH) * H);

  // Local ridge / dark-line contrast map
  const ink = new Float32Array(W * H);
  for (let y = Math.max(3, inY0 + 3); y < Math.min(H - 3, inY1 - 3); y++) {
    for (let x = Math.max(3, inX0 + 3); x < Math.min(W - 3, inX1 - 3); x++) {
      const v = luma[y * W + x];
      if (v > 182) continue;
      let maxBg = 0;
      for (let dy = -3; dy <= 3; dy += 2) {
        for (let dx = -3; dx <= 3; dx += 2) {
          const nv = luma[(y + dy) * W + (x + dx)];
          if (nv > maxBg) maxBg = nv;
        }
      }
      if (maxBg - v > 34) {
        ink[y * W + x] = Math.min(1, (maxBg - v - 26) / 80);
      }
    }
  }

  // Hough accumulator at grid stride 2
  const nAng = 180;
  const maxRho = Math.ceil(Math.hypot(W, H));
  const nRho = maxRho * 2 + 1;
  const acc = new Float32Array(nAng * nRho);
  const cosT = new Float32Array(nAng);
  const sinT = new Float32Array(nAng);
  for (let a = 0; a < nAng; a++) {
    const rad = (a * Math.PI) / 180;
    cosT[a] = Math.cos(rad);
    sinT[a] = Math.sin(rad);
  }

  for (let y = Math.max(6, inY0 + 6); y < Math.min(H - 6, inY1 - 6); y += 2) {
    for (let x = Math.max(6, inX0 + 6); x < Math.min(W - 6, inX1 - 6); x += 2) {
      const v = Math.max(
        ink[y * W + x],
        ink[y * W + x + 1],
        ink[(y + 1) * W + x],
        ink[(y + 1) * W + x + 1]
      );
      if (v <= 0.22) continue;
      for (let a = 3; a < nAng - 2; a++) {
        if (Math.abs(a - 90) <= 2) continue;
        const rho = Math.round(x * cosT[a] + y * sinT[a]) + maxRho;
        acc[a * nRho + rho] += v;
      }
    }
  }

  const peaks: Array<{ a: number; rho: number; val: number }> = [];
  for (let a = 3; a < nAng - 2; a++) {
    if (Math.abs(a - 90) <= 2) continue;
    for (let r = 8; r < nRho - 8; r++) {
      const val = acc[a * nRho + r];
      if (val < 95) continue;
      let isMax = true;
      for (let da = -3; da <= 3 && isMax; da++) {
        const aa = a + da;
        if (aa < 0 || aa >= nAng) continue;
        for (let dr = -6; dr <= 6; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= nRho) continue;
          if (acc[aa * nRho + rr] > val) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) peaks.push({ a, rho: r - maxRho, val });
    }
  }
  peaks.sort((a, b) => b.val - a.val);

  interface RawCandidate {
    aDeg: number;
    rho: number;
    p1: NormPt; // inside W x H
    p2: NormPt;
    score: number;
    midY: number;
  }

  const candidates: RawCandidate[] = [];
  const minSpan = Math.max(180, (inX1 - inX0) * 0.36);

  const traceAtAngleRho = (angDeg: number, rho: number) => {
    const rad = (angDeg * Math.PI) / 180;
    const ca = Math.cos(rad);
    const sa = Math.sin(rad);
    const pts: Array<{ x: number; y: number; hit: boolean; clean: boolean }> = [];
    for (let t = -maxRho; t <= maxRho; t += 2) {
      const x = Math.round(rho * ca - t * sa);
      const y = Math.round(rho * sa + t * ca);
      if (x < inX0 + 2 || x >= inX1 - 2 || y < inY0 + 2 || y >= inY1 - 2) continue;
      let on = 0;
      let side = 0;
      for (let d = -2; d <= 2; d++) {
        const xx = Math.round(x + d * ca);
        const yy = Math.round(y + d * sa);
        if (xx >= 0 && xx < W && yy >= 0 && yy < H) on = Math.max(on, ink[yy * W + xx]);
      }
      for (const d of [-5, -4, 4, 5]) {
        const xx = Math.round(x + d * ca);
        const yy = Math.round(y + d * sa);
        if (xx >= 0 && xx < W && yy >= 0 && yy < H) side = Math.max(side, ink[yy * W + xx]);
      }
      pts.push({ x, y, hit: on > 0.22, clean: on > 0.22 && side < 0.28 });
    }
    if (pts.length < 30) return null;

    let cs = -1,
      cl = -1,
      ch = 0,
      cClean = 0;
    let bs = -1,
      be = -1,
      bh = 0,
      bSpan = 0,
      bClean = 0;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].hit) {
        if (cs === -1 || i - cl > 10) {
          cs = i;
          ch = 1;
          cClean = pts[i].clean ? 1 : 0;
        } else {
          ch++;
          if (pts[i].clean) cClean++;
        }
        cl = i;
        const sp = cl - cs;
        if (ch > bh) {
          bh = ch;
          bSpan = sp;
          bs = cs;
          be = cl;
          bClean = cClean;
        }
      }
    }
    if (bs < 0) return null;
    const spanPx = bSpan * 2;
    const occ = bh / Math.max(1, bSpan);
    if (spanPx < minSpan || occ < 0.7) return null;

    // Also try extending to neatline edge if very close & dark dots continue (>45%)
    let startIdx = bs;
    let endIdx = be;
    const tryExtend = (dir: -1 | 1) => {
      const anchor = dir === -1 ? bs : be;
      let extHits = 0;
      let extSteps = 0;
      let lastGood = anchor;
      for (let i = anchor + dir; i >= 0 && i < pts.length; i += dir) {
        extSteps++;
        if (extSteps > 165) break;
        if (pts[i].hit) {
          extHits++;
          lastGood = i;
        }
      }
      if (extSteps > 6 && extHits / extSteps >= 0.45) {
        if (dir === -1) startIdx = lastGood;
        else endIdx = lastGood;
      }
    };
    tryExtend(-1);
    tryExtend(1);

    const p1 = { x: pts[startIdx].x, y: pts[startIdx].y };
    const p2 = { x: pts[endIdx].x, y: pts[endIdx].y };
    const totalLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const cleanRatio = bClean / Math.max(1, bh);

    return {
      aDeg: angDeg,
      rho,
      p1,
      p2,
      score: totalLen * (0.55 + cleanRatio * 0.85) * occ,
      midY: (p1.y + p2.y) / 2,
    };
  };

  for (const p of peaks.slice(0, 24)) {
    let bestLocal: RawCandidate | null = null;
    for (let da = -1.5; da <= 1.5; da += 0.5) {
      for (let dr = -2; dr <= 2; dr++) {
        const cand = traceAtAngleRho(p.a + da, p.rho + dr);
        if (cand && (!bestLocal || cand.score > bestLocal.score)) {
          bestLocal = cand;
        }
      }
    }
    if (bestLocal) candidates.push(bestLocal);
  }

  candidates.sort((a, b) => b.score - a.score);

  // Deduplicate similar lines (parallel & close midpoint or heavy endpoint overlap)
  const unique: RawCandidate[] = [];
  for (const cand of candidates) {
    const midX = (cand.p1.x + cand.p2.x) / 2;
    const isDup = unique.some((u) => {
      const angDiff = Math.min(
        Math.abs(u.aDeg - cand.aDeg),
        180 - Math.abs(u.aDeg - cand.aDeg)
      );
      if (angDiff > 10) return false;
      const uMidX = (u.p1.x + u.p2.x) / 2;
      const dMid = Math.hypot(midX - uMidX, cand.midY - u.midY);
      return dMid < (inX1 - inX0) * 0.12;
    });
    if (!isDup) {
      unique.push(cand);
      if (unique.length >= Math.max(2, expectedSymbols.length)) break;
    }
  }

  if (unique.length === 0) return [];

  // Look for endpoint glyphs ('A'..'F') near each line's ends to identify A–B vs C–D cleanly
  const lumaAtW = (x: number, y: number) => luma[y * W + x];
  const scoreEndpointLabel = (pt: NormPt, chars: GlyphChar[]): Record<GlyphChar, number> | null => {
    const rx0 = Math.max(0, Math.round(pt.x - 24));
    const rx1 = Math.min(W - 1, Math.round(pt.x + 24));
    const ry0 = Math.max(0, Math.round(pt.y - 24));
    const ry1 = Math.min(H - 1, Math.round(pt.y + 24));
    const gw = rx1 - rx0 + 1;
    const gh = ry1 - ry0 + 1;
    if (gw < 8 || gh < 8) return null;

    const vis = new Uint8Array(gw * gh);
    let bestGlyph: Float32Array | null = null;
    let bestBoxScore = -1e9;
    for (let ly = 0; ly < gh; ly++) {
      for (let lx = 0; lx < gw; lx++) {
        if (vis[ly * gw + lx]) continue;
        if (lumaAtW(rx0 + lx, ry0 + ly) >= 145) continue;
        const q = [lx, ly];
        vis[ly * gw + lx] = 1;
        let minX = lx,
          maxX = lx,
          minY = ly,
          maxY = ly,
          cnt = 0;
        for (let qi = 0; qi < q.length; qi += 2) {
          const cx = q[qi];
          const cy = q[qi + 1];
          cnt++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < gw && ny >= 0 && ny < gh && !vis[ny * gw + nx]) {
                if (lumaAtW(rx0 + nx, ry0 + ny) < 160) {
                  vis[ny * gw + nx] = 1;
                  q.push(nx, ny);
                }
              }
            }
          }
        }
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        if (bh >= 6 && bh <= 18 && bw >= 4 && bw <= 16 && bw / bh >= 0.4 && bw / bh <= 1.4 && cnt >= 8) {
          const dist = Math.hypot(rx0 + (minX + maxX) / 2 - pt.x, ry0 + (minY + maxY) / 2 - pt.y);
          const s = -dist + bh * 0.4;
          if (s > bestBoxScore) {
            bestBoxScore = s;
            bestGlyph = resamplePatchTo16x16(lumaAtW, rx0 + minX, ry0 + minY, bw, bh);
          }
        }
      }
    }
    return bestGlyph ? scoreGlyphRaster(bestGlyph, chars) : null;
  };

  // Orient each line left-to-right (x1 <= x2, standard cross-section convention A->B / C->D)
  const oriented = unique.map((u) => {
    const swap = u.p1.x > u.p2.x;
    const leftPt = swap ? u.p2 : u.p1;
    const rightPt = swap ? u.p1 : u.p2;
    const gL = scoreEndpointLabel(leftPt, ['A', 'C', 'E']);
    const gR = scoreEndpointLabel(rightPt, ['B', 'D', 'F']);
    return { leftPt, rightPt, midY: u.midY, gL, gR };
  });

  // Sort north-to-south as primary tie-breaker when glyphs are noisy inside map contours
  oriented.sort((a, b) => a.midY - b.midY);

  const toFullNorm = (pt: NormPt): NormPt => ({
    x: Number((roiX + (pt.x / W) * roiW).toFixed(5)),
    y: Number((roiY + (pt.y / H) * roiH).toFixed(5)),
  });

  if (oriented.length === 2) {
    // Check if glyph votes strongly favor swapping (C-D above A-B) vs default (A-B above C-D)
    const abFirstScore =
      (oriented[0].gL?.A ?? 0) +
      (oriented[0].gR?.B ?? 0) +
      (oriented[1].gL?.C ?? 0) +
      (oriented[1].gR?.D ?? 0);
    const cdFirstScore =
      (oriented[0].gL?.C ?? 0) +
      (oriented[0].gR?.D ?? 0) +
      (oriented[1].gL?.A ?? 0) +
      (oriented[1].gR?.B ?? 0);
    const sym0 = cdFirstScore > abFirstScore + 0.25 ? expectedSymbols[1] || 'C–D' : expectedSymbols[0] || 'A–B';
    const sym1 = sym0 === (expectedSymbols[0] || 'A–B') ? expectedSymbols[1] || 'C–D' : expectedSymbols[0] || 'A–B';

    return [
      {
        symbol: sym0,
        points: [toFullNorm(oriented[0].leftPt), toFullNorm(oriented[0].rightPt)],
        source: 'auto',
      },
      {
        symbol: sym1,
        points: [toFullNorm(oriented[1].leftPt), toFullNorm(oriented[1].rightPt)],
        source: 'auto',
      },
    ];
  }

  return oriented.map((o, idx) => ({
    symbol: expectedSymbols[idx] || SECTION_PAIRS[idx]?.symbol || 'A–B',
    points: [toFullNorm(o.leftPt), toFullNorm(o.rightPt)],
    source: 'auto',
  }));
}
