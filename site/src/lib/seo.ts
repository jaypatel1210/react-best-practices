import { SITE } from '../config';
import { absoluteUrl } from './urls';

/** Builds schema.org JSON-LD. Every page gets the site graph plus its own nodes. */
type Node = Record<string, unknown>;

export interface Crumb {
  name: string;
  path: string;
}

export function siteGraph(site: URL | undefined): Node[] {
  const home = absoluteUrl('/', site);
  return [
    {
      '@type': 'Person',
      '@id': `${home}#author`,
      name: SITE.author.name,
      url: SITE.author.url,
      sameAs: [SITE.author.url],
    },
    {
      '@type': 'WebSite',
      '@id': `${home}#website`,
      url: home,
      name: SITE.name,
      description: SITE.description,
      inLanguage: SITE.lang,
      publisher: { '@id': `${home}#author` },
    },
  ];
}

export function breadcrumbs(crumbs: Crumb[], site: URL | undefined): Node {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path, site),
    })),
  };
}

export function itemList(name: string, items: { name: string; path: string }[], site: URL | undefined): Node {
  return {
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path, site),
    })),
  };
}

export function techArticle(
  opts: {
    path: string;
    headline: string;
    description: string;
    section: string;
    keywords: string[];
    published: Date;
    updated?: Date;
    image: string;
  },
  site: URL | undefined,
): Node {
  const home = absoluteUrl('/', site);
  const pageUrl = absoluteUrl(opts.path, site);
  return {
    '@type': 'TechArticle',
    '@id': `${pageUrl}#article`,
    headline: opts.headline,
    description: opts.description,
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    image: opts.image,
    articleSection: opts.section,
    keywords: opts.keywords.join(', '),
    datePublished: opts.published.toISOString(),
    dateModified: (opts.updated ?? opts.published).toISOString(),
    inLanguage: SITE.lang,
    proficiencyLevel: 'Intermediate',
    about: { '@type': 'Thing', name: 'React', sameAs: 'https://en.wikipedia.org/wiki/React_(software)' },
    author: { '@id': `${home}#author` },
    publisher: { '@id': `${home}#author` },
    isPartOf: { '@id': `${home}#website` },
    license: 'https://opensource.org/licenses/MIT',
  };
}

export function sourceCode(
  opts: { path: string; name: string; description: string; repoPath: string },
  site: URL | undefined,
): Node {
  const home = absoluteUrl('/', site);
  return {
    '@type': 'SoftwareSourceCode',
    name: opts.name,
    description: opts.description,
    url: absoluteUrl(opts.path, site),
    codeRepository: SITE.repo.url,
    codeSampleType: 'full solution',
    programmingLanguage: { '@type': 'ComputerLanguage', name: 'TypeScript' },
    runtimePlatform: 'React 18, React 19',
    license: 'https://opensource.org/licenses/MIT',
    author: { '@id': `${home}#author` },
    targetProduct: { '@type': 'SoftwareApplication', name: 'React', applicationCategory: 'DeveloperApplication' },
  };
}

export function graph(nodes: Node[]): string {
  // Escape "<" so content can never close the script tag.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
}
