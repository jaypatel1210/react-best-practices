import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { markSvg } from './brand';

/** Renders 1200×630 Open Graph images at build time: satori lays out text as SVG paths, sharp makes a PNG. */

type Weight = 500 | 700;
type FontSpec = { name: string; data: Buffer; weight: Weight; style: 'normal' };

let fonts: FontSpec[] | undefined;

function loadFonts(): FontSpec[] {
  const file = (pkg: string, name: string) => readFileSync(join(__SITE_ROOT__, 'node_modules', pkg, 'files', name));
  fonts ??= [
    { name: 'Space Grotesk', data: file('@fontsource/space-grotesk', 'space-grotesk-latin-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'Space Grotesk', data: file('@fontsource/space-grotesk', 'space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'JetBrains Mono', data: file('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'JetBrains Mono', data: file('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff'), weight: 700, style: 'normal' },
  ];
  return fonts;
}

export type OgTone = 'bug' | 'performance' | 'maintainability' | 'brand';

export type OgInput = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  tone?: OgTone;
};

const TONE: Record<OgTone, string> = {
  bug: '#ff7088',
  performance: '#f6bd57',
  maintainability: '#7cb0ff',
  brand: '#a79dff',
};

type Child = Node | string | null | undefined;
interface Node {
  type: string;
  props: Record<string, unknown> & { children?: (Node | string)[] | Node | string };
}

function h(type: string, props: Record<string, unknown>, ...children: Child[]): Node {
  const kids = children.filter((c): c is Node | string => c !== null && c !== undefined);
  // satori rejects an empty children array, so leave the key out for leaf nodes.
  if (kids.length === 0) return { type, props };
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const MARK = `data:image/svg+xml;base64,${Buffer.from(markSvg()).toString('base64')}`;

export async function renderOg(input: OgInput, host: string): Promise<Buffer> {
  const accent = TONE[input.tone ?? 'brand'];
  const title = clip(input.title, 96);
  const titleSize = title.length > 72 ? 54 : title.length > 48 ? 62 : 70;

  const tree = h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '60px 72px',
        backgroundColor: '#0b0e17',
        backgroundImage:
          'radial-gradient(circle at 88% 0%, rgba(148,136,255,0.30), rgba(11,14,23,0) 55%), radial-gradient(circle at 0% 100%, rgba(67,217,155,0.16), rgba(11,14,23,0) 45%)',
        color: '#e9ebf3',
        fontFamily: 'Space Grotesk',
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 18 } },
      h('img', { src: MARK, width: 54, height: 54 }),
      h('div', { style: { fontSize: 30, fontWeight: 700, letterSpacing: -0.5 } }, 'React Best Practices'),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 22 } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontFamily: 'JetBrains Mono',
            fontWeight: 700,
            fontSize: 24,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: accent,
          },
        },
        h('div', { style: { width: 14, height: 14, borderRadius: 7, backgroundColor: accent } }),
        input.eyebrow,
      ),
      h('div', { style: { fontSize: titleSize, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.6, maxWidth: 1050 } }, title),
      input.subtitle
        ? h('div', { style: { fontSize: 28, fontWeight: 500, lineHeight: 1.38, color: '#b1b7cb', maxWidth: 1000 } }, clip(input.subtitle, 150))
        : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 22,
          borderTop: '2px solid #252b42',
          fontFamily: 'JetBrains Mono',
          fontWeight: 500,
          fontSize: 22,
          color: '#8e95ad',
        },
      },
      h('div', {}, 'Symptom · root cause · fix'),
      h('div', {}, host),
    ),
  );

  // satori's types expect React elements; the plain object tree has the same shape.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: loadFonts() });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
