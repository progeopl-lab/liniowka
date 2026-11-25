import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Crosshair,
  ImagePlus,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import {
  formatCoordMetersPl,
  formatDmsPl,
  isWithinPoland,
  parseWgs84Input,
  wgs84ToPl1992,
  wgs84ToPl2000,
} from '../data/polishCoords';
import {
  DEFAULT_PRG_GOAL,
  GeologyDescriptionResponse,
  GeologyDescriptionSource,
  MgpMapMeta,
  PRG_CHAPTER_2_5_ITEMS,
  PRG_DOC_TYPE,
  PRG_LEGAL_BASIS,
  PrgProjectInfo,
  SmgpSharedAssets,
  TerrainReportResponse,
  buildPrgChapter1_1Items,
  buildPrgChapter2_1Items,
  buildPrgChapter2_6Content,
  buildTerrainReportHtml,
  buildTerrainReportPlainText,
  formatDistancePl,
  formatDistanceRounded10Pl,
  joinInvestorLines,
  toGenitiveOfficeNamePl,
} from '../data/terrainTypes';
import { A4MapSheetGenerator } from './A4MapSheetGenerator';
import { A4SopoMapPanel } from './A4SopoMapPanel';
import { A4SmgpMapPanel } from './A4SmgpMapPanel';
import { A3MgpMapPanel } from './A3MgpMapPanel';

function readImageFileAsDataUrl(file: File): Promise<string> {
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

function prepareImageForAnalysis(
  sourceUrl: string,
  marker?: { xPercent: number; yPercent: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxDim = 2200;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Brak wsparcia Canvas 2D.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      if (marker) {
        const mx = (Math.max(0, Math.min(100, marker.xPercent)) / 100) * w;
        const my = (Math.max(0, Math.min(100, marker.yPercent)) / 100) * h;
        const radius = Math.max(12, Math.min(w, h) * 0.022);
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(4, radius * 0.34);
        ctx.beginPath();
        ctx.arc(mx, my, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = Math.max(2.5, radius * 0.2);
        ctx.beginPath();
        ctx.arc(mx, my, radius, 0, Math.PI * 2);
        ctx.stroke();

        const arm = radius * 1.65;
        ctx.beginPath();
        ctx.moveTo(mx - arm, my);
        ctx.lineTo(mx - radius * 0.45, my);
        ctx.moveTo(mx + radius * 0.45, my);
        ctx.lineTo(mx + arm, my);
        ctx.moveTo(mx, my - arm);
        ctx.lineTo(mx, my - radius * 0.45);
        ctx.moveTo(mx, my + radius * 0.45);
        ctx.lineTo(mx, my + arm);
        ctx.stroke();

        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.arc(mx, my, Math.max(2.5, radius * 0.18), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('Nie udało się wczytać obrazu mapy do analizy.'));
    img.src = sourceUrl;
  });
}

export function TerrainDescriptionTool() {
  const [investorNameLine1, setInvestorNameLine1] = useState<string>('');
  const [investorNameLine2, setInvestorNameLine2] = useState<string>('');
  const [investorAddressLine1, setInvestorAddressLine1] = useState<string>('');
  const [investorAddressLine2, setInvestorAddressLine2] = useState<string>('');
  const [taskName, setTaskName] = useState<string>('');
  const [goal, setGoal] = useState<string>(DEFAULT_PRG_GOAL);

  const [coordsInput, setCoordsInput] = useState<string>('N 49 23 38.13 E 20 57 34.18');
  const [loading, setLoading] = useState<boolean>(false);
  const [locatingGps, setLocatingGps] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [report, setReport] = useState<TerrainReportResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [mgpMeta, setMgpMeta] = useState<MgpMapMeta | null>(null);
  const [loadingMgpMeta, setLoadingMgpMeta] = useState<boolean>(false);

  const [geologyDescription, setGeologyDescription] = useState<string>('');
  const [geologySourceMode, setGeologySourceMode] = useState<GeologyDescriptionSource | null>(null);
  const [geologyWarning, setGeologyWarning] = useState<string | null>(null);
  const [geologyError, setGeologyError] = useState<string | null>(null);
  const [loadingGeology, setLoadingGeology] = useState<boolean>(false);
  const [smgpPanelAssets, setSmgpPanelAssets] = useState<SmgpSharedAssets | null>(null);
  const [showGeologyUploads, setShowGeologyUploads] = useState<boolean>(false);
  const [manualMapImageUrl, setManualMapImageUrl] = useState<string | null>(null);
  const [manualLegend1ImageUrl, setManualLegend1ImageUrl] = useState<string | null>(null);
  const [manualLegend2ImageUrl, setManualLegend2ImageUrl] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const geologyReqIdRef = useRef<number>(0);

  const projectInfo: PrgProjectInfo = useMemo(
    () => ({
      investorNameLine1,
      investorNameLine2,
      investorAddressLine1,
      investorAddressLine2,
      taskName,
      goal,
    }),
    [investorNameLine1, investorNameLine2, investorAddressLine1, investorAddressLine2, taskName, goal]
  );

  const joinedInvestor = useMemo(() => joinInvestorLines(projectInfo), [projectInfo]);

  const parsedPoint = useMemo(() => parseWgs84Input(coordsInput), [coordsInput]);
  const validInPoland = parsedPoint ? isWithinPoland(parsedPoint.lat, parsedPoint.lon) : false;

  useEffect(() => {
    if (!parsedPoint || !validInPoland) {
      setMgpMeta(null);
      return;
    }
    let cancelled = false;
    setLoadingMgpMeta(true);
    fetch(
      `/api/mgp-map-meta?lat=${parsedPoint.lat.toFixed(7)}&lon=${parsedPoint.lon.toFixed(7)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MgpMapMeta | null) => {
        if (!cancelled) setMgpMeta(data);
      })
      .catch(() => {
        if (!cancelled) setMgpMeta(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingMgpMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parsedPoint?.lat, parsedPoint?.lon, validInPoland]);

  const pl1992 = useMemo(
    () => (parsedPoint ? wgs84ToPl1992(parsedPoint.lat, parsedPoint.lon) : null),
    [parsedPoint]
  );

  const pl2000 = useMemo(
    () => (parsedPoint ? wgs84ToPl2000(parsedPoint.lat, parsedPoint.lon) : null),
    [parsedPoint]
  );

  const dmsLabel = useMemo(() => {
    if (!parsedPoint) return null;
    return `${formatDmsPl(parsedPoint.lat, 'N', 'S')}  ${formatDmsPl(parsedPoint.lon, 'E', 'W')}`;
  }, [parsedPoint]);

  const ddLabel = useMemo(() => {
    if (!parsedPoint) return null;
    return `${parsedPoint.lat.toFixed(6).replace('.', ',')}° N, ${parsedPoint.lon.toFixed(6).replace('.', ',')}° E`;
  }, [parsedPoint]);

  const copyText = async (key: string, text: string, html?: string) => {
    try {
      if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob([text], { type: 'text/plain' }),
              'text/html': new Blob([html], { type: 'text/html' }),
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText(text);
        }
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2200);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleUseGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFetchError('Przeglądarka nie obsługuje odczytu lokalizacji GPS.');
      return;
    }
    setLocatingGps(true);
    setFetchError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setCoordsInput(`${formatDmsPl(lat, 'N', 'S')} ${formatDmsPl(lon, 'E', 'W')}`);
        setLocatingGps(false);
      },
      () => {
        setFetchError('Nie udało się odczytać pozycji GPS — sprawdź uprawnienia lokalizacji.');
        setLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const hasSmgpPanelImages = Boolean(
    smgpPanelAssets?.mapImageUrl ||
      smgpPanelAssets?.legendCol1ImageUrl ||
      smgpPanelAssets?.legendCol2ImageUrl
  );

  const hasManualGeologyImages = Boolean(
    manualMapImageUrl || manualLegend1ImageUrl || manualLegend2ImageUrl
  );

  const generateGeologyDescription = async (
    lat: number,
    lon: number,
    mode: 'auto' | 'pig-only' | 'panel-smgp' | 'manual-uploads'
  ) => {
    const reqId = ++geologyReqIdRef.current;
    setLoadingGeology(true);
    setGeologyError(null);

    try {
      let mapImageDataUrl: string | undefined;
      const legendImageDataUrls: string[] = [];
      let crossSectionImageDataUrl: string | undefined;

      const usePanelAssets =
        mode === 'panel-smgp' ||
        (mode === 'auto' &&
          Boolean(
            smgpPanelAssets?.mapImageUrl &&
              (smgpPanelAssets.legendCol1ImageUrl || smgpPanelAssets.legendCol2ImageUrl)
          ));

      if (usePanelAssets && smgpPanelAssets) {
        if (smgpPanelAssets.mapImageUrl) {
          mapImageDataUrl = await prepareImageForAnalysis(smgpPanelAssets.mapImageUrl, {
            xPercent: smgpPanelAssets.markerXPercent,
            yPercent: smgpPanelAssets.markerYPercent,
          });
        }
        if (smgpPanelAssets.legendCol1ImageUrl) {
          legendImageDataUrls.push(
            await prepareImageForAnalysis(smgpPanelAssets.legendCol1ImageUrl)
          );
        }
        if (smgpPanelAssets.legendCol2ImageUrl) {
          legendImageDataUrls.push(
            await prepareImageForAnalysis(smgpPanelAssets.legendCol2ImageUrl)
          );
        }
        if (smgpPanelAssets.crossSectionImageUrl) {
          crossSectionImageDataUrl = await prepareImageForAnalysis(
            smgpPanelAssets.crossSectionImageUrl
          );
        }
      } else if (mode === 'manual-uploads') {
        if (manualMapImageUrl) {
          mapImageDataUrl = await prepareImageForAnalysis(manualMapImageUrl);
        }
        if (manualLegend1ImageUrl) {
          legendImageDataUrls.push(await prepareImageForAnalysis(manualLegend1ImageUrl));
        }
        if (manualLegend2ImageUrl) {
          legendImageDataUrls.push(await prepareImageForAnalysis(manualLegend2ImageUrl));
        }
      }

      const res = await fetch('/api/geology-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: Number(lat.toFixed(7)),
          lon: Number(lon.toFixed(7)),
          mapImageDataUrl,
          legendImageDataUrls: legendImageDataUrls.length > 0 ? legendImageDataUrls : undefined,
          crossSectionImageDataUrl,
        }),
      });

      const data = (await res.json()) as GeologyDescriptionResponse & { error?: string };
      if (reqId !== geologyReqIdRef.current) return;

      if (!res.ok) {
        setGeologyError(data?.error ?? 'Nie udało się wygenerować opisu budowy geologicznej.');
        return;
      }

      setGeologyDescription(data.description);
      setGeologySourceMode(data.sourceMode);
      setGeologyWarning(data.warning ?? null);
      if (data.sourceMode === 'mgp-500k-fallback') {
        setShowGeologyUploads(true);
      }
    } catch {
      if (reqId !== geologyReqIdRef.current) return;
      setGeologyError(
        'Nie udało się połączyć z usługą generowania opisu budowy geologicznej.'
      );
    } finally {
      if (reqId === geologyReqIdRef.current) {
        setLoadingGeology(false);
      }
    }
  };

  const handleManualGeologyFile = async (
    slot: 'map' | 'legend1' | 'legend2',
    file: File | null
  ) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      setGeologyError('Obsługiwane są wyłącznie pliki graficzne PNG, JPG lub WebP.');
      return;
    }
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setGeologyError(null);
      if (slot === 'map') setManualMapImageUrl(dataUrl);
      else if (slot === 'legend1') setManualLegend1ImageUrl(dataUrl);
      else setManualLegend2ImageUrl(dataUrl);
    } catch {
      setGeologyError('Nie udało się odczytać wybranego pliku obrazu.');
    }
  };

  const handleFetchReport = async () => {
    if (!parsedPoint) {
      setFetchError('Wpisz poprawne współrzędne WGS-84 (np. N 49 23 38.13 E 20 57 34.18 lub 49.393925, 20.959494).');
      inputRef.current?.focus();
      return;
    }
    if (!validInPoland) {
      setFetchError('Współrzędne wykraczają poza granice Polski (48,8–55,2° N; 13,8–24,5° E).');
      return;
    }

    setLoading(true);
    setFetchError(null);
    setGeologyDescription('');
    setGeologySourceMode(null);
    setGeologyWarning(null);
    setGeologyError(null);

    void generateGeologyDescription(parsedPoint.lat, parsedPoint.lon, 'auto');

    try {
      const params = new URLSearchParams({
        lat: parsedPoint.lat.toFixed(7),
        lon: parsedPoint.lon.toFixed(7),
      });
      const res = await fetch(`/api/terrain-report?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data?.error ?? 'Nie udało się pobrać danych z usług GIS.');
        return;
      }
      setReport(data as TerrainReportResponse);
    } catch {
      setFetchError(
        'Brak połączenia z serwerem GIS — moduł „Projekt robót geologicznych” wymaga dostępu do internetu.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    geologyReqIdRef.current++;
    setCoordsInput('');
    setFetchError(null);
    setReport(null);
    setGeologyDescription('');
    setGeologySourceMode(null);
    setGeologyWarning(null);
    setGeologyError(null);
    setLoadingGeology(false);
    inputRef.current?.focus();
  };

  const handleClearProjectMeta = () => {
    setInvestorNameLine1('');
    setInvestorNameLine2('');
    setInvestorAddressLine1('');
    setInvestorAddressLine2('');
    setTaskName('');
    setGoal(DEFAULT_PRG_GOAL);
  };

  const handleAppendAdminToTask = () => {
    if (!report?.admin) return;
    const parts: string[] = [];
    if (report.admin.parcelNo) {
      parts.push(`na działce nr ${report.admin.parcelNo}`);
    }
    const obreb = report.admin.precinct || report.admin.locality;
    if (obreb) {
      parts.push(`obr. ${obreb}`);
    }
    if (report.admin.commune) {
      parts.push(`w gminie ${report.admin.commune}`);
    }
    if (parts.length === 0) return;
    const suffix = parts.join(', ');
    setTaskName((prev) => (prev.trim() ? `${prev.trim()} ${suffix}` : suffix));
  };

  const hasProjectMeta =
    investorNameLine1.trim() !== '' ||
    investorNameLine2.trim() !== '' ||
    investorAddressLine1.trim() !== '' ||
    investorAddressLine2.trim() !== '' ||
    taskName.trim() !== '' ||
    goal.trim() !== DEFAULT_PRG_GOAL;

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* Page title row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-500">
            GUGiK · PIG-PIB (SOPO, MIDAS, JCWPd, GZWP, SMGP, MGśP) · GDOŚ · OSM
          </p>
          <h1 className="mt-0.5 text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 leading-tight">
            Projekt robót geologicznych
          </h1>
        </div>
        <p className="text-xs text-slate-500">
          Rozdział 1, przelicznik WGS-84 → PUWG 1992 / 2000, raport GIS i załączniki A4/A3.
        </p>
      </div>

      {/* Project info (Zleceniodawca + Zadanie) + Coordinate input + Live Polish geodetic XY conversion */}
      <section
        aria-label="Dane Zleceniodawcy, zadania i współrzędne WGS-84"
        className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        {/* Zleceniodawca (2 lines name + 2 lines address) & Nazwa zadania */}
        <div className="p-4 sm:p-6 bg-white border-b border-slate-200 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-950">1. Informacje ogólne</h2>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                Dane Zleceniodawcy i zadania
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Tytuł opracowania: <span className="font-semibold text-slate-800">{PRG_DOC_TYPE}</span>
              </p>
            </div>
            {hasProjectMeta && (
              <button
                type="button"
                onClick={handleClearProjectMeta}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Wyczyść dane</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Nazwa Zleceniodawcy — 2 linijki */}
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-slate-700">
                Nazwa Zleceniodawcy (2 linijki)
              </span>
              <input
                id="investor-name-1"
                type="text"
                value={investorNameLine1}
                onChange={(e) => setInvestorNameLine1(e.target.value)}
                placeholder="Linia 1, np. WKS Grybów Sp. z o.o."
                aria-label="Nazwa Zleceniodawcy – linia 1"
                className="w-full h-10 px-3 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none transition-colors"
              />
              <input
                id="investor-name-2"
                type="text"
                value={investorNameLine2}
                onChange={(e) => setInvestorNameLine2(e.target.value)}
                placeholder="Linia 2 (opcjonalnie)"
                aria-label="Nazwa Zleceniodawcy – linia 2"
                className="w-full h-10 px-3 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none transition-colors"
              />
            </div>

            {/* Adres Zleceniodawcy — 2 linijki */}
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-slate-700">
                Adres Zleceniodawcy (2 linijki)
              </span>
              <input
                id="investor-addr-1"
                type="text"
                value={investorAddressLine1}
                onChange={(e) => setInvestorAddressLine1(e.target.value)}
                placeholder="Linia 1, np. ul. Kościuszki 33"
                aria-label="Adres Zleceniodawcy – linia 1"
                className="w-full h-10 px-3 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none transition-colors"
              />
              <input
                id="investor-addr-2"
                type="text"
                value={investorAddressLine2}
                onChange={(e) => setInvestorAddressLine2(e.target.value)}
                placeholder="Linia 2, np. 33-330 Grybów"
                aria-label="Adres Zleceniodawcy – linia 2"
                className="w-full h-10 px-3 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {joinedInvestor && (
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Inwestor:</span> {joinedInvestor}
            </div>
          )}

          {/* Nazwa zadania */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="prg-task-name" className="text-xs font-semibold text-slate-700">
                Nazwa zadania
              </label>
              {report && (report.admin.parcelNo || report.admin.commune) && (
                <button
                  type="button"
                  onClick={handleAppendAdminToTask}
                  className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 transition-colors cursor-pointer"
                >
                  + Dopisz działkę, obręb i gminę z raportu GIS
                </button>
              )}
            </div>
            <textarea
              id="prg-task-name"
              rows={2}
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="np. rozpoznanie warunków geologiczno-inżynierskich w rejonie projektowanej inwestycji, a w szczególności określenie parametrów podłoża skalnego w obrębie którego nastąpi posadowienie hali produkcyjnej na działce nr 2328/1, 2328/13 i 562/3, obr. Biała Niżna w gminie Grybowie"
              className="w-full px-3 py-2 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none transition-colors resize-y"
            />
          </div>

          {/* Cel opracowania (domyślnie wypełniony wg wzoru) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="prg-goal" className="text-xs font-semibold text-slate-700">
                Cel opracowania
              </label>
              {goal.trim() !== DEFAULT_PRG_GOAL && (
                <button
                  type="button"
                  onClick={() => setGoal(DEFAULT_PRG_GOAL)}
                  className="text-[11px] font-semibold text-slate-500 hover:text-blue-800 transition-colors cursor-pointer"
                >
                  Przywróć domyślny
                </button>
              )}
            </div>
            <textarea
              id="prg-goal"
              rows={2}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50/60 border border-slate-300 focus:bg-white focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md text-xs sm:text-sm text-slate-900 focus:outline-none transition-colors resize-y"
            />
          </div>
        </div>

        <div className="p-4 sm:p-6 bg-slate-50/70 border-b border-slate-200 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="wgs84-input" className="text-xs font-semibold text-slate-700">
              Współrzędne WGS-84 (stopnie lub dziesiętne)
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleUseGps}
                disabled={locatingGps}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 disabled:text-slate-400 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{locatingGps ? 'Szukam GPS…' : 'Pobierz GPS'}</span>
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Wyczyść</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              ref={inputRef}
              id="wgs84-input"
              type="text"
              value={coordsInput}
              onChange={(e) => {
                setCoordsInput(e.target.value);
                if (fetchError) setFetchError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleFetchReport();
                }
              }}
              placeholder="np. N 49 23 38.13 E 20 57 34.18 lub 49.393925, 20.959494"
              className="flex-1 min-w-0 h-11 px-3.5 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md font-mono text-sm sm:text-base font-semibold text-slate-950 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:outline-none transition-colors"
            />
            <button
              type="button"
              onClick={() => void handleFetchReport()}
              disabled={loading || !validInPoland}
              className="h-11 px-5 rounded-md bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Pobieranie…</span>
                </>
              ) : (
                <>
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  <span>Pokaż tekst</span>
                </>
              )}
            </button>
          </div>

          {coordsInput.trim() !== '' && !parsedPoint && (
            <p className="text-xs font-medium text-rose-700">
              Nie rozpoznano formatu. Wpisz np. <span className="font-mono">N 49 23 38.13 E 20 57 34.18</span> lub{' '}
              <span className="font-mono">49.393925, 20.959494</span>.
            </p>
          )}

          {parsedPoint && !validInPoland && (
            <p className="text-xs font-medium text-amber-800">
              Współrzędne leżą poza granicami Polski — przelicznik XY działa, ale raport GIS wymaga punktu na terenie Polski.
            </p>
          )}

          {fetchError && (
            <div
              role="alert"
              className="flex items-start gap-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{fetchError}</span>
            </div>
          )}
        </div>

        {/* Live Polish Geodetic XY Conversion */}
        <div className="p-4 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-600">
              Przeliczenie na polskie układy geodezyjne XY (X – północ, Y – wschód)
            </h2>
            {dmsLabel && ddLabel && (
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {dmsLabel} · {ddLabel}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* PUWG 1992 (EPSG:2180) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">
                  PUWG 1992 <span className="font-mono font-medium text-slate-500">(EPSG:2180)</span>
                </span>
                {pl1992 && (
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        'xy92',
                        `PUWG 1992 (EPSG:2180): X = ${formatCoordMetersPl(pl1992.x)}, Y = ${formatCoordMetersPl(pl1992.y)}`
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-blue-800 transition-colors cursor-pointer"
                  >
                    {copiedKey === 'xy92' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-700" aria-hidden="true" />
                        <span className="text-emerald-700">Skopiowano</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" aria-hidden="true" />
                        <span>Kopiuj XY</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                <div className="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                  <div className="text-[10px] text-slate-500">X (N) [m]</div>
                  <div className="text-sm font-bold text-blue-800 mt-0.5">
                    {pl1992 ? formatCoordMetersPl(pl1992.x) : '—'}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                  <div className="text-[10px] text-slate-500">Y (E) [m]</div>
                  <div className="text-sm font-bold text-slate-950 mt-0.5">
                    {pl1992 ? formatCoordMetersPl(pl1992.y) : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* PUWG 2000 (PL-2000) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">
                  PUWG 2000{' '}
                  <span className="font-mono font-medium text-slate-500">
                    {pl2000 ? `(strefa ${pl2000.zone} · ${pl2000.epsg})` : '(PL-2000)'}
                  </span>
                </span>
                {pl2000 && (
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        'xy2000',
                        `PUWG 2000 strefa ${pl2000.zone} (${pl2000.epsg}): X = ${formatCoordMetersPl(pl2000.x)}, Y = ${formatCoordMetersPl(pl2000.y)}`
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-blue-800 transition-colors cursor-pointer"
                  >
                    {copiedKey === 'xy2000' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-700" aria-hidden="true" />
                        <span className="text-emerald-700">Skopiowano</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" aria-hidden="true" />
                        <span>Kopiuj XY</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                <div className="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                  <div className="text-[10px] text-slate-500">X (N) [m]</div>
                  <div className="text-sm font-bold text-blue-800 mt-0.5">
                    {pl2000 ? formatCoordMetersPl(pl2000.x) : '—'}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                  <div className="text-[10px] text-slate-500">Y (E) [m]</div>
                  <div className="text-sm font-bold text-slate-950 mt-0.5">
                    {pl2000 ? formatCoordMetersPl(pl2000.y) : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Full PRG Description Report (sections 1–8) */}
      {report && (
        <section
          aria-label="Wygenerowany opis projektu robót geologicznych"
          className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-950">
                Opis projektu robót geologicznych
              </h2>
              <p className="text-xs text-slate-500">
                Rozdziały 1–3 i raport lokalizacyjny — gotowy do skopiowania do Worda.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void copyText(
                  'full',
                  buildTerrainReportPlainText(report, projectInfo, mgpMeta, geologyDescription),
                  buildTerrainReportHtml(report, projectInfo, mgpMeta, geologyDescription)
                )
              }
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              {copiedKey === 'full' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  <span>Skopiowano cały opis</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Kopiuj cały opis</span>
                </>
              )}
            </button>
          </div>

          <div className="p-4 sm:p-6 divide-y divide-slate-200 text-sm text-slate-800">
            {joinedInvestor && (
              <div className="pb-3.5 text-sm text-slate-900">
                <strong className="font-bold text-slate-950">Inwestor:</strong> {joinedInvestor}
              </div>
            )}

            {/* 1. Informacje ogólne */}
            <article className={`${joinedInvestor ? 'py-4' : 'pb-4'} space-y-2 text-slate-900`}>
              <h3 className="text-sm font-bold text-slate-950">1. Informacje ogólne</h3>
              <ul className="list-disc pl-6 space-y-1 leading-relaxed">
                <li>
                  typ opracowania: <span>{PRG_DOC_TYPE}</span>
                </li>
                <li>
                  zadanie:{' '}
                  {taskName.trim() ? (
                    <span>{taskName.trim()}</span>
                  ) : (
                    <span className="text-slate-400 italic">wpisz nazwę zadania powyżej</span>
                  )}
                </li>
                <li>
                  cel: <span>{goal.trim() || DEFAULT_PRG_GOAL}</span>
                </li>
                <li>
                  inwestor:{' '}
                  {joinedInvestor ? (
                    <span>{joinedInvestor}</span>
                  ) : (
                    <span className="text-slate-400 italic">wpisz dane Zleceniodawcy powyżej</span>
                  )}
                </li>
              </ul>
              <p className="leading-relaxed">{PRG_LEGAL_BASIS}</p>
            </article>

            {/* 1.1. Materiały wykorzystane do opracowania */}
            <article className="py-4 space-y-1.5 text-slate-900">
              <h3 className="text-sm font-bold text-slate-950">
                1.1. Materiały wykorzystane do opracowania
              </h3>
              <p className="leading-relaxed">Projekt wykonano na podstawie:</p>
              <ul className="list-disc pl-6 space-y-1 leading-relaxed">
                {buildPrgChapter1_1Items(report, mgpMeta).map((item, idx) => {
                  const parts = item.split(/(<uzupełnij>|<wpisz skalę>)/g);
                  return (
                    <li key={`mat-1-1-${idx}`}>
                      {parts.map((part, pIdx) =>
                        part === '<uzupełnij>' || part === '<wpisz skalę>' ? (
                          <span key={pIdx} className="italic text-slate-500">
                            {part}
                          </span>
                        ) : (
                          <span key={pIdx}>{part}</span>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>

            {/* 1.2. Opis techniczny inwestycji */}
            <article className="py-4 space-y-1.5 text-slate-900">
              <h3 className="text-sm font-bold text-slate-950">
                1.2. Opis techniczny inwestycji
              </h3>
              <p className="leading-relaxed italic text-slate-500">&lt;uzupełnij&gt;</p>
            </article>

            {/* 2. Informacje o terenie badań / 2.1. Informacje ogólne */}
            <article className="py-4 space-y-1.5 text-slate-900">
              <h3 className="text-sm font-bold text-slate-950">
                2. Informacje o terenie badań
              </h3>
              <h4 className="text-sm font-bold text-slate-950">
                2.1. Informacje ogólne
              </h4>
              <ul className="list-disc pl-6 space-y-1 leading-relaxed">
                {buildPrgChapter2_1Items(projectInfo).map((item, idx) => {
                  const parts = item.split(/(<uzupełnij>)/g);
                  return (
                    <li key={`info-2-1-${idx}`}>
                      {parts.map((part, pIdx) =>
                        part === '<uzupełnij>' ? (
                          <span key={pIdx} className="italic text-slate-500">
                            {part}
                          </span>
                        ) : (
                          <span key={pIdx}>{part}</span>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>

            {/* 2.2. Położenie administracyjne */}
            <article className="py-4 space-y-1.5">
              <h3 className="text-sm font-bold text-slate-950">2.2. Położenie administracyjne</h3>
              {report.admin.voivodeship || report.admin.commune ? (
                <div className="space-y-0.5 leading-relaxed">
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">miejscowość:</span>{' '}
                    <strong className="font-semibold text-slate-950">
                      {report.admin.locality ?? report.admin.precinct ?? '—'}
                    </strong>
                    {report.admin.precinct && report.admin.precinct !== report.admin.locality
                      ? ` (obręb ewidencyjny: ${report.admin.precinct})`
                      : ''}
                  </p>
                  {report.admin.parcelNo && (
                    <p>
                      <span className="text-slate-400">- </span>
                      <span className="text-slate-500">działka ewidencyjna:</span> nr{' '}
                      <strong className="font-mono font-semibold text-slate-950">
                        {report.admin.parcelNo}
                      </strong>
                      {report.admin.parcelId ? (
                        <span className="font-mono text-xs text-slate-500">
                          {' '}
                          ({report.admin.parcelId})
                        </span>
                      ) : null}
                    </p>
                  )}
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">gmina:</span> {report.admin.commune ?? '—'}
                  </p>
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">powiat:</span>{' '}
                    {(report.admin.county ?? '—').replace(/^powiat\s+/i, '')}
                  </p>
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">województwo:</span>{' '}
                    {report.admin.voivodeship ?? '—'}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-amber-800">
                  - {report.admin.error ?? 'Brak danych z usługi GUGiK ULDK.'}
                </p>
              )}
            </article>

            {/* 2.3. Położenie geograficzne */}
            <article className="py-4 space-y-1.5">
              <h3 className="text-sm font-bold text-slate-950">2.3. Położenie geograficzne</h3>
              {report.geography.mezoregion ? (
                <div className="space-y-0.5 leading-relaxed">
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">prowincja:</span>{' '}
                    {report.geography.prowincja ?? '—'}
                  </p>
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">podprowincja:</span>{' '}
                    {report.geography.podprowincja ?? '—'}
                  </p>
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">makroregion:</span>{' '}
                    {report.geography.makroregion ?? '—'}
                  </p>
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">mezoregion:</span>{' '}
                    <strong className="font-semibold text-slate-950">
                      {report.geography.mezoregion}
                    </strong>
                    {report.geography.mezoregionCode ? (
                      <span className="font-mono text-xs text-slate-600">
                        {' '}
                        ({report.geography.mezoregionCode})
                      </span>
                    ) : null}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-amber-800">
                  - {report.geography.error ?? 'Brak danych z usługi mezoregionów GDOŚ.'}
                </p>
              )}

              <div className="pt-1.5 space-y-0.5 leading-relaxed">
                <p className="font-semibold text-slate-900">Współrzędne geograficzne:</p>
                <p>
                  <span className="text-slate-400">- </span>
                  <span className="text-slate-500">WGS-84 (stopnie):</span>{' '}
                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                    {formatDmsPl(report.coords.wgs84.lat, 'N', 'S')}{' '}
                    {formatDmsPl(report.coords.wgs84.lon, 'E', 'W')}
                  </span>
                </p>
                <p>
                  <span className="text-slate-400">- </span>
                  <span className="text-slate-500">WGS-84 (dziesiętne):</span>{' '}
                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                    {report.coords.wgs84.lat.toFixed(6).replace('.', ',')}° N,{' '}
                    {report.coords.wgs84.lon.toFixed(6).replace('.', ',')}° E
                  </span>
                </p>
                <p>
                  <span className="text-slate-400">- </span>
                  <span className="text-slate-500">
                    PUWG 1992 ({report.coords.pl1992.epsg}):
                  </span>{' '}
                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                    X = {formatCoordMetersPl(report.coords.pl1992.x)}, Y ={' '}
                    {formatCoordMetersPl(report.coords.pl1992.y)}
                  </span>
                </p>
                <p>
                  <span className="text-slate-400">- </span>
                  <span className="text-slate-500">
                    PUWG 2000 strefa {report.coords.pl2000.zone} ({report.coords.pl2000.epsg}):
                  </span>{' '}
                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                    X = {formatCoordMetersPl(report.coords.pl2000.x)}, Y ={' '}
                    {formatCoordMetersPl(report.coords.pl2000.y)}
                  </span>
                </p>
              </div>
            </article>

            {/* 2.4. Odległości od najbliższych ulic, dróg, linii kolejowych i cieków wodnych */}
            <article className="py-4 space-y-1.5">
              <h3 className="text-sm font-bold text-slate-950">
                2.4. Odległości od najbliższych ulic, dróg, linii kolejowych i cieków wodnych
              </h3>
              <p className="leading-relaxed text-slate-900">Teren badań położony jest:</p>
              <div className="space-y-0.5 leading-relaxed">
                {report.nearbyInfrastructure.roadsAndRail.length > 0 ? (
                  report.nearbyInfrastructure.roadsAndRail.map((item, idx) => {
                    const objectLabel =
                      item.kind === 'road'
                        ? item.name
                        : item.name.toLowerCase() === 'linia kolejowa'
                          ? 'linii kolejowej'
                          : item.name;
                    return (
                      <p key={`${item.kind}-${item.name}-${idx}`}>
                        <span className="text-slate-400">- </span>
                        około{' '}
                        <strong className="font-mono font-semibold text-slate-950 tabular-nums">
                          {formatDistanceRounded10Pl(item.distanceM)}
                        </strong>{' '}
                        {item.terrainDirectionFromObject} od{' '}
                        {item.kind === 'road' ? 'ulicy / drogi ' : ''}
                        <strong className="font-medium text-slate-950">{objectLabel}</strong>
                        {item.ref
                          ? ` (${item.kind === 'rail' ? `nr ${item.ref}` : item.ref})`
                          : ''}
                      </p>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-500">
                    -{' '}
                    {report.nearbyInfrastructure.error ??
                      'nie znaleziono nazwanych ulic, dróg ani linii kolejowych w promieniu ok. 550 m'}
                  </p>
                )}

                {report.hydro.nearestWaterways.length > 0 ? (
                  report.hydro.nearestWaterways.map((w, idx) => (
                    <p key={`sec3-wat-${idx}`}>
                      <span className="text-slate-400">- </span>
                      około{' '}
                      <strong className="font-mono font-semibold text-slate-950 tabular-nums">
                        {formatDistanceRounded10Pl(w.distanceM)}
                      </strong>{' '}
                      {w.terrainDirectionFromObject} od cieku{' '}
                      <strong className="font-medium text-slate-950">{w.name}</strong>
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">
                    - brak nazwanych cieków wodnych w promieniu ok. 550 m
                  </p>
                )}

                {report.nearbyInfrastructure.communeOffice && (
                  <p>
                    <span className="text-slate-400">- </span>
                    około{' '}
                    <strong className="font-mono font-semibold text-slate-950 tabular-nums">
                      {formatDistanceRounded10Pl(report.nearbyInfrastructure.communeOffice.distanceM)}
                    </strong>{' '}
                    {report.nearbyInfrastructure.communeOffice.terrainDirectionFromObject} od{' '}
                    <strong className="font-medium text-slate-950">
                      {toGenitiveOfficeNamePl(report.nearbyInfrastructure.communeOffice.name)}
                    </strong>
                  </p>
                )}
              </div>
            </article>

            {/* 2.5. Morfologia */}
            <article className="py-4 space-y-1.5 text-slate-900">
              <h3 className="text-sm font-bold text-slate-950">2.5. Morfologia</h3>
              <ul className="list-disc pl-6 space-y-1 leading-relaxed">
                {PRG_CHAPTER_2_5_ITEMS.map((item, idx) => {
                  const parts = item.split(/(<uzupełnij>)/g);
                  return (
                    <li key={`morf-2-5-${idx}`}>
                      {parts.map((part, pIdx) =>
                        part === '<uzupełnij>' ? (
                          <span key={pIdx} className="italic text-slate-500">
                            {part}
                          </span>
                        ) : (
                          <span key={pIdx}>{part}</span>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>

            {/* 2.6. Położenie terenu robót względem obiektów i obszarów chronionych */}
            {(() => {
              const ch26 = buildPrgChapter2_6Content(report);
              return (
                <article className="py-4 space-y-2 text-slate-900 leading-relaxed">
                  <h3 className="text-sm font-bold text-slate-950">
                    2.6. Położenie terenu robót względem obiektów i obszarów chronionych
                  </h3>

                  <div className="space-y-1.5">
                    <p>{ch26.protectedIntro}</p>
                    {ch26.protectedInsideItems.length > 0 && (
                      <ul className="list-disc pl-6 space-y-1">
                        {ch26.protectedInsideItems.map((item, idx) => (
                          <li key={`prot-in-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {ch26.protectedNearestItems.length > 0 && (
                      <div className="space-y-1">
                        <p>Najbliższe pozostałe obszary i obiekty chronione:</p>
                        <ul className="list-disc pl-6 space-y-1">
                          {ch26.protectedNearestItems.map((item, idx) => (
                            <li key={`prot-near-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <p>{ch26.miningIntro}</p>
                    {ch26.miningInsideItems.length > 0 && (
                      <ul className="list-disc pl-6 space-y-1">
                        {ch26.miningInsideItems.map((item, idx) => (
                          <li key={`min-in-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {ch26.miningNearestItems.length > 0 && (
                      <div className="space-y-1">
                        <p>Najbliższe sąsiednie obiekty górnicze (MIDAS):</p>
                        <ul className="list-disc pl-6 space-y-1">
                          {ch26.miningNearestItems.map((item, idx) => (
                            <li key={`min-near-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </article>
              );
            })()}

            {/* 3. Budowa geologiczna <sprawdzić> */}
            <article className="py-4 space-y-2.5 text-slate-900 leading-relaxed">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-950">
                  3. Budowa geologiczna{' '}
                  <span className="italic font-normal text-slate-500">&lt;sprawdzić&gt;</span>
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {hasSmgpPanelImages && (
                    <button
                      type="button"
                      disabled={loadingGeology}
                      onClick={() =>
                        void generateGeologyDescription(
                          report.coords.wgs84.lat,
                          report.coords.wgs84.lon,
                          'panel-smgp'
                        )
                      }
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Analizuj wycinek i legendę z ZAŁ. 3</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={loadingGeology}
                    onClick={() =>
                      void generateGeologyDescription(
                        report.coords.wgs84.lat,
                        report.coords.wgs84.lon,
                        'pig-only'
                      )
                    }
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${loadingGeology ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Generuj z PIG-PIB</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGeologyUploads((prev) => !prev)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{showGeologyUploads ? 'Ukryj wgrywanie' : 'Wgraj mapę i legendę'}</span>
                  </button>
                </div>
              </div>

              {geologySourceMode && !loadingGeology && (
                <p className="text-xs text-slate-500">
                  Źródło opisu:{' '}
                  <span className="font-medium text-slate-700">
                    {geologySourceMode === 'scan-and-pig'
                      ? 'analiza wycinka mapy SMGP i legendy (wspomagana danymi PIG-PIB)'
                      : geologySourceMode === 'smgp-vector'
                        ? 'wektorowa baza SMGP 1:50 000 i MGP (PIG-PIB)'
                        : 'wstępny opis z MGP 1:500 000 (brak wektorowej SMGP dla tego arkusza)'}
                  </span>
                </p>
              )}

              {geologyWarning && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden="true" />
                  <span>{geologyWarning}</span>
                </div>
              )}

              {geologyError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{geologyError}</span>
                </div>
              )}

              {showGeologyUploads && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2.5">
                  <p className="text-xs text-slate-600">
                    Wgraj zrzut wycinka mapy geologicznej (najlepiej z zaznaczoną lokalizacją) oraz
                    obraz legendy arkusza — albo wytnij je w panelu{' '}
                    <span className="font-semibold text-slate-800">ZAŁ. 3 (SMGP)</span> poniżej i
                    kliknij analizę.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        {
                          slot: 'map' as const,
                          label: '1. Wycinek mapy SMGP',
                          value: manualMapImageUrl,
                          clear: () => setManualMapImageUrl(null),
                        },
                        {
                          slot: 'legend1' as const,
                          label: '2. Legenda (cz. 1)',
                          value: manualLegend1ImageUrl,
                          clear: () => setManualLegend1ImageUrl(null),
                        },
                        {
                          slot: 'legend2' as const,
                          label: '3. Legenda (cz. 2, opcj.)',
                          value: manualLegend2ImageUrl,
                          clear: () => setManualLegend2ImageUrl(null),
                        },
                      ] as const
                    ).map((item) => (
                      <div
                        key={item.slot}
                        className="rounded-md border border-slate-200 bg-white p-2 flex flex-col justify-between gap-1.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-slate-700">
                            {item.label}
                          </span>
                          {item.value && (
                            <button
                              type="button"
                              onClick={item.clear}
                              aria-label={`Usuń ${item.label}`}
                              className="text-slate-400 hover:text-rose-700 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        {item.value ? (
                          <img
                            src={item.value}
                            alt={item.label}
                            className="w-full h-16 object-cover rounded border border-slate-200"
                          />
                        ) : (
                          <label className="flex items-center justify-center h-16 rounded border border-dashed border-slate-300 hover:border-blue-600 text-[11px] text-slate-500 hover:text-blue-700 cursor-pointer transition-colors">
                            <span>Wybierz obraz…</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="sr-only"
                              onChange={(e) => {
                                const f = e.target.files?.[0] ?? null;
                                void handleManualGeologyFile(item.slot, f);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={loadingGeology || !hasManualGeologyImages}
                      onClick={() =>
                        void generateGeologyDescription(
                          report.coords.wgs84.lat,
                          report.coords.wgs84.lon,
                          'manual-uploads'
                        )
                      }
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Analizuj wgrane obrazy</span>
                    </button>
                  </div>
                </div>
              )}

              {loadingGeology ? (
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-700 shrink-0" aria-hidden="true" />
                  <span>Analizuję dane geologiczne i przygotowuję opis rozdziału 3…</span>
                </div>
              ) : (
                <textarea
                  aria-label="Opis budowy geologicznej – rozdział 3"
                  rows={5}
                  value={geologyDescription}
                  onChange={(e) => setGeologyDescription(e.target.value)}
                  placeholder="Tu pojawi się wygenerowany opis budowy geologicznej — możesz go również edytować ręcznie przed skopiowaniem do Worda."
                  className="w-full px-3 py-2 bg-white border border-slate-200 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/15 rounded-md text-sm text-slate-900 leading-relaxed focus:outline-none resize-y"
                />
              )}
            </article>

            {/* Osuwiska i TZRM (SOPO) */}
            <article className="py-4 space-y-1.5">
              <h3 className="text-sm font-bold text-slate-950">
                Osuwiska i tereny zagrożone ruchami masowymi (SOPO)
              </h3>

              {report.sopo.error ? (
                <p className="text-xs text-amber-800">- {report.sopo.error}</p>
              ) : (
                <div className="space-y-1.5 leading-relaxed">
                  <div className="space-y-0.5">
                    {report.sopo.mappedCommune === true && (
                      <p className="text-slate-600">
                        <span className="text-slate-400">- </span>
                        gmina skartowana w SOPO
                        {report.sopo.mappingYear ||
                        report.sopo.fieldCurrency ||
                        report.sopo.author ||
                        report.sopo.coordinator
                          ? ` (${[
                              report.sopo.mappingYear
                                ? `zakończenie prac: ${report.sopo.mappingYear}`
                                : null,
                              report.sopo.fieldCurrency
                                ? `aktualność terenowa: ${report.sopo.fieldCurrency}`
                                : null,
                              report.sopo.author ? `autorzy: ${report.sopo.author}` : null,
                              report.sopo.coordinator
                                ? `koordynator: ${report.sopo.coordinator}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(', ')})`
                          : ''}
                      </p>
                    )}

                    {report.sopo.insideLandslide.length > 0 || report.sopo.insideTzrm.length > 0 ? (
                      <div className="space-y-2">
                        {report.sopo.insideLandslide.map((s) => {
                          const d = s.details;
                          return (
                            <div key={`in-l-${s.number}`} className="space-y-0.5">
                              <p className="text-rose-800 font-semibold">
                                <span>- </span>
                                UWAGA: punkt leży wewnątrz osuwiska SOPO nr{' '}
                                <span className="font-mono">{s.number}</span>
                              </p>
                              {s.activity && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    stopień aktywności całego osuwiska:
                                  </span>{' '}
                                  <strong className="font-semibold text-slate-950">
                                    {s.activity}
                                  </strong>
                                </p>
                              )}
                              {s.pointActivityZone && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    strefa aktywności w miejscu punktu:
                                  </span>{' '}
                                  <strong className="font-semibold text-slate-950">
                                    {s.pointActivityZone}
                                  </strong>
                                </p>
                              )}
                              {d?.activityZones && d.activityZones.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    strefy aktywności w obrębie osuwiska:
                                  </span>{' '}
                                  {d.activityZones
                                    .map(
                                      (z) =>
                                        `${z.activity}: ${z.areaHa.toFixed(2).replace('.', ',')} ha (${z.sharePct}%)`
                                    )
                                    .join('; ')}
                                </p>
                              )}
                              {s.areaHa !== undefined && s.areaM2 !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">powierzchnia osuwiska:</span>{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {s.areaHa.toFixed(2).replace('.', ',')} ha (
                                    {Math.round(s.areaM2)} m²)
                                  </span>
                                </p>
                              )}
                              {s.perimeterM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">obwód osuwiska:</span>{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {Math.round(s.perimeterM)} m
                                  </span>
                                </p>
                              )}
                              {d?.approxLengthM !== undefined && d?.approxWidthM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    wymiary orientacyjne osuwiska (z geometrii SOPO):
                                  </span>{' '}
                                  długość ok.{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {d.approxLengthM} m
                                  </span>
                                  , szerokość ok.{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {d.approxWidthM} m
                                  </span>
                                  {d.axisOrientation ? ` (rozciągłość ${d.axisOrientation})` : ''}
                                </p>
                              )}
                              {d?.elevMinM !== undefined && d?.elevMaxM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    rzędne terenu osuwiska (NMT GUGiK):
                                  </span>{' '}
                                  od{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {d.elevMinM}
                                  </span>{' '}
                                  do{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {d.elevMaxM} m n.p.m.
                                  </span>
                                  {d.reliefM !== undefined
                                    ? `, deniwelacja: ok. ${d.reliefM} m`
                                    : ''}
                                  {d.avgSlopeDeg !== undefined
                                    ? `, średnie nachylenie ok. ${d.avgSlopeDeg.toFixed(1).replace('.', ',')}°`
                                    : ''}
                                </p>
                              )}
                              {d?.pointElevM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    rzędna terenu w punkcie inwestycji (NMT GUGiK):
                                  </span>{' '}
                                  ok.{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {d.pointElevM} m n.p.m.
                                  </span>
                                </p>
                              )}
                              {d?.boundaryTypes && d.boundaryTypes.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    rozpoznanie granic osuwiska:
                                  </span>{' '}
                                  {d.boundaryTypes.join('; ')}
                                </p>
                              )}
                              {d?.mainScarps && d.mainScarps.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">skarpy główne:</span>{' '}
                                  {d.mainScarps.join('; ')}
                                </p>
                              )}
                              {d?.secondaryScarps && d.secondaryScarps.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">skarpy wtórne:</span>{' '}
                                  {d.secondaryScarps.join('; ')}
                                </p>
                              )}
                              {d?.toes && d.toes.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">czoła osuwiska:</span>{' '}
                                  {d.toes.join('; ')}
                                </p>
                              )}
                              {d?.trenches && d.trenches.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">rowy osuwiskowe:</span>{' '}
                                  {d.trenches.join('; ')}
                                </p>
                              )}
                              {d?.accumulationRidges && d.accumulationRidges.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">progi akumulacyjne:</span>{' '}
                                  {d.accumulationRidges.join('; ')}
                                </p>
                              )}
                              {d?.cracks && d.cracks.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">szczeliny:</span>{' '}
                                  {d.cracks.join('; ')}
                                </p>
                              )}
                              {d?.springsAndSeeps && d.springsAndSeeps.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    źródła i wysięki na osuwisku:
                                  </span>{' '}
                                  {d.springsAndSeeps.join('; ')}
                                </p>
                              )}
                              {d?.wetlandsAndPonds && d.wetlandsAndPonds.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">zbiorniki i podmokłości:</span>{' '}
                                  {d.wetlandsAndPonds.join('; ')}
                                </p>
                              )}
                              {d?.debrisAreas && d.debrisAreas.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">rumosze i blokowiska:</span>{' '}
                                  {d.debrisAreas.join('; ')}
                                </p>
                              )}
                              {d?.depressions && d.depressions.length > 0 && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    zagłębienia wewnątrzosuwiskowe:
                                  </span>{' '}
                                  {d.depressions.join('; ')}
                                </p>
                              )}
                              {s.cardVersion && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    wersja karty rejestracyjnej:
                                  </span>{' '}
                                  {s.cardVersion}
                                </p>
                              )}
                              {s.filledDate && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">data wypełnienia karty:</span>{' '}
                                  {s.filledDate}
                                </p>
                              )}
                              {s.establishedDate && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">data ustalenia:</span>{' '}
                                  {s.establishedDate}
                                </p>
                              )}
                            </div>
                          );
                        })}

                        {report.sopo.insideTzrm.map((t) => {
                          const td = t.details;
                          return (
                            <div key={`in-t-${t.number}`} className="space-y-0.5">
                              <p className="text-rose-800 font-semibold">
                                <span>- </span>
                                UWAGA: punkt leży wewnątrz terenu zagrożonego ruchami masowymi (TZRM)
                                nr <span className="font-mono">{t.number}</span>
                              </p>
                              {t.areaHa !== undefined && t.areaM2 !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">powierzchnia TZRM:</span>{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {t.areaHa.toFixed(2).replace('.', ',')} ha (
                                    {Math.round(t.areaM2)} m²)
                                  </span>
                                </p>
                              )}
                              {t.perimeterM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">obwód TZRM:</span>{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {Math.round(t.perimeterM)} m
                                  </span>
                                </p>
                              )}
                              {td?.approxLengthM !== undefined && td?.approxWidthM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    wymiary orientacyjne TZRM (z geometrii SOPO):
                                  </span>{' '}
                                  długość ok.{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {td.approxLengthM} m
                                  </span>
                                  , szerokość ok.{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {td.approxWidthM} m
                                  </span>
                                  {td.axisOrientation ? ` (rozciągłość ${td.axisOrientation})` : ''}
                                </p>
                              )}
                              {td?.elevMinM !== undefined && td?.elevMaxM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    rzędne terenu TZRM (NMT GUGiK):
                                  </span>{' '}
                                  od{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {td.elevMinM}
                                  </span>{' '}
                                  do{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {td.elevMaxM} m n.p.m.
                                  </span>
                                  {td.reliefM !== undefined
                                    ? `, deniwelacja: ok. ${td.reliefM} m`
                                    : ''}
                                </p>
                              )}
                              {td?.pointElevM !== undefined && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    rzędna terenu w punkcie inwestycji (NMT GUGiK):
                                  </span>{' '}
                                  ok.{' '}
                                  <span className="font-mono font-semibold text-slate-950 tabular-nums">
                                    {td.pointElevM} m n.p.m.
                                  </span>
                                </p>
                              )}
                              {t.cardVersion && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">wersja karty TZRM:</span>{' '}
                                  {t.cardVersion}
                                </p>
                              )}
                              {t.filledDate && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">
                                    data wypełnienia karty TZRM:
                                  </span>{' '}
                                  {t.filledDate}
                                </p>
                              )}
                              {t.establishedDate && (
                                <p className="text-slate-800">
                                  <span className="text-slate-400">- </span>
                                  <span className="text-slate-500">data ustalenia TZRM:</span>{' '}
                                  {t.establishedDate}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p>
                        <span className="text-slate-400">- </span>
                        wg mapy SOPO (PIG-PIB) punkt nie leży w obrębie osuwiska ani terenu
                        zagrożonego ruchami masowymi
                      </p>
                    )}
                  </div>

                  {report.sopo.nearestLandslides.length > 0 ? (
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-slate-500">
                        Najbliższe osuwiska SOPO:
                      </p>
                      {report.sopo.nearestLandslides.map((s) => (
                        <p key={`near-l-${s.number}`} className="text-slate-700">
                          <span className="text-slate-400">- </span>
                          osuwisko nr{' '}
                          <strong className="font-mono font-semibold text-slate-950">
                            {s.number}
                          </strong>
                          {s.activity ? (
                            <span className="text-slate-500"> ({s.activity})</span>
                          ) : null}{' '}
                          – ok.{' '}
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatDistancePl(s.distanceM)}
                          </span>{' '}
                          {s.directionToObject}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-600">
                      <span className="text-slate-400">- </span>
                      brak skartowanych osuwisk SOPO w promieniu 2 km
                    </p>
                  )}

                  {report.sopo.nearestTzrm.length > 0 ? (
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-slate-500">
                        Najbliższe tereny zagrożone ruchami masowymi (TZRM):
                      </p>
                      {report.sopo.nearestTzrm.map((t) => (
                        <p key={`near-t-${t.number}`} className="text-slate-700">
                          <span className="text-slate-400">- </span>
                          TZRM nr{' '}
                          <strong className="font-mono font-semibold text-slate-950">
                            {t.number}
                          </strong>{' '}
                          – ok.{' '}
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatDistancePl(t.distanceM)}
                          </span>{' '}
                          {t.directionToObject}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-600">
                      <span className="text-slate-400">- </span>
                      brak skartowanych terenów zagrożonych (TZRM) w promieniu 2 km
                    </p>
                  )}
                </div>
              )}
            </article>

            {/* Najbliższy ciek wodny, JCWPd i GZWP */}
            <article className="py-4 space-y-1.5">
              <h3 className="text-sm font-bold text-slate-950">
                Najbliższy ciek wodny, JCWPd i GZWP
              </h3>
              <div className="space-y-1.5 leading-relaxed">
                {report.hydro.nearestWaterways.length > 0 ? (
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-slate-500">Najbliższe cieki wodne:</p>
                    {report.hydro.nearestWaterways.map((w, idx) => (
                      <p key={`wat-${idx}`}>
                        <span className="text-slate-400">- </span>
                        <strong className="font-medium text-slate-950">{w.name}</strong> – ok.{' '}
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {formatDistancePl(w.distanceM)}
                        </span>{' '}
                        {w.objectDirectionFromTerrain}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-600">
                    <span className="text-slate-400">- </span>
                    nie znaleziono nazwanych cieków wodnych w promieniu ok. 550 m
                  </p>
                )}

                <div className="space-y-0.5">
                  {report.hydro.jcwpd ? (
                    <>
                      <p>
                        <span className="text-slate-400">- </span>
                        <span className="text-slate-500">JCWPd:</span> nr{' '}
                        <strong className="font-mono font-semibold text-slate-950">
                          {report.hydro.jcwpd.number}
                        </strong>{' '}
                        (kod UE: <span className="font-mono">{report.hydro.jcwpd.euCode}</span>)
                      </p>
                      <p>
                        <span className="text-slate-400">- </span>
                        <span className="text-slate-500">dorzecze:</span> {report.hydro.jcwpd.basin},{' '}
                        <span className="text-slate-500">region wodny:</span>{' '}
                        {report.hydro.jcwpd.waterRegion}
                      </p>
                      <p>
                        <span className="text-slate-400">- </span>
                        <span className="text-slate-500">stan ogólny:</span>{' '}
                        {report.hydro.jcwpd.status},{' '}
                        <span className="text-slate-500">ryzyko:</span> {report.hydro.jcwpd.risk}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-amber-800">
                      - brak danych JCWPd dla wskazanego punktu
                    </p>
                  )}

                  {report.hydro.gzwp.inside ? (
                    <p>
                      <span className="text-slate-400">- </span>
                      <strong className="font-semibold text-blue-800">GZWP:</strong> punkt leży w
                      granicach Głównego Zbiornika Wód Podziemnych nr{' '}
                      <strong className="font-mono">{report.hydro.gzwp.number}</strong> –{' '}
                      {report.hydro.gzwp.name}
                    </p>
                  ) : (
                    <>
                      <p>
                        <span className="text-slate-400">- </span>
                        <span className="text-slate-500">GZWP:</span> punkt leży poza granicami
                        Głównych Zbiorników Wód Podziemnych
                      </p>
                      {report.hydro.gzwp.nearestName &&
                        report.hydro.gzwp.nearestDistanceM !== null && (
                          <p className="text-slate-700">
                            <span className="text-slate-400">- </span>
                            <span className="text-slate-500">najbliższy GZWP:</span> nr{' '}
                            <span className="font-mono font-semibold text-slate-900">
                              {report.hydro.gzwp.nearestNumber ?? '—'}
                            </span>{' '}
                            – {report.hydro.gzwp.nearestName} – ok.{' '}
                            <span className="font-mono font-semibold text-slate-900 tabular-nums">
                              {formatDistancePl(report.hydro.gzwp.nearestDistanceM)}
                            </span>{' '}
                            {report.hydro.gzwp.nearestDirection ?? ''}
                          </p>
                        )}
                    </>
                  )}
                </div>
              </div>
            </article>

            {/* Arkusz SMGP 1:50 000 */}
            <article className="pt-4 space-y-1.5">
              <h3 className="text-sm font-bold text-slate-950">Arkusz SMGP 1:50 000</h3>
              {report.smgp.sheetNumber || report.smgp.sheetName ? (
                <div className="space-y-0.5 leading-relaxed">
                  <p>
                    <span className="text-slate-400">- </span>
                    <span className="text-slate-500">arkusz:</span> nr{' '}
                    <strong className="font-mono font-semibold text-slate-950">
                      {report.smgp.sheetNumber ?? '—'}
                    </strong>{' '}
                    –{' '}
                    <strong className="font-semibold text-slate-950">
                      {report.smgp.sheetName ?? '—'}
                    </strong>{' '}
                    (SMGP 1:50 000)
                  </p>
                  {report.smgp.mapAuthors && (
                    <p>
                      <span className="text-slate-400">- </span>
                      <span className="text-slate-500">autorzy mapy:</span>{' '}
                      {report.smgp.mapAuthors}
                      {report.smgp.mapYear || report.smgp.mapPrintYear
                        ? ` (${[
                            report.smgp.mapYear ? `oprac. ${report.smgp.mapYear}` : null,
                            report.smgp.mapPrintYear ? `druk ${report.smgp.mapPrintYear}` : null,
                          ]
                            .filter(Boolean)
                            .join(', ')})`
                        : ''}
                    </p>
                  )}
                  {report.smgp.textAuthors && (
                    <p>
                      <span className="text-slate-400">- </span>
                      <span className="text-slate-500">autorzy objaśnień:</span>{' '}
                      {report.smgp.textAuthors}
                      {report.smgp.textPrintYear ? ` (druk ${report.smgp.textPrintYear})` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-amber-800">
                  - {report.smgp.error ?? 'Brak danych o arkuszu SMGP 1:50 000.'}
                </p>
              )}
            </article>
          </div>
        </section>
      )}

      <A4MapSheetGenerator
        lat={parsedPoint?.lat ?? null}
        lon={parsedPoint?.lon ?? null}
        validInPoland={validInPoland}
      />

      <A4SopoMapPanel
        lat={parsedPoint?.lat ?? null}
        lon={parsedPoint?.lon ?? null}
        validInPoland={validInPoland}
      />

      <A4SmgpMapPanel
        lat={parsedPoint?.lat ?? null}
        lon={parsedPoint?.lon ?? null}
        validInPoland={validInPoland}
        onSmgpAssetsChange={setSmgpPanelAssets}
      />

      <A3MgpMapPanel
        board="A"
        defaultHeaderLabel="ZAŁ.4"
        lat={parsedPoint?.lat ?? null}
        lon={parsedPoint?.lon ?? null}
        validInPoland={validInPoland}
        mgpMeta={mgpMeta}
        loadingMeta={loadingMgpMeta}
      />

      <A3MgpMapPanel
        board="B"
        defaultHeaderLabel="ZAŁ.5"
        lat={parsedPoint?.lat ?? null}
        lon={parsedPoint?.lon ?? null}
        validInPoland={validInPoland}
        mgpMeta={mgpMeta}
        loadingMeta={loadingMgpMeta}
      />
    </div>
  );
}
