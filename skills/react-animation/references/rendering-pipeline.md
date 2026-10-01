# The Browser Rendering Pipeline: Costs and Tools

## Contents

1. [Stages of a frame](#stages-of-a-frame)
2. [What each property triggers](#what-each-property-triggers)
3. [Layers and their cost](#layers-and-their-cost)
4. [Containment](#containment)
5. [Finding the cost in DevTools](#finding-the-cost-in-devtools)

## Stages of a frame

1. **JavaScript**: event handlers, timers, React rendering and commits, `requestAnimationFrame` callbacks.
2. **Style**: match selectors and compute styles for affected elements. Cost grows with the number of elements affected and the complexity of the selectors involved.
3. **Layout**: compute sizes and positions. A change can ripple to siblings and ancestors unless containment stops it.
4. **Paint**: record drawing commands for changed areas, then rasterize them into pixels.
5. **Composite**: assemble layers on the GPU, applying transforms and opacity.

A frame at 60 Hz has 16.7 ms for all of this, and 8.3 ms at 120 Hz, minus the browser's own overhead. A blocking task of N ms drops roughly N ÷ 16.7 frames at 60 Hz.

## What each property triggers

| Stage reached | Typical properties |
|---|---|
| Layout → paint → composite | `width`, `height`, `min-*`/`max-*`, `padding`, `margin`, `border-width`, `top`/`right`/`bottom`/`left`, `inset`, `display`, `position`, `float`, `font-*`, `line-height`, `letter-spacing`, `text-align`, `white-space`, `overflow`, flex and grid properties, adding or removing elements, changing text |
| Paint → composite | `color`, `background-*`, `border-color`, `border-style`, `border-radius`, `box-shadow`, `outline`, `text-decoration`, `visibility` |
| Composite only | `transform` (`translate`, `scale`, `rotate`), `opacity` |
| Depends on the browser | `filter`, `backdrop-filter`, `clip-path`, `mask`: may be composited, may repaint |

Composite-only changes skip layout and paint *when the element has its own layer*, which the browser arranges automatically for running `transform`/`opacity` animations.

Reading layout (`getBoundingClientRect()`, `offset*`, `client*`, `scroll*`, `getComputedStyle()`, `innerText`, `focus()`) after any change in the first two rows forces layout synchronously, in the middle of your script.

## Layers and their cost

- **What creates a layer:** running `transform`/`opacity` animations, `will-change: transform | opacity`, 3D transforms, `<video>` and `<canvas>`, `position: fixed` in some browsers, and overlapping another layer (the browser may promote an element just to keep paint order correct).
- **Memory:** about width × height × devicePixelRatio² × 4 bytes per layer. On phones, too many large layers cause checkerboarding, dropped frames or tab crashes.
- **Overlap promotion** can multiply layers: an animated element placed *under* many siblings can force each of them onto its own layer. Give the animated element a higher `z-index`, or isolate it.
- **Rasterization:** a layer is painted once and moved cheaply. Scaling a layer up can look blurry until it's re-rasterized at the new scale. Animate from small to large with care, or rasterize at the final size and scale down.

## Containment

| Value | Effect | Side effects |
|---|---|---|
| `contain: layout` | Layout inside doesn't affect outside | Containing block for positioned descendants; independent formatting context |
| `contain: paint` | Descendants don't paint outside the box; offscreen content skips painting | Clips overflow (menus, focus rings, shadows); containing block and stacking context |
| `contain: size` | Laid out as if empty | Needs an explicit size, or it collapses |
| `contain: inline-size` | Size containment on the inline axis only | Basis for container queries |
| `contain: style` | Counters and quotes stay inside | Rarely matters |
| `contain: content` | `layout paint style` | As above |
| `contain: strict` | `content` plus `size` | Needs an explicit size |
| `content-visibility: auto` | Skips style, layout and paint while offscreen | Always applies layout, style and paint containment; pair with `contain-intrinsic-size` (`react-large-lists`) |

A contained element without a fixed size still pushes its neighbors when its own size changes. Only size containment, or a fixed size, isolates it completely.

## Finding the cost in DevTools

**Chrome, Performance panel** (record with 4–6× CPU throttling):

- Purple *Recalculate Style* and *Layout*, green *Paint* and *Composite Layers* blocks show where frame time goes. Long purple blocks after your scripts mean style or layout work, not React rendering.
- *Forced reflow* warnings mark layout forced by JavaScript, with a link to the line that read layout.
- The *Layout Shifts* track shows CLS sources; the *Frames* track shows dropped and partially presented frames.
- React's performance tracks (development and profiling builds) show component render work in the same timeline (`react-rerenders/references/measuring.md`).

**Chrome, Rendering drawer** (⋮ → More tools → Rendering):

- *Paint flashing* highlights repainted areas. A whole page flashing during a small animation means it isn't composited.
- *Layout shift regions* highlights shifting content.
- *Layer borders* outlines composited layers.
- *Frame rendering stats* shows the frame rate live.

**Chrome, Layers panel**: every layer, why it was created ("compositing reasons"), and its memory estimate.

**Animations panel**: slows animations down, replays them and shows their timing, to see whether motion is smooth and where it starts.

Firefox's Performance panel (Firefox Profiler) and Safari's Timelines show the same stages under similar names.
