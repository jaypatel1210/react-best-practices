const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/**
 * Prefixes a site path with the configured base path and keeps the trailing slash
 * convention (`trailingSlash: 'always'`) for page URLs.
 */
export function url(path = '/'): string {
  const [pathname, hash = ''] = path.split('#');
  let clean = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const isFile = /\.[a-z0-9]+$/i.test(clean);
  if (!isFile && !clean.endsWith('/')) clean += '/';
  return `${BASE}${clean}${hash ? `#${hash}` : ''}`;
}

/**
 * An absolute URL on the deployed site, for canonical links, Open Graph and JSON-LD.
 * Accepts a site path ("/fixes/") or one already prefixed by url().
 */
export function absoluteUrl(path: string, site: URL | undefined): string {
  const origin = site ?? new URL('http://localhost:4321');
  const hasBase = BASE !== '' && (path === BASE || path.startsWith(`${BASE}/`));
  return new URL(hasBase ? path : url(path), origin).href;
}

export const fixUrl = (slug: string) => url(`/fixes/${slug}/`);
export const skillUrl = (id: string) => url(`/skills/${id}/`);
export const utilityUrl = (slug: string) => url(`/utilities/${slug}/`);
export const ogImageUrl = (key: string) => url(`/og/${key}.png`);
