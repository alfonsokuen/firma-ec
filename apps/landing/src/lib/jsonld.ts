export const SITE = {
  name: 'firmar.ec',
  url: 'https://firmar.ec',
  operator: 'IDK Manager',
  operatorUrl: 'https://idkmanager.com',
  contactUrl: 'https://github.com/idkmanager/firmar-ec/issues',
  dpoContactUrl: 'https://idkmanager.com/contacto/',
  securityUrl: 'https://github.com/idkmanager/firmar-ec/security/advisories/new',
  githubOrg: 'https://github.com/idkmanager/firmar-ec',
  githubPersonal: 'https://github.com/alfonsokuen/firmar-ec',
  sourceCodeRepository: 'https://git.idkmanager.com/alfonso/firmar-ec',
  license: 'AGPL-3.0',
} as const;

export interface OrgArgs {
  lang: 'es' | 'en';
}
export const organization = ({ lang }: OrgArgs) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE.url}/#organization`,
  name: SITE.name,
  url: SITE.url,
  logo: `${SITE.url}/icons/icon-512.png`,
  description:
    lang === 'es'
      ? 'PWA pública ecuatoriana de firma y verificación de PDFs con certificados digitales nacionales. Open source. Cumple LOPDP por diseño.'
      : 'Ecuadorian public PWA for signing and verifying PDFs with national digital certificates. Open source. LOPDP-compliant by design.',
  parentOrganization: { '@type': 'Organization', name: SITE.operator, url: SITE.operatorUrl },
  sameAs: [SITE.githubOrg, SITE.githubPersonal],
  contactPoint: [
    {
      '@type': 'ContactPoint',
      url: SITE.contactUrl,
      contactType: 'customer support',
      availableLanguage: ['es', 'en'],
    },
  ],
});

export const website = ({ lang }: OrgArgs) => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE.url}/#website`,
  url: SITE.url,
  name: SITE.name,
  inLanguage: lang === 'es' ? 'es-EC' : 'en-US',
  publisher: { '@id': `${SITE.url}/#organization` },
});

export const softwareApplication = ({ lang }: OrgArgs) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SITE.url}/#app`,
  name: SITE.name,
  operatingSystem: 'Web',
  applicationCategory: 'SecurityApplication',
  url: 'https://app.firmar.ec',
  description:
    lang === 'es'
      ? 'App PWA gratis para firmar y verificar PDFs con tu certificado electrónico .p12 (ECI ARCOTEL). 100% en tu navegador, sin registro ni servidores.'
      : 'Free PWA app to sign and verify PDFs with your electronic certificate .p12 (ARCOTEL ECI). 100% in your browser, no sign-up, nothing uploaded.',
  // schema.org/keywords (Text): tópicos/consultas que describen la app para
  // buscadores e IA (GEO/AEO). No es el meta keywords tag (muerto): aquí es un
  // dato estructurado legítimo, en el idioma de la página. Complementa featureList.
  keywords:
    lang === 'es'
      ? 'firmar documentos, firmar documentos en línea, firmar documentos gratis, página web para firmar documentos, cómo se firma electrónicamente un documento, firma electrónica para firmar documentos, firmar documentos con firma electrónica Ecuador, firmar PDF, firma electrónica Ecuador'
      : 'sign documents, sign documents online, sign documents free, website to sign documents, how to electronically sign a document, electronic signature to sign documents, sign documents with electronic signature Ecuador, sign PDF, electronic signature Ecuador',
  softwareVersion: '0.9.14',
  license: `https://opensource.org/licenses/${SITE.license}`,
  codeRepository: SITE.githubOrg,
  isAccessibleForFree: true,
  // Entity association for SEO: name the ARCOTEL-accredited issuers (ACE/ECI)
  // whose certificates firmar.ec recognises, so queries for a specific issuer
  // ("firma electrónica UANATACA", "certificado Security Data", "BCE", etc.)
  // can surface this page. Mirrors the visible list in Compatibilidad.astro.
  featureList:
    lang === 'es'
      ? [
          'Firma PDF con certificado .p12 (PAdES) 100% en el navegador',
          'Verificación de firmas y validación de certificados sin conexión',
          'Compatible con Security Data, Banco Central del Ecuador (BCE), UANATACA, ANF AC, Consejo de la Judicatura (iCert-EC), ArgosData, Datil, Lazzate, Eclipsoft, Alpha Technologies, AppFirmas, CorpNewBest, DarkCam, FirmaSegura, LetMi y PrimeCoreLat',
          'Lista de confianza (TSL) de ARCOTEL embebida y verificada por huella SHA-256',
        ]
      : [
          'Sign PDFs with a .p12 certificate (PAdES) 100% in the browser',
          'Signature verification and certificate validation offline',
          'Compatible with Security Data, Banco Central del Ecuador (BCE), UANATACA, ANF AC, Consejo de la Judicatura (iCert-EC), ArgosData, Datil, Lazzate, Eclipsoft, Alpha Technologies, AppFirmas, CorpNewBest, DarkCam, FirmaSegura, LetMi and PrimeCoreLat',
          'ARCOTEL Trust Service List (TSL) embedded and verified by SHA-256 fingerprint',
        ],
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
});

export interface BreadcrumbItem {
  name: string;
  url: string;
}
export const breadcrumbList = (items: BreadcrumbItem[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: it.url,
  })),
});

export interface FaqEntry {
  question: string;
  answer: string;
}
export const faqPage = (entries: FaqEntry[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: entries.map((e) => ({
    '@type': 'Question',
    name: e.question,
    acceptedAnswer: { '@type': 'Answer', text: e.answer },
  })),
});

export interface DefinedTerm {
  name: string;
  description: string;
  url?: string;
}
export const definedTermSet = (terms: DefinedTerm[]) => ({
  '@context': 'https://schema.org',
  '@type': 'DefinedTermSet',
  name: 'Glosario firmar.ec',
  hasDefinedTerm: terms.map((t) => ({
    '@type': 'DefinedTerm',
    name: t.name,
    description: t.description,
    ...(t.url ? { url: t.url } : {}),
  })),
});

export const techArticle = ({
  headline,
  description,
  url,
  lang,
  datePublished,
  dateModified,
}: {
  headline: string;
  description: string;
  url: string;
  lang: 'es' | 'en';
  datePublished: string;
  dateModified?: string;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline,
  description,
  url,
  inLanguage: lang === 'es' ? 'es-EC' : 'en-US',
  datePublished,
  dateModified: dateModified ?? datePublished,
  // E-E-A-T (YMYL): autoría + revisión editorial explícitas. El equipo editorial
  // es el del operador (IDK Manager); el publisher sigue siendo la org firmar.ec.
  author: {
    '@type': 'Organization',
    name: lang === 'es' ? 'Equipo IDK Manager' : 'IDK Manager Team',
    url: SITE.operatorUrl,
  },
  reviewedBy: {
    '@type': 'Organization',
    name: lang === 'es' ? 'Equipo IDK Manager' : 'IDK Manager Team',
    url: SITE.operatorUrl,
  },
  publisher: { '@id': `${SITE.url}/#organization` },
});

export const aboutPage = ({ lang }: OrgArgs) => ({
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  url: lang === 'es' ? `${SITE.url}/acerca/` : `${SITE.url}/en/about/`,
  inLanguage: lang === 'es' ? 'es-EC' : 'en-US',
  publisher: { '@id': `${SITE.url}/#organization` },
});

export const legalDocument = ({
  lang,
  type,
  url,
}: { lang: 'es' | 'en'; type: 'TermsOfService' | 'PrivacyPolicy'; url: string }) => ({
  '@context': 'https://schema.org',
  '@type': type,
  url,
  inLanguage: lang === 'es' ? 'es-EC' : 'en-US',
  publisher: { '@id': `${SITE.url}/#organization` },
});

export interface HowToStep {
  name: string;
  text: string;
  image?: string;
  url?: string;
}
export const howTo = ({
  name,
  description,
  totalTime,
  steps,
  image,
}: {
  name: string;
  description: string;
  totalTime?: string;
  steps: HowToStep[];
  image?: string;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name,
  description,
  ...(totalTime ? { totalTime } : {}),
  ...(image ? { image } : {}),
  step: steps.map((s, i) => ({
    '@type': 'HowToStep',
    position: i + 1,
    name: s.name,
    text: s.text,
    ...(s.image ? { image: s.image } : {}),
    ...(s.url ? { url: s.url } : {}),
  })),
});
