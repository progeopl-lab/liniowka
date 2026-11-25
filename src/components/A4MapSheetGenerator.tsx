import { useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  Download,
  FileImage,
  FileText,
  Loader2,
  Map as MapIcon,
} from 'lucide-react';
import { renderTopoA4SheetCanvas } from '../data/a4MapCanvas';

interface A4MapSheetGeneratorProps {
  lat: number | null;
  lon: number | null;
  validInPoland: boolean;
}

export function A4MapSheetGenerator({
  lat,
  lon,
  validInPoland,
}: A4MapSheetGeneratorProps) {
  const [headerLabel, setHeaderLabel] = useState<string>('ZAŁ.1');
  const [bottomLayer, setBottomLayer] = useState<'topo' | 'orto'>('topo');
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [generatedCoordsKey, setGeneratedCoordsKey] = useState<string | null>(null);

  const currentKey =
    lat !== null && lon !== null
      ? `${lat.toFixed(6)}:${lon.toFixed(6)}:${headerLabel.trim()}:${bottomLayer}`
      : null;

  const isStale = Boolean(previewDataUrl && currentKey && generatedCoordsKey !== currentKey);

  const buildSheet = async (): Promise<string | null> => {
    if (lat === null || lon === null || !validInPoland) {
      setError('Wpisz poprawne współrzędne na terenie Polski, aby wygenerować załącznik A4.');
      return null;
    }

    setGenerating(true);
    setError(null);

    try {
      const canvas = await renderTopoA4SheetCanvas({
        lat,
        lon,
        headerLabel,
        bottomLayer,
      });
      const dataUrl = canvas.toDataURL('image/png');
      setPreviewDataUrl(dataUrl);
      setGeneratedCoordsKey(currentKey);
      return dataUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Nie udało się wygenerować arkusza A4 z serwera map.'
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

    const safeTag = (headerLabel.trim() || 'ZAL.1')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    pdf.save(`${safeTag}_lokalizacja_A4.pdf`);
  };

  const handleDownloadPng = async () => {
    const dataUrl = !isStale && previewDataUrl ? previewDataUrl : await buildSheet();
    if (!dataUrl) return;

    const safeTag = (headerLabel.trim() || 'ZAL.1')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${safeTag}_lokalizacja_A4.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <section
      aria-label="Załącznik mapowy A4 – Mapy topograficzne (1:50 000 i 1:10 000)"
      className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-950">
            Załącznik mapowy A4 – Mapy topograficzne (1:50 000 i 1:10 000)
          </h2>
          <p className="text-xs text-slate-500">
            Dwie mapy na jednej stronie A4 (17 × 10 cm każda), czerwony punkt z czarnym obrysem,
            oznaczenie północy i objaśnienia.
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
              <span>Generowanie A4…</span>
            </>
          ) : (
            <>
              <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{previewDataUrl ? 'Odśwież stronę A4' : 'Generuj stronę A4'}</span>
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
                htmlFor="topo-zal-label-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Napis w prawym górnym rogu (Arial 26 pt bold)
              </label>
              <input
                id="topo-zal-label-input"
                type="text"
                maxLength={24}
                value={headerLabel}
                onChange={(e) => setHeaderLabel(e.target.value)}
                placeholder="ZAŁ.1"
                className="w-36 h-9 px-2.5 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md font-sans text-sm font-bold text-slate-950 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">
                Podkład mapy 1:10 000
              </span>
              <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => setBottomLayer('topo')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    bottomLayer === 'topo'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Mapa topograficzna
                </button>
                <button
                  type="button"
                  onClick={() => setBottomLayer('orto')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    bottomLayer === 'orto'
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

      {/* Feedback & Preview */}
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
            Zmieniono współrzędne lub ustawienia — kliknij „Odśwież stronę A4” albo od razu
            „Pobierz PDF (A4)”, aby wygenerować aktualny arkusz.
          </p>
        )}

        {previewDataUrl ? (
          <div className="max-w-lg mx-auto bg-white border border-slate-300 shadow-sm rounded-sm overflow-hidden">
            <img
              src={previewDataUrl}
              alt="Podgląd strony A4 z mapami topograficznymi 1:50 000 i 1:10 000"
              className="w-full h-auto block"
            />
          </div>
        ) : (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Kliknij „Generuj stronę A4” lub „Pobierz PDF (A4)”, aby utworzyć załącznik
              topograficzny.
            </p>
            <p className="text-xs text-slate-500 max-w-xl mx-auto">
              Każda mapa ma wymiar dokładnie 17 × 10 cm (1:50 000 oraz 1:10 000), czerwony punkt z
              czarnym obrysem w środku, oznaczenie północy N, podpis i objaśnienia.
            </p>
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={generating || !validInPoland}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 disabled:text-slate-400 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Generuj i pobierz PDF od razu</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
