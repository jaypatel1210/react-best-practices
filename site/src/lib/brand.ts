/** The site mark as SVG markup, for icons and Open Graph images. Matches BrandMark.astro. */

export const BRAND_COLOR = '#5546e8';

const GLYPH =
  '<path d="M10.5 10.5 6 16l4.5 5.5M21.5 10.5 26 16l-4.5 5.5" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="m12.6 16.4 2.6 2.7 4.4-6" fill="none" stroke="#7dfcc6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';

/**
 * @param rounded Rounded tile (favicon) or a full square (touch and maskable icons).
 * @param scale Glyph scale, below 1 to keep it inside a maskable icon's safe zone.
 */
export function markSvg({ rounded = true, scale = 1 }: { rounded?: boolean; scale?: number } = {}): string {
  const glyph = scale === 1 ? GLYPH : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${GLYPH}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${rounded ? 8 : 0}" fill="${BRAND_COLOR}"/>${glyph}</svg>`;
}
