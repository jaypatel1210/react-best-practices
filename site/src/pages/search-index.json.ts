import type { APIRoute } from 'astro';
import { UTILITIES } from '../data/utilities';
import { getFixes, getSkills, KIND_LABEL } from '../lib/content';
import { fixUrl, skillUrl, url, utilityUrl } from '../lib/urls';

/** The index the site search loads on first open: t = title, d = description, u = URL, k = type, g = keywords. */
export const GET: APIRoute = async () => {
  const [fixes, skills] = await Promise.all([getFixes(), getSkills()]);
  const entries = [
    ...fixes.map((f) => ({
      t: f.data.title,
      d: f.data.symptom,
      u: fixUrl(f.id),
      k: 'Fix',
      g: [...f.data.tags, f.data.skill, KIND_LABEL[f.data.kind], f.data.cause, f.data.fix].join(' '),
    })),
    ...skills.map((s) => ({
      t: `${s.data.title} skill`,
      d: s.data.headline,
      u: skillUrl(s.id),
      k: 'Skill',
      g: [s.id, ...s.data.rules].join(' '),
    })),
    ...UTILITIES.map((u) => ({
      t: u.name,
      d: u.summary,
      u: utilityUrl(u.slug),
      k: 'Utility',
      g: [u.file, ...u.exports, ...u.useWhen].join(' '),
    })),
    {
      t: 'React code review checklist',
      d: 'What to look for in a React pull request, why it matters and the fix.',
      u: url('/checklist/'),
      k: 'Page',
      g: 'review audit pull request PR severity',
    },
    {
      t: 'How the skills work with Claude',
      d: 'What Claude loads and when, plus install instructions.',
      u: url('/how-it-works/'),
      k: 'Page',
      g: 'install plugin marketplace claude code agent skills',
    },
  ];
  return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
