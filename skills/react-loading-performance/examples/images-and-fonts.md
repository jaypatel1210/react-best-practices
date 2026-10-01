# Example: A Slow Hero Image and Fonts That Move Text

A product landing page has a large hero photo, a feature grid with screenshots, customer logos, and a brand typeface. Field data shows LCP at 4.1 s and CLS at 0.21 on mobile.

## Part 1: the hero image

### Find out where LCP time goes

Use the `web-vitals` attribution build (`references/core-web-vitals.md`) or the Performance panel's LCP breakdown. For this page:

| LCP part | Time |
|---|---|
| Time to first byte | 0.6 s |
| Resource load delay | 1.9 s |
| Resource load duration | 1.3 s |
| Element render delay | 0.3 s |

The largest part is *load delay*: the browser found the image almost two seconds after the HTML arrived.

### Fix 1: make the image discoverable

```tsx
// Before: the URL comes from a client-side fetch, and the image is a CSS background
function Hero() {
  const { data } = useQuery({ queryKey: ['landing'], queryFn: fetchLandingContent });
  return <div className="hero" style={{ backgroundImage: data ? `url(${data.heroUrl})` : undefined }} />;
}
```

The browser can't request the image until JavaScript loads, the fetch completes, the component renders and styles are applied. Render it on the server as an `<img>`, with the URL in the HTML:

```tsx
// After: server-rendered (SSR, static generation or a Server Component)
function Hero({ hero }: { hero: HeroContent }) {
  return (
    <img
      className="hero__image"
      src={hero.src}
      srcSet={hero.srcSet}           // e.g. "/hero-640.avif 640w, /hero-1080.avif 1080w, /hero-1600.avif 1600w"
      sizes="(min-width: 1200px) 1200px, 100vw"
      width={1600}
      height={900}
      alt={hero.alt}
      fetchPriority="high"
      decoding="async"
    />
  );
}
```

If the image must stay a CSS background, or is chosen in JavaScript, preload it so the request starts with the HTML: `<link rel="preload" as="image" href=… imagesrcset=… imagesizes=… fetchpriority="high">`, or React 19's `preload(src, { as: 'image', imageSrcSet, imageSizes, fetchPriority: 'high' })`. The preload's `imagesrcset` and `imagesizes` must match the image's, or the browser downloads two files.

### Fix 2: priority, size and format

- **`fetchPriority="high"`** moves the hero ahead of the screenshots and logos competing for bandwidth.
- **No `loading="lazy"` on the hero.** Lazy images wait until layout confirms they're in the viewport, which delays the LCP.
- **`srcSet` with `w` descriptors and an accurate `sizes`** lets a phone pick the 640 px file instead of the 1600 px one. A `sizes` value that's too large (or missing, which means `100vw`) sends oversized files to desktop sidebars and cards.
- **AVIF or WebP** (through an image CDN, or `<picture>` with AVIF first, WebP second and a JPEG `<img>` fallback) often halves the bytes again.
- Oversized images also cost the device decode time and memory, not just bandwidth.

After these fixes, load delay drops to about 0.2 s and load duration to 0.5 s.

With `next/image`, the component handles `srcSet`, formats and sizes; you still mark the hero. On Next.js 16+, use `loading="eager"` or `fetchPriority="high"` (the `priority` prop is deprecated there; use it on Next.js 15 and earlier).

## Part 2: images that shift the layout

The feature grid's screenshots render without dimensions, so each one pushes the text below it down as it loads.

```tsx
<img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" decoding="async" />
```

```css
.feature img { width: 100%; height: auto; } /* keeps the aspect ratio from width/height */
```

- **`width` and `height` give the browser the aspect ratio** before the file arrives, so it reserves the right space even when CSS makes the image fluid. For images whose dimensions you don't know, use a container with `aspect-ratio`.
- **Lazy loading is right here**: the grid is below the fold.
- **A placeholder inside the reserved box** (a dominant color background, or a tiny blurred preview) avoids an empty rectangle without shifting anything.
- **Fixed-size images** such as avatars and logos don't need `sizes`; use density descriptors: `srcSet="/logo.png 1x, /logo@2x.png 2x"`.

## Part 3: fonts that move text

The brand font loads from a third-party stylesheet, and when it arrives, every heading and paragraph reflows: it's wider than the fallback.

### Self-host, preload one file, choose the display strategy

```html
<link rel="preload" href="/fonts/brand-sans-var.woff2" as="font" type="font/woff2" crossorigin />
```

```css
@font-face {
  font-family: 'Brand Sans';
  src: url('/fonts/brand-sans-var.woff2') format('woff2');
  font-weight: 300 800;   /* one variable file instead of five static weights */
  font-display: swap;     /* show text immediately in the fallback */
}
```

- **Self-hosting** removes the extra connection and the stylesheet-then-font request chain.
- **Preload only what the first screen uses**, here the one variable file. Fonts are always requested in CORS mode, so the preload needs `crossorigin` even for a same-origin file; without it, the preload is wasted and the font downloads twice.
- **`swap`** keeps text visible. For body text where a late swap is worse than the fallback, `optional` avoids the shift entirely.

### Make the fallback the same size

```css
@font-face {
  font-family: 'Brand Sans Fallback';
  src: local('Arial');
  size-adjust: 104%;
  ascent-override: 92%;
  descent-override: 24%;
  line-gap-override: 0%;
}

body {
  font-family: 'Brand Sans', 'Brand Sans Fallback', system-ui, sans-serif;
}
```

The values above are illustrative: generate the real ones for your font with Fontaine or Capsize, or let `next/font` do it. With the fallback scaled to the brand font's metrics, the swap changes letter shapes but barely moves lines, and CLS from fonts drops to almost zero. The `font-size-adjust` property can additionally match x-heights between the two.

In Next.js, `next/font` self-hosts, preloads and generates the adjusted fallback for you:

```tsx
import localFont from 'next/font/local';
const brandSans = localFont({ src: './brand-sans-var.woff2', display: 'swap', variable: '--font-brand' });
```

## Result

LCP went from 4.1 s to 1.9 s (discovery, priority, size), and CLS from 0.21 to 0.03 (image dimensions and fallback metrics), measured at the 75th percentile of mobile page loads over the following four weeks.
