export const SITE = {
  name: 'React Best Practices',
  shortName: 'React BP',
  tagline: 'Real React issues, why they happen, and how to fix them',
  description:
    'Real React issues with root causes, fixes and live demos: re-renders, memoization, keys, effects, context, data fetching, INP and Core Web Vitals. Free and open source.',
  locale: 'en_US',
  lang: 'en',
  author: {
    name: 'Jay Patel',
    url: 'https://github.com/jaypatel1210',
    github: 'jaypatel1210',
  },
  repo: {
    url: 'https://github.com/jaypatel1210/react-best-practices',
    branch: 'main',
  },
  license: 'MIT',
  themeColor: { light: '#f7f8fc', dark: '#0b0e17' },
  install: {
    marketplace: '/plugin marketplace add jaypatel1210/react-best-practices',
    plugin: '/plugin install react-best-practices@react-best-practices',
  },
} as const;

/** Link to a file or folder in the repository on GitHub. */
export function repoUrl(path = '', kind: 'blob' | 'tree' = 'blob'): string {
  const clean = path.replace(/^\/+/, '');
  return clean ? `${SITE.repo.url}/${kind}/${SITE.repo.branch}/${clean}` : SITE.repo.url;
}
