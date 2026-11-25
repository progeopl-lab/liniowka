export interface PhysioHierarchy {
  prowincja: string;
  podprowincja: string;
  makroregion: string;
}

const PROVINCES: Record<string, string> = {
  '31': 'Niż Środkowoeuropejski',
  '33': 'Masyw Czeski',
  '34': 'Wyżyny Polskie',
  '51': 'Karpaty Zachodnie z Podkarpaciem Zachodnim i Północnym',
  '52': 'Karpaty Wschodnie z Podkarpaciem Wschodnim',
  '84': 'Niż Wschodniobałtycko-Białoruski',
  '85': 'Wyżyny Ukraińskie',
};

const SUBPROVINCES: Record<string, string> = {
  '313': 'Pobrzeża Południowobałtyckie',
  '314': 'Pojezierza Południowobałtyckie',
  '315': 'Pojezierza Południowobałtyckie',
  '317': 'Niziny Sasko-Łużyckie',
  '318': 'Niziny Środkowopolskie',
  '332': 'Sudety z Przedgórzem Sudeckim',
  '341': 'Wyżyna Śląsko-Krakowska',
  '342': 'Wyżyna Małopolska',
  '343': 'Wyżyna Lubelsko-Lwowska',
  '512': 'Podkarpacie Północne',
  '513': 'Zewnętrzne Karpaty Zachodnie',
  '514': 'Centralne Karpaty Zachodnie',
  '521': 'Podkarpacie Wschodnie',
  '522': 'Zewnętrzne Karpaty Wschodnie',
  '841': 'Pobrzeża Wschodniobałtyckie',
  '842': 'Pojezierza Wschodniobałtyckie',
  '843': 'Wysoczyzny Podlasko-Białoruskie',
  '845': 'Polesie',
  '851': 'Wyżyna Wołyńsko-Podolska',
};

const MACROREGIONS: Record<string, string> = {
  '313.2': 'Pobrzeże Szczecińskie',
  '313.3': 'Pobrzeże Szczecińskie',
  '313.4': 'Pobrzeże Koszalińskie',
  '313.5': 'Pobrzeże Gdańskie',
  '314.4': 'Pojezierze Zachodniopomorskie',
  '314.5': 'Pojezierze Wschodniopomorskie',
  '314.6': 'Pojezierze Południowopomorskie',
  '314.7': 'Pojezierze Południowopomorskie',
  '314.8': 'Dolina Dolnej Wisły',
  '314.9': 'Pojezierze Iławskie',
  '315.1': 'Pojezierze Chełmińsko-Dobrzyńskie',
  '315.3': 'Pradolina Toruńsko-Eberswaldzka',
  '315.4': 'Pojezierze Lubuskie',
  '315.5': 'Pojezierze Wielkopolskie',
  '315.6': 'Pradolina Warciańsko-Odrzańska',
  '315.7': 'Wzniesienia Zielonogórskie',
  '315.8': 'Pojezierze Leszczyńskie',
  '317.2': 'Nizina Śląsko-Łużycka',
  '317.4': 'Nizina Śląsko-Łużycka',
  '317.7': 'Wzniesienia Łużyckie',
  '318.1': 'Nizina Południowowielkopolska',
  '318.2': 'Nizina Południowowielkopolska',
  '318.3': 'Obniżenie Milicko-Głogowskie',
  '318.4': 'Wał Trzebnicki',
  '318.5': 'Nizina Śląska',
  '318.6': 'Nizina Północnomazowiecka',
  '318.7': 'Nizina Środkowomazowiecka',
  '318.8': 'Wzniesienia Południowomazowieckie',
  '318.9': 'Nizina Południowopodlaska',
  '332.1': 'Przedgórze Sudeckie',
  '332.2': 'Pogórze Zachodniosudeckie',
  '332.3': 'Sudety Zachodnie',
  '332.4': 'Sudety Środkowe',
  '332.5': 'Sudety Środkowe',
  '332.6': 'Sudety Wschodnie',
  '341.1': 'Wyżyna Śląska',
  '341.2': 'Wyżyna Woźnicko-Wieluńska',
  '341.3': 'Wyżyna Krakowsko-Częstochowska',
  '342.1': 'Wyżyna Przedborska',
  '342.2': 'Niecka Nidziańska',
  '342.3': 'Wyżyna Kielecka',
  '343.1': 'Wyżyna Lubelska',
  '343.2': 'Roztocze',
  '512.1': 'Kotlina Ostrawska',
  '512.2': 'Kotlina Oświęcimska',
  '512.3': 'Brama Krakowska',
  '512.4': 'Kotlina Sandomierska',
  '512.5': 'Kotlina Sandomierska',
  '513.3': 'Pogórze Zachodniobeskidzkie',
  '513.4': 'Beskidy Zachodnie',
  '513.5': 'Beskidy Zachodnie',
  '513.6': 'Pogórze Środkowobeskidzkie',
  '513.7': 'Beskidy Środkowe',
  '514.1': 'Obniżenie Orawsko-Podhalańskie',
  '514.5': 'Łańcuch Tatrzański',
  '521.1': 'Płaskowyż Sańsko-Dniestrzański',
  '522.1': 'Beskidy Lesiste',
  '841.5': 'Nizina Staropruska',
  '842.7': 'Pojezierze Litewskie',
  '842.8': 'Pojezierze Mazurskie',
  '843.3': 'Nizina Północnopodlaska',
  '845.1': 'Polesie Zachodnie',
  '845.3': 'Polesie Wołyńskie',
  '851.1': 'Wyżyna Wołyńska',
  '851.2': 'Kotlina Pobuża',
};

export function resolvePhysioHierarchy(mezoCode: string | null | undefined): PhysioHierarchy | null {
  if (!mezoCode) return null;
  const normalized = mezoCode.trim();
  const match = normalized.match(/^(\d{2})(\d)\.(\d)/);
  if (!match) return null;

  const provKey = match[1];
  const subKey = `${match[1]}${match[2]}`;
  const macroKey = `${subKey}.${match[3]}`;

  // Special case: 513.54-513.59 (Beskid Sądecki, Pogórze Popradzkie, etc.) -> Beskidy Zachodnie
  // Special case: 314.6-7 -> Pojezierze Południowopomorskie
  return {
    prowincja: PROVINCES[provKey] ?? '—',
    podprowincja: SUBPROVINCES[subKey] ?? '—',
    makroregion: MACROREGIONS[macroKey] ?? '—',
  };
}
