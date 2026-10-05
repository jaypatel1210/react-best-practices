import type { APIRoute } from 'astro';
import { BRAND_COLOR } from '../lib/brand';
import { SITE } from '../config';
import { url } from '../lib/urls';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: SITE.name,
      short_name: SITE.shortName,
      description: SITE.description,
      lang: SITE.lang,
      start_url: url('/'),
      scope: url('/'),
      display: 'minimal-ui',
      background_color: SITE.themeColor.dark,
      theme_color: BRAND_COLOR,
      icons: [
        { src: url('/icon-192.png'), sizes: '192x192', type: 'image/png' },
        { src: url('/icon-512.png'), sizes: '512x512', type: 'image/png' },
        { src: url('/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
