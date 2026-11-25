import { TerrainDescriptionTool } from './components/TerrainDescriptionTool';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F6F8FA] text-slate-900">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 min-h-14 flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2.5 text-sm sm:text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
            <img
              src="/pwa-192x192.png"
              alt=""
              width={28}
              height={28}
              className="w-7 h-7 rounded-md shrink-0"
            />
            <span>PRO GEO</span>
            <span className="text-slate-300 font-normal">|</span>
            <span className="text-xs sm:text-sm font-semibold text-blue-700">
              Projekt robót geologicznych (PRG)
            </span>
          </div>
          <span className="hidden sm:inline text-xs font-medium text-slate-500">
            Generator dokumentacji i załączników GIS A4/A3
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
        <TerrainDescriptionTool />
      </main>

      <footer className="border-t border-slate-200 bg-white mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500">
          <p>PRO GEO · Generator Projektu robót geologicznych (PRG)</p>
          <p>Dane GIS: GUGiK, PIG-PIB (SOPO, MIDAS, JCWPd, GZWP, SMGP, MGśP), GDOŚ, OSM.</p>
        </div>
      </footer>
    </div>
  );
}
