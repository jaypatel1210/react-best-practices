/*
 * Timing collector for `render-audit bench`.
 *
 * The runner injects this before the page's own scripts instead of the render tracker, so the
 * app runs without per-render instrumentation. For each scenario step it collects:
 *
 *   interactions  Event Timing entries grouped by interactionId: the step's slowest response
 *                 (the way INP measures one), split into input delay, processing and
 *                 presentation delay
 *   long tasks    tasks over 50 ms, for total blocking time
 *   long frames   Long Animation Frames (over 50 ms), with the scripts that ran in the worst one
 *   frame pacing  requestAnimationFrame timestamps while the step runs, for dropped frames
 *   React         commits and render time (actualDuration, development builds) from a minimal
 *                 DevTools hook that does constant work per commit; the first commit of each
 *                 root (the initial render or hydration) is also counted on its own, so later
 *                 commits are the re-render work
 *
 * Everything is read through window.__RA_VITALS__. Nothing in here may throw into the app.
 */
(() => {
  'use strict';

  const g = globalThis;
  try {
    if (typeof window !== 'undefined' && window.top !== window) return; // main frame only
  } catch {
    return;
  }
  if (g.__RA_VITALS__) return;

  const VERSION = 1;
  const MAX_ENTRIES = 5000;
  const MAX_FRAMES = 20000;
  // Event Timing reports durations rounded to 8 ms; entries of one interaction that end within
  // this distance of the slowest one were presented in the same frame.
  const SAME_FRAME_MS = 8;

  const now = () => performance.now();
  const round = (n) => Math.round(n * 100) / 100;
  const installedAt = now();

  const errors = [];
  function recordError(where, error) {
    if (errors.length < 20) errors.push(`${where}: ${(error && error.message) || error}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Performance entries, kept compact and assigned to steps by start time

  const events = [];
  const longFrames = [];
  const longTasks = [];
  const observers = [];
  const supported = (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];

  function describe(el) {
    try {
      if (!el || el.nodeType !== 1) return '';
      let text = el.tagName.toLowerCase();
      if (el.id) text += `#${el.id}`;
      const label = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('data-testid');
      if (label) text += `[${label.slice(0, 60)}]`;
      else if (typeof el.className === 'string' && el.className.trim()) text += `.${el.className.trim().split(/\s+/)[0]}`;
      return text.slice(0, 100);
    } catch {
      return '';
    }
  }

  function observe(type, options, onEntry) {
    if (!supported.includes(type)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          try {
            onEntry(entry);
          } catch (error) {
            recordError(type, error);
          }
        }
      });
      observer.observe({ type, buffered: true, ...options });
      observers.push({ observer, onEntry });
    } catch (error) {
      recordError(`observe ${type}`, error);
    }
  }

  function flush() {
    for (const { observer, onEntry } of observers) {
      try {
        for (const entry of observer.takeRecords()) onEntry(entry);
      } catch (error) {
        recordError('takeRecords', error);
      }
    }
  }

  observe('event', { durationThreshold: 16 }, (entry) => {
    if (!entry.interactionId || events.length >= MAX_ENTRIES) return;
    events.push({
      id: entry.interactionId,
      name: entry.name,
      start: entry.startTime,
      duration: entry.duration,
      processingStart: entry.processingStart,
      processingEnd: entry.processingEnd,
      target: describe(entry.target),
    });
  });

  observe('long-animation-frame', {}, (entry) => {
    if (longFrames.length >= MAX_ENTRIES) return;
    const scripts = Array.from(entry.scripts || [])
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3)
      .map((script) => ({
        source: String(script.sourceURL || '').slice(0, 200),
        fn: String(script.sourceFunctionName || ''),
        invoker: String(script.invoker || '').slice(0, 120),
        ms: round(script.duration),
      }));
    longFrames.push({ start: entry.startTime, duration: entry.duration, blocking: entry.blockingDuration || 0, scripts });
  });

  observe('longtask', {}, (entry) => {
    if (longTasks.length < MAX_ENTRIES) longTasks.push({ start: entry.startTime, duration: entry.duration });
  });

  // ---------------------------------------------------------------------------------------------
  // Frame pacing: one requestAnimationFrame callback per frame while a step runs

  let sampling = false;
  let loop = 0;
  let frameTimes = [];

  function startFrames() {
    frameTimes = [];
    sampling = true;
    if (typeof requestAnimationFrame !== 'function') return;
    const token = ++loop;
    const tick = (ts) => {
      if (!sampling || token !== loop) return;
      if (frameTimes.length < MAX_FRAMES) frameTimes.push(ts);
      requestAnimationFrame(tick);
    };
    try {
      requestAnimationFrame(tick);
    } catch (error) {
      recordError('raf', error);
    }
  }

  function stopFrames() {
    sampling = false;
    loop++;
    return frameTimes;
  }

  // A gap of k frame intervals between callbacks means k - 1 frames were missed. The interval is
  // the lower quartile of the observed gaps (most frames are on time), so 60 Hz and 120 Hz work.
  function pacing(times, activeEnd) {
    if (times.length < 3) return { produced: times.length, dropped: 0, smoothness: null, vsync: null };
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const sorted = gaps.slice().sort((a, b) => a - b);
    const vsync = Math.min(40, Math.max(6, sorted[Math.floor(sorted.length / 4)]));
    let dropped = 0;
    let activeFrames = 0;
    let activeDropped = 0;
    for (let i = 0; i < gaps.length; i++) {
      const missed = Math.max(0, Math.round(gaps[i] / vsync) - 1);
      dropped += missed;
      if (times[i + 1] <= activeEnd) {
        activeFrames++;
        activeDropped += missed;
      }
    }
    // Smoothness covers the part of the step where something happened, so the quiet time the
    // runner waits for at the end of every step doesn't dilute it.
    const smoothness = activeFrames ? round((activeFrames / (activeFrames + activeDropped)) * 100) : null;
    return { produced: times.length, dropped, smoothness, vsync: round(vsync) };
  }

  // ---------------------------------------------------------------------------------------------
  // React DevTools hook: commit count and render time only

  const HOOK = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
  const renderers = [];
  const roots = typeof WeakSet === 'function' ? new WeakSet() : null;
  let lastCommitAt = 0;
  let totalCommits = 0;
  let step = null;

  let hook = g[HOOK];
  const hookMode = hook ? 'wrapped' : 'installed';
  if (!hook) {
    let nextRendererId = 0;
    hook = {
      renderers: new Map(),
      supportsFiber: true,
      inject(renderer) {
        nextRendererId += 1;
        hook.renderers.set(nextRendererId, renderer);
        return nextRendererId;
      },
      onCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onScheduleFiberRoot() {},
      checkDCE() {},
    };
    try {
      Object.defineProperty(g, HOOK, { value: hook, configurable: true, writable: true, enumerable: false });
    } catch {
      g[HOOK] = hook;
    }
  }

  const originalInject = hook.inject;
  hook.inject = function inject(renderer) {
    const id = originalInject.apply(this, arguments);
    try {
      renderers.push({ id, version: (renderer && renderer.version) || null, bundleType: renderer ? renderer.bundleType : null });
    } catch (error) {
      recordError('inject', error);
    }
    return id;
  };

  const originalCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function onCommitFiberRoot(rendererId, root) {
    try {
      const fiber = root && root.current;
      const ms = fiber && typeof fiber.actualDuration === 'number' ? fiber.actualDuration : 0;
      const first = !!roots && !!root && typeof root === 'object' && !roots.has(root);
      if (first) roots.add(root);
      lastCommitAt = now();
      totalCommits++;
      if (step) {
        step.commits++;
        step.renderMs += ms;
        if (first) step.firstRenderMs += ms;
        step.lastCommitAt = lastCommitAt;
      }
    } catch (error) {
      recordError('commit', error);
    }
    if (typeof originalCommit === 'function') return originalCommit.apply(this, arguments);
    return undefined;
  };

  // ---------------------------------------------------------------------------------------------
  // Steps

  function newStep(index, name, start) {
    return { index, name, start, commits: 0, renderMs: 0, firstRenderMs: 0, lastCommitAt: 0 };
  }

  // Each step appears by name in DevTools' Timings track when a trace is opened.
  function markStep(current, endAt) {
    try {
      if (typeof performance.measure === 'function') performance.measure(`render-audit ${current.index}: ${current.name}`, { start: current.start, end: endAt });
    } catch (error) {
      recordError('measure', error);
    }
  }

  function interactionsIn(start, end) {
    const byId = new Map();
    for (const entry of events) {
      if (entry.start < start || entry.start > end) continue;
      const group = byId.get(entry.id);
      if (group) group.push(entry);
      else byId.set(entry.id, [entry]);
    }
    const out = [];
    for (const [id, group] of byId) {
      let longest = group[0];
      for (const entry of group) if (entry.duration > longest.duration) longest = entry;
      const presentedAt = longest.start + longest.duration;
      const sameFrame = group.filter((entry) => Math.abs(entry.start + entry.duration - presentedAt) <= SAME_FRAME_MS);
      const processingEnd = Math.max(...sameFrame.map((entry) => entry.processingEnd));
      const inputDelay = Math.max(0, longest.processingStart - longest.start);
      const processing = Math.max(0, processingEnd - longest.processingStart);
      out.push({
        id,
        type: group.some((entry) => entry.name.startsWith('key')) ? 'keyboard' : 'pointer',
        event: longest.name,
        at: round(longest.start - start),
        duration: longest.duration,
        inputDelay: round(inputDelay),
        processing: round(processing),
        presentation: round(Math.max(0, longest.duration - inputDelay - processing)),
        target: longest.target || (group.find((entry) => entry.target) || {}).target || '',
      });
    }
    return out.sort((a, b) => b.duration - a.duration);
  }

  function end() {
    flush();
    const current = step;
    const times = stopFrames();
    step = null;
    if (!current) return null;
    const endAt = now();
    markStep(current, endAt);
    const within = (t) => t >= current.start && t <= endAt;

    const interactions = interactionsIn(current.start, endAt);
    const tasks = longTasks.filter((task) => within(task.start));
    const frames = longFrames.filter((frame) => within(frame.start));
    let worstFrame = null;
    for (const frame of frames) if (!worstFrame || frame.duration > worstFrame.duration) worstFrame = frame;

    // The end of the last thing that happened: an interaction's paint, a long task or frame, or
    // a React commit.
    let activeEnd = current.start;
    for (const item of interactions) activeEnd = Math.max(activeEnd, current.start + item.at + item.duration);
    for (const task of tasks) activeEnd = Math.max(activeEnd, task.start + task.duration);
    for (const frame of frames) activeEnd = Math.max(activeEnd, frame.start + frame.duration);
    if (current.lastCommitAt) activeEnd = Math.max(activeEnd, current.lastCommitAt);

    const worst = interactions[0] || null;
    return {
      index: current.index,
      name: current.name,
      start: round(current.start),
      durationMs: round(endAt - current.start),
      activeMs: round(activeEnd - current.start),
      inp: worst ? worst.duration : null,
      interactions: { count: interactions.length, worst, slowest: interactions.slice(0, 5) },
      tbt: round(tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
      longTasks: tasks.length,
      longFrames: {
        count: frames.length,
        maxMs: worstFrame ? round(worstFrame.duration) : 0,
        blockingMs: round(frames.reduce((sum, frame) => sum + frame.blocking, 0)),
        scripts: worstFrame ? worstFrame.scripts : [],
      },
      frames: pacing(times, activeEnd),
      react: { commits: current.commits, renderMs: round(current.renderMs), firstRenderMs: round(current.firstRenderMs) },
    };
  }

  // The page load is step 0 and starts at navigation start.
  step = newStep(0, 'load', 0);
  startFrames();

  g.__RA_VITALS__ = {
    version: VERSION,
    /** Starts a step (the previous one must have been ended); returns its start time. */
    begin(index, name) {
      flush();
      step = newStep(index, name, now());
      startFrames();
      return round(step.start);
    },
    /** Ends the current step and returns its timings. */
    end,
    idleMs() {
      return now() - (lastCommitAt || installedAt);
    },
    status() {
      return {
        version: VERSION,
        hook: hookMode,
        renderers,
        commits: totalCommits,
        supported: {
          event: supported.includes('event'),
          longAnimationFrame: supported.includes('long-animation-frame'),
          longtask: supported.includes('longtask'),
        },
        errors: errors.slice(),
      };
    },
  };
})();
