import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { DemoShell, type DemoMode } from './kit';
import './FlipDemo.css';

type Player = { id: string; name: string; score: number };
type Point = { x: number; y: number };

const INITIAL: Player[] = [
  { id: 'priya', name: 'Priya', score: 820 },
  { id: 'mateo', name: 'Mateo', score: 790 },
  { id: 'aiko', name: 'Aiko', score: 765 },
  { id: 'jonas', name: 'Jonas', score: 740 },
  { id: 'leila', name: 'Leila', score: 710 },
  { id: 'sam', name: 'Sam', score: 685 },
];

/** A small seeded generator, so every run of the demo shuffles the same way. */
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(reducedMotionQuery);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
}

/**
 * FLIP: after each commit, before paint, compare every [data-flip-key] element's position with the
 * one recorded after the previous commit, put moved elements back where they were with a
 * transform, then animate that transform to none.
 */
function useFlip(containerRef: RefObject<HTMLElement | null>, enabled: boolean, durationMs = 450) {
  const previous = useRef(new Map<string, Point>());

  // No dependency array: compare positions after every commit of the list's owner.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-flip-key]'));

    // Cancel our own running animations, so we measure the real layout, not a transformed one.
    for (const el of items) {
      for (const animation of el.getAnimations()) if (animation.id === 'flip') animation.cancel();
    }

    // Read pass: positions relative to the container, so page scrolling doesn't count as a move.
    const origin = container.getBoundingClientRect();
    const next = new Map<string, Point>();
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      next.set(el.dataset.flipKey!, { x: rect.left - origin.left, y: rect.top - origin.top });
    }

    // Write pass: invert each moved item, then play it back to its new place.
    if (enabled) {
      for (const el of items) {
        const key = el.dataset.flipKey!;
        const before = previous.current.get(key);
        const after = next.get(key)!;
        if (!before) continue;
        const dx = before.x - after.x;
        const dy = before.y - after.y;
        if (dx === 0 && dy === 0) continue;
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: durationMs,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
          id: 'flip',
        });
      }
    }

    previous.current = next;
  });
}

function Stage({ mode }: { mode: DemoMode }) {
  const [players, setPlayers] = useState(INITIAL);
  const [round, setRound] = useState(0);
  const [random] = useState(() => createRandom(7));
  const reducedMotion = usePrefersReducedMotion();
  const listRef = useRef<HTMLOListElement>(null);
  useFlip(listRef, mode === 'fix' && !reducedMotion);

  const ranked = [...players].sort((a, b) => b.score - a.score);

  const shuffle = () => {
    // Random numbers are drawn here, in the event handler, so state updates stay pure.
    const gains = players.map(() => Math.round(random() * 90));
    setPlayers(players.map((player, i) => ({ ...player, score: player.score + gains[i] })));
    setRound((n) => n + 1);
  };

  return (
    <>
      <div className="demo-row">
        <button type="button" className="demo-btn demo-btn-primary" onClick={shuffle}>
          Shuffle scores
        </button>
        <span className="fl-round">Round {round}</span>
      </div>
      <ol ref={listRef} className="fl-board" aria-label="Leaderboard">
        {ranked.map((player, i) => (
          <li key={player.id} data-flip-key={player.id} className="fl-row">
            <span className="fl-rank">{i + 1}</span>
            <span className="fl-avatar" aria-hidden="true">
              {player.name[0]}
            </span>
            <span className="fl-name">{player.name}</span>
            <span className="fl-score">{player.score}</span>
          </li>
        ))}
      </ol>
      {reducedMotion && (
        <p className="fl-note">Your system asks for reduced motion, so the fix skips the animation and rows move instantly.</p>
      )}
    </>
  );
}

export default function FlipDemo() {
  return (
    <DemoShell
      title="Re-sort a leaderboard and try to follow one player"
      hint="Press “Shuffle scores” a few times and try to follow one player, then switch to the fix and do the same. Both versions key the rows by player ID; only the fix animates the move."
      issueLabel="Instant re-sort"
      fixLabel="FLIP animation"
      explain={{
        issue: (
          <>
            React moves the existing row elements to their new places in one commit. No CSS property changes, so there’s
            nothing for a transition to animate, and the rows jump.
          </>
        ),
        fix: (
          <>
            A FLIP hook measures every row after React’s commit in <code>useLayoutEffect</code>, offsets each moved row
            back to its old position before paint, and plays the offset to zero with the Web Animations API.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}
