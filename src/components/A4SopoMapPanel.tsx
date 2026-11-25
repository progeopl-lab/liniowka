import { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileImage,
  FileText,
  Layers,
  Loader2,
} from 'lucide-react';
import {
  buildPibSopoCitation,
  renderSopoA4SheetCanvas,
} from '../data/a4MapCanvas';
import type { SopoCitationMeta } from '../data/terrainTypes';

interface A4SopoMapPanelProps {
  lat: number | null;
  lon: number | null;
  validInPoland: boolean;
}

export function A4SopoMapPanel({
  lat,
  lon,
  validInPoland,
}: A4SopoMapPanelProps) {
  const [headerLabel, setHeaderLabel] = useState<string>('ZAŁ.2');
  const [sopoScale, setSopoScale] = useState<10000 | 25000>(10000);
  const [basemapLayer, setBasemapLayer] = useState<'topo' | 'orto'>('topo');
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [generatedCoordsKey, setGeneratedCoordsKey] = useState<string | null>(null);
  const [sopoMeta, setSopoMeta] = useState<SopoCitationMeta | null>(null);
  const [copiedCitation, setCopiedCitation] = useState<boolean>(false);

  // Fetch commune SOPO authorship metadata for PIG-PIB citation whenever coordinates change
  useEffect(() => {
    if (lat === null || lon === null || !validInPoland) return;
    let cancelled = false;
    fetch(`/api/sopo-meta?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SopoCitationMeta | null) => {
        if (!cancelled && data) setSopoMeta(data);
      })
      .catch(() => {
        // tolerate fallback citation
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, validInPoland]);

  const currentKey =
    lat !== null && lon !== null
      ? `sopo:${lat.toFixed(6)}:${lon.toFixed(6)}:${headerLabel.trim()}:${sopoScale}:${basemapLayer}`
      : null;

  const isStale = Boolean(previewDataUrl && currentKey && generatedCoordsKey !== currentKey);

  const buildSheet = async (): Promise<string | null> => {
    if (lat === null || lon === null || !validInPoland) {
      setError('Wpisz poprawne współrzędne na terenie Polski, aby wygenerować załącznik SOPO A4.');
      return null;
    }

    setGenerating(true);
    setError(null);

    try {
      let resolvedMeta = sopoMeta;
      try {
        const metaRes = await fetch(`/api/sopo-meta?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}`);
        if (metaRes.ok) {
          resolvedMeta = (await metaRes.json()) as SopoCitationMeta;
          setSopoMeta(resolvedMeta);
        }
      } catch {
        // use cached or fallback citation
      }

      const canvas = await renderSopoA4SheetCanvas({
        lat,
        lon,
        headerLabel,
        basemapLayer,
        sopoScale,
        sopoMeta: resolvedMeta,
      });
      const dataUrl = canvas.toDataURL('image/png');
      setPreviewDataUrl(dataUrl);
      setGeneratedCoordsKey(currentKey);
      return dataUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Nie udało się wygenerować arkusza SOPO A4 z serwera PIG-PIB.'
      );
      return null;
    } finally {
      setGenerating(false);
    }
  };

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

    const safeTag = (headerLabel.trim() || 'ZAL.2')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    pdf.save(`${safeTag}_SOPO_A4.pdf`);
  };

  const handleDownloadPng = async () => {
    const dataUrl = !isStale && previewDataUrl ? previewDataUrl : await buildSheet();
    if (!dataUrl) return;

    const safeTag = (headerLabel.trim() || 'ZAL.2')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${safeTag}_SOPO_A4.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const citationPreview = buildPibSopoCitation(sopoMeta);

  const handleCopyCitation = async () => {
    const text = `${citationPreview.primaryCitation}\n${citationPreview.statutoryNotice}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCitation(true);
      window.setTimeout(() => setCopiedCitation(false), 2200);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <section
      aria-label="Załącznik mapowy A4 – Mapa osuwisk SOPO (PIG-PIB)"
      className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-950">
            Załącznik mapowy A4 – Mapa osuwisk SOPO (PIG-PIB)
          </h2>
          <p className="text-xs text-slate-500">
            Jedna duża mapa SOPO (17 × 15 cm) na stronie A4 z niebieskim punktem z czarnym
            obrysem, północą N, pełną legendą SOPO i cytowaniem PIG-PIB.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void buildSheet()}
          disabled={generating || !validInPoland}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-md bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {generating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>Generowanie SOPO A4…</span>
            </>
          ) : (
            <>
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{previewDataUrl ? 'Odśwież SOPO A4' : 'Generuj SOPO A4'}</span>
            </>
          )}
        </button>
      </div>

      {/* Options toolbar */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label
                htmlFor="sopo-zal-label-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Napis w prawym górnym rogu (Arial 26 pt bold)
              </label>
              <input
                id="sopo-zal-label-input"
                type="text"
                maxLength={24}
                value={headerLabel}
                onChange={(e) => setHeaderLabel(e.target.value)}
                placeholder="ZAŁ.2"
                className="w-32 h-9 px-2.5 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md font-sans text-sm font-bold text-slate-950 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">Skala mapy SOPO</span>
              <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => setSopoScale(10000)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    sopoScale === 10000
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  1:10 000
                </button>
                <button
                  type="button"
                  onClick={() => setSopoScale(25000)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    sopoScale === 25000
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  1:25 000
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">Podkład mapy</span>
              <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => setBasemapLayer('topo')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    basemapLayer === 'topo'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Topograficzna
                </button>
                <button
                  type="button"
                  onClick={() => setBasemapLayer('orto')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    basemapLayer === 'orto'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Ortofotomapa
                </button>
              </div>
            </div>
          </div>

          {/* Export actions */}
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
      </div>

      {/* Feedback, Preview & PIG-PIB Citation */}
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
            Zmieniono współrzędne, skalę lub podkład — kliknij „Odśwież SOPO A4” albo od razu
            „Pobierz PDF (A4)”, aby wygenerować aktualny załącznik SOPO.
          </p>
        )}

        {previewDataUrl ? (
          <div className="max-w-lg mx-auto bg-white border border-slate-300 shadow-sm rounded-sm overflow-hidden">
            <img
              src={previewDataUrl}
              alt="Podgląd strony A4 z mapą osuwisk SOPO, legendą i cytowaniem PIG-PIB"
              className="w-full h-auto block"
            />
          </div>
        ) : (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Kliknij „Generuj SOPO A4” lub „Pobierz PDF (A4)”, aby utworzyć załącznik z mapą SOPO.
            </p>
            <p className="text-xs text-slate-500 max-w-xl mx-auto">
              Strona A4 zawiera wyłącznie mapę SOPO (17 × 15 cm w skali 1:10 000 lub 1:25 000),
              niebieską kropkę z czarnym obrysem, północ N, pełną legendę SOPO oraz cytowanie
              zgodne z zaleceniami PIG-PIB.
            </p>
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={generating || !validInPoland}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 disabled:text-slate-400 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Generuj i pobierz PDF SOPO od razu</span>
              </button>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-900">
              Cytowanie do dokumentacji (zasady PIG-PIB SOPO)
            </span>
            <button
              type="button"
              onClick={() => void handleCopyCitation()}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 cursor-pointer"
            >
              {copiedCitation ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                  <span className="text-emerald-700">Skopiowano cytowanie</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Kopiuj cytowanie</span>
                </>
              )}
            </button>
          </div>
          <p className="text-xs text-slate-800 leading-relaxed">{citationPreview.primaryCitation}</p>
          <p className="text-[11px] italic text-slate-600 leading-relaxed">
            {citationPreview.statutoryNotice}
          </p>
        </div>
      </div>
    </section>
  );
}
