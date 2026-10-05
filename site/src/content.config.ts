import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Every skill in ../skills, in the order the site presents them. */
export const SKILL_IDS = [
  'react-best-practices',
  'react-rerenders',
  'react-memoization',
  'react-reconciliation',
  'react-composition',
  'react-context',
  'react-effects',
  'react-refs-closures',
  'react-layout-portals',
  'react-data-fetching',
  'react-error-handling',
  'react-responsiveness',
  'react-large-lists',
  'react-loading-performance',
  'react-animation',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export const FIX_KINDS = ['bug', 'performance', 'maintainability'] as const;
export type FixKind = (typeof FIX_KINDS)[number];

export const SKILL_GROUPS = ['core', 'rendering', 'state', 'ui', 'data', 'speed'] as const;

/** One issue → cause → fix lesson. The file name is the URL slug. */
const fixes = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/fixes' }),
  schema: z.object({
    /** The symptom as a developer would describe it. Used for the H1 and <title>. */
    title: z.string().min(20).max(80),
    /** Meta description: what goes wrong and what fixes it. */
    description: z.string().min(80).max(170),
    skill: z.enum(SKILL_IDS),
    kind: z.enum(FIX_KINDS),
    /** One sentence each, shown in the diagnosis card at the top of the page. */
    symptom: z.string(),
    cause: z.string(),
    fix: z.string(),
    tags: z.array(z.string()).default([]),
    /** React versions the advice applies to, e.g. "18 and 19" or "19.2+". */
    react: z.string().default('18 and 19'),
    /** Position within its skill. */
    order: z.number().int(),
    /** The worked example in this repository that the page is drawn from. */
    source: z.string(),
    published: z.coerce.date(),
    updated: z.coerce.date().optional(),
    related: z.array(reference('fixes')).default([]),
    /** Shown on the home page. */
    featured: z.boolean().default(false),
  }),
});

/** Site copy for each skill. The file name must match the skill folder name. */
const skills = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/skills' }),
  schema: z.object({
    title: z.string(),
    /** One line promise, shown under the title. */
    headline: z.string(),
    description: z.string().min(80).max(170),
    group: z.enum(SKILL_GROUPS),
    /** The handful of rules worth remembering. */
    rules: z.array(z.string()).min(3).max(8),
    /** Things you might say to Claude that load this skill. */
    prompts: z.array(z.string()).min(2).max(5),
  }),
});

/** The SKILL.md frontmatter, read straight from the skills folder. */
const skillDocs = defineCollection({
  loader: glob({
    pattern: '*/SKILL.md',
    base: '../skills',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
    license: z.string().optional(),
  }),
});

export const collections = { fixes, skills, skillDocs };
