import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE } from '../config';
import { getFixes, getSkillTitles, KIND_LABEL } from '../lib/content';
import { fixUrl } from '../lib/urls';

export const GET: APIRoute = async ({ site }) => {
  const [fixes, skillTitles] = await Promise.all([getFixes(), getSkillTitles()]);
  const items = fixes
    .slice()
    .sort((a, b) => b.data.published.getTime() - a.data.published.getTime())
    .map((fix) => ({
      title: fix.data.title,
      description: fix.data.description,
      pubDate: fix.data.updated ?? fix.data.published,
      link: fixUrl(fix.id),
      categories: [skillTitles[fix.data.skill] ?? fix.data.skill, KIND_LABEL[fix.data.kind]],
    }));

  return rss({
    title: `${SITE.name}: new fixes`,
    description: SITE.description,
    site: site ?? 'http://localhost:4321',
    items,
    customData: `<language>${SITE.lang}</language>`,
  });
};
