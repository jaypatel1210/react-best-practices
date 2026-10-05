import { getCollection, type CollectionEntry } from 'astro:content';
import { SKILL_IDS, type FixKind, type SkillId } from '../content.config';

export type Fix = CollectionEntry<'fixes'>;
export type Skill = CollectionEntry<'skills'>;

export const KIND_LABEL: Record<FixKind, string> = {
  bug: 'Bug',
  performance: 'Performance',
  maintainability: 'Maintainability',
};

export const KIND_BLURB: Record<FixKind, string> = {
  bug: 'Users see wrong data, lose input, or hit a crash.',
  performance: 'Work repeats on a hot path, or the page loads late.',
  maintainability: 'The code works but fights the next change.',
};

export const GROUP_LABEL = {
  core: 'Start here',
  rendering: 'Rendering',
  state: 'State, effects and closures',
  ui: 'Layout and motion',
  data: 'Data and errors',
  speed: 'Speed at scale',
} as const;

export const GROUP_ORDER = ['core', 'rendering', 'state', 'ui', 'data', 'speed'] as const;

export function skillOrder(id: SkillId): number {
  return SKILL_IDS.indexOf(id);
}

/** All skills, in the order of SKILL_IDS. */
export async function getSkills(): Promise<Skill[]> {
  const skills = await getCollection('skills');
  return skills.sort((a, b) => skillOrder(a.id as SkillId) - skillOrder(b.id as SkillId));
}

/** All fixes, grouped by skill order and then by their order within the skill. */
export async function getFixes(): Promise<Fix[]> {
  const fixes = await getCollection('fixes');
  return fixes.sort(
    (a, b) => skillOrder(a.data.skill) - skillOrder(b.data.skill) || a.data.order - b.data.order,
  );
}

export async function getSkillTitles(): Promise<Record<string, string>> {
  const skills = await getCollection('skills');
  return Object.fromEntries(skills.map((s) => [s.id, s.data.title]));
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
