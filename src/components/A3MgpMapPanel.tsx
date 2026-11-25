import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  Crop,
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
import type { A4WhiteMaskRect } from '../data/a4MapCanvas';
import {
  renderMgpA3SheetCanvas,
  type A3Orientation,
} from '../data/a3MgpCanvas';
import {
  computeCenteredMapRectForSizeMm,
  cropImageFromElement,
  detectMapNeatlineFromImage,
  formatDmsShort,
  parseAxisCoord,
  readFileAsDataUrl,
  type NormRect,
} from '../data/rasterNeatlineUtils';
import type { MgpBoard, MgpMapMeta } from '../data/terrainTypes';

interface A3MgpMapPanelProps {
  board: MgpBoard;
  defaultHeaderLabel: string;
  lat: number | null;
  lon: number | null;
  validInPoland: boolean;
  mgpMeta: MgpMapMeta | null;
  loadingMeta: boolean;
}

type CropTargetSlot = 'map' | 'legend' | 'authors';
type MapCalibMode = 'auto' | 'corners' | 'neatline' | 'manual';

interface MgpUndoSnapshot {
  label: string;
  headerLabel: string;
  orientation: A3Orientation;
  mapWidthMm: number;
  mapHeightMm: number;
  markerColor: '#FFE600' | '#EF1D1D';
  selectedEdition: 'III' | 'II' | 'I' | '';
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
  legendImageUrl: string | null;
  authorsImageUrl: string | null;
  whiteMasks: A4WhiteMaskRect[];
}

const SLOT_LABELS: Record<CropTargetSlot, string> = {
  map: '1. Wycinek mapy z rastra',
  legend: '2. Legenda (1 kolumna)',
  authors: '3. Autorzy / metryczka',
};

export function A3MgpMapPanel({
  board,
  defaultHeaderLabel,
  lat,
  lon,
  validInPoland,
  mgpMeta,
  loadingMeta,
}: A3MgpMapPanelProps) {
  const [headerLabel, setHeaderLabel] = useState<string>(defaultHeaderLabel);
  const [orientation, setOrientation] = useState<A3Orientation>('landscape');
  const [mapWidthMm, setMapWidthMm] = useState<number>(250);
  const [mapHeightMm, setMapHeightMm] = useState<number>(180);
  const [markerColor, setMarkerColor] = useState<'#FFE600' | '#EF1D1D'>('#FFE600');
  const [selectedEdition, setSelectedEdition] = useState<'III' | 'II' | 'I' | ''>('');

  // Geographic frame border coordinates (editable, auto-filled from active edition sheetBounds)
  const [northLatText, setNorthLatText] = useState<string>('');
  const [southLatText, setSouthLatText] = useState<string>('');
  const [westLonText, setWestLonText] = useState<string>('');
  const [eastLonText, setEastLonText] = useState<string>('');

  // Full MGP Plansza A/B raster JPG/PNG sheet (persisted in server mgp-sheets/)
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
  const panelSectionRef = useRef<HTMLElement | null>(null);
  const pendingAutoDetectRef = useRef<boolean>(false);
  const skipNextAutoCropRef = useRef<boolean>(false);
  const [undoStack, setUndoStack] = useState<MgpUndoSnapshot[]>([]);

  // Cropped pieces for A3 page
  const [customMapImageUrl, setCustomMapImageUrl] = useState<string | null>(null);
  const [markerXPercent, setMarkerXPercent] = useState<number>(50);
  const [markerYPercent, setMarkerYPercent] = useState<number>(50);
  const [legendImageUrl, setLegendImageUrl] = useState<string | null>(null);
  const [authorsImageUrl, setAuthorsImageUrl] = useState<string | null>(null);

  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // Interactive white artifact-masking rectangles drawn directly on generated A3 page
  const [whiteMasks, setWhiteMasks] = useState<A4WhiteMaskRect[]>([]);
  const [maskDrawMode, setMaskDrawMode] = useState<boolean>(false);
  const [showMaskOutlines, setShowMaskOutlines] = useState<boolean>(true);
  const [previewZoom, setPreviewZoom] = useState<1 | 1.5 | 2>(1);
  const [maskDragStart, setMaskDragStart] = useState<{ x: number; y: number } | null>(null);
  const [maskDragCurrent, setMaskDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const neatlineStorageKey = mgpMeta?.sheetNumber
    ? `progeo_mgp_neatline_${mgpMeta.sheetNumber}_${board}`
    : null;

  const activeEditionInfo = useMemo(() => {
    if (!mgpMeta?.editions?.length) return null;
    if (selectedEdition) {
      const match = mgpMeta.editions.find((e) => e.edition === selectedEdition);
      if (match) return match;
    }
    return (
      mgpMeta.editions.find((e) => e.edition === mgpMeta.activeEdition) ??
      mgpMeta.editions[0] ??
      null
    );
  }, [mgpMeta, selectedEdition]);

  const applyBoundsToInputs = (bounds: MgpMapMeta['sheetBounds'] | undefined) => {
    if (!bounds) return;
    setNorthLatText(formatDmsShort(bounds.maxLat));
    setSouthLatText(formatDmsShort(bounds.minLat));
    setWestLonText(formatDmsShort(bounds.minLon));
    setEastLonText(formatDmsShort(bounds.maxLon));
  };

  // Initialize state whenever mgpMeta changes for new coordinates
  useEffect(() => {
    if (!mgpMeta) {
      setSourceSheetUrl(null);
      setSavedSheetName(null);
      setCalibratedNeatline(null);
      setNeatlineSource(null);
      setCustomMapImageUrl(null);
      setPreviewDataUrl(null);
      setUndoStack([]);
      return;
    }

    setUndoStack([]);
    const initEdition = mgpMeta.activeEdition ?? mgpMeta.editions[0]?.edition ?? '';
    setSelectedEdition(initEdition);
    const edObj =
      mgpMeta.editions.find((e) => e.edition === initEdition) ?? mgpMeta.editions[0] ?? null;
    applyBoundsToInputs(edObj?.sheetBounds ?? mgpMeta.sheetBounds);

    let loadedManualRect: NormRect | null = null;
    if (mgpMeta.sheetNumber) {
      try {
        const rawRect = localStorage.getItem(
          `progeo_mgp_neatline_${mgpMeta.sheetNumber}_${board}`
        );
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

    const savedUrl = board === 'A' ? mgpMeta.savedScanUrlA : mgpMeta.savedScanUrlB;
    if (savedUrl && mgpMeta.sheetNumber) {
      setSourceSheetUrl(savedUrl);
      setSavedSheetName(`mgp${mgpMeta.sheetNumber.padStart(4, '0')}_${board}`);
    } else {
      setSourceSheetUrl(null);
      setSavedSheetName(null);
      setCustomMapImageUrl(null);
    }
  }, [mgpMeta, board]);

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
    const fallback = activeEditionInfo?.pointInSheetPercent ?? mgpMeta?.pointInSheetPercent;
    if (fallback) {
      return { ...fallback, outOfFrame: false };
    }
    return null;
  }, [lat, lon, parsedBorder, activeEditionInfo, mgpMeta]);

  const sheetGroundSpan = useMemo(() => {
    const bounds = parsedBorder
      ? {
          minLon: parsedBorder.wLon,
          maxLon: parsedBorder.eLon,
          minLat: parsedBorder.sLat,
          maxLat: parsedBorder.nLat,
        }
      : activeEditionInfo?.sheetBounds ?? mgpMeta?.sheetBounds ?? null;
    if (!bounds) return null;
    const midLat = (bounds.minLat + bounds.maxLat) / 2;
    const groundW =
      (bounds.maxLon - bounds.minLon) * 111320 * Math.cos((midLat * Math.PI) / 180);
    const groundH = (bounds.maxLat - bounds.minLat) * 111132;
    if (groundW <= 500 || groundH <= 500) return null;
    return { groundW, groundH };
  }, [parsedBorder, activeEditionInfo, mgpMeta]);

  const pushUndoSnapshot = (label: string) => {
    const snap: MgpUndoSnapshot = {
      label,
      headerLabel,
      orientation,
      mapWidthMm,
      mapHeightMm,
      markerColor,
      selectedEdition,
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
      legendImageUrl,
      authorsImageUrl,
      whiteMasks: whiteMasks.map((m) => ({ ...m })),
    };
    setUndoStack((prev) => [...prev.slice(-29), snap]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    skipNextAutoCropRef.current = true;

    setHeaderLabel(snap.headerLabel);
    setOrientation(snap.orientation);
    setMapWidthMm(snap.mapWidthMm);
    setMapHeightMm(snap.mapHeightMm);
    setMarkerColor(snap.markerColor);
    setSelectedEdition(snap.selectedEdition);
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
    setLegendImageUrl(snap.legendImageUrl);
    setAuthorsImageUrl(snap.authorsImageUrl);
    setWhiteMasks(snap.whiteMasks);

    setCornerTL(null);
    setDragStart(null);
    setDragCurrent(null);
    setMaskDragStart(null);
    setMaskDragCurrent(null);
    setError(null);

    if (neatlineStorageKey) {
      try {
        if (snap.neatlineSource === 'manual' && snap.calibratedNeatline) {
          localStorage.setItem(
            neatlineStorageKey,
            JSON.stringify({ ...snap.calibratedNeatline, manual: true })
          );
        } else {
          localStorage.removeItem(neatlineStorageKey);
        }
      } catch {
        // ignore
      }
    }
  };

  const applyCenteredNeatlineCrop = (img: HTMLImageElement, neatline: NormRect) => {
    if (!interpolatedPercent) return;
    const { cropRect, markerXPercent: mx, markerYPercent: my } =
      computeCenteredMapRectForSizeMm(
        img,
        neatline,
        interpolatedPercent.uPercent,
        interpolatedPercent.vPercentFromTop,
        mapWidthMm,
        mapHeightMm,
        sheetGroundSpan
      );
    const cropped = cropImageFromElement(img, cropRect);
    setCustomMapImageUrl(cropped);
    setMarkerXPercent(mx);
    setMarkerYPercent(my);
  };

  const saveNeatlineAndCrop = (rect: NormRect, manual = true) => {
    setCalibratedNeatline(rect);
    setNeatlineSource(manual ? 'manual' : 'auto');
    if (neatlineStorageKey && manual) {
      try {
        localStorage.setItem(neatlineStorageKey, JSON.stringify({ ...rect, manual: true }));
      } catch {
        // ignore
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
    setMapCropMode('auto');
    try {
      const detected = detectMapNeatlineFromImage(img);
      if (detected) {
        if (neatlineStorageKey) {
          try {
            localStorage.removeItem(neatlineStorageKey);
          } catch {
            // ignore
          }
        }
        saveNeatlineAndCrop(detected, false);
        setError(null);
      }
    } catch {
      // fallback silently to manual calibration
    }
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
    mapWidthMm,
    mapHeightMm,
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
    let wasClamped = false;
    if (sourceImgRef.current && sourceImgRef.current.naturalWidth > 0) {
      const centered = computeCenteredMapRectForSizeMm(
        sourceImgRef.current,
        calibratedNeatline,
        interpolatedPercent.uPercent,
        interpolatedPercent.vPercentFromTop,
        mapWidthMm,
        mapHeightMm,
        sheetGroundSpan
      );
      cropBox = centered.cropRect;
      expectedMarkerX = centered.markerXPercent;
      expectedMarkerY = centered.markerYPercent;
      wasClamped = centered.wasClamped;
    }
    return { ptX, ptY, cropBox, expectedMarkerX, expectedMarkerY, wasClamped };
  }, [calibratedNeatline, interpolatedPercent, imgDims, sheetGroundSpan, mapWidthMm, mapHeightMm]);

  const isPointDisplacedFromCoords = Boolean(
    customMapImageUrl &&
      (mapCropMode === 'manual' ||
        neatlineSource === 'manual' ||
        (overlayPreview &&
          (Math.abs(markerXPercent - overlayPreview.expectedMarkerX) > 0.25 ||
            Math.abs(markerYPercent - overlayPreview.expectedMarkerY) > 0.25)))
  );

  const assignSlotUrl = (slot: CropTargetSlot, url: string | null) => {
    pushUndoSnapshot(url ? `Zmiana: ${SLOT_LABELS[slot]}` : `Usunięcie: ${SLOT_LABELS[slot]}`);
    if (slot === 'map') {
      setCustomMapImageUrl(url);
      if (url) {
        setMarkerXPercent(50);
        setMarkerYPercent(50);
      }
    } else if (slot === 'legend') {
      setLegendImageUrl(url);
    } else {
      setAuthorsImageUrl(url);
    }
  };

  const getSlotUrl = (slot: CropTargetSlot): string | null => {
    switch (slot) {
      case 'map':
        return customMapImageUrl;
      case 'legend':
        return legendImageUrl;
      case 'authors':
        return authorsImageUrl;
    }
  };

  const persistFullSheetToServer = async (file: File) => {
    if (!mgpMeta?.sheetNumber) return;
    setSavingToFolder(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(
        `/api/mgp-sheet-scan?sheet=${encodeURIComponent(mgpMeta.sheetNumber)}&board=${board}`,
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
          setSavedSheetName(json.filename ?? `mgp${mgpMeta.sheetNumber}_${board}`);
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
        if (neatlineStorageKey) {
          try {
            localStorage.removeItem(neatlineStorageKey);
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
    if (!mgpMeta?.sheetNumber) return;
    try {
      await fetch(
        `/api/mgp-sheet-scan?sheet=${encodeURIComponent(mgpMeta.sheetNumber)}&board=${board}`,
        { method: 'DELETE' }
      );
    } catch {
      // ignore
    }
    setSavedSheetName(null);
    setSourceSheetUrl(null);
    setCalibratedNeatline(null);
    setNeatlineSource(null);
    setCornerTL(null);
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

  const resetPointToCoordinates = () => {
    if (lat === null || lon === null) return;
    pushUndoSnapshot('Przywrócenie punktu ze współrzędnych');

    setCornerTL(null);
    setDragStart(null);
    setDragCurrent(null);
    setMapCropMode('auto');
    setError(null);

    if (neatlineStorageKey) {
      try {
        localStorage.removeItem(neatlineStorageKey);
      } catch {
        // ignore
      }
    }

    const bounds = activeEditionInfo?.sheetBounds ?? mgpMeta?.sheetBounds ?? null;
    if (bounds) {
      applyBoundsToInputs(bounds);
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
          const centered = computeCenteredMapRectForSizeMm(
            img,
            resolvedNeatline,
            uPct,
            vPct,
            mapWidthMm,
            mapHeightMm,
            groundSpan
          );
          setCustomMapImageUrl(cropImageFromElement(img, centered.cropRect));
          setMarkerXPercent(centered.markerXPercent);
          setMarkerYPercent(centered.markerYPercent);
        } catch {
          // ignore
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
    if (activeCropSlot === 'map') {
      if (mapCropMode === 'auto') {
        if (!calibratedNeatline) {
          setMapCropMode('corners');
          setCornerTL(pt);
          setError(null);
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
            setActiveCropSlot('legend');
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
          assignSlotUrl(activeCropSlot, cropped);
        }

        const order: CropTargetSlot[] = ['map', 'legend', 'authors'];
        const nextIdx = order.indexOf(activeCropSlot) + 1;
        if (nextIdx < order.length) setActiveCropSlot(order[nextIdx]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udało się wyciąć fragmentu rastra.');
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  const currentKey =
    lat !== null && lon !== null
      ? [
          board,
          lat.toFixed(6),
          lon.toFixed(6),
          headerLabel.trim(),
          orientation,
          mapWidthMm,
          mapHeightMm,
          markerColor,
          selectedEdition,
          markerXPercent.toFixed(1),
          markerYPercent.toFixed(1),
          customMapImageUrl ? customMapImageUrl.length : 0,
          legendImageUrl ? legendImageUrl.length : 0,
          authorsImageUrl ? authorsImageUrl.length : 0,
          whiteMasks
            .map((m) => `${m.x.toFixed(4)},${m.y.toFixed(4)},${m.w.toFixed(4)},${m.h.toFixed(4)}`)
            .join('|'),
          mgpMeta?.sheetNumber ?? '',
        ].join(':')
      : null;

  const isStale = Boolean(previewDataUrl && currentKey && generatedKey !== currentKey);

  const buildSheet = async (): Promise<string | null> => {
    if (lat === null || lon === null || !validInPoland) {
      setError('Wpisz poprawne współrzędne na terenie Polski, aby wygenerować załącznik MGśP A3.');
      return null;
    }
    if (!customMapImageUrl) {
      setError(
        `Wgraj raster JPG/PNG arkusza MGśP (Plansza ${board}) w Kroku 1, aby wyinterpolować punkt i wyciąć mapę w skali 1:50 000.`
      );
      return null;
    }

    setGenerating(true);
    setError(null);
    try {
      const canvas = await renderMgpA3SheetCanvas({
        board,
        orientation,
        headerLabel,
        mgpMeta,
        activeEditionInfo,
        customMapImageUrl,
        legendImageUrl,
        authorsImageUrl,
        markerXPercent,
        markerYPercent,
        markerColor,
        mapWidthMm,
        mapHeightMm,
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
          : `Nie udało się wygenerować arkusza MGśP Plansza ${board} (A3).`
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
          const canvas = await renderMgpA3SheetCanvas({
            board,
            orientation,
            headerLabel,
            mgpMeta,
            activeEditionInfo,
            customMapImageUrl,
            legendImageUrl,
            authorsImageUrl,
            markerXPercent,
            markerYPercent,
            markerColor,
            mapWidthMm,
            mapHeightMm,
            whiteMasks,
          });
          if (cancelled) return;
          setPreviewDataUrl(canvas.toDataURL('image/png'));
          setGeneratedKey(currentKey);
        } catch {
          // ignore auto-preview error
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    board,
    validInPoland,
    lat,
    lon,
    orientation,
    headerLabel,
    mgpMeta,
    activeEditionInfo,
    customMapImageUrl,
    legendImageUrl,
    authorsImageUrl,
    markerXPercent,
    markerYPercent,
    markerColor,
    mapWidthMm,
    mapHeightMm,
    whiteMasks,
    currentKey,
  ]);

  // Scoped Ctrl+Z / Cmd+Z undo when focus is inside this MGP panel
  const handlePanelKeyDown = (ev: React.KeyboardEvent<HTMLElement>) => {
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
        ev.stopPropagation();
        handleUndo();
      }
    }
  };

  const handleDownloadPdf = async () => {
    const dataUrl = !isStale && previewDataUrl ? previewDataUrl : await buildSheet();
    if (!dataUrl) return;

    const pdf = new jsPDF({
      orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a3',
      compress: true,
    });
    const pdfW = orientation === 'landscape' ? 420 : 297;
    const pdfH = orientation === 'landscape' ? 297 : 420;
    pdf.addImage(dataUrl, 'PNG', 0, 0, pdfW, pdfH, undefined, 'FAST');

    const safeTag = (headerLabel.trim() || defaultHeaderLabel)
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    pdf.save(`${safeTag}_MGSP_Plansza_${board}_50k_A3.pdf`);
  };

  const handleDownloadPng = async () => {
    const dataUrl = !isStale && previewDataUrl ? previewDataUrl : await buildSheet();
    if (!dataUrl) return;

    const safeTag = (headerLabel.trim() || defaultHeaderLabel)
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${safeTag}_MGSP_Plansza_${board}_50k_A3.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const boardAccent =
    board === 'A'
      ? {
          badge: 'bg-emerald-700 text-white',
          btn: 'bg-emerald-700 hover:bg-emerald-800',
          border: 'border-emerald-200',
          desc: 'Złoża kopalin, wody powierzchniowe i podziemne, warunki podłoża budowlanego, ochrona przyrody i zabytków.',
        }
      : {
          badge: 'bg-teal-800 text-white',
          btn: 'bg-teal-800 hover:bg-teal-900',
          border: 'border-teal-200',
          desc: 'Zagrożenia powierzchni ziemi, geochemia gleb/osadów, odpady oraz obszary predysponowane do składowania.',
        };

  const boardAuthors =
    board === 'A'
      ? activeEditionInfo?.authorsA ?? mgpMeta?.authorsA
      : activeEditionInfo?.authorsB ?? mgpMeta?.authorsB;
  const boardYear =
    board === 'A'
      ? activeEditionInfo?.yearA ?? mgpMeta?.yearA
      : activeEditionInfo?.yearB ?? mgpMeta?.yearB;

  return (
    <section
      ref={panelSectionRef}
      tabIndex={-1}
      onKeyDown={handlePanelKeyDown}
      aria-label={`Załącznik mapowy A3 – Mapa Geośrodowiskowa Polski 1:50 000 – Plansza ${board}`}
      className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden focus:outline-none"
    >
      <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${boardAccent.badge}`}
            >
              Plansza {board} · A3
            </span>
            <h2 className="text-sm font-bold text-slate-950">
              Załącznik mapowy A3 – Mapa Geośrodowiskowa Polski 1:50 000 (Plansza {board})
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{boardAccent.desc}</p>
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
            className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-md ${boardAccent.btn} disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
          >
            {generating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Składanie A3…</span>
              </>
            ) : (
              <>
                <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {previewDataUrl ? `Odśwież Planszę ${board} A3` : `Generuj Planszę ${board} A3`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-white space-y-4">
        {/* Detected MGśP sheet + edition switcher + PIG-PIB links */}
        {loadingMeta ? (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>Sprawdzam arkusz MGśP 1:50 000 i granice geograficzne…</span>
          </p>
        ) : mgpMeta?.sheetNumber ? (
          <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                Arkusz MGśP: <strong className="font-mono">nr {mgpMeta.sheetNumber}</strong> –{' '}
                <strong>{activeEditionInfo?.sheetName ?? mgpMeta.sheetName ?? '—'}</strong>
                {activeEditionInfo?.godlo ? ` (${activeEditionInfo.godlo})` : ''}
                {boardAuthors ? ` · autorzy Planszy ${board}: ${boardAuthors}` : ''}
                {boardYear ? ` (${boardYear})` : ''}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {mgpMeta.resourceUrl && (
                  <a
                    href={mgpMeta.resourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 whitespace-nowrap"
                  >
                    <span>Pobierz skany z PIG-PIB</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                )}
                <a
                  href={mgpMeta.emgspUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
                >
                  <span>Portal e-MGśP</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              </div>
            </div>

            {mgpMeta.editions.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-500 font-medium">Edycja arkusza (układ ramki):</span>
                  {mgpMeta.editions.map((ed) => {
                    const isActive = activeEditionInfo?.edition === ed.edition;
                    const edYear = board === 'A' ? ed.yearA : ed.yearB;
                    return (
                      <button
                        key={ed.edition}
                        type="button"
                        onClick={() => {
                          pushUndoSnapshot(`Zmiana edycji MGśP na ${ed.edition}`);
                          setSelectedEdition(ed.edition);
                          applyBoundsToInputs(ed.sheetBounds);
                        }}
                        className={`px-2 py-0.5 rounded font-semibold border cursor-pointer ${
                          isActive
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        MGśP {ed.edition} ({ed.coordSystemLabel}
                        {edYear ? `, ${edYear}` : ''})
                      </button>
                    );
                  })}
                </div>
                {savedSheetName && (
                  <span className="font-medium text-emerald-700">
                    Zapisano (`mgp-sheets/{savedSheetName}`)
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}

        {/* Top controls: header label, A3 orientation, exact map cutout size in mm, export buttons */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label
                htmlFor={`mgp-zal-label-${board}`}
                className="block text-xs font-semibold text-slate-700"
              >
                Oznaczenie (róg A3)
              </label>
              <input
                id={`mgp-zal-label-${board}`}
                type="text"
                maxLength={24}
                value={headerLabel}
                onChange={(e) => setHeaderLabel(e.target.value)}
                placeholder={defaultHeaderLabel}
                className="w-24 h-9 px-2.5 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md font-sans text-sm font-bold text-slate-950 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">Orientacja A3</span>
              <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    if (orientation !== 'landscape') {
                      pushUndoSnapshot('Zmiana orientacji A3 na poziomą');
                      setOrientation('landscape');
                      if (mapWidthMm === 200 && mapHeightMm === 150) {
                        setMapWidthMm(250);
                        setMapHeightMm(180);
                      }
                    }
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    orientation === 'landscape'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Poziomo (420×297)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (orientation !== 'portrait') {
                      pushUndoSnapshot('Zmiana orientacji A3 na pionową');
                      setOrientation('portrait');
                      if (mapWidthMm === 250 && mapHeightMm === 180) {
                        setMapWidthMm(200);
                        setMapHeightMm(150);
                      }
                    }
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    orientation === 'portrait'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Pionowo (297×420)
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">
                Wymiar wycinka mapy (1:50 000) [mm]
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={80}
                  max={360}
                  step={5}
                  aria-label="Szerokość wycinka mapy w mm"
                  value={mapWidthMm}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 50 && v <= 380) {
                      setMapWidthMm(v);
                    }
                  }}
                  className="w-16 h-9 px-2 border border-slate-300 rounded-md font-mono text-xs text-slate-900"
                />
                <span className="text-xs text-slate-400">×</span>
                <input
                  type="number"
                  min={60}
                  max={300}
                  step={5}
                  aria-label="Wysokość wycinka mapy w mm"
                  value={mapHeightMm}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 50 && v <= 340) {
                      setMapHeightMm(v);
                    }
                  }}
                  className="w-16 h-9 px-2 border border-slate-300 rounded-md font-mono text-xs text-slate-900"
                />
                <span className="text-[11px] text-slate-500">
                  ({((mapWidthMm * 50) / 1000).toFixed(1)}×{((mapHeightMm * 50) / 1000).toFixed(1)} km)
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">Punkt</span>
              <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    pushUndoSnapshot('Zmiana koloru punktu na żółty');
                    setMarkerColor('#FFE600');
                  }}
                  className={`px-2 py-1 text-xs font-medium rounded cursor-pointer ${
                    markerColor === '#FFE600'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Żółty
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pushUndoSnapshot('Zmiana koloru punktu na czerwony');
                    setMarkerColor('#EF1D1D');
                  }}
                  className={`px-2 py-1 text-xs font-medium rounded cursor-pointer ${
                    markerColor === '#EF1D1D'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Czerwony
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
              <span>Pobierz PDF (A3)</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPng()}
              disabled={generating || !validInPoland}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileImage className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pobierz PNG (A3)</span>
            </button>
          </div>
        </div>

        {/* STEP 1: Full MGśP Raster Upload + Border Geographic Coordinates Calibration */}
        <div
          tabIndex={0}
          onPaste={(e) => void handlePasteToTarget(e, setSourceSheetUrl, true)}
          className="rounded-lg border border-slate-300 bg-slate-50/70 p-3.5 space-y-3 focus:outline-none focus:border-blue-600"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Crop className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>
                  Krok 1: Raster arkusza MGśP – Plansza {board} (JPG/PNG) i kalibracja ramki
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Wgraj raster Planszy {board} (lub wklej Ctrl+V). Ramka wykryje się automatycznie, a
                wycinek {mapWidthMm}×{mapHeightMm} mm w skali 1:50 000 wycentruje się na punkcie (lub
                dosunie do brzegu ramki mapy, jeśli wychodziłby poza arkusz).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md ${boardAccent.btn} text-white text-xs font-semibold cursor-pointer`}
              >
                <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {savingToFolder
                    ? 'Zapisywanie…'
                    : sourceSheetUrl
                      ? `Podmień raster Planszy ${board}`
                      : `Wgraj raster Planszy ${board}`}
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

          {/* Geographic Coordinates of Map Frame Edges */}
          <div className="rounded-md bg-white border border-slate-200 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-800">
                Współrzędne na obrzeżach ramki rastra (interpolacja punktu):
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
                {(activeEditionInfo?.sheetBounds ?? mgpMeta?.sheetBounds) && (
                  <button
                    type="button"
                    onClick={() => {
                      pushUndoSnapshot('Przywrócenie granic arkusza MGśP');
                      applyBoundsToInputs(activeEditionInfo?.sheetBounds ?? mgpMeta?.sheetBounds);
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
                  od góry.
                  {overlayPreview?.wasClamped && (
                    <span className="ml-1 text-emerald-800 font-medium">
                      (Ramka wycinka dosunięta do brzegu mapy, aby nie wyjść poza arkusz.)
                    </span>
                  )}
                  {interpolatedPercent.outOfFrame && (
                    <span className="text-rose-700 font-semibold ml-1">
                      (Punkt poza wpisanymi granicami ramki!)
                    </span>
                  )}
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
                {(['map', 'legend', 'authors'] as CropTargetSlot[]).map((slot) => {
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
                })}
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
                    <span>Przywróć punkt</span>
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

              <div
                ref={rasterScrollRef}
                className="bg-slate-200/60 border border-slate-300 rounded p-1 overflow-auto max-h-[520px] text-center"
              >
                <div
                  onMouseDown={handleRasterMouseDown}
                  onMouseMove={(e) => {
                    if (!dragStart) return;
                    setDragCurrent(getNormPoint(e));
                  }}
                  onMouseUp={finishCropDrag}
                  onMouseLeave={() => {
                    if (dragStart) finishCropDrag();
                  }}
                  className={`relative inline-block select-none bg-white leading-none ${
                    activeCropSlot === 'map' && mapCropMode === 'auto' && calibratedNeatline
                      ? 'cursor-default'
                      : 'cursor-crosshair'
                  }`}
                >
                  <img
                    ref={sourceImgRef}
                    src={sourceSheetUrl}
                    alt={`Pełny raster arkusza MGśP – Plansza ${board}`}
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

                  {/* Auto-cropped centered/clamped map rectangle + interpolated dot */}
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
                          backgroundColor: markerColor,
                        }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-black shadow-md pointer-events-none"
                      />
                    </>
                  )}

                  {cornerTL && (
                    <div
                      aria-hidden="true"
                      style={{ left: `${cornerTL.x * 100}%`, top: `${cornerTL.y * 100}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white shadow pointer-events-none"
                    />
                  )}

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
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              Pobierz skan JPG/PNG arkusza MGśP – <strong>Plansza {board}</strong> z PIG-PIB i wgraj
              tutaj (lub wklej przez <span className="font-mono">Ctrl+V</span>) — zostanie zapisany
              osobno w katalogu aplikacji dla Planszy {board}.
            </p>
          )}
        </div>

        {/* STEP 2: Cropped map + 3 Legend columns + Authors slots */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Slot 1: Cropped Map + clickable marker */}
          <div
            tabIndex={0}
            onPaste={(e) => void handlePasteToTarget(e, (u) => assignSlotUrl('map', u))}
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2 focus:outline-none focus:border-blue-600"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                1. Wycinek Planszy {board} ({mapWidthMm}×{mapHeightMm} mm)
              </span>
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
                    {isPointDisplacedFromCoords
                      ? ' — zmieniona ręcznie'
                      : ' — kliknij wycinek, aby skorygować'}
                  </p>
                  {lat !== null && lon !== null && (
                    <button
                      type="button"
                      onClick={resetPointToCoordinates}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border bg-white border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      <span>Przywróć punkt</span>
                    </button>
                  )}
                </div>
                <div
                  onClick={(e) => {
                    pushUndoSnapshot('Przesunięcie kropki lokalizacji');
                    const pt = getNormPoint(e);
                    setMarkerXPercent(Number((pt.x * 100).toFixed(1)));
                    setMarkerYPercent(Number((pt.y * 100).toFixed(1)));
                  }}
                  className="relative border border-slate-300 rounded overflow-hidden bg-white cursor-crosshair"
                >
                  <img
                    src={customMapImageUrl}
                    alt={`Wycięty fragment MGśP Plansza ${board}`}
                    className="w-full max-h-56 object-contain block"
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      left: `${markerXPercent}%`,
                      top: `${markerYPercent}%`,
                      backgroundColor: markerColor,
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-black shadow-sm pointer-events-none"
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                Brak wycinka mapy — wgraj raster Planszy {board} w Kroku 1 powyżej.
              </p>
            )}
          </div>

          {/* Slots 2-3: Single-column Legend (right side) & Authors (centered below map description) */}
          <div className="grid grid-cols-1 gap-2.5">
            {(
              [
                {
                  slot: 'legend' as const,
                  title: '2. Legenda (1 kolumna – po prawej pod ZAŁ.)',
                  url: legendImageUrl,
                },
                {
                  slot: 'authors' as const,
                  title: '3. Autorzy / metryczka (wyśrodkowane pod opisem mapy)',
                  url: authorsImageUrl,
                },
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
                  <div className="flex items-center gap-1.5">
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
                    className="w-full max-h-24 object-contain border border-slate-200 rounded bg-white block"
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
      </div>

      {/* Feedback & A3 Preview with white artifact masking */}
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
            Zmieniono ustawienia lub wycinki — kliknij „Odśwież Planszę {board} A3” albo „Pobierz
            PDF (A3)”.
          </p>
        )}

        {previewDataUrl ? (
          <div className="space-y-3">
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
                        pushUndoSnapshot('Usunięcie wszystkich białych masek');
                        setWhiteMasks([]);
                      }}
                      className="px-2 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-medium cursor-pointer"
                    >
                      Usuń maski ({whiteMasks.length})
                    </button>
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer ml-1">
                      <input
                        type="checkbox"
                        checked={showMaskOutlines}
                        onChange={(e) => setShowMaskOutlines(e.target.checked)}
                        className="accent-blue-700"
                      />
                      <span>Obrysy</span>
                    </label>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-slate-500 mr-0.5">Powiększenie A3:</span>
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
                  maxWidth: previewZoom === 1 ? (orientation === 'landscape' ? '720px' : '540px') : 'none',
                }}
                className={`relative mx-auto inline-block select-none bg-white border border-slate-300 shadow-sm rounded-sm overflow-hidden leading-none ${
                  maskDrawMode ? 'cursor-crosshair' : ''
                }`}
              >
                <img
                  src={previewDataUrl}
                  alt={`Podgląd arkusza A3 – MGśP 1:50 000 Plansza ${board}`}
                  draggable={false}
                  className="w-full h-auto block pointer-events-none"
                />

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
                      className="absolute border border-dashed border-blue-500/70 bg-white/10 pointer-events-none"
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

                {maskDragStart && maskDragCurrent && (
                  <div
                    aria-hidden="true"
                    style={{
                      left: `${Math.min(maskDragStart.x, maskDragCurrent.x) * 100}%`,
                      top: `${Math.min(maskDragStart.y, maskDragCurrent.y) * 100}%`,
                      width: `${Math.abs(maskDragCurrent.x - maskDragStart.x) * 100}%`,
                      height: `${Math.abs(maskDragCurrent.y - maskDragStart.y) * 100}%`,
                    }}
                    className="absolute border-2 border-blue-600 bg-white/80 pointer-events-none"
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 text-center py-6">
            Podgląd strony A3 dla <strong>Planszy {board}</strong> pojawi się automatycznie po
            wgraniu rastra arkusza MGśP w Kroku 1 powyżej.
          </p>
        )}
      </div>
    </section>
  );
}
