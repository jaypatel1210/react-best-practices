import type { APIRoute, GetStaticPaths } from 'astro';
import { UTILITIES } from '../../data/utilities';
import { getFixes, getSkills, KIND_LABEL } from '../../lib/content';
import { renderOg, type OgInput } from '../../lib/og';

export const getStaticPaths = (async () => {
  const [fixes, skills] = await Promise.all([getFixes(), getSkills()]);
  const demos = fixes.filter((f) => f.body?.includes('client:visible')).length;
  const page = (key: string, props: OgInput) => ({ params: { key }, props });

  return [
    page('home', {
      eyebrow: 'Open-source skills for Claude Code',
      title: 'Real React issues, why they happen, and how to fix them',
      subtitle: `${fixes.length} fixes, ${demos} live demos and ${skills.length} skills, free and open source.`,
    }),
    page('fixes', {
      eyebrow: 'All fixes',
      title: 'React issues and how to fix them',
      subtitle: 'Re-renders, keys, effects, context, data fetching, INP, lists, loading and animation.',
    }),
    page('skills', {
      eyebrow: 'The skills',
      title: 'Fifteen React skills for Claude',
      subtitle: 'Instructions, worked examples and tested code, loaded only when a task needs them.',
    }),
    page('utilities', {
      eyebrow: 'Tested utilities',
      title: 'React hooks and helpers you can copy',
      subtitle: 'Typed, dependency-free and tested against React 18 and 19.',
    }),
    page('checklist', {
      eyebrow: 'Code review',
      title: 'React code review checklist',
      subtitle: 'What to look for, why it matters and the fix, grouped by area.',
    }),
    page('how-it-works', {
      eyebrow: 'How it works',
      title: 'How the React skills work with Claude',
      subtitle: 'Descriptions first, then SKILL.md, then one worked example: only what the task needs.',
    }),
    page('about', { eyebrow: 'About', title: 'Teaching React fixes to people and to Claude' }),
    ...fixes.map((fix) =>
      page(`fixes/${fix.id}`, {
        eyebrow: `${KIND_LABEL[fix.data.kind]} · ${fix.data.skill}`,
        title: fix.data.title,
        subtitle: `Fix: ${fix.data.fix}`,
        tone: fix.data.kind,
      }),
    ),
    ...skills.map((skill) =>
      page(`skills/${skill.id}`, { eyebrow: `Skill · ${skill.id}`, title: skill.data.title, subtitle: skill.data.headline }),
    ),
    ...UTILITIES.map((u) =>
      page(`utilities/${u.slug}`, { eyebrow: `Tested utility · ${u.skill}`, title: u.name, subtitle: u.description }),
    ),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props, site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const host = `${site?.host ?? 'localhost'}${base}`;
  const png = await renderOg(props as OgInput, host);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
