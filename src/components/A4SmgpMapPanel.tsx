import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  ArrowLeftRight,
  Crop,
  Crosshair,
  Download,
  Eraser,
  ExternalLink,
  FileImage,
  FileText,
  ImagePlus,
  Loader2,
  Map as MapIcon,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react';
import { renderSmgpA4SheetCanvas, type A4WhiteMaskRect } from '../data/a4MapCanvas';
import {
  analyzeCrossSectionCutout,
  computePerpendicularProjectionOnLine,
  detectCrossSectionBandsOnRaster,
  detectCrossSectionLinesOnRaster,
  evaluatePointAtTAlongPolyline,
  extractBandCutoutFromRaster,
  inferSectionBandFromCropRect,
  normalizeSectionSymbol,
  type CrossSectionCutoutAnalysis,
  type CrossSectionLineDef,
  type DetectedBand,
  type NormPt,
} from '../data/smgpCrossSectionDetect';
import type { SmgpMapMeta, SmgpSharedAssets } from '../data/terrainTypes';

interface A4SmgpMapPanelProps {
  lat: number | null;
  lon: number | null;
  validInPoland: boolean;
  onSmgpAssetsChange?: (assets: SmgpSharedAssets) => void;
}

type CropTargetSlot = 'map' | 'cross' | 'legend1' | 'legend2' | 'authors';
type MapCalibMode = 'auto' | 'corners' | 'neatline' | 'manual';

interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SmgpUndoSnapshot {
  label: string;
  headerLabel: string;
  layoutOrder: 'cross-below-map' | 'cross-at-bottom';
  northLatText: string;
  southLatText: string;
  westLonText: string;
  eastLonText: string;
  calibratedNeatline: NormRect | null;
  neatlineSource: 'auto' | 'manual' | null;
  mapCropMode: MapCalibMode;
  customMapImageUrl: string | null;
  markerXPercent: number;
  markerYPercent: number;
  crossSectionImageUrl: string | null;
  crossFromRaster: boolean;
  crossCutoutMeta: CrossSectionCutoutAnalysis | null;
  crossTargetScale: 'auto-100k' | 'fit' | 'original-50k';
  crossScaleOverride: string;
  crossHeaderMaskPercent: number;
  selectedSectionSymbol: string;
  arrowPercent: number;
  arrowMode: 'auto' | 'manual';
  sectionLines: Record<string, CrossSectionLineDef>;
  legendCol1ImageUrl: string | null;
  legendCol2ImageUrl: string | null;
  authorsImageUrl: string | null;
  whiteMasks: A4WhiteMaskRect[];
}

function parseAxisCoord(raw: string): number | null {
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

function formatDmsShort(deg: number): string {
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

function readFileAsDataUrl(file: File): Promise<string> {
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

function cropImageFromElement(img: HTMLImageElement, rect: NormRect): string {
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

function computeCenteredMapRect(
  img: HTMLImageElement,
  neatline: NormRect,
  uPercent: number,
  vPercentFromTop: number,
  sheetGroundSpan?: { groundW: number; groundH: number } | null
): { cropRect: NormRect; markerXPercent: number; markerYPercent: number } {
  const u = Math.max(0, Math.min(1, uPercent / 100));
  const v = Math.max(0, Math.min(1, vPercentFromTop / 100));
  const ptX = neatline.x + u * neatline.w;
  const ptY = neatline.y + v * neatline.h;

  const pixelAspectCorrection = img.naturalWidth / Math.max(1, img.naturalHeight);
  const targetRatioYOverX = (570 / 1320) * pixelAspectCorrection;

  // Preserve exact 1:50 000 scale on A4 (132 mm x 57 mm frame = 6600 m x 2850 m on ground)
  let targetW = sheetGroundSpan
    ? Math.min(neatline.w, neatline.w * (6600 / Math.max(1000, sheetGroundSpan.groundW)))
    : Math.min(neatline.w, neatline.w * 0.365);
  let targetH = targetW * targetRatioYOverX;

  if (targetH > neatline.h) {
    targetH = neatline.h;
    targetW = Math.min(neatline.w, targetH / targetRatioYOverX);
  }

  // Clamp window inside neatline instead of shrinking so 1:50 000 scale stays 100% preserved
  const winX = Math.max(
    neatline.x,
    Math.min(neatline.x + neatline.w - targetW, ptX - targetW / 2)
  );
  const winY = Math.max(
    neatline.y,
    Math.min(neatline.y + neatline.h - targetH, ptY - targetH / 2)
  );

  return {
    cropRect: { x: winX, y: winY, w: targetW, h: targetH },
    markerXPercent: Number((((ptX - winX) / targetW) * 100).toFixed(1)),
    markerYPercent: Number((((ptY - winY) / targetH) * 100).toFixed(1)),
  };
}

function detectMapNeatlineFromImage(img: HTMLImageElement): NormRect | null {
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

const SLOT_LABELS: Record<CropTargetSlot, string> = {
  map: '1. Wycinek mapy z rastra',
  cross: '2. Przekrój geologiczny',
  legend1: '3. Legenda – kol. 1',
  legend2: '4. Legenda – kol. 2',
  authors: '5. Autorzy arkusza',
};

export function A4SmgpMapPanel({
  lat,
  lon,
  validInPoland,
  onSmgpAssetsChange,
}: A4SmgpMapPanelProps) {
  const [headerLabel, setHeaderLabel] = useState<string>('ZAŁ.3');
  const [layoutOrder, setLayoutOrder] = useState<'cross-below-map' | 'cross-at-bottom'>(
    'cross-below-map'
  );
  const [smgpMeta, setSmgpMeta] = useState<SmgpMapMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(false);

  // Geographic frame border coordinates (editable, auto-filled from sheetBounds)
  const [northLatText, setNorthLatText] = useState<string>('');
  const [southLatText, setSouthLatText] = useState<string>('');
  const [westLonText, setWestLonText] = useState<string>('');
  const [eastLonText, setEastLonText] = useState<string>('');

  // Full SMGP raster JPG/PNG sheet (persisted in server smgp-sheets/)
  const [sourceSheetUrl, setSourceSheetUrl] = useState<string | null>(null);
  const [savingToFolder, setSavingToFolder] = useState<boolean>(false);
  const [savedSheetName, setSavedSheetName] = useState<string | null>(null);
  const [calibratedNeatline, setCalibratedNeatline] = useState<NormRect | null>(null);
  const [neatlineSource, setNeatlineSource] = useState<'auto' | 'manual' | null>(null);
  const [cornerTL, setCornerTL] = useState<{ x: number; y: number } | null>(null);
  const [cropZoom, setCropZoom] = useState<1 | 1.5 | 2>(1);
  const [activeCropSlot, setActiveCropSlot] = useState<CropTargetSlot>('map');
  const [mapCropMode, setMapCropMode] = useState<MapCalibMode>('auto');
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const sourceImgRef = useRef<HTMLImageElement | null>(null);
  const rasterScrollRef = useRef<HTMLDivElement | null>(null);
  const rasterStageRef = useRef<HTMLDivElement | null>(null);
  const pendingAutoDetectRef = useRef<boolean>(false);
  const skipNextAutoCropRef = useRef<boolean>(false);
  const [draggingProjSquare, setDraggingProjSquare] = useState<boolean>(false);
  const [draggingEndpoint, setDraggingEndpoint] = useState<{
    symbol: string;
    end: 'start' | 'end';
  } | null>(null);
  const [undoStack, setUndoStack] = useState<SmgpUndoSnapshot[]>([]);

  // Cropped pieces for A4 page
  const [customMapImageUrl, setCustomMapImageUrl] = useState<string | null>(null);
  const [markerXPercent, setMarkerXPercent] = useState<number>(50);
  const [markerYPercent, setMarkerYPercent] = useState<number>(50);

  const [crossSectionImageUrl, setCrossSectionImageUrl] = useState<string | null>(null);
  const [crossFromRaster, setCrossFromRaster] = useState<boolean>(false);
  const [crossTargetScale, setCrossTargetScale] = useState<'auto-100k' | 'fit' | 'original-50k'>(
    'auto-100k'
  );
  const [crossScaleOverride, setCrossScaleOverride] = useState<string>('');
  const [crossHeaderMaskPercent, setCrossHeaderMaskPercent] = useState<number>(16);
  const [selectedSectionSymbol, setSelectedSectionSymbol] = useState<string>('');
  const [arrowPercent, setArrowPercent] = useState<number>(50);
  const [arrowMode, setArrowMode] = useState<'auto' | 'manual'>('auto');

  // Detected / defined cross-section lines on map & cutout recognition metadata
  const [detectedBands, setDetectedBands] = useState<DetectedBand[]>([]);
  const [autoBandCutouts, setAutoBandCutouts] = useState<
    Record<string, { dataUrl: string; analysis: CrossSectionCutoutAnalysis; band: DetectedBand }>
  >({});
  const [sectionLines, setSectionLines] = useState<Record<string, CrossSectionLineDef>>({});
  const sectionLinesRef = useRef<Record<string, CrossSectionLineDef>>({});
  sectionLinesRef.current = sectionLines;
  const [sectionPickTarget, setSectionPickTarget] = useState<string | null>(null);
  const [sectionPickFirstPt, setSectionPickFirstPt] = useState<NormPt | null>(null);
  const [crossCutoutMeta, setCrossCutoutMeta] = useState<CrossSectionCutoutAnalysis | null>(null);

  const [legendCol1ImageUrl, setLegendCol1ImageUrl] = useState<string | null>(null);
  const [legendCol2ImageUrl, setLegendCol2ImageUrl] = useState<string | null>(null);
  const [authorsImageUrl, setAuthorsImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!onSmgpAssetsChange) return;
    onSmgpAssetsChange({
      mapImageUrl: customMapImageUrl,
      markerXPercent,
      markerYPercent,
      legendCol1ImageUrl,
      legendCol2ImageUrl,
      crossSectionImageUrl,
      portalAvailable: smgpMeta ? smgpMeta.portalAvailable : null,
    });
  }, [
    onSmgpAssetsChange,
    customMapImageUrl,
    markerXPercent,
    markerYPercent,
    legendCol1ImageUrl,
    legendCol2ImageUrl,
    crossSectionImageUrl,
    smgpMeta,
  ]);

  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // Interactive white artifact-masking rectangles drawn directly on the generated A4 sheet
  const [whiteMasks, setWhiteMasks] = useState<A4WhiteMaskRect[]>([]);
  const [maskDrawMode, setMaskDrawMode] = useState<boolean>(false);
  const [showMaskOutlines, setShowMaskOutlines] = useState<boolean>(true);
  const [previewZoom, setPreviewZoom] = useState<1 | 1.5 | 2>(1);
  const [maskDragStart, setMaskDragStart] = useState<{ x: number; y: number } | null>(null);
  const [maskDragCurrent, setMaskDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const applyMetaBoundsToInputs = (bounds: SmgpMapMeta['sheetBounds'] | undefined) => {
    if (!bounds) return;
    setNorthLatText(formatDmsShort(bounds.maxLat));
    setSouthLatText(formatDmsShort(bounds.minLat));
    setWestLonText(formatDmsShort(bounds.minLon));
    setEastLonText(formatDmsShort(bounds.maxLon));
  };

  useEffect(() => {
    if (lat === null || lon === null || !validInPoland) {
      setSmgpMeta(null);
      return;
    }
    let cancelled = false;
    setLoadingMeta(true);
    fetch(`/api/smgp-map-meta?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SmgpMapMeta | null) => {
        if (cancelled || !data) return;
        setSmgpMeta(data);
        setUndoStack([]);
        applyMetaBoundsToInputs(data.sheetBounds);

        if (data.crossSections.length > 0) {
          setSelectedSectionSymbol(normalizeSectionSymbol(data.crossSections[0].symbol));
          setArrowPercent(data.crossSections[0].projectionPercent);
          setArrowMode('auto');
        } else {
          setSelectedSectionSymbol('A–B');
          setArrowPercent(50);
          setArrowMode('auto');
        }

        // Load saved manual cross-section lines for this sheet (if any)
        let savedManualSections: Record<string, CrossSectionLineDef> = {};
        if (data.sheetNumber) {
          try {
            const rawSec = localStorage.getItem(`progeo_smgp_sections_${data.sheetNumber}`);
            if (rawSec) {
              const parsed = JSON.parse(rawSec) as Record<string, CrossSectionLineDef>;
              if (parsed && typeof parsed === 'object') {
                savedManualSections = parsed;
              }
            }
          } catch {
            savedManualSections = {};
          }
        }
        setSectionLines(savedManualSections);
        setSectionPickTarget(null);
        setSectionPickFirstPt(null);

        let loadedManualRect: NormRect | null = null;
        if (data.sheetNumber) {
          try {
            const rawRect = localStorage.getItem(`progeo_smgp_neatline_${data.sheetNumber}`);
            if (rawRect) {
              const parsed = JSON.parse(rawRect) as NormRect & { manual?: boolean };
              if (parsed.manual && typeof parsed.x === 'number' && typeof parsed.w === 'number') {
                loadedManualRect = { x: parsed.x, y: parsed.y, w: parsed.w, h: parsed.h };
              }
            }
          } catch {
            loadedManualRect = null;
          }
        }

        if (loadedManualRect) {
          setCalibratedNeatline(loadedManualRect);
          setNeatlineSource('manual');
        } else {
          setCalibratedNeatline(null);
          setNeatlineSource(null);
        }

        if (data.savedScanUrl) {
          setSourceSheetUrl(data.savedScanUrl);
          setSavedSheetName(`smgp${(data.sheetNumber ?? '').padStart(4, '0')}`);
        } else {
          setSavedSheetName(null);
          setSourceSheetUrl(null);
        }
      })
      .catch(() => {
        // tolerate offline metadata failure
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, validInPoland]);

  const parsedBorder = useMemo(() => {
    const nLat = parseAxisCoord(northLatText);
    const sLat = parseAxisCoord(southLatText);
    const wLon = parseAxisCoord(westLonText);
    const eLon = parseAxisCoord(eastLonText);
    if (
      nLat === null ||
      sLat === null ||
      wLon === null ||
      eLon === null ||
      nLat <= sLat ||
      eLon <= wLon
    ) {
      return null;
    }
    return { nLat, sLat, wLon, eLon };
  }, [northLatText, southLatText, westLonText, eastLonText]);

  const interpolatedPercent = useMemo(() => {
    if (lat === null || lon === null) return null;
    if (parsedBorder) {
      const rawU = ((lon - parsedBorder.wLon) / (parsedBorder.eLon - parsedBorder.wLon)) * 100;
      const rawV = ((parsedBorder.nLat - lat) / (parsedBorder.nLat - parsedBorder.sLat)) * 100;
      return {
        uPercent: Number(Math.max(0, Math.min(100, rawU)).toFixed(2)),
        vPercentFromTop: Number(Math.max(0, Math.min(100, rawV)).toFixed(2)),
        outOfFrame: rawU < 0 || rawU > 100 || rawV < 0 || rawV > 100,
      };
    }
    if (smgpMeta?.pointInSheetPercent) {
      return { ...smgpMeta.pointInSheetPercent, outOfFrame: false };
    }
    return null;
  }, [lat, lon, parsedBorder, smgpMeta]);

  const sheetGroundSpan = useMemo(() => {
    const bounds = parsedBorder
      ? {
          minLon: parsedBorder.wLon,
          maxLon: parsedBorder.eLon,
          minLat: parsedBorder.sLat,
          maxLat: parsedBorder.nLat,
        }
      : smgpMeta?.sheetBounds ?? null;
    if (!bounds) return null;
    const midLat = (bounds.minLat + bounds.maxLat) / 2;
    const groundW =
      (bounds.maxLon - bounds.minLon) * 111320 * Math.cos((midLat * Math.PI) / 180);
    const groundH = (bounds.maxLat - bounds.minLat) * 111132;
    if (groundW <= 500 || groundH <= 500) return null;
    return { groundW, groundH };
  }, [parsedBorder, smgpMeta?.sheetBounds]);

  const sheetPxPerMm = useMemo(() => {
    if (!calibratedNeatline || !imgDims || !sheetGroundSpan) return null;
    const mapWidthMmAt50k = sheetGroundSpan.groundW / 50; // meters / 50 = mm on 1:50 000 sheet
    if (mapWidthMmAt50k <= 10) return null;
    return (calibratedNeatline.w * imgDims.w) / mapWidthMmAt50k;
  }, [calibratedNeatline, imgDims, sheetGroundSpan]);

  const applyCenteredNeatlineCrop = (img: HTMLImageElement, neatline: NormRect) => {
    if (!interpolatedPercent) return;
    const { cropRect, markerXPercent: mx, markerYPercent: my } = computeCenteredMapRect(
      img,
      neatline,
      interpolatedPercent.uPercent,
      interpolatedPercent.vPercentFromTop,
      sheetGroundSpan
    );
    const cropped = cropImageFromElement(img, cropRect);
    setCustomMapImageUrl(cropped);
    setMarkerXPercent(mx);
    setMarkerYPercent(my);
  };

  useEffect(() => {
    const img = sourceImgRef.current;
    if (
      sourceSheetUrl &&
      img &&
      img.complete &&
      img.naturalWidth > 0 &&
      !calibratedNeatline &&
      neatlineSource !== 'manual'
    ) {
      runAutoDetectNeatline(img);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSheetUrl, calibratedNeatline, neatlineSource, imgDims?.w, imgDims?.h]);

  useEffect(() => {
    if (skipNextAutoCropRef.current) {
      skipNextAutoCropRef.current = false;
      return;
    }
    const img = sourceImgRef.current;
    if (
      img &&
      img.complete &&
      img.naturalWidth > 0 &&
      calibratedNeatline &&
      interpolatedPercent &&
      mapCropMode !== 'manual'
    ) {
      try {
        applyCenteredNeatlineCrop(img, calibratedNeatline);
      } catch {
        // ignore decode error
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    interpolatedPercent?.uPercent,
    interpolatedPercent?.vPercentFromTop,
    calibratedNeatline,
    sheetGroundSpan?.groundW,
    sourceSheetUrl,
    imgDims?.w,
    imgDims?.h,
    mapCropMode,
  ]);

  const overlayPreview = useMemo(() => {
    if (!calibratedNeatline || !interpolatedPercent) return null;
    const ptX = calibratedNeatline.x + (interpolatedPercent.uPercent / 100) * calibratedNeatline.w;
    const ptY =
      calibratedNeatline.y + (interpolatedPercent.vPercentFromTop / 100) * calibratedNeatline.h;

    let cropBox: NormRect | null = null;
    let expectedMarkerX = 50;
    let expectedMarkerY = 50;
    if (sourceImgRef.current && sourceImgRef.current.naturalWidth > 0) {
      const centered = computeCenteredMapRect(
        sourceImgRef.current,
        calibratedNeatline,
        interpolatedPercent.uPercent,
        interpolatedPercent.vPercentFromTop,
        sheetGroundSpan
      );
      cropBox = centered.cropRect;
      expectedMarkerX = centered.markerXPercent;
      expectedMarkerY = centered.markerYPercent;
    }
    return { ptX, ptY, cropBox, expectedMarkerX, expectedMarkerY };
  }, [calibratedNeatline, interpolatedPercent, imgDims, sheetGroundSpan]);

  const isPointDisplacedFromCoords = Boolean(
    customMapImageUrl &&
      (mapCropMode === 'manual' ||
        neatlineSource === 'manual' ||
        (overlayPreview &&
          (Math.abs(markerXPercent - overlayPreview.expectedMarkerX) > 0.25 ||
            Math.abs(markerYPercent - overlayPreview.expectedMarkerY) > 0.25)))
  );

  const availableSectionSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const s of smgpMeta?.crossSections ?? []) {
      const sym = normalizeSectionSymbol(s.symbol);
      if (sym) set.add(sym);
    }
    for (const b of detectedBands) {
      if (b.defaultSymbol) set.add(b.defaultSymbol);
    }
    for (const sym of Object.keys(sectionLines)) {
      if (sym) set.add(sym);
    }
    if (set.size === 0) {
      set.add('A–B');
      set.add('C–D');
    } else if (!set.has('C–D') && !smgpMeta?.portalAvailable) {
      set.add('C–D');
    }
    return Array.from(set);
  }, [smgpMeta?.crossSections, smgpMeta?.portalAvailable, detectedBands, sectionLines]);

  const persistManualSectionLines = (nextMap: Record<string, CrossSectionLineDef>) => {
    if (!smgpMeta?.sheetNumber) return;
    const manualsOnly: Record<string, CrossSectionLineDef> = {};
    for (const [k, v] of Object.entries(nextMap)) {
      if (v.source === 'manual') manualsOnly[k] = v;
    }
    try {
      if (Object.keys(manualsOnly).length > 0) {
        localStorage.setItem(
          `progeo_smgp_sections_${smgpMeta.sheetNumber}`,
          JSON.stringify(manualsOnly)
        );
      } else {
        localStorage.removeItem(`progeo_smgp_sections_${smgpMeta.sheetNumber}`);
      }
    } catch {
      // ignore
    }
  };

  const cloneSectionLines = (
    lines: Record<string, CrossSectionLineDef>
  ): Record<string, CrossSectionLineDef> => {
    const copy: Record<string, CrossSectionLineDef> = {};
    for (const [k, v] of Object.entries(lines)) {
      copy[k] = { ...v, points: v.points.map((p) => ({ ...p })) };
    }
    return copy;
  };

  const pushUndoSnapshot = (label: string) => {
    const snapshot: SmgpUndoSnapshot = {
      label,
      headerLabel,
      layoutOrder,
      northLatText,
      southLatText,
      westLonText,
      eastLonText,
      calibratedNeatline: calibratedNeatline ? { ...calibratedNeatline } : null,
      neatlineSource,
      mapCropMode,
      customMapImageUrl,
      markerXPercent,
      markerYPercent,
      crossSectionImageUrl,
      crossFromRaster,
      crossCutoutMeta: crossCutoutMeta ? { ...crossCutoutMeta } : null,
      crossTargetScale,
      crossScaleOverride,
      crossHeaderMaskPercent,
      selectedSectionSymbol,
      arrowPercent,
      arrowMode,
      sectionLines: cloneSectionLines(sectionLinesRef.current),
      legendCol1ImageUrl,
      legendCol2ImageUrl,
      authorsImageUrl,
      whiteMasks: whiteMasks.map((m) => ({ ...m })),
    };
    setUndoStack((prev) => [...prev.slice(-29), snapshot]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    skipNextAutoCropRef.current = true;

    setHeaderLabel(snap.headerLabel);
    setLayoutOrder(snap.layoutOrder);
    setNorthLatText(snap.northLatText);
    setSouthLatText(snap.southLatText);
    setWestLonText(snap.westLonText);
    setEastLonText(snap.eastLonText);
    setCalibratedNeatline(snap.calibratedNeatline);
    setNeatlineSource(snap.neatlineSource);
    setMapCropMode(snap.mapCropMode);
    setCustomMapImageUrl(snap.customMapImageUrl);
    setMarkerXPercent(snap.markerXPercent);
    setMarkerYPercent(snap.markerYPercent);
    setCrossSectionImageUrl(snap.crossSectionImageUrl);
    setCrossFromRaster(snap.crossFromRaster);
    setCrossCutoutMeta(snap.crossCutoutMeta);
    setCrossTargetScale(snap.crossTargetScale);
    setCrossScaleOverride(snap.crossScaleOverride);
    setCrossHeaderMaskPercent(snap.crossHeaderMaskPercent);
    setSelectedSectionSymbol(snap.selectedSectionSymbol);
    setArrowPercent(snap.arrowPercent);
    setArrowMode(snap.arrowMode);
    setSectionLines(snap.sectionLines);
    sectionLinesRef.current = snap.sectionLines;
    setLegendCol1ImageUrl(snap.legendCol1ImageUrl);
    setLegendCol2ImageUrl(snap.legendCol2ImageUrl);
    setAuthorsImageUrl(snap.authorsImageUrl);
    setWhiteMasks(snap.whiteMasks);

    setCornerTL(null);
    setDragStart(null);
    setDragCurrent(null);
    setSectionPickTarget(null);
    setSectionPickFirstPt(null);
    setDraggingProjSquare(false);
    setDraggingEndpoint(null);
    setMaskDragStart(null);
    setMaskDragCurrent(null);
    setError(null);

    persistManualSectionLines(snap.sectionLines);
    if (smgpMeta?.sheetNumber) {
      try {
        if (snap.neatlineSource === 'manual' && snap.calibratedNeatline) {
          localStorage.setItem(
            `progeo_smgp_neatline_${smgpMeta.sheetNumber}`,
            JSON.stringify({ ...snap.calibratedNeatline, manual: true })
          );
        } else {
          localStorage.removeItem(`progeo_smgp_neatline_${smgpMeta.sheetNumber}`);
        }
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') {
        const target = ev.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'TEXTAREA' ||
            (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') ||
            target.isContentEditable)
        ) {
          return;
        }
        if (undoStack.length > 0) {
          ev.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const applyAutoBandCutout = (entry: {
    dataUrl: string;
    analysis: CrossSectionCutoutAnalysis;
  }) => {
    setCrossSectionImageUrl(entry.dataUrl);
    setCrossFromRaster(true);
    setCrossCutoutMeta(entry.analysis);
    setCrossHeaderMaskPercent(0);
  };

  const runDetectCrossSectionsOnRaster = (
    imgOverride?: HTMLImageElement | null,
    neatlineOverride?: NormRect | null,
    forceReplaceAuto = false
  ) => {
    const img = imgOverride ?? sourceImgRef.current;
    const nl = neatlineOverride ?? calibratedNeatline;
    if (!img || !img.complete || img.naturalWidth === 0 || !nl) return;

    if (forceReplaceAuto) {
      pushUndoSnapshot('Wykrycie linii przekrojów z rastra');
    }

    const bands = detectCrossSectionBandsOnRaster(img, nl);
    setDetectedBands(bands);

    // Automatically crop each detected cross-section band below the neatline.
    // Keep canonical top-to-bottom band symbol (A–B, C–D, ...) unless OCR confidence is high,
    // so noisy letters never swap A–B with C–D.
    const nextCutouts: Record<
      string,
      { dataUrl: string; analysis: CrossSectionCutoutAnalysis; band: DetectedBand }
    > = {};
    for (const band of bands) {
      const extracted = extractBandCutoutFromRaster(img, band, availableSectionSymbols);
      if (!extracted) continue;
      const recognized = normalizeSectionSymbol(extracted.analysis.recognizedSymbol);
      const fallbackSym = normalizeSectionSymbol(band.defaultSymbol);
      const key =
        extracted.analysis.confidence === 'high' && recognized && !nextCutouts[recognized]
          ? recognized
          : fallbackSym;
      if (key) {
        nextCutouts[key] = {
          dataUrl: extracted.dataUrl,
          analysis: { ...extracted.analysis, recognizedSymbol: key },
          band,
        };
      }
    }
    setAutoBandCutouts(nextCutouts);

    // Auto-insert the matching cross-section cutout directly under the map if user hasn't pasted an external cutout
    const firstKey = Object.keys(nextCutouts)[0];
    if (firstKey && (!crossSectionImageUrl || crossFromRaster || forceReplaceAuto)) {
      const targetEntry = nextCutouts[activeSectionSymbol] ?? nextCutouts[firstKey];
      if (targetEntry) {
        applyAutoBandCutout(targetEntry);
        if (!selectedSectionSymbol && targetEntry.analysis.recognizedSymbol) {
          setSelectedSectionSymbol(targetEntry.analysis.recognizedSymbol);
        }
      }
    }

    // If portal vectors exist, don't overwrite them with heuristic line detection
    const hasPortalVectors = Boolean(
      smgpMeta?.crossSections?.some((s) => s.pathsWgs84 && s.pathsWgs84.length > 0)
    );
    if (hasPortalVectors && !forceReplaceAuto) return;

    // Always preserve canonical band order (A–B first, then C–D, ...) when matching lines on the map
    const expected =
      bands.length > 0
        ? bands.map((b) => b.defaultSymbol)
        : availableSectionSymbols.length > 0
          ? availableSectionSymbols
          : ['A–B', 'C–D'];

    const detectedLines = detectCrossSectionLinesOnRaster(img, nl, expected);
    if (detectedLines.length > 0) {
      setSectionLines((prev) => {
        const next = { ...prev };
        for (const dl of detectedLines) {
          if (forceReplaceAuto || !next[dl.symbol] || next[dl.symbol].source !== 'manual') {
            next[dl.symbol] = dl;
          }
        }
        return next;
      });
    }
  };

  // Populate vector cross-section lines from PIG-PIB when portalAvailable === true
  useEffect(() => {
    if (!calibratedNeatline || !smgpMeta?.crossSections?.length) return;
    const bounds = parsedBorder
      ? {
          minLon: parsedBorder.wLon,
          maxLon: parsedBorder.eLon,
          minLat: parsedBorder.sLat,
          maxLat: parsedBorder.nLat,
        }
      : smgpMeta.sheetBounds;
    if (!bounds) return;

    const dLon = bounds.maxLon - bounds.minLon;
    const dLat = bounds.maxLat - bounds.minLat;
    if (dLon <= 0 || dLat <= 0) return;

    const vectorDefs: CrossSectionLineDef[] = [];
    for (const sec of smgpMeta.crossSections) {
      const sym = normalizeSectionSymbol(sec.symbol);
      const pts = sec.pathsWgs84?.[0];
      if (!sym || !pts || pts.length < 2) continue;
      const mapped = pts.map((p) => {
        const u = (p.lon - bounds.minLon) / dLon;
        const v = (bounds.maxLat - p.lat) / dLat;
        return {
          x: calibratedNeatline.x + u * calibratedNeatline.w,
          y: calibratedNeatline.y + v * calibratedNeatline.h,
        };
      });
      vectorDefs.push({ symbol: sym, points: mapped, source: 'vector' });
    }

    if (vectorDefs.length > 0) {
      setSectionLines((prev) => {
        const next = { ...prev };
        for (const vd of vectorDefs) {
          if (!next[vd.symbol] || next[vd.symbol].source !== 'manual') {
            next[vd.symbol] = vd;
          }
        }
        return next;
      });
    }
  }, [calibratedNeatline, parsedBorder, smgpMeta?.crossSections, smgpMeta?.sheetBounds]);

  // Trigger band & raster cross-section line detection once neatline is calibrated
  useEffect(() => {
    const img = sourceImgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && calibratedNeatline) {
      runDetectCrossSectionsOnRaster(img, calibratedNeatline, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibratedNeatline, sourceSheetUrl, smgpMeta?.portalAvailable]);

  const activeSectionSymbol = useMemo(() => {
    const clean = normalizeSectionSymbol(selectedSectionSymbol);
    if (clean) return clean;
    return availableSectionSymbols[0] || 'A–B';
  }, [selectedSectionSymbol, availableSectionSymbols]);

  const activePerpProjection = useMemo(() => {
    const axisL = crossCutoutMeta?.axisLeftNorm ?? 0.03;
    const axisR = crossCutoutMeta?.axisRightNorm ?? 0.97;
    const lineDef = sectionLines[activeSectionSymbol];
    if (overlayPreview && lineDef && lineDef.points.length >= 2) {
      const aspect =
        imgDims && imgDims.h > 0 ? imgDims.w / imgDims.h : 1.24;
      const proj = computePerpendicularProjectionOnLine(
        { x: overlayPreview.ptX, y: overlayPreview.ptY },
        lineDef.points,
        aspect,
        axisL,
        axisR,
        Boolean(lineDef.reversed)
      );
      if (proj) {
        return { ...proj, source: lineDef.source };
      }
    }

    const portalSec = smgpMeta?.crossSections.find(
      (s) => normalizeSectionSymbol(s.symbol) === activeSectionSymbol
    );
    if (portalSec) {
      const frac = Math.max(0, Math.min(1, portalSec.projectionPercent / 100));
      const arrowPct = Number(((axisL + frac * (axisR - axisL)) * 100).toFixed(1));
      return {
        tAlong: frac,
        arrowPercent: arrowPct,
        projPt: null as NormPt | null,
        distNorm: 0,
        source: 'vector' as const,
      };
    }

    return null;
  }, [
    activeSectionSymbol,
    sectionLines,
    overlayPreview,
    imgDims,
    crossCutoutMeta?.axisLeftNorm,
    crossCutoutMeta?.axisRightNorm,
    smgpMeta?.crossSections,
  ]);

  const displayedProjSquarePt = useMemo((): NormPt | null => {
    const lineDef = sectionLines[activeSectionSymbol];
    if (lineDef && lineDef.points.length >= 2) {
      if (arrowMode === 'auto' && activePerpProjection?.projPt) {
        return activePerpProjection.projPt;
      }
      const axisL = Math.max(0, Math.min(0.45, crossCutoutMeta?.axisLeftNorm ?? 0.03));
      const axisR = Math.max(axisL + 0.2, Math.min(1, crossCutoutMeta?.axisRightNorm ?? 0.97));
      const tFromArrow = Math.max(0, Math.min(1, (arrowPercent / 100 - axisL) / (axisR - axisL)));
      const aspect = imgDims && imgDims.h > 0 ? imgDims.w / imgDims.h : 1.24;
      return evaluatePointAtTAlongPolyline(
        lineDef.points,
        aspect,
        tFromArrow,
        Boolean(lineDef.reversed)
      );
    }
    return activePerpProjection?.projPt ?? null;
  }, [
    sectionLines,
    activeSectionSymbol,
    arrowMode,
    activePerpProjection?.projPt,
    arrowPercent,
    crossCutoutMeta?.axisLeftNorm,
    crossCutoutMeta?.axisRightNorm,
    imgDims,
  ]);

  useEffect(() => {
    if (arrowMode === 'auto' && activePerpProjection) {
      setArrowPercent(activePerpProjection.arrowPercent);
    }
  }, [arrowMode, activePerpProjection]);

  const updateArrowFromRasterPoint = (pt: NormPt) => {
    const lineDef = sectionLines[activeSectionSymbol];
    if (!lineDef || lineDef.points.length < 2) return;
    const axisL = crossCutoutMeta?.axisLeftNorm ?? 0.03;
    const axisR = crossCutoutMeta?.axisRightNorm ?? 0.97;
    const aspect = imgDims && imgDims.h > 0 ? imgDims.w / imgDims.h : 1.24;
    const proj = computePerpendicularProjectionOnLine(
      pt,
      lineDef.points,
      aspect,
      axisL,
      axisR,
      Boolean(lineDef.reversed)
    );
    if (!proj) return;
    setArrowMode('manual');
    setArrowPercent(proj.arrowPercent);
  };

  const updateEndpointFromRasterPoint = (
    symbol: string,
    end: 'start' | 'end',
    pt: NormPt
  ) => {
    const clamped: NormPt = {
      x: Math.max(0, Math.min(1, pt.x)),
      y: Math.max(0, Math.min(1, pt.y)),
    };
    setSectionLines((prev) => {
      const cur = prev[symbol];
      if (!cur || cur.points.length < 2) return prev;
      const nextPts = cur.points.map((p) => ({ ...p }));
      if (end === 'start') {
        nextPts[0] = clamped;
      } else {
        nextPts[nextPts.length - 1] = clamped;
      }
      const next: Record<string, CrossSectionLineDef> = {
        ...prev,
        [symbol]: {
          ...cur,
          points: nextPts,
          source: 'manual',
        },
      };
      sectionLinesRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    if (!draggingProjSquare) return;

    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const handleWindowMove = (ev: MouseEvent) => {
      const stage = rasterStageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / Math.max(1, rect.height)));
      updateArrowFromRasterPoint({ x, y });
    };

    const handleWindowUp = () => {
      setDraggingProjSquare(false);
    };

    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
    return () => {
      document.body.style.cursor = prevCursor;
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleWindowUp);
    };
  });

  useEffect(() => {
    if (!draggingEndpoint) return;

    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const handleWindowMove = (ev: MouseEvent) => {
      const stage = rasterStageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / Math.max(1, rect.height)));
      updateEndpointFromRasterPoint(draggingEndpoint.symbol, draggingEndpoint.end, { x, y });
    };

    const handleWindowUp = () => {
      persistManualSectionLines(sectionLinesRef.current);
      setDraggingEndpoint(null);
    };

    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
    return () => {
      document.body.style.cursor = prevCursor;
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleWindowUp);
    };
  });

  const currentKey =
    lat !== null && lon !== null
      ? [
          lat.toFixed(6),
          lon.toFixed(6),
          headerLabel.trim(),
          layoutOrder,
          activeSectionSymbol,
          arrowPercent.toFixed(1),
          crossTargetScale,
          crossScaleOverride.trim(),
          crossHeaderMaskPercent,
          crossFromRaster ? (sheetPxPerMm ?? 0).toFixed(2) : 'ext',
          markerXPercent.toFixed(1),
          markerYPercent.toFixed(1),
          customMapImageUrl ? customMapImageUrl.length : 0,
          crossSectionImageUrl ? crossSectionImageUrl.length : 0,
          legendCol1ImageUrl ? legendCol1ImageUrl.length : 0,
          legendCol2ImageUrl ? legendCol2ImageUrl.length : 0,
          authorsImageUrl ? authorsImageUrl.length : 0,
          whiteMasks.map((m) => `${m.x.toFixed(4)},${m.y.toFixed(4)},${m.w.toFixed(4)},${m.h.toFixed(4)}`).join('|'),
          smgpMeta?.sheetNumber ?? '',
        ].join(':')
      : null;

  const isStale = Boolean(previewDataUrl && currentKey && generatedKey !== currentKey);

  const analyzeAndApplyCrossSection = (
    url: string | null,
    fromRaster: boolean,
    cropRectHint: NormRect | null = null
  ) => {
    setCrossSectionImageUrl(url);
    setCrossFromRaster(Boolean(url && fromRaster));
    if (!url) {
      setCrossCutoutMeta(null);
      return;
    }

    const hintSym = cropRectHint
      ? inferSectionBandFromCropRect(detectedBands, cropRectHint)
      : null;

    const probe = new Image();
    probe.onload = () => {
      const analysis = analyzeCrossSectionCutout(probe, {
        bandSymbolHint: hintSym,
        availableSymbols: availableSectionSymbols,
      });
      setCrossCutoutMeta(analysis);
      if (analysis.recognizedSymbol) {
        setSelectedSectionSymbol(analysis.recognizedSymbol);
        setArrowMode('auto');
      }
    };
    probe.src = url;
  };

  const assignSlotUrl = (
    slot: CropTargetSlot,
    url: string | null,
    cropRectHint: NormRect | null = null
  ) => {
    pushUndoSnapshot(url ? `Zmiana: ${SLOT_LABELS[slot]}` : `Usunięcie: ${SLOT_LABELS[slot]}`);
    if (slot === 'map') {
      setCustomMapImageUrl(url);
      if (url) {
        setMarkerXPercent(50);
        setMarkerYPercent(50);
      }
    } else if (slot === 'cross') {
      analyzeAndApplyCrossSection(url, Boolean(url), cropRectHint);
    } else if (slot === 'legend1') {
      setLegendCol1ImageUrl(url);
    } else if (slot === 'legend2') {
      setLegendCol2ImageUrl(url);
    } else {
      setAuthorsImageUrl(url);
    }
  };

  const getSlotUrl = (slot: CropTargetSlot): string | null => {
    switch (slot) {
      case 'map':
        return customMapImageUrl;
      case 'cross':
        return crossSectionImageUrl;
      case 'legend1':
        return legendCol1ImageUrl;
      case 'legend2':
        return legendCol2ImageUrl;
      case 'authors':
        return authorsImageUrl;
    }
  };

  const persistFullSheetToServer = async (file: File) => {
    if (!smgpMeta?.sheetNumber) return;
    setSavingToFolder(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(
        `/api/smgp-sheet-scan?sheet=${encodeURIComponent(smgpMeta.sheetNumber)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: buf,
        }
      );
      if (res.ok) {
        const json = (await res.json()) as { savedScanUrl?: string; filename?: string };
        if (json.savedScanUrl) {
          setSourceSheetUrl(json.savedScanUrl);
          setSavedSheetName(json.filename ?? `smgp${smgpMeta.sheetNumber}`);
        }
      }
    } catch {
      // keep client dataUrl
    } finally {
      setSavingToFolder(false);
    }
  };

  const handleImageFile = async (
    file: File | null | undefined,
    setter: (val: string | null) => void,
    saveAsFullSheet = false
  ) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Wybierz plik graficzny (JPG, PNG lub WebP).');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setter(dataUrl);
      setError(null);
      if (saveAsFullSheet) {
        setCornerTL(null);
        pendingAutoDetectRef.current = true;
        setCalibratedNeatline(null);
        setNeatlineSource(null);
        setAutoBandCutouts({});
        if (crossFromRaster) {
          setCrossSectionImageUrl(null);
          setCrossFromRaster(false);
          setCrossCutoutMeta(null);
        }
        if (smgpMeta?.sheetNumber) {
          try {
            localStorage.removeItem(`progeo_smgp_neatline_${smgpMeta.sheetNumber}`);
          } catch {
            // ignore
          }
        }
        void persistFullSheetToServer(file);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wczytać pliku obrazu.');
    }
  };

  const handleRemoveSavedSheet = async () => {
    if (!smgpMeta?.sheetNumber) return;
    try {
      await fetch(`/api/smgp-sheet-scan?sheet=${encodeURIComponent(smgpMeta.sheetNumber)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
    setSavedSheetName(null);
    setSourceSheetUrl(null);
    setCalibratedNeatline(null);
    setNeatlineSource(null);
    setCornerTL(null);
    setAutoBandCutouts({});
  };

  const handlePasteToTarget = async (
    e: React.ClipboardEvent<HTMLDivElement>,
    setter: (val: string | null) => void,
    saveAsFullSheet = false
  ) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await handleImageFile(file, setter, saveAsFullSheet);
          return;
        }
      }
    }
  };

  const getNormPoint = (e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return { x, y };
  };

  const dragRect: NormRect | null =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          w: Math.abs(dragCurrent.x - dragStart.x),
          h: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  const saveNeatlineAndCrop = (rect: NormRect, manual = true) => {
    setCalibratedNeatline(rect);
    setNeatlineSource(manual ? 'manual' : 'auto');
    if (smgpMeta?.sheetNumber && manual) {
      try {
        localStorage.setItem(
          `progeo_smgp_neatline_${smgpMeta.sheetNumber}`,
          JSON.stringify({ ...rect, manual: true })
        );
      } catch {
        // ignore quota errors
      }
    }
    if (sourceImgRef.current && interpolatedPercent) {
      applyCenteredNeatlineCrop(sourceImgRef.current, rect);
    }
  };

  const runAutoDetectNeatline = (imgOverride?: HTMLImageElement | null, recordUndo = false) => {
    const img = imgOverride ?? sourceImgRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return;
    if (recordUndo) {
      pushUndoSnapshot('Automatyczne wykrycie ramki');
    }
    setCornerTL(null);
    setDragStart(null);
    setDragCurrent(null);
    setSectionPickTarget(null);
    setSectionPickFirstPt(null);
    setMapCropMode('auto');
    try {
      const detected = detectMapNeatlineFromImage(img);
      if (detected) {
        if (smgpMeta?.sheetNumber) {
          try {
            localStorage.removeItem(`progeo_smgp_neatline_${smgpMeta.sheetNumber}`);
          } catch {
            // ignore
          }
        }
        saveNeatlineAndCrop(detected, false);
        setError(null);
      }
    } catch {
      // fallback silently to manual corner selection
    }
  };

  const resetPointToCoordinates = () => {
    if (lat === null || lon === null) return;
    pushUndoSnapshot('Przywrócenie punktu ze współrzędnych');

    setCornerTL(null);
    setDragStart(null);
    setDragCurrent(null);
    setSectionPickTarget(null);
    setSectionPickFirstPt(null);
    setMapCropMode('auto');
    setArrowMode('auto');
    setError(null);

    if (smgpMeta?.sheetNumber) {
      try {
        localStorage.removeItem(`progeo_smgp_neatline_${smgpMeta.sheetNumber}`);
      } catch {
        // ignore
      }
    }

    const bounds = smgpMeta?.sheetBounds
      ? smgpMeta.sheetBounds
      : parsedBorder
        ? {
            minLon: parsedBorder.wLon,
            maxLon: parsedBorder.eLon,
            minLat: parsedBorder.sLat,
            maxLat: parsedBorder.nLat,
          }
        : null;

    if (smgpMeta?.sheetBounds) {
      applyMetaBoundsToInputs(smgpMeta.sheetBounds);
    }

    let uPct = interpolatedPercent?.uPercent ?? 50;
    let vPct = interpolatedPercent?.vPercentFromTop ?? 50;
    let groundSpan = sheetGroundSpan;

    if (bounds) {
      const dLon = bounds.maxLon - bounds.minLon;
      const dLat = bounds.maxLat - bounds.minLat;
      if (dLon > 0 && dLat > 0) {
        uPct = Number(
          Math.max(0, Math.min(100, ((lon - bounds.minLon) / dLon) * 100)).toFixed(2)
        );
        vPct = Number(
          Math.max(0, Math.min(100, ((bounds.maxLat - lat) / dLat) * 100)).toFixed(2)
        );
      }
      const midLat = (bounds.minLat + bounds.maxLat) / 2;
      const groundW = dLon * 111320 * Math.cos((midLat * Math.PI) / 180);
      const groundH = dLat * 111132;
      if (groundW > 500 && groundH > 500) {
        groundSpan = { groundW, groundH };
      }
    }

    const img = sourceImgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      let targetNeatline: NormRect | null = null;
      try {
        targetNeatline = detectMapNeatlineFromImage(img);
      } catch {
        targetNeatline = null;
      }
      const resolvedNeatline = targetNeatline ?? calibratedNeatline;
      if (resolvedNeatline) {
        setCalibratedNeatline(resolvedNeatline);
        setNeatlineSource('auto');
        try {
          const centered = computeCenteredMapRect(
            img,
            resolvedNeatline,
            uPct,
            vPct,
            groundSpan
          );
          setCustomMapImageUrl(cropImageFromElement(img, centered.cropRect));
          setMarkerXPercent(centered.markerXPercent);
          setMarkerYPercent(centered.markerYPercent);
        } catch {
          // ignore decode error
        }
        return;
      }
    }

    pendingAutoDetectRef.current = true;
    setCalibratedNeatline(null);
    setNeatlineSource(null);
  };

  const focusZoomOnMarker = (nextZoom: 1.5 | 2 = 2) => {
    setCropZoom(nextZoom);
    if (!overlayPreview) return;
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const container = rasterScrollRef.current;
        const img = sourceImgRef.current;
        if (!container || !img) return;
        const targetX = overlayPreview.ptX * img.clientWidth;
        const targetY = overlayPreview.ptY * img.clientHeight;
        container.scrollTo({
          left: Math.max(0, targetX - container.clientWidth / 2),
          top: Math.max(0, targetY - container.clientHeight / 2),
          behavior: 'smooth',
        });
      }, 40);
    });
  };

  const handleRasterMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const pt = getNormPoint(e);

    // 2-click cross-section line placement on map ("Wskaż A-B / C-D na mapie")
    if (sectionPickTarget) {
      if (!sectionPickFirstPt) {
        setSectionPickFirstPt(pt);
        setError(null);
        return;
      }
      const dist = Math.hypot(pt.x - sectionPickFirstPt.x, pt.y - sectionPickFirstPt.y);
      if (dist > 0.02) {
        const sym = sectionPickTarget;
        pushUndoSnapshot(`Wyznaczenie linii przekroju ${sym}`);
        const newDef: CrossSectionLineDef = {
          symbol: sym,
          points: [sectionPickFirstPt, pt],
          source: 'manual',
          reversed: false,
        };
        setSectionLines((prev) => {
          const next = { ...prev, [sym]: newDef };
          persistManualSectionLines(next);
          return next;
        });
        setSelectedSectionSymbol(sym);
        setArrowMode('auto');
        if ((!crossSectionImageUrl || crossFromRaster) && autoBandCutouts[sym]) {
          applyAutoBandCutout(autoBandCutouts[sym]);
        }
      }
      setSectionPickFirstPt(null);
      setSectionPickTarget(null);
      return;
    }

    if (activeCropSlot === 'map') {
      if (mapCropMode === 'auto') {
        if (!calibratedNeatline) {
          setMapCropMode('corners');
          setCornerTL(pt);
          setError(null);
          return;
        }
        // Allow clicking directly on the active cross-section line to slide the projection square,
        // while keeping the rest of the map protected from accidental stray clicks.
        const lineDef = sectionLines[activeSectionSymbol];
        if (lineDef && lineDef.points.length >= 2) {
          const axisL = crossCutoutMeta?.axisLeftNorm ?? 0.03;
          const axisR = crossCutoutMeta?.axisRightNorm ?? 0.97;
          const aspect = imgDims && imgDims.h > 0 ? imgDims.w / imgDims.h : 1.24;
          const proj = computePerpendicularProjectionOnLine(
            pt,
            lineDef.points,
            aspect,
            axisL,
            axisR,
            Boolean(lineDef.reversed)
          );
          if (proj && proj.distNorm <= 0.025) {
            pushUndoSnapshot('Przesunięcie punktu rzutowania');
            setArrowMode('manual');
            setArrowPercent(proj.arrowPercent);
            setDraggingProjSquare(true);
            return;
          }
        }
        return;
      }
      if (mapCropMode === 'corners') {
        if (!cornerTL) {
          setCornerTL(pt);
          setError(null);
          return;
        }
        const x = Math.min(cornerTL.x, pt.x);
        const y = Math.min(cornerTL.y, pt.y);
        const w = Math.abs(pt.x - cornerTL.x);
        const h = Math.abs(pt.y - cornerTL.y);
        setCornerTL(null);
        if (w > 0.08 && h > 0.08) {
          try {
            pushUndoSnapshot('Kalibracja ramki (2 narożniki)');
            saveNeatlineAndCrop({ x, y, w, h });
            setMapCropMode('auto');
            setActiveCropSlot('cross');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Nie udało się wyciąć fragmentu rastra.');
          }
        }
        return;
      }
    }

    setDragStart(pt);
    setDragCurrent(pt);
  };

  const finishCropDrag = () => {
    if (sectionPickTarget) return;
    if (activeCropSlot === 'map' && (mapCropMode === 'corners' || mapCropMode === 'auto')) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    if (dragRect && dragRect.w > 0.015 && dragRect.h > 0.015 && sourceImgRef.current) {
      try {
        const img = sourceImgRef.current;
        if (activeCropSlot === 'map' && mapCropMode === 'neatline' && interpolatedPercent) {
          if (dragRect.w > 0.08 && dragRect.h > 0.08) {
            pushUndoSnapshot('Kalibracja ramki (prostokąt)');
            saveNeatlineAndCrop(dragRect);
            setMapCropMode('auto');
          }
        } else {
          const cropped = cropImageFromElement(img, dragRect);
          assignSlotUrl(activeCropSlot, cropped, dragRect);
        }

        const order: CropTargetSlot[] = ['map', 'cross', 'legend1', 'legend2', 'authors'];
        const nextIdx = order.indexOf(activeCropSlot) + 1;
        if (nextIdx < order.length) setActiveCropSlot(order[nextIdx]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udało się wyciąć fragmentu rastra.');
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  const handleSelectSection = (symbol: string) => {
    const normalized = normalizeSectionSymbol(symbol);
    if (normalized !== activeSectionSymbol) {
      pushUndoSnapshot(`Zmiana przekroju na ${normalized}`);
    }
    setSelectedSectionSymbol(normalized);
    setArrowMode('auto');
    if ((!crossSectionImageUrl || crossFromRaster) && autoBandCutouts[normalized]) {
      applyAutoBandCutout(autoBandCutouts[normalized]);
    }
  };

  const buildSheet = async (): Promise<string | null> => {
    if (lat === null || lon === null || !validInPoland) {
      setError('Wpisz poprawne współrzędne na terenie Polski, aby wygenerować załącznik SMGP A4.');
      return null;
    }
    if (!customMapImageUrl) {
      setError(
        'Wgraj raster JPG/PNG arkusza SMGP i wskaż ramkę geograficzną w Kroku 1, aby wyinterpolować żółtą kropkę i wyciąć fragment mapy z rastra.'
      );
      return null;
    }

    setGenerating(true);
    setError(null);

    try {
      const canvas = await renderSmgpA4SheetCanvas({
        headerLabel,
        smgpMeta,
        crossSectionImageUrl,
        customMapImageUrl,
        legendCol1ImageUrl,
        legendCol2ImageUrl,
        authorsImageUrl,
        markerXPercent,
        markerYPercent,
        selectedSectionSymbol: activeSectionSymbol,
        arrowPercent,
        layoutOrder,
        sheetPxPerMm: crossFromRaster ? sheetPxPerMm : null,
        crossTargetScale,
        crossScaleOverride,
        crossHeaderMaskPercent,
        whiteMasks,
      });
      const dataUrl = canvas.toDataURL('image/png');
      setPreviewDataUrl(dataUrl);
      setGeneratedKey(currentKey);
      return dataUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Nie udało się wygenerować arkusza SMGP 1:50 000 A4.'
      );
      return null;
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!validInPoland || lat === null || lon === null || !customMapImageUrl) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const canvas = await renderSmgpA4SheetCanvas({
            headerLabel,
            smgpMeta,
            crossSectionImageUrl,
            customMapImageUrl,
            legendCol1ImageUrl,
            legendCol2ImageUrl,
            authorsImageUrl,
            markerXPercent,
            markerYPercent,
            selectedSectionSymbol: activeSectionSymbol,
            arrowPercent,
            layoutOrder,
            sheetPxPerMm: crossFromRaster ? sheetPxPerMm : null,
            crossTargetScale,
            crossScaleOverride,
            crossHeaderMaskPercent,
            whiteMasks,
          });
          if (cancelled) return;
          setPreviewDataUrl(canvas.toDataURL('image/png'));
          setGeneratedKey(currentKey);
        } catch {
          // ignore auto-preview error
        }
      })();
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    validInPoland,
    lat,
    lon,
    headerLabel,
    layoutOrder,
    smgpMeta,
    customMapImageUrl,
    crossSectionImageUrl,
    crossFromRaster,
    sheetPxPerMm,
    crossTargetScale,
    crossScaleOverride,
    crossHeaderMaskPercent,
    whiteMasks,
    legendCol1ImageUrl,
    legendCol2ImageUrl,
    authorsImageUrl,
    markerXPercent,
    markerYPercent,
    activeSectionSymbol,
    arrowPercent,
    currentKey,
  ]);

  const handleDownloadPdf = async () => {
    const dataUrl = !isStale && previewDataUrl ? previewDataUrl : await buildSheet();
    if (!dataUrl) return;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');

    const safeTag = (headerLabel.trim() || 'ZAL.3')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    pdf.save(`${safeTag}_SMGP_50k_A4.pdf`);
  };

  const handleDownloadPng = async () => {
    const dataUrl = !isStale && previewDataUrl ? previewDataUrl : await buildSheet();
    if (!dataUrl) return;

    const safeTag = (headerLabel.trim() || 'ZAL.3')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${safeTag}_SMGP_50k_A4.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const pgiResourceUrl = smgpMeta?.sheetNumber
    ? `https://baza.pgi.gov.pl/resources.html?type=map50&id=${encodeURIComponent(smgpMeta.sheetNumber)}`
    : null;

  return (
    <section
      aria-label="Załącznik mapowy A4 – Mapa geologiczna 1:50 000 z rastra SMGP"
      className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-950">
            Załącznik mapowy A4 – Mapa geologiczna 1:50 000 (z rastra SMGP)
          </h2>
          <p className="text-xs text-slate-500">
            Kalibracja po współrzędnych geograficznych na obrzeżach rastra JPG/PNG, automatyczna
            interpolacja żółtej kropki i wycięcie prostokąta do składu strony A4.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title={
              undoStack.length > 0
                ? `Cofnij: ${undoStack[undoStack.length - 1].label} (Ctrl+Z)`
                : 'Brak czynności do cofnięcia (Ctrl+Z)'
            }
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-white border border-slate-300 hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed text-slate-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Cofnij{undoStack.length > 0 ? ` (${undoStack.length})` : ''}</span>
          </button>

          <button
            type="button"
            onClick={() => void buildSheet()}
            disabled={generating || !validInPoland}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-md bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {generating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Składanie A4…</span>
              </>
            ) : (
              <>
                <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{previewDataUrl ? 'Odśwież SMGP A4' : 'Generuj SMGP A4'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-white space-y-4">
        {/* Detected SMGP sheet + direct PIG-PIB JPG link */}
        {loadingMeta ? (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>Sprawdzam arkusz SMGP 1:50 000 i granice geograficzne…</span>
          </p>
        ) : smgpMeta?.sheetNumber ? (
          <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                Arkusz SMGP: <strong className="font-mono">nr {smgpMeta.sheetNumber}</strong> –{' '}
                <strong>{smgpMeta.sheetName ?? '—'}</strong>
                {smgpMeta.mapAuthors ? ` · autorzy: ${smgpMeta.mapAuthors}` : ''}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {smgpMeta.scanUrl && (
                  <a
                    href={smgpMeta.scanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 whitespace-nowrap"
                  >
                    <span>Pobierz skan JPG z PIG-PIB</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                )}
                {pgiResourceUrl && (
                  <a
                    href={pgiResourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
                  >
                    <span>Strona arkusza PIG-PIB</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
            {(smgpMeta.sheetNotes || savedSheetName) && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                <span>
                  {smgpMeta.sheetNotes ? `Uwaga PIG-PIB: ${smgpMeta.sheetNotes}` : ''}
                </span>
                {savedSheetName && (
                  <span className="font-medium text-emerald-700">
                    Zapisano w katalogu aplikacji (`smgp-sheets/{savedSheetName}`)
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}

        {/* Top controls */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label
                htmlFor="smgp-zal-label-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Napis w prawym górnym rogu (Arial 26 pt bold)
              </label>
              <input
                id="smgp-zal-label-input"
                type="text"
                maxLength={24}
                value={headerLabel}
                onChange={(e) => setHeaderLabel(e.target.value)}
                placeholder="ZAŁ.3"
                className="w-32 h-9 px-2.5 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md font-sans text-sm font-bold text-slate-950 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">
                Kolejność na stronie A4
              </span>
              <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    if (layoutOrder !== 'cross-below-map') {
                      pushUndoSnapshot('Zmiana układu strony A4');
                      setLayoutOrder('cross-below-map');
                    }
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    layoutOrder === 'cross-below-map'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Przekrój pod mapą
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (layoutOrder !== 'cross-at-bottom') {
                      pushUndoSnapshot('Zmiana układu strony A4');
                      setLayoutOrder('cross-at-bottom');
                    }
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    layoutOrder === 'cross-at-bottom'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Przekrój na dole (jak wzór)
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={generating || !validInPoland}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pobierz PDF (A4)</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPng()}
              disabled={generating || !validInPoland}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileImage className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pobierz PNG (A4)</span>
            </button>
          </div>
        </div>

        {/* STEP 1: Full SMGP Raster Upload + Border Geographic Coordinates Calibration */}
        <div
          tabIndex={0}
          onPaste={(e) => void handlePasteToTarget(e, setSourceSheetUrl, true)}
          className="rounded-lg border border-slate-300 bg-slate-50/70 p-3.5 space-y-3 focus:outline-none focus:border-blue-600"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Crop className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                <span>Krok 1: Raster arkusza SMGP (JPG/PNG) i kalibracja ramki</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Wgraj raster arkusza z PIG-PIB i wskaż na nim narożniki ramki geograficznej —
                aplikacja wyinterpoluje żółtą kropkę ze współrzędnych i wytnie fragment rastra.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer">
                <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {savingToFolder
                    ? 'Zapisywanie…'
                    : sourceSheetUrl
                      ? 'Podmień raster JPG/PNG'
                      : 'Wgraj raster JPG/PNG'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) =>
                    void handleImageFile(e.target.files?.[0], setSourceSheetUrl, true)
                  }
                />
              </label>
              {savedSheetName ? (
                <button
                  type="button"
                  onClick={() => void handleRemoveSavedSheet()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Usuń z katalogu</span>
                </button>
              ) : sourceSheetUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setSourceSheetUrl(null);
                    setCornerTL(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Zamknij raster</span>
                </button>
              ) : null}
            </div>
          </div>

          {/* Geographic Coordinates of Map Frame Edges (for transparent interpolation) */}
          <div className="rounded-md bg-white border border-slate-200 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-800">
                Współrzędne na obrzeżach ramki rastra (interpolacja żółtego punktu):
              </span>
              <div className="flex flex-wrap items-center gap-3">
                {lat !== null && lon !== null && (
                  <button
                    type="button"
                    onClick={resetPointToCoordinates}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border cursor-pointer ${
                      isPointDisplacedFromCoords
                        ? 'bg-amber-100 border-amber-400 text-amber-950 hover:bg-amber-200'
                        : 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
                    }`}
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>Przywróć punkt ze współrzędnych</span>
                  </button>
                )}
                {smgpMeta?.sheetBounds && (
                  <button
                    type="button"
                    onClick={() => {
                      pushUndoSnapshot('Przywrócenie granic arkusza');
                      applyMetaBoundsToInputs(smgpMeta.sheetBounds);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>Przywróć z granic arkusza</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <label className="space-y-0.5">
                <span className="block text-slate-500">Góra ramki (φ max, N)</span>
                <input
                  type="text"
                  value={northLatText}
                  onChange={(e) => setNorthLatText(e.target.value)}
                  placeholder="49°30′00″"
                  className="w-full h-7 px-2 border border-slate-300 rounded font-mono text-[11px] text-slate-900"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-slate-500">Dół ramki (φ min, N)</span>
                <input
                  type="text"
                  value={southLatText}
                  onChange={(e) => setSouthLatText(e.target.value)}
                  placeholder="49°20′00″"
                  className="w-full h-7 px-2 border border-slate-300 rounded font-mono text-[11px] text-slate-900"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-slate-500">Lewy brzeg (λ min, E)</span>
                <input
                  type="text"
                  value={westLonText}
                  onChange={(e) => setWestLonText(e.target.value)}
                  placeholder="20°45′00″"
                  className="w-full h-7 px-2 border border-slate-300 rounded font-mono text-[11px] text-slate-900"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-slate-500">Prawy brzeg (λ max, E)</span>
                <input
                  type="text"
                  value={eastLonText}
                  onChange={(e) => setEastLonText(e.target.value)}
                  placeholder="21°00′00″"
                  className="w-full h-7 px-2 border border-slate-300 rounded font-mono text-[11px] text-slate-900"
                />
              </label>
            </div>

            {interpolatedPercent && (
              <div className="text-[11px] text-slate-600 space-y-0.5">
                <p>
                  Punkt:{' '}
                  <strong className="font-mono text-slate-900">
                    {lat !== null ? `${formatDmsShort(lat)} N` : '—'},{' '}
                    {lon !== null ? `${formatDmsShort(lon)} E` : '—'}
                  </strong>{' '}
                  · w ramce geograficznej:{' '}
                  <strong className="font-mono text-slate-900">
                    {interpolatedPercent.uPercent}%
                  </strong>{' '}
                  od lewej,{' '}
                  <strong className="font-mono text-slate-900">
                    {interpolatedPercent.vPercentFromTop}%
                  </strong>{' '}
                  od góry
                  {overlayPreview && imgDims
                    ? ` (ok. piks. ${Math.round(overlayPreview.ptX * imgDims.w)} × ${Math.round(
                        overlayPreview.ptY * imgDims.h
                      )} z ${imgDims.w}×${imgDims.h})`
                    : ''}
                  .
                  {interpolatedPercent.outOfFrame && (
                    <span className="text-rose-700 font-semibold ml-1">
                      (Punkt poza wpisanymi granicami ramki!)
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-slate-500">
                  Domyślne granice arkusza z PIG-PIB przeliczono na WGS-84 (z poprawką ok. 124 m z
                  układu Pułkowo 1942 użytego na drukowanych opisach ramki SMGP).
                </p>
              </div>
            )}
          </div>

          {sourceSheetUrl ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-600 mr-1">
                  Wycinasz teraz:
                </span>
                {(['map', 'cross', 'legend1', 'legend2', 'authors'] as CropTargetSlot[]).map(
                  (slot) => {
                    const done = Boolean(getSlotUrl(slot));
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => {
                          setActiveCropSlot(slot);
                          setCornerTL(null);
                        }}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                          activeCropSlot === slot
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : done
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                              : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {SLOT_LABELS[slot]}
                        {done ? ' ✓' : ''}
                      </button>
                    );
                  }
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
                {activeCropSlot === 'map' ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-700">Tryb mapy:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMapCropMode('auto');
                        setCornerTL(null);
                      }}
                      className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                        mapCropMode === 'auto'
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Auto ze współrzędnych (ochrona)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMapCropMode('corners');
                        setCornerTL(null);
                      }}
                      className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                        mapCropMode === 'corners'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      2 narożniki ramki (LG → PD)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMapCropMode('neatline');
                        setCornerTL(null);
                      }}
                      className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                        mapCropMode === 'neatline'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Przeciągnij prostokąt ramki
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMapCropMode('manual');
                        setCornerTL(null);
                      }}
                      className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                        mapCropMode === 'manual'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Ręczny wycinek
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-600 font-medium">
                    Przeciągnij myszką prostokąt dla:{' '}
                    <strong>{SLOT_LABELS[activeCropSlot]}</strong>
                  </span>
                )}

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    title={
                      undoStack.length > 0
                        ? `Cofnij: ${undoStack[undoStack.length - 1].label} (Ctrl+Z)`
                        : 'Brak czynności do cofnięcia (Ctrl+Z)'
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Undo2 className="w-3 h-3" aria-hidden="true" />
                    <span>Cofnij{undoStack.length > 0 ? ` (${undoStack.length})` : ''}</span>
                  </button>
                  <button
                    type="button"
                    onClick={resetPointToCoordinates}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold border cursor-pointer ${
                      isPointDisplacedFromCoords
                        ? 'bg-amber-100 border-amber-400 text-amber-950 hover:bg-amber-200'
                        : 'bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100'
                    }`}
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>Przywróć punkt ze współrzędnych</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAutoDetectNeatline(null, true)}
                    className="px-2 py-0.5 rounded font-medium bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                  >
                    Wykryj ramkę automatycznie
                  </button>
                  {overlayPreview && (
                    <button
                      type="button"
                      onClick={() => focusZoomOnMarker(2)}
                      className="px-2 py-0.5 rounded font-medium bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100 cursor-pointer"
                    >
                      Pokaż kropkę (2×)
                    </button>
                  )}
                  <span className="text-slate-500 ml-1 mr-0.5">Powiększenie:</span>
                  {([1, 1.5, 2] as const).map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setCropZoom(z)}
                      className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                        cropZoom === z
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {z === 1 ? 'Dopasuj' : `${z}×`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cross-section line bar for perpendicular projection (rzut prostopadły) */}
              {calibratedNeatline && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-700 flex items-center gap-1">
                      <Crosshair className="w-3 h-3 text-cyan-700" aria-hidden="true" />
                      <span>Linie przekrojów na mapie (rzut prostopadły):</span>
                    </span>
                    {availableSectionSymbols.map((sym) => {
                      const def = sectionLines[sym];
                      const isPicking = sectionPickTarget === sym;
                      const isActive = activeSectionSymbol === sym;
                      return (
                        <div key={sym} className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (isPicking) {
                                setSectionPickTarget(null);
                                setSectionPickFirstPt(null);
                              } else {
                                setSectionPickTarget(sym);
                                setSectionPickFirstPt(null);
                                setSelectedSectionSymbol(sym);
                              }
                            }}
                            className={`px-2 py-0.5 rounded font-semibold border cursor-pointer ${
                              isPicking
                                ? 'bg-indigo-700 border-indigo-700 text-white'
                                : def
                                  ? isActive
                                    ? 'bg-cyan-700 border-cyan-700 text-white'
                                    : 'bg-cyan-50 border-cyan-300 text-cyan-900 hover:bg-cyan-100'
                                  : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {isPicking
                              ? `Anuluj (${sym})`
                              : def
                                ? `Przekrój ${sym} ✓ (wskaż 2 pkt)`
                                : `Wskaż ${sym} (2 klik.)`}
                          </button>
                          {def && !isPicking && (
                            <button
                              type="button"
                              title={`Odwróć kierunek ${sym}`}
                              onClick={() => {
                                pushUndoSnapshot(`Odwrócenie kierunku ${sym}`);
                                setSectionLines((prev) => {
                                  const cur = prev[sym];
                                  if (!cur) return prev;
                                  const next = {
                                    ...prev,
                                    [sym]: {
                                      ...cur,
                                      source: 'manual' as const,
                                      reversed: !cur.reversed,
                                    },
                                  };
                                  persistManualSectionLines(next);
                                  return next;
                                });
                                setSelectedSectionSymbol(sym);
                                setArrowMode('auto');
                              }}
                              className="p-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer"
                            >
                              <ArrowLeftRight className="w-3 h-3" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => runDetectCrossSectionsOnRaster(null, null, true)}
                    className="px-2 py-0.5 rounded font-medium bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 cursor-pointer"
                  >
                    Wykryj linie z rastra
                  </button>
                </div>
              )}

              <div
                ref={rasterScrollRef}
                className="bg-slate-200/60 border border-slate-300 rounded p-1 overflow-auto max-h-[520px] text-center"
              >
                <div
                  ref={rasterStageRef}
                  onMouseDown={handleRasterMouseDown}
                  onMouseMove={(e) => {
                    if (draggingEndpoint) {
                      updateEndpointFromRasterPoint(
                        draggingEndpoint.symbol,
                        draggingEndpoint.end,
                        getNormPoint(e)
                      );
                      return;
                    }
                    if (draggingProjSquare) {
                      updateArrowFromRasterPoint(getNormPoint(e));
                      return;
                    }
                    if (!dragStart) return;
                    setDragCurrent(getNormPoint(e));
                  }}
                  onMouseUp={() => {
                    if (draggingEndpoint) {
                      persistManualSectionLines(sectionLinesRef.current);
                      setDraggingEndpoint(null);
                      return;
                    }
                    if (draggingProjSquare) {
                      setDraggingProjSquare(false);
                      return;
                    }
                    finishCropDrag();
                  }}
                  onMouseLeave={() => {
                    if (dragStart && !draggingProjSquare && !draggingEndpoint) finishCropDrag();
                  }}
                  className={`relative inline-block select-none bg-white leading-none ${
                    draggingProjSquare || draggingEndpoint
                      ? 'cursor-grabbing'
                      : activeCropSlot === 'map' &&
                          mapCropMode === 'auto' &&
                          calibratedNeatline &&
                          !sectionPickTarget
                        ? 'cursor-default'
                        : 'cursor-crosshair'
                  }`}
                >
                  <img
                    ref={sourceImgRef}
                    src={sourceSheetUrl}
                    alt="Pełny raster arkusza SMGP"
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
                      if (pendingAutoDetectRef.current || !calibratedNeatline) {
                        pendingAutoDetectRef.current = false;
                        runAutoDetectNeatline(img);
                      } else if (interpolatedPercent && mapCropMode !== 'manual') {
                        try {
                          applyCenteredNeatlineCrop(img, calibratedNeatline);
                        } catch {
                          // ignore
                        }
                      }
                    }}
                    style={{
                      maxHeight: cropZoom === 1 ? '480px' : cropZoom === 1.5 ? '880px' : '1500px',
                      maxWidth: cropZoom === 1 ? '100%' : 'none',
                    }}
                    className="w-auto h-auto block pointer-events-none"
                  />

                  {/* Calibrated frame neatline */}
                  {calibratedNeatline && (
                    <div
                      aria-hidden="true"
                      style={{
                        left: `${calibratedNeatline.x * 100}%`,
                        top: `${calibratedNeatline.y * 100}%`,
                        width: `${calibratedNeatline.w * 100}%`,
                        height: `${calibratedNeatline.h * 100}%`,
                      }}
                      className="absolute border-2 border-dashed border-blue-600/80 pointer-events-none"
                    />
                  )}

                  {/* Auto-cropped centered map rectangle + interpolated yellow-black dot */}
                  {overlayPreview?.cropBox && (
                    <div
                      aria-hidden="true"
                      style={{
                        left: `${overlayPreview.cropBox.x * 100}%`,
                        top: `${overlayPreview.cropBox.y * 100}%`,
                        width: `${overlayPreview.cropBox.w * 100}%`,
                        height: `${overlayPreview.cropBox.h * 100}%`,
                      }}
                      className="absolute border-2 border-amber-500 bg-amber-300/15 pointer-events-none"
                    />
                  )}

                  {overlayPreview && (
                    <>
                      <div
                        aria-hidden="true"
                        style={{ left: `${overlayPreview.ptX * 100}%` }}
                        className="absolute top-0 bottom-0 w-px bg-black/45 pointer-events-none"
                      />
                      <div
                        aria-hidden="true"
                        style={{ top: `${overlayPreview.ptY * 100}%` }}
                        className="absolute left-0 right-0 h-px bg-black/45 pointer-events-none"
                      />
                      <div
                        aria-hidden="true"
                        style={{
                          left: `${overlayPreview.ptX * 100}%`,
                          top: `${overlayPreview.ptY * 100}%`,
                        }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-amber-500/90 pointer-events-none"
                      />
                      <div
                        aria-hidden="true"
                        style={{
                          left: `${overlayPreview.ptX * 100}%`,
                          top: `${overlayPreview.ptY * 100}%`,
                        }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-yellow-300 border-2 border-black shadow-md pointer-events-none"
                      />
                    </>
                  )}

                  {/* Cross-section polylines (A-B, C-D) + perpendicular drop line from yellow dot */}
                  {Object.keys(sectionLines).length > 0 && (
                    <svg
                      viewBox="0 0 1000 1000"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full pointer-events-none"
                    >
                      {Object.values(sectionLines).map((sec) => {
                        if (sec.points.length < 2) return null;
                        const isActive = sec.symbol === activeSectionSymbol;
                        const stroke =
                          sec.symbol === 'C–D'
                            ? '#7c3aed'
                            : sec.symbol === 'E–F'
                              ? '#059669'
                              : '#0284c7';
                        const ptsAttr = sec.points
                          .map((p) => `${(p.x * 1000).toFixed(1)},${(p.y * 1000).toFixed(1)}`)
                          .join(' ');
                        return (
                          <g key={sec.symbol}>
                            <polyline
                              points={ptsAttr}
                              fill="none"
                              stroke={stroke}
                              strokeWidth={isActive ? 3.2 : 2}
                              strokeDasharray={isActive ? 'none' : '8 5'}
                              strokeOpacity={isActive ? 0.95 : 0.7}
                              vectorEffect="non-scaling-stroke"
                            />
                          </g>
                        );
                      })}

                      {overlayPreview && displayedProjSquarePt && (
                        <line
                          x1={overlayPreview.ptX * 1000}
                          y1={overlayPreview.ptY * 1000}
                          x2={displayedProjSquarePt.x * 1000}
                          y2={displayedProjSquarePt.y * 1000}
                          stroke="#dc2626"
                          strokeWidth={2.6}
                          strokeDasharray="6 4"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                    </svg>
                  )}

                  {/* Draggable endpoint square handles (A, B, C, D) for manual cross-section adjustment */}
                  {Object.values(sectionLines).map((sec) => {
                    if (sec.points.length < 2) return null;
                    const parts = sec.symbol.split(/[–-]/).map((s) => s.trim());
                    const startLabel = sec.reversed ? parts[1] || 'B' : parts[0] || 'A';
                    const endLabel = sec.reversed ? parts[0] || 'A' : parts[1] || 'B';
                    const pStart = sec.points[0];
                    const pEnd = sec.points[sec.points.length - 1];
                    const isActive = sec.symbol === activeSectionSymbol;
                    const badgeBg =
                      sec.symbol === 'C–D'
                        ? 'bg-violet-700 hover:bg-violet-800'
                        : sec.symbol === 'E–F'
                          ? 'bg-emerald-700 hover:bg-emerald-800'
                          : 'bg-sky-700 hover:bg-sky-800';
                    const endpoints: Array<{
                      end: 'start' | 'end';
                      label: string;
                      pt: NormPt;
                    }> = [
                      { end: 'start', label: startLabel, pt: pStart },
                      { end: 'end', label: endLabel, pt: pEnd },
                    ];
                    return (
                      <div key={`badges-${sec.symbol}`}>
                        {endpoints.map(({ end, label, pt }) => {
                          const isThisDragging =
                            draggingEndpoint?.symbol === sec.symbol &&
                            draggingEndpoint?.end === end;
                          const canDragHandle = !sectionPickTarget && !dragStart;
                          return (
                            <button
                              key={`${sec.symbol}-${end}`}
                              type="button"
                              disabled={!canDragHandle}
                              aria-label={`Przesuń punkt skrajny ${label} przekroju ${sec.symbol}`}
                              title={`Chwyć i przeciągnij kwadrat ${label}, aby skorygować linię przekroju ${sec.symbol}`}
                              onMouseDown={(e) => {
                                if (!canDragHandle) return;
                                e.stopPropagation();
                                e.preventDefault();
                                pushUndoSnapshot(
                                  `Korekta punktu ${label} przekroju ${sec.symbol}`
                                );
                                setSelectedSectionSymbol(sec.symbol);
                                if (
                                  (!crossSectionImageUrl || crossFromRaster) &&
                                  autoBandCutouts[sec.symbol]
                                ) {
                                  applyAutoBandCutout(autoBandCutouts[sec.symbol]);
                                }
                                setDraggingEndpoint({ symbol: sec.symbol, end });
                              }}
                              style={{
                                left: `${pt.x * 100}%`,
                                top: `${pt.y * 100}%`,
                                cursor: canDragHandle
                                  ? isThisDragging
                                    ? 'grabbing'
                                    : 'grab'
                                  : 'default',
                              }}
                              className={`group absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center bg-transparent z-20 focus:outline-none ${
                                canDragHandle ? 'pointer-events-auto' : 'pointer-events-none'
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`pointer-events-none inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-[3px] text-[10px] font-bold text-white border-2 border-white shadow-md transition-transform ${badgeBg} ${
                                  isThisDragging
                                    ? 'scale-125 ring-2 ring-amber-400'
                                    : isActive
                                      ? 'opacity-100 group-hover:scale-115 group-hover:ring-2 group-hover:ring-amber-300'
                                      : 'opacity-85 group-hover:opacity-100 group-hover:scale-115 group-hover:ring-2 group-hover:ring-amber-300'
                                }`}
                              >
                                {label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  {displayedProjSquarePt && (() => {
                    const canDragProj =
                      !sectionPickTarget &&
                      (sectionLines[activeSectionSymbol]?.points.length ?? 0) >= 2;
                    return (
                      <button
                        type="button"
                        disabled={!canDragProj}
                        aria-label="Przesuń czerwony kwadracik po linii przekroju"
                        title="Przeciągnij po linii przekroju, aby przesunąć strzałkę na dokumencie A4 (podwójne kliknięcie = rzut prostopadły)"
                        onMouseDown={(e) => {
                          if (!canDragProj) return;
                          e.stopPropagation();
                          e.preventDefault();
                          pushUndoSnapshot('Przesunięcie punktu rzutowania');
                          setDraggingProjSquare(true);
                        }}
                        onDoubleClick={(e) => {
                          if (!canDragProj) return;
                          e.stopPropagation();
                          if (activePerpProjection) {
                            pushUndoSnapshot('Powrót do rzutu prostopadłego');
                            setArrowMode('auto');
                            setArrowPercent(activePerpProjection.arrowPercent);
                          }
                        }}
                        style={{
                          left: `${displayedProjSquarePt.x * 100}%`,
                          top: `${displayedProjSquarePt.y * 100}%`,
                          cursor: canDragProj
                            ? draggingProjSquare
                              ? 'grabbing'
                              : 'grab'
                            : 'default',
                        }}
                        className={`group absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-transparent z-30 focus:outline-none ${
                          canDragProj ? 'pointer-events-auto' : 'pointer-events-none'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute w-6 h-6 rounded-full border-2 border-red-500/80 bg-red-500/15 transition-opacity ${
                            draggingProjSquare || arrowMode === 'manual'
                              ? 'opacity-100'
                              : 'opacity-0 group-hover:opacity-100'
                          }`}
                        />
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none block w-3.5 h-3.5 bg-red-600 border-2 border-white rotate-45 shadow-md transition-transform ${
                            draggingProjSquare ? 'scale-125' : 'group-hover:scale-125'
                          }`}
                        />
                      </button>
                    );
                  })()}

                  {/* First click pin while defining a cross-section line manually */}
                  {sectionPickFirstPt && (
                    <div
                      aria-hidden="true"
                      style={{
                        left: `${sectionPickFirstPt.x * 100}%`,
                        top: `${sectionPickFirstPt.y * 100}%`,
                      }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-indigo-600 border-2 border-white shadow pointer-events-none"
                    />
                  )}

                  {/* First corner click pin */}
                  {cornerTL && (
                    <div
                      aria-hidden="true"
                      style={{ left: `${cornerTL.x * 100}%`, top: `${cornerTL.y * 100}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white shadow pointer-events-none"
                    />
                  )}

                  {/* Active mouse drag selection */}
                  {dragRect && (
                    <div
                      aria-hidden="true"
                      style={{
                        left: `${dragRect.x * 100}%`,
                        top: `${dragRect.y * 100}%`,
                        width: `${dragRect.w * 100}%`,
                        height: `${dragRect.h * 100}%`,
                      }}
                      className="absolute border-2 border-amber-500 bg-amber-400/20 pointer-events-none"
                    />
                  )}
                </div>
              </div>

              <p className="text-[11px] text-slate-600">
                {sectionPickTarget
                  ? !sectionPickFirstPt
                    ? `Kliknij na mapie POCZĄTEK przekroju ${sectionPickTarget} (litera ${sectionPickTarget.split('–')[0] || 'A'}).`
                    : `Teraz kliknij na mapie KONIEC przekroju ${sectionPickTarget} (litera ${sectionPickTarget.split('–')[1] || 'B'}) — rzut prostopadły policzy się automatycznie.`
                  : calibratedNeatline && activeCropSlot === 'map' && mapCropMode === 'auto'
                    ? `${neatlineSource === 'auto' ? 'Ramka wykryta automatycznie' : 'Ramka skalibrowana ręcznie'} — żółta kropka zablokowana na współrzędnych z góry panelu. Możesz chwytać kwadraty skrajne (A, B, C, D) do korekty linii przekroju oraz przeciągać czerwony kwadracik po linii ${activeSectionSymbol}, aby ustawić miejsce strzałki na A4.`
                    : activeCropSlot === 'map' && mapCropMode === 'corners'
                      ? !cornerTL
                        ? 'Kliknij dokładny LEWY GÓRNY wewnętrzny róg ramki geograficznej mapy na rastrze (możesz użyć powiększenia 1.5× lub 2×).'
                        : 'Teraz kliknij PRAWY DOLNY wewnętrzny róg ramki geograficznej mapy — punkt i wycinek policzą się automatycznie.'
                      : activeCropSlot === 'map' && mapCropMode === 'neatline'
                        ? 'Przeciągnij prostokąt dokładnie po wewnętrznej ramce geograficznej na rastrze — punkt żółty i wycinek policzą się automatycznie.'
                        : `Przeciągnij myszką prostokąt na rastrze, aby wyciąć: ${SLOT_LABELS[activeCropSlot]}.`}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              Pobierz skan JPG arkusza z linku powyżej i wgraj tutaj (lub wklej przez{' '}
              <span className="font-mono">Ctrl+V</span>) — zostanie zapisany w katalogu aplikacji.
            </p>
          )}
        </div>

        {/* STEP 2: Slot cards (click map to adjust yellow dot, click cross-section to adjust top arrow) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Slot 1: Cropped Map + clickable yellow/black marker */}
          <div
            tabIndex={0}
            onPaste={(e) => void handlePasteToTarget(e, (u) => assignSlotUrl('map', u))}
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2 focus:outline-none focus:border-blue-600"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">1. Wycinek rastra (żółty punkt)</span>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 cursor-pointer">
                  <span>Wgraj / Ctrl+V</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) =>
                      void handleImageFile(e.target.files?.[0], (u) => assignSlotUrl('map', u))
                    }
                  />
                </label>
                {customMapImageUrl && (
                  <button
                    type="button"
                    onClick={() => assignSlotUrl('map', null)}
                    className="text-[11px] text-rose-700 hover:text-rose-900 cursor-pointer"
                  >
                    Usuń
                  </button>
                )}
              </div>
            </div>

            {customMapImageUrl ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <p className="text-[11px] text-slate-500">
                    Pozycja kropki ({markerXPercent}% / {markerYPercent}%)
                    {isPointDisplacedFromCoords ? (
                      <span className="ml-1 text-amber-800 font-semibold">
                        — zmieniona ręcznie
                      </span>
                    ) : (
                      ' — z góry panelu (kliknij wycinek, aby przesunąć)'
                    )}
                  </p>
                  {lat !== null && lon !== null && (
                    <button
                      type="button"
                      onClick={resetPointToCoordinates}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border cursor-pointer ${
                        isPointDisplacedFromCoords
                          ? 'bg-amber-100 border-amber-400 text-amber-950 hover:bg-amber-200'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      <span>Przywróć punkt ze współrzędnych</span>
                    </button>
                  )}
                </div>
                <div
                  onClick={(e) => {
                    pushUndoSnapshot('Przesunięcie żółtej kropki');
                    const pt = getNormPoint(e);
                    setMarkerXPercent(Number((pt.x * 100).toFixed(1)));
                    setMarkerYPercent(Number((pt.y * 100).toFixed(1)));
                  }}
                  className="relative border border-slate-300 rounded overflow-hidden bg-white cursor-crosshair"
                >
                  <img
                    src={customMapImageUrl}
                    alt="Wycięty fragment rastra mapy geologicznej"
                    className="w-full max-h-60 object-contain block"
                  />
                  <div
                    aria-hidden="true"
                    style={{ left: `${markerXPercent}%`, top: `${markerYPercent}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-yellow-300 border-2 border-black shadow-sm pointer-events-none"
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                Brak wycinka rastra — kliknij „Przywróć punkt ze współrzędnych” lub „Wykryj ramkę
                automatycznie” w Kroku 1 powyżej.
              </p>
            )}
          </div>

          {/* Slot 2: Cropped Cross-section + auto recognition + perpendicular projection + manual override */}
          <div
            tabIndex={0}
            onPaste={(e) =>
              void handlePasteToTarget(e, (url) => {
                pushUndoSnapshot('Wklejenie przekroju geologicznego');
                analyzeAndApplyCrossSection(url, false, null);
              })
            }
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2 focus:outline-none focus:border-blue-600"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                2. Przekrój + rzut lokalizacji na dole
              </span>
              <div className="flex items-center gap-2">
                {autoBandCutouts[activeSectionSymbol] && (!crossSectionImageUrl || !crossFromRaster) && (
                  <button
                    type="button"
                    onClick={() => {
                      pushUndoSnapshot('Wstawienie przekroju z rastra');
                      applyAutoBandCutout(autoBandCutouts[activeSectionSymbol]);
                    }}
                    className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                  >
                    Wstaw z rastra
                  </button>
                )}
                <label className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 cursor-pointer">
                  <span>Wgraj / Ctrl+V</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) =>
                      void handleImageFile(e.target.files?.[0], (url) => {
                        pushUndoSnapshot('Wgranie przekroju geologicznego');
                        analyzeAndApplyCrossSection(url, false, null);
                      })
                    }
                  />
                </label>
                {crossSectionImageUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      pushUndoSnapshot('Usunięcie przekroju geologicznego');
                      analyzeAndApplyCrossSection(null, false, null);
                    }}
                    className="text-[11px] text-rose-700 hover:text-rose-900 cursor-pointer"
                  >
                    Usuń
                  </button>
                )}
              </div>
            </div>

            {/* Active / Recognized Cross-Section Selector */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
              <div className="flex flex-wrap items-center gap-1">
                {availableSectionSymbols.map((sym) => {
                  const hasLine = Boolean(sectionLines[sym]);
                  const portalSec = smgpMeta?.crossSections.find(
                    (s) => normalizeSectionSymbol(s.symbol) === sym
                  );
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => handleSelectSection(sym)}
                      className={`px-2 py-0.5 font-semibold rounded border cursor-pointer ${
                        activeSectionSymbol === sym
                          ? 'bg-blue-700 border-blue-700 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {sym}
                      {portalSec ? ` (${portalSec.projectionPercent}%)` : hasLine ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
              {crossCutoutMeta?.recognizedSymbol && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
                  Rozpoznano z wycinka: {crossCutoutMeta.recognizedSymbol}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <label className="space-y-0.5">
                <span className="block text-slate-600 font-medium">Skala przekroju na A4</span>
                <select
                  value={crossTargetScale}
                  onChange={(e) => {
                    pushUndoSnapshot('Zmiana skali przekroju');
                    setCrossTargetScale(e.target.value as 'auto-100k' | 'fit' | 'original-50k');
                  }}
                  className="w-full h-7 px-1.5 bg-white border border-slate-300 rounded text-[11px] text-slate-900"
                >
                  <option value="auto-100k">Auto 1:100 000 (proporcjonalnie)</option>
                  <option value="fit">Dopasuj do szerokości strony</option>
                  <option value="original-50k">Zachowaj 1:50 000 (jeśli się mieści)</option>
                </select>
              </label>
              <label className="space-y-0.5">
                <span className="block text-slate-600 font-medium">Opis skali (opcjonalnie)</span>
                <input
                  type="text"
                  value={crossScaleOverride}
                  onChange={(e) => setCrossScaleOverride(e.target.value)}
                  placeholder="auto z rozmiaru (np. 1:100 000)"
                  className="w-full h-7 px-2 bg-white border border-slate-300 rounded text-[11px] text-slate-900"
                />
              </label>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                <span className="text-slate-600 font-medium">
                  Nakładka na stare napisy u góry ({crossHeaderMaskPercent}%):
                </span>
                <div className="flex items-center gap-1">
                  {[0, 14, 22, 30].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        pushUndoSnapshot('Zmiana nakładki nagłówka przekroju');
                        setCrossHeaderMaskPercent(pct);
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                        crossHeaderMaskPercent === pct
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {pct === 0 ? 'Brak' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={35}
                step={1}
                value={crossHeaderMaskPercent}
                onMouseDown={() => pushUndoSnapshot('Zmiana nakładki nagłówka przekroju')}
                onTouchStart={() => pushUndoSnapshot('Zmiana nakładki nagłówka przekroju')}
                onChange={(e) => setCrossHeaderMaskPercent(Number(e.target.value))}
                className="w-full accent-slate-800 cursor-pointer"
              />
            </div>

            {crossSectionImageUrl ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <span className="text-slate-600">
                    {arrowMode === 'auto' && activePerpProjection
                      ? `Rzut prostopadły (${arrowPercent.toFixed(1)}%) — przesuń czerwony kwadracik na mapie, suwak lub kliknij wycinek:`
                      : `Pozycja ręczna (${arrowPercent.toFixed(1)}%) — przesuń czerwony kwadracik na mapie lub suwak:`}
                  </span>
                  {arrowMode === 'manual' && activePerpProjection && (
                    <button
                      type="button"
                      onClick={() => {
                        pushUndoSnapshot('Powrót do rzutu prostopadłego');
                        setArrowMode('auto');
                        setArrowPercent(activePerpProjection.arrowPercent);
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 border border-blue-300 text-blue-800 hover:bg-blue-100 cursor-pointer"
                    >
                      Przywróć rzut prostopadły ({activePerpProjection.arrowPercent.toFixed(1)}%)
                    </button>
                  )}
                </div>

                <div
                  onClick={(e) => {
                    pushUndoSnapshot('Przesunięcie strzałki na przekroju');
                    const pt = getNormPoint(e);
                    setArrowMode('manual');
                    setArrowPercent(Number((pt.x * 100).toFixed(1)));
                  }}
                  className="relative border border-slate-300 rounded overflow-hidden bg-white cursor-crosshair"
                >
                  <img
                    src={crossSectionImageUrl}
                    alt="Wycięty przekrój geologiczny"
                    className="w-full max-h-36 object-contain block"
                  />
                  {crossHeaderMaskPercent > 0 && (
                    <div
                      aria-hidden="true"
                      style={{ height: `${crossHeaderMaskPercent}%` }}
                      className="absolute top-0 left-0 right-0 bg-white/85 border-b border-dashed border-blue-500 pointer-events-none flex items-end justify-center pb-0.5"
                    >
                      <span className="text-[9px] font-semibold text-blue-800">
                        nakładka zastępująca stare napisy
                      </span>
                    </div>
                  )}
                  <div
                    aria-hidden="true"
                    style={{
                      left: `${arrowPercent}%`,
                      top: `${Math.max(crossHeaderMaskPercent + 4, 36)}%`,
                    }}
                    className="absolute bottom-0 w-0.5 border-l-2 border-dashed border-black/80 pointer-events-none"
                  />
                  <div
                    aria-hidden="true"
                    style={{ left: `${arrowPercent}%` }}
                    className="absolute bottom-0 -translate-x-1/2 translate-y-0 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[8px] border-l-transparent border-r-transparent border-b-yellow-400 pointer-events-none"
                  />
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.2}
                  value={arrowPercent}
                  onMouseDown={() => pushUndoSnapshot('Przesunięcie strzałki na przekroju')}
                  onTouchStart={() => pushUndoSnapshot('Przesunięcie strzałki na przekroju')}
                  onChange={(e) => {
                    setArrowMode('manual');
                    setArrowPercent(Number(e.target.value));
                  }}
                  className="w-full accent-blue-700 cursor-pointer"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[11px] text-slate-500">
                  <span>
                    {arrowMode === 'auto' && activePerpProjection
                      ? 'Pozycja z rzutu prostopadłego:'
                      : 'Pozycja rzutu lokalizacji na przekroju:'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {arrowMode === 'manual' && activePerpProjection && (
                      <button
                        type="button"
                        onClick={() => {
                          pushUndoSnapshot('Powrót do rzutu prostopadłego');
                          setArrowMode('auto');
                          setArrowPercent(activePerpProjection.arrowPercent);
                        }}
                        className="text-[10px] font-semibold text-blue-700 hover:underline cursor-pointer"
                      >
                        Rzut ({activePerpProjection.arrowPercent.toFixed(1)}%)
                      </button>
                    )}
                    <span className="font-mono font-semibold text-slate-800">
                      {arrowPercent.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={arrowPercent}
                  onMouseDown={() => pushUndoSnapshot('Przesunięcie strzałki na przekroju')}
                  onTouchStart={() => pushUndoSnapshot('Przesunięcie strzałki na przekroju')}
                  onChange={(e) => {
                    setArrowMode('manual');
                    setArrowPercent(Number(e.target.value));
                  }}
                  className="w-full accent-blue-700 cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>

        {/* Slots 3, 4, 5: Legend Col 1, Legend Col 2, Authors */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              { slot: 'legend1' as const, title: '3. Legenda (kol. 1)', url: legendCol1ImageUrl },
              { slot: 'legend2' as const, title: '4. Legenda (kol. 2)', url: legendCol2ImageUrl },
              { slot: 'authors' as const, title: '5. Autorzy arkusza', url: authorsImageUrl },
            ] as const
          ).map(({ slot, title, url }) => (
            <div
              key={slot}
              tabIndex={0}
              onPaste={(e) => void handlePasteToTarget(e, (u) => assignSlotUrl(slot, u))}
              className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-1.5 focus:outline-none focus:border-blue-600"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-bold text-slate-800">{title}</span>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 cursor-pointer">
                    <span>Wgraj</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) =>
                        void handleImageFile(e.target.files?.[0], (u) => assignSlotUrl(slot, u))
                      }
                    />
                  </label>
                  {url && (
                    <button
                      type="button"
                      onClick={() => assignSlotUrl(slot, null)}
                      className="text-[11px] text-rose-700 hover:text-rose-900 cursor-pointer"
                    >
                      Usuń
                    </button>
                  )}
                </div>
              </div>
              {url ? (
                <img
                  src={url}
                  alt={title}
                  className="w-full max-h-20 object-contain border border-slate-200 rounded bg-white block"
                />
              ) : (
                <p className="text-[10px] text-slate-500">
                  Wytnij z rastra lub wklej (<span className="font-mono">Ctrl+V</span>).
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Feedback & A4 Preview */}
      <div className="p-4 sm:p-6 bg-slate-100/80 space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {isStale && (
          <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Zmieniono wycinki lub położenie znaczników — kliknij „Odśwież SMGP A4” albo „Pobierz PDF
            (A4)”.
          </p>
        )}

        {previewDataUrl ? (
          <div className="space-y-3">
            {/* Toolbar for white-rectangle artifact masking directly on generated A4 page */}
            <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMaskDrawMode((v) => !v);
                    setMaskDragStart(null);
                    setMaskDragCurrent(null);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold border transition-colors cursor-pointer ${
                    maskDrawMode
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {maskDrawMode
                      ? 'Rysowanie białych masek: WŁĄCZONE'
                      : 'Rysuj białe prostokąty (maskuj artefakty)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  title={
                    undoStack.length > 0
                      ? `Cofnij: ${undoStack[undoStack.length - 1].label} (Ctrl+Z)`
                      : 'Brak czynności do cofnięcia (Ctrl+Z)'
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed text-slate-800 text-[11px] font-semibold cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Cofnij{undoStack.length > 0 ? ` (${undoStack.length})` : ''}</span>
                </button>

                {whiteMasks.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        pushUndoSnapshot('Usunięcie ostatniej białej maski');
                        setWhiteMasks((prev) => prev.slice(0, -1));
                      }}
                      className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium cursor-pointer"
                    >
                      Cofnij maskę
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        pushUndoSnapshot('Usunięcie wszystkich białych masek');
                        setWhiteMasks([]);
                      }}
                      className="px-2 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-medium cursor-pointer"
                    >
                      Usuń wszystkie ({whiteMasks.length})
                    </button>
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer ml-1">
                      <input
                        type="checkbox"
                        checked={showMaskOutlines}
                        onChange={(e) => setShowMaskOutlines(e.target.checked)}
                        className="accent-blue-700"
                      />
                      <span>Pokaż obrysy na podglądzie</span>
                    </label>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-slate-500 mr-0.5">Powiększenie A4:</span>
                {([1, 1.5, 2] as const).map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setPreviewZoom(z)}
                    className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                      previewZoom === z
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {z === 1 ? 'Dopasuj' : `${z}×`}
                  </button>
                ))}
              </div>
            </div>

            {maskDrawMode && (
              <p className="max-w-3xl mx-auto text-[11px] text-slate-600 text-center">
                Przeciągnij myszką prostokąt bezpośrednio na poniższym podglądzie A4, aby zakryć na
                biało niechciane napisy, pieczątki lub ramki (kliknij × na obrysie, aby usunąć
                wybraną maskę).
              </p>
            )}

            <div className="max-w-3xl mx-auto overflow-auto max-h-[760px] text-center">
              <div
                onMouseDown={(e) => {
                  if (!maskDrawMode) return;
                  const pt = getNormPoint(e);
                  setMaskDragStart(pt);
                  setMaskDragCurrent(pt);
                }}
                onMouseMove={(e) => {
                  if (!maskDrawMode || !maskDragStart) return;
                  setMaskDragCurrent(getNormPoint(e));
                }}
                onMouseUp={() => {
                  if (!maskDrawMode || !maskDragStart || !maskDragCurrent) {
                    setMaskDragStart(null);
                    setMaskDragCurrent(null);
                    return;
                  }
                  const x = Math.min(maskDragStart.x, maskDragCurrent.x);
                  const y = Math.min(maskDragStart.y, maskDragCurrent.y);
                  const w = Math.abs(maskDragCurrent.x - maskDragStart.x);
                  const h = Math.abs(maskDragCurrent.y - maskDragStart.y);
                  setMaskDragStart(null);
                  setMaskDragCurrent(null);
                  if (w > 0.005 && h > 0.005) {
                    pushUndoSnapshot('Dodanie białej maski');
                    setWhiteMasks((prev) => [
                      ...prev,
                      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, x, y, w, h },
                    ]);
                  }
                }}
                onMouseLeave={() => {
                  if (maskDragStart) {
                    setMaskDragStart(null);
                    setMaskDragCurrent(null);
                  }
                }}
                style={{
                  width: previewZoom === 1 ? '100%' : `${previewZoom * 100}%`,
                  maxWidth: previewZoom === 1 ? '540px' : 'none',
                }}
                className={`relative mx-auto inline-block select-none bg-white border border-slate-300 shadow-sm rounded-sm overflow-hidden leading-none ${
                  maskDrawMode ? 'cursor-crosshair' : ''
                }`}
              >
                <img
                  src={previewDataUrl}
                  alt="Podgląd strony A4 – Mapa geologiczna 1:50 000"
                  draggable={false}
                  className="w-full h-auto block pointer-events-none"
                />

                {/* Interactive outlines for white masks (pure white without outlines in exported PNG/PDF) */}
                {(maskDrawMode || showMaskOutlines) &&
                  whiteMasks.map((mask) => (
                    <div
                      key={mask.id}
                      style={{
                        left: `${mask.x * 100}%`,
                        top: `${mask.y * 100}%`,
                        width: `${mask.w * 100}%`,
                        height: `${mask.h * 100}%`,
                      }}
                      className="absolute border border-dashed border-blue-500/70 bg-white/10 group pointer-events-none"
                    >
                      {maskDrawMode && (
                        <button
                          type="button"
                          title="Usuń tę białą maskę"
                          onMouseDown={(ev) => ev.stopPropagation()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            pushUndoSnapshot('Usunięcie białej maski');
                            setWhiteMasks((prev) => prev.filter((item) => item.id !== mask.id));
                          }}
                          className="pointer-events-auto absolute -top-2.5 -right-2.5 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] leading-none flex items-center justify-center shadow hover:bg-rose-700 cursor-pointer"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}

                {/* Active white mask drag preview */}
                {maskDragStart && maskDragCurrent && (
                  <div
                    aria-hidden="true"
                    style={{
                      left: `${Math.min(maskDragStart.x, maskDragCurrent.x) * 100}%`,
                      top: `${Math.min(maskDragStart.y, maskDragCurrent.y) * 100}%`,
                      width: `${Math.abs(maskDragCurrent.x - maskDragStart.x) * 100}%`,
                      height: `${Math.abs(maskDragCurrent.y - maskDragStart.y) * 100}%`,
                    }}
                    className="absolute bg-white/90 border-2 border-dashed border-blue-600 pointer-events-none"
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Wgraj raster JPG/PNG, skalibruj ramkę i kliknij „Generuj SMGP A4”.
            </p>
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={generating || !validInPoland}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 disabled:text-slate-400 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Generuj i pobierz PDF SMGP od razu</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
