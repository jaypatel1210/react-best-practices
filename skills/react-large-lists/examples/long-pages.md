# Example: A Long Settings Page

An organization settings page has 40 sections (members, roles, billing, integrations, audit options, webhooks…). Each section renders forms, tables and previews. Everything must be reachable by anchor links and searchable with find-in-page, so virtualization is a poor fit. The page takes 900 ms of style and layout work on load, and scrolling stutters.

## Step 1: let the browser skip offscreen sections

```tsx
function SettingsPage({ sections }: { sections: SettingsSectionConfig[] }) {
  return (
    <main className="settings">
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="settings-section" aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          <section.Component />
        </section>
      ))}
    </main>
  );
}
```

```css
.settings-section {
  content-visibility: auto;
  contain-intrinsic-size: auto 720px; /* roughly the average section height */
}
```

- The browser now does style, layout and paint only for sections near the viewport. React still renders every section, so this saves browser rendering work, not component work.
- **`contain-intrinsic-size: auto 720px`** reserves an estimated height for sections that haven't rendered yet. `auto` remembers each section's real height once it has rendered, so scrolling back up is stable.
- Anchor links (`#webhooks`), find-in-page (in most browsers) and the accessibility tree still see all the content, because the DOM is all there.

Measure the change in the Performance panel: compare *Recalculate Style* and *Layout* time on load and while scrolling. The DOM node count stays the same, which is expected.

## Step 2: fix what containment broke

Two bugs appear right after the change.

**A role picker's dropdown is cut off at the section's edge.** `content-visibility: auto` always applies paint containment, so nothing paints outside the section box. Render the dropdown through a portal or the native top layer (`react-layout-portals`), which is also the right fix for overflow and z-index problems in general.

**A "fixed" save bar inside a section scrolls with the section.** Paint and layout containment make the section the containing block for `position: fixed` descendants. Move the save bar outside the contained sections, or portal it.

**The scrollbar jumps on first scroll.** The estimate is far from the real heights for some sections (the members table is 3,000 px tall). Give outliers their own estimate:

```css
.settings-section[data-size='tall'] { contain-intrinsic-size: auto 2400px; }
```

## Step 3: mount the heaviest parts only on approach

The integrations section embeds live previews (iframes) and a usage chart. Even with `content-visibility`, they still load and run their scripts on page load.

```tsx
function UsageChartSection() {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: '400px 0px', once: true });
  return (
    <div ref={ref} style={{ minHeight: 320 }}>
      {inView ? <UsageChart /> : <ChartPlaceholder />}
    </div>
  );
}

function IntegrationPreview({ src, title }: { src: string; title: string }) {
  return <iframe src={src} title={title} loading="lazy" width={640} height={360} />;
}
```

- **Plain iframes and images use `loading="lazy"`**, the browser's built-in version of the same idea. Keep their `width` and `height` so the layout doesn't shift.
- **Components with JavaScript cost** (charts, editors, maps) mount with `useInView` and `once: true`, inside a box with a reserved `minHeight`.
- **Code-split them too** if they're heavy, so their code also loads on approach (`react-loading-performance`).

## Step 4: pause work in skipped sections

A section with a live webhook log polls every five seconds, even while it's thousands of pixels away. `content-visibility` fires an event when the browser starts or stops skipping a section:

```tsx
function useSkippedByBrowser<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = (e: Event) => setSkipped((e as ContentVisibilityAutoStateChangeEvent).skipped);
    el.addEventListener('contentvisibilityautostatechange', onChange);
    return () => el.removeEventListener('contentvisibilityautostatechange', onChange);
  }, [ref]);
  return skipped;
}

// In the webhook log: poll only while the browser is rendering the section
const skipped = useSkippedByBrowser(sectionRef);
useQuery({ queryKey: ['webhook-log', orgId], queryFn: fetchWebhookLog, refetchInterval: skipped ? false : 5000 });
```

The event fires on the element that has `content-visibility: auto`, so attach the ref to the section itself.

## When this approach stops being enough

- **Hundreds of sections, or thousands of list items:** React still renders and mounts all of them, and the DOM stays large. Switch to virtualization or pagination (`examples/virtualized-table.md`).
- **Sections that change often** while offscreen still cost React renders. Keep their state local, or pause their updates as in Step 4.
