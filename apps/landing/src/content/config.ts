// Astro 5: uses glob() loaders instead of deprecated type:'content'.
// This avoids the deprecation warning that breaks astro check in strict mode.
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const faq = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/faq' }),
  schema: z.object({
    question: z.string(),
    lang: z.enum(['es', 'en']),
    order: z.number().default(100),
    tags: z.array(z.string()).default([]),
  }),
});

const glosario = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/glosario' }),
  schema: z.object({
    term: z.string(),
    lang: z.enum(['es', 'en']),
    acronym: z.string().optional(),
    seeAlso: z.array(z.string()).default([]),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['es', 'en']),
    datePublished: z.string(),
    dateModified: z.string().optional(),
    h1: z.string().optional(),
    breadcrumbs: z.array(z.object({ name: z.string(), url: z.string() })).default([]),
    related: z.array(z.object({ title: z.string(), href: z.string() })).default([]),
  }),
});

export const collections = { faq, glosario, pages };
