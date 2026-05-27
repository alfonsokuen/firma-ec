// Fuente única de patrocinadores activos de firmar.ec.
// La consumen tanto `SponsorsStrip.astro` (sección completa) como
// `HeroSponsors.astro` (fila "Con el apoyo de" al pie del hero).
// Agregar un patrocinador aquí lo hace aparecer en AMBOS lugares a la vez;
// con la lista vacía, el strip muestra su empty-state y la fila del hero se oculta.
//
// Para agregar: { name, url, logo: '/sponsors/<tier>/<slug>.svg', tier }.
// El logo debe ser SVG monocromo (se muestra en escala de grises y coloriza en hover).
// Mantener orden por tier (founding → bronze).
export type SponsorTier = 'founding' | 'platinum' | 'gold' | 'silver' | 'bronze';

export type Sponsor = {
  name: string;
  url: string;
  logo: string;
  tier: SponsorTier;
};

export const sponsors: Sponsor[] = [];
