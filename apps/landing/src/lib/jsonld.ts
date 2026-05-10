export const SITE = {
  name: 'firmar.ec',
  url: 'https://firmar.ec',
  operator: 'IDK Manager',
  operatorUrl: 'https://idkmanager.com',
  contactUrl: 'https://github.com/idkmanager/firma-ec/issues',
  dpoContactUrl: 'https://idkmanager.com/contacto/',
  securityUrl: 'https://github.com/idkmanager/firma-ec/security/advisories/new',
  githubOrg: 'https://github.com/idkmanager/firma-ec',
  githubPersonal: 'https://github.com/alfonsokuen/firma-ec',
  sourceCodeRepository: 'https://git.idkmanager.com/alfonso/firma-ec',
  license: 'Apache-2.0',
} as const;

export interface OrgArgs { lang: 'es' | 'en' }
export const organization = ({ lang }: OrgArgs) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE.url}/#organization`,
  name: SITE.name,
  url: SITE.url,
  logo: `${SITE.url}/icons/icon-512.png`,
  description: lang === 'es'
    ? 'PWA pública ecuatoriana de firma y verificación de PDFs con certificados digitales nacionales. Open source. Cumple LOPDP por diseño.'
    : 'Ecuadorian public PWA for signing and verifying PDFs with national digital certificates. Open source. LOPDP-compliant by design.',
  parentOrganization: { '@type': 'Organization', name: SITE.operator, url: SITE.operatorUrl },
  sameAs: [SITE.githubOrg, SITE.githubPersonal],
  contactPoint: [{ '@type': 'ContactPoint', url: SITE.contactUrl, contactType: 'customer support', availableLanguage: ['es', 'en'] }],
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
  description: lang === 'es' ? 'App PWA para firmar y verificar PDFs con tu certificado electrónico .p12 (ECI ARCOTEL).' : 'PWA app to sign and verify PDFs with your electronic certificate .p12 (ARCOTEL ECI).',
  softwareVersion: '0.1.0',
  license: `https://opensource.org/licenses/${SITE.license}`,
  codeRepository: SITE.githubOrg,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
});

export interface BreadcrumbItem { name: string; url: string }
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

export interface FaqEntry { question: string; answer: string }
export const faqPage = (entries: FaqEntry[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: entries.map((e) => ({
    '@type': 'Question',
    name: e.question,
    acceptedAnswer: { '@type': 'Answer', text: e.answer },
  })),
});

export interface DefinedTerm { name: string; description: string; url?: string }
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

export const techArticle = ({ headline, description, url, lang, datePublished, dateModified }: { headline: string; description: string; url: string; lang: 'es' | 'en'; datePublished: string; dateModified?: string }) => ({
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline,
  description,
  url,
  inLanguage: lang === 'es' ? 'es-EC' : 'en-US',
  datePublished,
  dateModified: dateModified ?? datePublished,
  publisher: { '@id': `${SITE.url}/#organization` },
});

export const aboutPage = ({ lang }: OrgArgs) => ({
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  url: lang === 'es' ? `${SITE.url}/acerca` : `${SITE.url}/en/about`,
  inLanguage: lang === 'es' ? 'es-EC' : 'en-US',
  publisher: { '@id': `${SITE.url}/#organization` },
});

export const legalDocument = ({ lang, type, url }: { lang: 'es' | 'en'; type: 'TermsOfService' | 'PrivacyPolicy'; url: string }) => ({
  '@context': 'https://schema.org',
  '@type': type,
  url,
  inLanguage: lang === 'es' ? 'es-EC' : 'en-US',
  publisher: { '@id': `${SITE.url}/#organization` },
});

export interface HowToStep { name: string; text: string; image?: string; url?: string }
export const howTo = ({ name, description, totalTime, steps, image }: { name: string; description: string; totalTime?: string; steps: HowToStep[]; image?: string }) => ({
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
