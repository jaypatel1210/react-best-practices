import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { DemoShell, Meter, burn, type DemoMode } from './kit';
import './LayoutFlickerDemo.css';

type Placement = 'top' | 'bottom';
const GAP = 8;
const SLOW_MS = 300;

const TOOLS = [
  { id: 'copy', label: 'Copy link', tip: 'Link copied' },
  { id: 'share', label: 'Share', tip: 'Share with your team' },
  { id: 'export', label: 'Export', tip: 'Download as PDF' },
] as const;

interface TipProps {
  id: string;
  text: string;
  slow: boolean;
  onReport: (frames: number) => void;
}

/** Above the trigger when it fits inside the document box, otherwise below. */
function choosePlacement(tip: HTMLElement): Placement {
  const anchor = tip.parentElement!.getBoundingClientRect();
  const box = tip.closest('.lf-doc')!.getBoundingClientRect();
  const height = tip.getBoundingClientRect().height;
  return anchor.top - box.top >= height + GAP ? 'top' : 'bottom';
}

/**
 * Counts the animation frames the browser starts after the tooltip mounts and before its final
 * placement is committed. A requestAnimationFrame callback runs right before each frame is drawn,
 * so every callback that still sees no placement is a frame drawn with the tooltip in its default spot.
 */
function useFramesUntilPlaced(placed: boolean, onReport: (frames: number) => void) {
  const placedRef = useRef(placed);
  useLayoutEffect(() => {
    placedRef.current = placed;
  }, [placed]);

  useLayoutEffect(() => {
    let frames = 0;
    let id = requestAnimationFrame(function tick() {
      if (placedRef.current) return onReport(frames);
      frames += 1;
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [onReport]);
}

/** The issue: measure and adjust in useEffect, which usually runs after the browser has painted. */
function EffectTooltip({ id, text, slow, onReport }: TipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  useFramesUntilPlaced(placement !== null, onReport);

  useEffect(() => {
    const place = () => setPlacement(choosePlacement(ref.current!));
    if (!slow) {
      place();
      return;
    }
    const timer = window.setTimeout(place, SLOW_MS); // slow motion: the first frame stays up 300 ms
    return () => window.clearTimeout(timer);
  }, [slow]);

  return (
    <span ref={ref} id={id} role="tooltip" className="lf-tip" data-placement={placement ?? 'top'}>
      {text}
    </span>
  );
}

/** The fix: measure and adjust in useLayoutEffect, after the DOM update and before paint. */
function LayoutEffectTooltip({ id, text, slow, onReport }: TipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  useFramesUntilPlaced(placement !== null, onReport);

  useLayoutEffect(() => {
    if (slow) burn(SLOW_MS); // slow motion: the same 300 ms, spent before the browser can paint
    setPlacement(choosePlacement(ref.current!));
  }, [slow]);

  return (
    <span ref={ref} id={id} role="tooltip" className="lf-tip" data-placement={placement ?? 'top'}>
      {text}
    </span>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const [slow, setSlow] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [frames, setFrames] = useState<number | null>(null);
  const baseId = useId();
  const Tooltip = mode === 'issue' ? EffectTooltip : LayoutEffectTooltip;

  return (
    <>
      <div className="demo-row">
        <label className="lf-check">
          <input
            type="checkbox"
            checked={slow}
            onChange={(event) => {
              setSlow(event.target.checked);
              setOpenId(null);
              setFrames(null);
            }}
          />
          Slow motion: add {SLOW_MS} ms to the positioning step
        </label>
      </div>
      <div className="meters">
        <Meter
          label="Frames drawn before the tooltip was in place"
          initial={frames ?? '—'}
          tone={frames === null ? undefined : frames > 0 ? 'bad' : 'good'}
        />
      </div>
      <div className="lf-doc">
        <div className="lf-toolbar" role="group" aria-label="Document tools">
          {TOOLS.map((tool) => {
            const tipId = `${baseId}-${tool.id}`;
            const open = openId === tool.id;
            return (
              <span key={tool.id} className="lf-anchor">
                <button
                  type="button"
                  className="demo-btn"
                  aria-describedby={open ? tipId : undefined}
                  aria-pressed={open}
                  onClick={() => {
                    setFrames(null);
                    setOpenId(open ? null : tool.id);
                  }}
                >
                  {tool.label}
                </button>
                {open && <Tooltip id={tipId} text={tool.tip} slow={slow} onReport={setFrames} />}
              </span>
            );
          })}
        </div>
        <div className="lf-lines" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </>
  );
}

export default function LayoutFlickerDemo() {
  return (
    <DemoShell
      title="Open a tooltip that has to flip below its button"
      hint={`Click a toolbar button. Its tooltip prefers to sit above, but the toolbar is at the top edge of the document, so it has to flip below. Slow motion adds ${SLOW_MS} ms to the positioning step, standing in for a slow device. Untick it to see real speed.`}
      issueLabel="useEffect"
      fixLabel="useLayoutEffect"
      explain={{
        issue: (
          <>
            <code>useEffect</code> usually runs after the browser has painted, so the first frame shows the tooltip in its
            default spot above the button, and it jumps once the effect measures. At full speed the wrong frame is brief,
            and on a fast machine it may not appear at all.
          </>
        ),
        fix: (
          <>
            <code>useLayoutEffect</code> measures and moves the tooltip after React updates the DOM but before the
            browser paints, so no frame shows the default spot. In slow motion the click takes {SLOW_MS} ms longer to show
            anything: that’s the cost of blocking paint.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}
