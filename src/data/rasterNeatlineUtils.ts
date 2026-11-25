export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function parseAxisCoord(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '.');
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const deg = Math.abs(Number(nums[0]));
  const min = nums.length >= 2 ? Number(nums[1]) : 0;
  const sec = nums.length >= 3 ? Number(nums[2]) : 0;
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  const val = deg + min / 60 + sec / 3600;
  return s.includes('-') || /[SW]/i.test(s) ? -val : val;
}

export function formatDmsShort(deg: number): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = (minFloat - m) * 60;
  const sRounded = Number(s.toFixed(1));
  if (sRounded >= 60) {
    return `${d}°${String(m + 1).padStart(2, '0')}′00.0″`;
  }
  return `${d}°${String(m).padStart(2, '0')}′${sRounded.toFixed(1).padStart(4, '0')}″`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Nie udało się odczytać pliku obrazu.'));
    };
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku obrazu.'));
    reader.readAsDataURL(file);
  });
}

export function cropImageFromElement(img: HTMLImageElement, rect: NormRect): string {
  const sx = Math.max(0, Math.round(rect.x * img.naturalWidth));
  const sy = Math.max(0, Math.round(rect.y * img.naturalHeight));
  const sw = Math.max(10, Math.round(rect.w * img.naturalWidth));
  const sh = Math.max(10, Math.round(rect.h * img.naturalHeight));

  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Brak wsparcia Canvas 2D.');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}

/**
 * Computes an exact 1:50 000 map cutout rectangle centered on (uPercent, vPercentFromTop)
 * for a target physical frame size (mapWidthMm × mapHeightMm).
 * If the centered rectangle would extend beyond the calibrated neatline, it is clamped inside
 * the neatline so 1:50 000 scale is preserved and the marker shifts accurately inside the cutout.
 */
export function computeCenteredMapRectForSizeMm(
  img: HTMLImageElement,
  neatline: NormRect,
  uPercent: number,
  vPercentFromTop: number,
  mapWidthMm: number,
  mapHeightMm: number,
  sheetGroundSpan?: { groundW: number; groundH: number } | null
): {
  cropRect: NormRect;
  markerXPercent: number;
  markerYPercent: number;
  wasClamped: boolean;
} {
  const u = Math.max(0, Math.min(1, uPercent / 100));
  const v = Math.max(0, Math.min(1, vPercentFromTop / 100));
  const ptX = neatline.x + u * neatline.w;
  const ptY = neatline.y + v * neatline.h;

  const safeWmm = Math.max(40, Math.min(390, mapWidthMm));
  const safeHmm = Math.max(40, Math.min(360, mapHeightMm));
  const targetGroundW = safeWmm * 50; // 1:50 000 -> 1 mm = 50 m

  const pixelAspectCorrection = img.naturalWidth / Math.max(1, img.naturalHeight);
  const targetRatioYOverX = (safeHmm / safeWmm) * pixelAspectCorrection;

  let targetW = sheetGroundSpan
    ? Math.min(neatline.w, neatline.w * (targetGroundW / Math.max(1000, sheetGroundSpan.groundW)))
    : Math.min(neatline.w, neatline.w * Math.min(0.95, safeWmm / 365));
  let targetH = targetW * targetRatioYOverX;

  if (targetH > neatline.h) {
    targetH = neatline.h;
    targetW = Math.min(neatline.w, targetH / targetRatioYOverX);
  }

  const idealX = ptX - targetW / 2;
  const idealY = ptY - targetH / 2;
  const winX = Math.max(neatline.x, Math.min(neatline.x + neatline.w - targetW, idealX));
  const winY = Math.max(neatline.y, Math.min(neatline.y + neatline.h - targetH, idealY));

  const wasClamped = Math.abs(winX - idealX) > 1e-4 || Math.abs(winY - idealY) > 1e-4;

  return {
    cropRect: { x: winX, y: winY, w: targetW, h: targetH },
    markerXPercent: Number((((ptX - winX) / Math.max(1e-6, targetW)) * 100).toFixed(1)),
    markerYPercent: Number((((ptY - winY) / Math.max(1e-6, targetH)) * 100).toFixed(1)),
    wasClamped,
  };
}

/**
 * Automatically detects the inner geographic neatline border on Polish 1:50 000 PIG-PIB raster sheets
 * (SMGP, MGśP Plansza A & Plansza B, MHP) and refines all four edges at native pixel resolution.
 */
export function detectMapNeatlineFromImage(img: HTMLImageElement): NormRect | null {
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  if (natW < 200 || natH < 200) return null;

  const targetW = Math.min(1400, natW);
  const scale = targetW / natW;
  const w = Math.max(100, Math.round(natW * scale));
  const h = Math.max(100, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const luma = (x: number, y: number): number => {
    const idx = (y * w + x) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  };

  const rowStats = (y: number, x0: number, x1: number) => {
    let dark = 0;
    let line = 0;
    let nw = 0;
    const count = Math.max(1, x1 - x0);
    for (let x = x0; x < x1; x++) {
      const v = luma(x, y);
      if (v < 130) dark++;
      if (v < 210) line++;
      if (v < 232) nw++;
    }
    return { dark: dark / count, line: line / count, nw: nw / count };
  };

  const colStats = (x: number, y0: number, y1: number) => {
    let dark = 0;
    let line = 0;
    let nw = 0;
    const count = Math.max(1, y1 - y0);
    for (let y = y0; y < y1; y++) {
      const v = luma(x, y);
      if (v < 130) dark++;
      if (v < 210) line++;
      if (v < 232) nw++;
    }
    return { dark: dark / count, line: line / count, nw: nw / count };
  };

  const findHorizontalOuter = (
    startY: number,
    endY: number,
    step: number,
    x0: number,
    x1: number
  ): number | null => {
    for (let y = startY; step > 0 ? y < endY : y > endY; y += step) {
      if (rowStats(y, x0, x1).dark >= 0.55) return y;
    }
    return null;
  };

  let tx0 = Math.floor(0.42 * w);
  let tx1 = Math.floor(0.68 * w);
  let outerTop = findHorizontalOuter(Math.floor(0.01 * h), Math.floor(0.32 * h), 1, tx0, tx1);
  let outerBot = findHorizontalOuter(Math.floor(0.92 * h), Math.floor(0.42 * h), -1, tx0, tx1);

  if (outerTop === null || outerBot === null) {
    tx0 = Math.floor(0.25 * w);
    tx1 = Math.floor(0.75 * w);
    if (outerTop === null) {
      outerTop = findHorizontalOuter(Math.floor(0.01 * h), Math.floor(0.32 * h), 1, tx0, tx1);
    }
    if (outerBot === null) {
      outerBot = findHorizontalOuter(Math.floor(0.92 * h), Math.floor(0.42 * h), -1, tx0, tx1);
    }
  }
  if (outerTop === null || outerBot === null || outerBot - outerTop < h * 0.25) return null;

  const vy0 = Math.floor(outerTop + 0.08 * (outerBot - outerTop));
  const vy1 = Math.floor(outerTop + 0.45 * (outerBot - outerTop));
  let outerLeft: number | null = null;
  for (let x = Math.floor(0.01 * w); x < Math.floor(0.45 * w); x++) {
    if (colStats(x, vy0, vy1).dark >= 0.55) {
      outerLeft = x;
      break;
    }
  }
  let outerRight: number | null = null;
  for (let x = Math.floor(0.98 * w); x > Math.floor(0.45 * w); x--) {
    if (colStats(x, vy0, vy1).dark >= 0.55) {
      outerRight = x;
      break;
    }
  }
  if (outerLeft === null || outerRight === null || outerRight - outerLeft < w * 0.2) return null;

  const spanW = outerRight - outerLeft;
  const spanH = outerBot - outerTop;

  const findInnerEdge = (
    start: number,
    step: number,
    maxSteps: number,
    statFn: (pos: number, a: number, b: number) => { dark: number; line: number; nw: number },
    spanA: number,
    spanB: number
  ): number => {
    let sawGap = false;
    let fallbackInnerLine: number | null = null;
    for (let s = 2; s < maxSteps - 12; s++) {
      const idx = start + step * s;
      const { line, nw } = statFn(idx, spanA, spanB);
      if (nw < 0.45) {
        sawGap = true;
      } else if (sawGap && line >= 0.7) {
        let sumNw = 0;
        for (let k = 1; k <= 10; k++) {
          sumNw += statFn(start + step * (s + k), spanA, spanB).nw;
        }
        if (sumNw / 10 >= 0.62) {
          return idx;
        }
        if (s >= Math.floor(maxSteps * 0.25) && line >= 0.78) {
          fallbackInnerLine = idx;
        }
      }
    }
    return fallbackInnerLine ?? start;
  };

  const inLeft = findInnerEdge(
    outerLeft,
    1,
    Math.floor(0.08 * spanW),
    colStats,
    Math.floor(outerTop + 0.12 * spanH),
    Math.floor(outerTop + 0.45 * spanH)
  );
  const inRight = findInnerEdge(
    outerRight,
    -1,
    Math.floor(0.08 * spanW),
    colStats,
    Math.floor(outerTop + 0.12 * spanH),
    Math.floor(outerTop + 0.55 * spanH)
  );
  const inTop = findInnerEdge(
    outerTop,
    1,
    Math.floor(0.08 * spanH),
    rowStats,
    Math.floor(outerLeft + 0.25 * spanW),
    Math.floor(outerLeft + 0.75 * spanW)
  );
  const inBot = findInnerEdge(
    outerBot,
    -1,
    Math.floor(0.08 * spanH),
    rowStats,
    Math.floor(outerLeft + 0.45 * spanW),
    Math.floor(outerLeft + 0.85 * spanW)
  );

  const refineEdgeFullRes = (
    approxNorm: number,
    orthoNormStart: number,
    orthoNormEnd: number,
    isHorizontal: boolean
  ): number => {
    const patchLen = 140;
    const searchHalf = 28;
    const centerOrtho = (orthoNormStart + orthoNormEnd) / 2;
    const sx = isHorizontal
      ? Math.max(0, Math.min(natW - patchLen, Math.round(centerOrtho * natW - patchLen / 2)))
      : Math.max(0, Math.min(natW - 2 * searchHalf, Math.round(approxNorm * natW - searchHalf)));
    const sy = isHorizontal
      ? Math.max(0, Math.min(natH - 2 * searchHalf, Math.round(approxNorm * natH - searchHalf)))
      : Math.max(0, Math.min(natH - patchLen, Math.round(centerOrtho * natH - patchLen / 2)));
    const pw = isHorizontal ? patchLen : Math.min(2 * searchHalf, natW - sx);
    const ph = isHorizontal ? Math.min(2 * searchHalf, natH - sy) : patchLen;
    if (pw < 20 || ph < 20) return approxNorm;

    const pCanvas = document.createElement('canvas');
    pCanvas.width = pw;
    pCanvas.height = ph;
    const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });
    if (!pCtx) return approxNorm;
    pCtx.drawImage(img, sx, sy, pw, ph, 0, 0, pw, ph);
    const pData = pCtx.getImageData(0, 0, pw, ph).data;

    const approxLocal = isHorizontal
      ? Math.round(approxNorm * natH) - sy
      : Math.round(approxNorm * natW) - sx;
    let bestPos = approxLocal;
    let bestScore = -1e9;
    const limit = isHorizontal ? ph : pw;
    const span = isHorizontal ? pw : ph;
    for (let i = 2; i < limit - 2; i++) {
      let darkCnt = 0;
      let darknessSum = 0;
      for (let j = 0; j < span; j++) {
        const px = isHorizontal ? j : i;
        const py = isHorizontal ? i : j;
        const k = (py * pw + px) * 4;
        const v = 0.299 * pData[k] + 0.587 * pData[k + 1] + 0.114 * pData[k + 2];
        if (v < 145) darkCnt++;
        darknessSum += 255 - v;
      }
      const ratio = darkCnt / span;
      if (ratio >= 0.72) {
        const score = ratio * 1000 + darknessSum / span - Math.abs(i - approxLocal) * 2;
        if (score > bestScore) {
          bestScore = score;
          bestPos = i;
        }
      }
    }
    return isHorizontal ? (sy + bestPos) / natH : (sx + bestPos) / natW;
  };

  const finalLeft = refineEdgeFullRes(inLeft / w, inTop / h, inBot / h, false);
  const finalRight = refineEdgeFullRes(inRight / w, inTop / h, inBot / h, false);
  const finalTop = refineEdgeFullRes(inTop / h, inLeft / w, inRight / w, true);
  const finalBot = refineEdgeFullRes(inBot / h, inLeft / w, inRight / w, true);

  if (finalRight <= finalLeft + 0.1 || finalBot <= finalTop + 0.1) return null;
  return {
    x: finalLeft,
    y: finalTop,
    w: finalRight - finalLeft,
    h: finalBot - finalTop,
  };
}
