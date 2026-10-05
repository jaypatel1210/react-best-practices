import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { markSvg } from '../lib/brand';

/** PNG icons rasterized from the SVG mark at build time. */
const ICONS = {
  'favicon-32': { size: 32, rounded: true, scale: 1 },
  'apple-touch-icon': { size: 180, rounded: false, scale: 0.9 },
  'icon-192': { size: 192, rounded: true, scale: 1 },
  'icon-512': { size: 512, rounded: true, scale: 1 },
  // Maskable icons get cropped to a circle or squircle, so keep the glyph in the inner 80%.
  'icon-maskable-512': { size: 512, rounded: false, scale: 0.72 },
} as const;

type IconName = keyof typeof ICONS;

export const getStaticPaths = (() =>
  (Object.keys(ICONS) as IconName[]).map((icon) => ({ params: { icon } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const { size, rounded, scale } = ICONS[params.icon as IconName];
  const svg = Buffer.from(markSvg({ rounded, scale }));
  const png = await sharp(svg, { density: Math.ceil((72 * size) / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
