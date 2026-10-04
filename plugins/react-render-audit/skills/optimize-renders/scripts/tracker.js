/*
 * Render tracker for react-render-audit.
 *
 * The runner injects this file into the page before any other script runs. It installs React's
 * DevTools global hook (or wraps one that already exists), so React reports every commit here.
 * For each commit it records which components rendered and why:
 *
 *   mount            first render of an instance
 *   state            its own useState/useReducer/useSyncExternalStore (or class state) changed
 *   context          a context it reads changed value
 *   props            a prop changed value
 *   contextUnstable  a context it reads is a new object/function with the same content   (wasted)
 *   propsUnstable    only props that are new objects/functions/JSX with the same content (wasted)
 *   parent           its parent re-rendered and every prop is equal                      (wasted)
 *   self             it rendered on its own and no cause was detected (forced update, etc.)
 *
 * Results are grouped into steps that the runner opens and closes around each scenario action.
 * Everything is read through window.__RENDER_AUDIT__. Nothing in here may throw into the app.
 */
(() => {
  'use strict';

  const g = globalThis;
  try {
    if (typeof window !== 'undefined' && window.top !== window) return; // main frame only
  } catch {
    return;
  }
  if (g.__RENDER_AUDIT__) return;

  const VERSION = 1;
  const PERFORMED_WORK = 1;
  // A commit this soon after the previous one, started by a component that rendered in it, is
  // almost always a setState inside a layout or passive effect.
  const CASCADE_WINDOW_MS = 30;
  const MAX_COMMIT_LOG = 400;
  const MAX_ERRORS = 20;

  const TAG = {
    Function: 0,
    Class: 1,
    Indeterminate: 2,
    HostRoot: 3,
    ContextConsumer: 9,
    ContextProvider: 10,
    ForwardRef: 11,
    Memo: 14,
    SimpleMemo: 15,
  };
  // Memo (14) is a wrapper whose child does the rendering, so it isn't counted itself.
  const COMPOSITE = new Set([TAG.Function, TAG.Class, TAG.Indeterminate, TAG.ForwardRef, TAG.SimpleMemo]);
  const ELEMENT = new Set([Symbol.for('react.element'), Symbol.for('react.transitional.element')]);
  const KIND_LABEL = { state: 'useState', reducer: 'useReducer', store: 'useSyncExternalStore' };

  const now = () => performance.now();
  const round = (n) => Math.round(n * 100) / 100;
  const hasOwn = Object.prototype.hasOwnProperty;

  const errors = [];
  function recordError(where, error) {
    if (errors.length < MAX_ERRORS) errors.push(`${where}: ${(error && error.message) || error}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Component types and instances

  const typeIds = new WeakMap(); // component function/class/forwardRef object -> id
  const typeInfo = []; // id -> { id, name, kind, memo, compiled }
  const typeRefs = []; // id -> the function whose source location identifies the component
  const instanceIds = new WeakMap(); // fiber (and its alternate) -> instance id
  let nextInstanceId = 1;

  function displayName(fiber) {
    const type = fiber.type;
    const elementType = fiber.elementType;
    if (elementType && typeof elementType === 'object' && elementType.displayName) return elementType.displayName;
    if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
    if (type && typeof type === 'object') {
      if (type.displayName) return type.displayName;
      const inner = type.render || type.type;
      if (typeof inner === 'function') return inner.displayName || inner.name || 'Anonymous';
    }
    return 'Anonymous';
  }

  function kindOf(fiber) {
    if (fiber.tag === TAG.Class) return 'class';
    if (fiber.tag === TAG.ForwardRef) return 'forwardRef';
    return 'function';
  }

  function isMemoWrapped(fiber) {
    if (fiber.tag === TAG.SimpleMemo) return true;
    const parent = fiber.return;
    return !!parent && parent.tag === TAG.Memo;
  }

  // React Compiler output calls useMemoCache, which keeps its cache on the fiber's update queue.
  function isCompiled(fiber) {
    const queue = fiber.updateQueue;
    return !!(queue && typeof queue === 'object' && queue.memoCache);
  }

  function typeIdOf(fiber) {
    const key = fiber.type;
    if (key == null || (typeof key !== 'object' && typeof key !== 'function')) return -1;
    let id = typeIds.get(key);
    if (id === undefined) {
      id = typeInfo.length;
      typeIds.set(key, id);
      typeInfo.push({ id, name: displayName(fiber), kind: kindOf(fiber), memo: false, compiled: false });
      typeRefs.push(fiber.tag === TAG.ForwardRef ? key.render || null : key);
    }
    const info = typeInfo[id];
    if (!info.memo && isMemoWrapped(fiber)) info.memo = true;
    if (!info.compiled && isCompiled(fiber)) info.compiled = true;
    return id;
  }

  function instanceIdOf(fiber) {
    let id = instanceIds.get(fiber);
    if (id === undefined && fiber.alternate) id = instanceIds.get(fiber.alternate);
    if (id === undefined) id = nextInstanceId++;
    instanceIds.set(fiber, id);
    if (fiber.alternate) instanceIds.set(fiber.alternate, id);
    return id;
  }

  // The component that created this element (development builds record it as _debugOwner); the
  // nearest component above it otherwise. It's where the props a memo fix needs are written.
  function ownerIdOf(fiber, parentId) {
    const owner = fiber._debugOwner;
    if (owner && typeof owner === 'object' && typeof owner.tag === 'number' && COMPOSITE.has(owner.tag)) return typeIdOf(owner);
    return parentId;
  }

  // ---------------------------------------------------------------------------------------------
  // Value comparison

  function isElement(value) {
    return !!value && typeof value === 'object' && ELEMENT.has(value.$$typeof);
  }

  function isElementLike(value) {
    if (isElement(value)) return true;
    return Array.isArray(value) && value.length > 0 && value.some(isElementLike);
  }

  // Structural equality that treats any two functions as equal: the question is whether only
  // identities changed, which is what breaks memo and effect dependencies.
  function sameContent(a, b, depth, budget) {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'function') return true;
    if (!a || !b || typeof a !== 'object') return false;
    if (depth > 5 || budget.left-- <= 0) return false;
    if (isElement(a) || isElement(b)) {
      return isElement(a) && isElement(b) && a.type === b.type && a.key === b.key && sameContent(a.props, b.props, depth + 1, budget);
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (a instanceof Date || b instanceof Date) {
      return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    if (a instanceof Map || a instanceof Set || b instanceof Map || b instanceof Set) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!hasOwn.call(b, key)) return false;
      if (!sameContent(a[key], b[key], depth + 1, budget)) return false;
    }
    return true;
  }

  // How a value that is no longer Object.is-equal changed: 'fn' (new function), 'element' (new
  // JSX), 'sameContent' (new object or array with equal content) or 'changed' (a real change).
  function changeKind(a, b) {
    try {
      if (typeof a === 'function' && typeof b === 'function') return 'fn';
      if (isElementLike(a) && isElementLike(b)) return 'element';
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        return sameContent(a, b, 0, { left: 400 }) ? 'sameContent' : 'changed';
      }
    } catch (error) {
      recordError('compare', error);
    }
    return 'changed';
  }

  function preview(value) {
    try {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      const type = typeof value;
      if (type === 'string') return JSON.stringify(value.length > 24 ? `${value.slice(0, 24)}…` : value);
      if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
      if (type === 'function') return 'fn';
      if (type === 'symbol') return 'symbol';
      if (Array.isArray(value)) return `Array(${value.length})`;
      if (isElement(value)) return '<element>';
      if (value instanceof Date) return 'Date';
      if (value instanceof Map) return `Map(${value.size})`;
      if (value instanceof Set) return `Set(${value.size})`;
      const keys = Object.keys(value);
      return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}}`;
    } catch {
      return '?';
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Why a component rendered

  function isHookNode(node) {
    return !!node && typeof node === 'object' && 'memoizedState' in node && 'next' in node && 'queue' in node;
  }

  function hookKind(node) {
    const queue = node.queue;
    if (!queue || typeof queue !== 'object') return null;
    if (typeof queue.getSnapshot === 'function') return 'store';
    if (typeof queue.dispatch === 'function' || 'lastRenderedReducer' in queue) {
      const reducer = queue.lastRenderedReducer;
      return reducer && reducer.name === 'basicStateReducer' ? 'state' : 'reducer';
    }
    return null;
  }

  // Changed state hooks, labelled by call order among hooks of the same kind ("useState #2" is the
  // second useState called while rendering the component, counting calls inside custom hooks).
  function hookChanges(next, prev) {
    const changes = [];
    let a = prev.memoizedState;
    let b = next.memoizedState;
    if (!isHookNode(a) || !isHookNode(b)) return changes;
    const seen = {};
    for (let index = 0; a && b && index < 500; index++) {
      const kind = hookKind(b);
      if (kind) {
        seen[kind] = (seen[kind] || 0) + 1;
        if (!Object.is(a.memoizedState, b.memoizedState)) {
          changes.push({
            label: `${KIND_LABEL[kind]} #${seen[kind]}`,
            sample: `${preview(a.memoizedState)} → ${preview(b.memoizedState)}`,
          });
        }
      }
      a = a.next;
      b = b.next;
    }
    return changes;
  }

  function classStateChanges(next, prev) {
    const before = prev.memoizedState;
    const after = next.memoizedState;
    if (before === after) return [];
    let keys = [];
    try {
      if (before && after && typeof before === 'object' && typeof after === 'object') {
        keys = Object.keys(after).filter((key) => !Object.is(before[key], after[key]));
      }
    } catch {
      keys = [];
    }
    return [{ label: keys.length ? `this.state (${keys.slice(0, 4).join(', ')})` : 'this.state', sample: '' }];
  }

  function contextName(context) {
    if (!context) return 'Context';
    return context.displayName || (context.Provider && context.Provider.displayName) || 'Context';
  }

  // The component that renders the nearest provider of `context` above `fiber`.
  function providerOwner(fiber, context, cache) {
    if (cache.has(context)) return cache.get(context);
    let owner = null;
    for (let node = fiber.return; node; node = node.return) {
      const type = node.type;
      if (node.tag === TAG.ContextProvider && (type === context || (type && type._context === context))) {
        for (let up = node.return; up; up = up.return) {
          if (COMPOSITE.has(up.tag)) {
            owner = displayName(up);
            break;
          }
        }
        break;
      }
    }
    cache.set(context, owner);
    return owner;
  }

  function contextChanges(next, prev, commit) {
    const nextDeps = next.dependencies;
    const prevDeps = prev.dependencies;
    if (!nextDeps || !prevDeps || !nextDeps.firstContext) return [];
    const before = new Map();
    for (let dep = prevDeps.firstContext; dep; dep = dep.next) before.set(dep.context, dep.memoizedValue);
    const changes = [];
    for (let dep = nextDeps.firstContext; dep; dep = dep.next) {
      if (!before.has(dep.context)) continue;
      const previous = before.get(dep.context);
      if (Object.is(previous, dep.memoizedValue)) continue;
      changes.push({
        name: contextName(dep.context),
        kind: changeKind(previous, dep.memoizedValue) === 'changed' ? 'changed' : 'unstable',
        provider: providerOwner(next, dep.context, commit.providers),
      });
    }
    return changes;
  }

  function propChanges(before, after) {
    const changes = [];
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return changes;
    for (const key of Object.keys(after)) {
      if (!hasOwn.call(before, key)) changes.push({ key, kind: 'changed' });
      else if (!Object.is(before[key], after[key])) changes.push({ key, kind: changeKind(before[key], after[key]) });
    }
    for (const key of Object.keys(before)) {
      if (!hasOwn.call(after, key)) changes.push({ key, kind: 'changed' });
    }
    return changes;
  }

  // ---------------------------------------------------------------------------------------------
  // Steps

  let current = null;
  let lastCommitAt = 0;
  let totalCommits = 0;
  let previousCommit = null;
  let lastInputAt = -1;
  const installedAt = now();

  // A commit that follows user input is a new interaction, not an effect cascade.
  if (typeof window !== 'undefined' && window.addEventListener) {
    for (const type of ['keydown', 'pointerdown', 'mousedown', 'click', 'input', 'change', 'wheel', 'touchstart']) {
      window.addEventListener(type, () => {
        lastInputAt = now();
      }, { capture: true, passive: true });
    }
  }

  function newStep(name) {
    return {
      name,
      startedAt: now(),
      endedAt: 0,
      commits: 0,
      renders: 0,
      mounts: 0,
      unmounts: 0,
      wasted: 0,
      cascadeCommits: 0,
      renderMs: 0,
      byType: new Map(),
      sources: new Map(),
      commitLog: [],
    };
  }

  function statsFor(step, id) {
    let stats = step.byType.get(id);
    if (!stats) {
      stats = {
        renders: 0,
        mounts: 0,
        unmounts: 0,
        remounts: 0,
        identityChurn: 0,
        wasted: 0,
        reasons: { state: 0, context: 0, props: 0, contextUnstable: 0, propsUnstable: 0, parent: 0, self: 0 },
        props: {},
        hooks: {},
        contexts: {},
        selfMs: 0,
        maxSelfMs: 0,
        instances: new Set(),
        maxPerCommit: 0,
        causedBy: {},
        owners: {},
        cascades: 0,
      };
      step.byType.set(id, stats);
    }
    return stats;
  }

  function sourceFor(step, id) {
    let source = step.sources.get(id);
    if (!source) {
      source = { triggers: 0, renders: 0, wasted: 0, mounts: 0 };
      step.sources.set(id, source);
    }
    return source;
  }

  // ---------------------------------------------------------------------------------------------
  // Commit traversal

  function addRender(stats, fiber, commit, id, parentId) {
    stats.renders++;
    const owner = ownerIdOf(fiber, parentId);
    if (owner >= 0 && owner !== id) stats.owners[owner] = (stats.owners[owner] || 0) + 1;
    stats.instances.add(instanceIdOf(fiber));
    commit.renders++;
    commit.rendered.add(id);
    commit.perType.set(id, (commit.perType.get(id) || 0) + 1);
    const self = fiber.selfBaseDuration;
    if (typeof self === 'number' && self >= 0) {
      stats.selfMs += self;
      if (self > stats.maxSelfMs) stats.maxSelfMs = self;
    }
  }

  function recordMount(fiber, commit, source, parentId) {
    const id = typeIdOf(fiber);
    if (id < 0) return;
    const stats = statsFor(commit.step, id);
    addRender(stats, fiber, commit, id, parentId);
    stats.mounts++;
    commit.step.mounts++;
    commit.mounted.set(id, (commit.mounted.get(id) || 0) + 1);
    if (source >= 0) {
      const cause = sourceFor(commit.step, source);
      cause.renders++;
      cause.mounts++;
      if (source !== id) stats.causedBy[source] = (stats.causedBy[source] || 0) + 1;
    }
  }

  // Returns the type id this component's subtree should be attributed to.
  function recordUpdate(next, prev, commit, source, parentId) {
    const id = typeIdOf(next);
    if (id < 0) return source;
    const stats = statsFor(commit.step, id);
    addRender(stats, next, commit, id, parentId);

    const hooks = next.tag === TAG.Class ? classStateChanges(next, prev) : hookChanges(next, prev);
    const contexts = contextChanges(next, prev, commit);
    const props = next.memoizedProps === prev.memoizedProps ? null : propChanges(prev.memoizedProps, next.memoizedProps);

    let reason;
    if (hooks.length) reason = 'state';
    else if (contexts.some((change) => change.kind === 'changed')) reason = 'context';
    else if (props && props.some((change) => change.kind === 'changed')) reason = 'props';
    else if (contexts.length) reason = 'contextUnstable';
    else if (props && props.length) reason = 'propsUnstable';
    else if (props) reason = 'parent';
    else reason = 'self';
    stats.reasons[reason]++;

    const wasted = reason === 'parent' || reason === 'propsUnstable' || reason === 'contextUnstable';
    if (wasted) {
      stats.wasted++;
      commit.step.wasted++;
      commit.wasted++;
    }

    for (const hook of hooks) {
      const entry = stats.hooks[hook.label] || (stats.hooks[hook.label] = { count: 0, sample: hook.sample });
      entry.count++;
    }
    for (const change of contexts) {
      const entry = stats.contexts[change.name] || (stats.contexts[change.name] = { changed: 0, unstable: 0, provider: change.provider });
      entry[change.kind]++;
    }
    if (props) {
      for (const change of props) {
        const entry = stats.props[change.key] || (stats.props[change.key] = { changed: 0, fn: 0, sameContent: 0, element: 0 });
        entry[change.kind]++;
      }
    }

    // A component whose own state or context changed starts a new cascade for its subtree.
    const startsCascade = reason === 'state' || reason === 'context' || reason === 'contextUnstable' || reason === 'self';
    const cause = startsCascade ? id : source;
    if (startsCascade) commit.sources.add(id);
    if (cause >= 0) {
      const entry = sourceFor(commit.step, cause);
      entry.renders++;
      if (wasted) entry.wasted++;
      if (cause !== id) stats.causedBy[cause] = (stats.causedBy[cause] || 0) + 1;
    }
    return cause;
  }

  function recordUnmountTree(fiber, commit) {
    // Iterative, because deleted subtrees can be deep.
    const stack = [fiber];
    while (stack.length) {
      const node = stack.pop();
      if (COMPOSITE.has(node.tag)) {
        const id = typeIdOf(node);
        if (id >= 0) {
          statsFor(commit.step, id).unmounts++;
          commit.step.unmounts++;
          commit.unmounted.set(id, (commit.unmounted.get(id) || 0) + 1);
        }
      }
      for (let child = node.child; child; child = child.sibling) stack.push(child);
    }
  }

  // `parentId` is the type id of the nearest component above the fiber (-1 at the root).
  function mountTree(fiber, commit, source, parentId) {
    let childParent = parentId;
    if (COMPOSITE.has(fiber.tag)) {
      recordMount(fiber, commit, source, parentId);
      childParent = typeIdOf(fiber);
    }
    for (let child = fiber.child; child; child = child.sibling) mountTree(child, commit, source, childParent);
  }

  function updateTree(next, prev, commit, source, parentId) {
    let childSource = source;
    let childParent = parentId;
    if (COMPOSITE.has(next.tag)) {
      const flags = next.flags !== undefined ? next.flags : next.effectTag || 0;
      if ((flags & PERFORMED_WORK) === PERFORMED_WORK) childSource = recordUpdate(next, prev, commit, source, parentId);
      childParent = typeIdOf(next);
    }
    if (next.deletions) {
      for (const deleted of next.deletions) recordUnmountTree(deleted, commit);
    }
    // When the children are the same objects as last time, the subtree bailed out entirely.
    if (next.child === prev.child) return;
    for (let child = next.child; child; child = child.sibling) {
      if (child.alternate) updateTree(child, child.alternate, commit, childSource, childParent);
      else mountTree(child, commit, childSource, childParent);
    }
  }

  function handleCommit(root) {
    const rootFiber = root && root.current;
    if (!rootFiber) return;
    const t = now();
    if (!current) current = newStep('(untracked)');
    const step = current;
    const commit = {
      step,
      renders: 0,
      wasted: 0,
      rendered: new Set(),
      sources: new Set(),
      perType: new Map(),
      mounted: new Map(),
      unmounted: new Map(),
      providers: new Map(),
    };

    if (rootFiber.alternate) updateTree(rootFiber, rootFiber.alternate, commit, -1, -1);
    else mountTree(rootFiber, commit, -1, -1);

    // Remounts: the same type unmounted and mounted again in one commit (unstable keys, or a
    // conditional wrapper). Identity churn: a type with the same name but a new identity replaced
    // the old one (a component or HOC created during render).
    if (commit.unmounted.size && commit.mounted.size) {
      const unmountedNames = new Map();
      for (const [id, count] of commit.unmounted) {
        const name = typeInfo[id].name;
        unmountedNames.set(name, (unmountedNames.get(name) || 0) + count);
      }
      for (const [id, count] of commit.mounted) {
        const stats = statsFor(step, id);
        if (commit.unmounted.has(id)) stats.remounts += Math.min(count, commit.unmounted.get(id));
        else if (unmountedNames.has(typeInfo[id].name)) stats.identityChurn += Math.min(count, unmountedNames.get(typeInfo[id].name));
      }
    }

    let cascade = false;
    if (previousCommit && t - previousCommit.t < CASCADE_WINDOW_MS && lastInputAt < previousCommit.t) {
      for (const id of commit.sources) {
        if (previousCommit.rendered.has(id)) {
          cascade = true;
          statsFor(step, id).cascades++;
        }
      }
    }
    for (const id of commit.sources) sourceFor(step, id).triggers++;
    for (const [id, count] of commit.perType) {
      const stats = statsFor(step, id);
      if (count > stats.maxPerCommit) stats.maxPerCommit = count;
    }

    const duration = typeof rootFiber.actualDuration === 'number' ? rootFiber.actualDuration : 0;
    step.commits++;
    step.renders += commit.renders;
    step.renderMs += duration;
    if (cascade) step.cascadeCommits++;
    if (step.commitLog.length < MAX_COMMIT_LOG) {
      step.commitLog.push({
        at: round(t - step.startedAt),
        renders: commit.renders,
        wasted: commit.wasted,
        ms: round(duration),
        sources: Array.from(commit.sources).slice(0, 6),
        cascade,
      });
    }
    previousCommit = { t, rendered: commit.rendered };
    lastCommitAt = t;
    totalCommits++;
  }

  // ---------------------------------------------------------------------------------------------
  // Long frames and slow interactions (Chromium only)

  const frames = [];
  const interactions = [];
  const observers = [];

  function observe(type, options, onEntry) {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      const supported = PerformanceObserver.supportedEntryTypes || [];
      if (!supported.includes(type)) return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onEntry(entry);
      });
      observer.observe({ type, buffered: true, ...options });
      observers.push({ observer, onEntry });
    } catch (error) {
      recordError(`observe ${type}`, error);
    }
  }

  observe('long-animation-frame', {}, (entry) => {
    frames.push({ start: entry.startTime, duration: entry.duration, blocking: entry.blockingDuration || 0 });
  });
  observe('event', { durationThreshold: 16 }, (entry) => {
    if (entry.interactionId) interactions.push({ name: entry.name, start: entry.startTime, duration: entry.duration });
  });

  function flushObservers() {
    for (const { observer, onEntry } of observers) {
      try {
        for (const entry of observer.takeRecords()) onEntry(entry);
      } catch (error) {
        recordError('takeRecords', error);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Serialization

  function serializeStep(step) {
    const components = [];
    for (const [id, stats] of step.byType) {
      components.push({
        id,
        renders: stats.renders,
        mounts: stats.mounts,
        unmounts: stats.unmounts,
        remounts: stats.remounts,
        identityChurn: stats.identityChurn,
        wasted: stats.wasted,
        reasons: stats.reasons,
        props: stats.props,
        hooks: stats.hooks,
        contexts: stats.contexts,
        selfMs: round(stats.selfMs),
        maxSelfMs: round(stats.maxSelfMs),
        instances: stats.instances.size,
        maxPerCommit: stats.maxPerCommit,
        causedBy: stats.causedBy,
        owners: stats.owners,
        cascades: stats.cascades,
      });
    }
    const sources = [];
    for (const [id, source] of step.sources) sources.push({ id, ...source });
    const inStep = (start) => start >= step.startedAt && start <= step.endedAt;
    const longFrames = frames.filter((frame) => inStep(frame.start) && frame.duration >= 50);
    const slowInteractions = interactions.filter((entry) => inStep(entry.start));
    return {
      name: step.name,
      startedAt: round(step.startedAt),
      durationMs: round(step.endedAt - step.startedAt),
      commits: step.commits,
      renders: step.renders,
      mounts: step.mounts,
      unmounts: step.unmounts,
      wasted: step.wasted,
      cascadeCommits: step.cascadeCommits,
      renderMs: round(step.renderMs),
      longFrames: {
        count: longFrames.length,
        maxMs: round(longFrames.reduce((max, frame) => Math.max(max, frame.duration), 0)),
        blockingMs: round(longFrames.reduce((sum, frame) => sum + frame.blocking, 0)),
      },
      interactions: {
        count: slowInteractions.length,
        maxMs: round(slowInteractions.reduce((max, entry) => Math.max(max, entry.duration), 0)),
      },
      components,
      sources,
      commitLog: step.commitLog,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // DOM snapshot for equivalence checks

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'BASE']);
  const DEFAULT_IGNORE = [
    'nextjs-portal',
    '#__next-build-watcher',
    '[data-nextjs-toast]',
    '[data-nextjs-dev-overlay]',
    'vite-error-overlay',
    '[data-render-audit-ignore]',
  ];
  const KEEP_ATTRIBUTES = new Set([
    'id', 'class', 'role', 'href', 'src', 'alt', 'title', 'type', 'name', 'for', 'placeholder',
    'tabindex', 'data-testid', 'hidden', 'inert', 'open', 'colspan', 'rowspan', 'target', 'rel', 'style',
  ]);
  // Ids generated by useId (every React version's format) and common UI libraries. They shift
  // when the component tree changes shape, so they're replaced by stable placeholders.
  const GENERATED_ID = /[:«][rR][0-9a-zA-Z]+[:»]|_[rR]_[0-9a-zA-Z]+_|react-aria\d*-\d+|headlessui-[a-z-]+-\d+|\bmui-\d+\b|downshift-\d+(?:-[a-z]+)?/g;

  function normalizeIds(value, ids) {
    return value.replace(GENERATED_ID, (match) => {
      let placeholder = ids.get(match);
      if (!placeholder) {
        placeholder = `#id${ids.size + 1}`;
        ids.set(match, placeholder);
      }
      return placeholder;
    });
  }

  // CSS-in-JS and CSS Modules class names carry content hashes; keep the readable part only.
  function normalizeClass(value) {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        if (/^(sc|css|jsx|emotion)-[A-Za-z0-9_-]{4,}$/.test(token)) return token.replace(/-[A-Za-z0-9_-]+$/, '-#');
        if (/[A-Za-z0-9]_[A-Za-z0-9-]+__[A-Za-z0-9_-]{5,}$/.test(token)) return token.replace(/__[A-Za-z0-9_-]{5,}$/, '__#');
        if (/^[A-Za-z]{5,8}$/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token) && !/^[A-Z]?[a-z]+(?:[A-Z][a-z]+)*$/.test(token)) return '#';
        return token;
      })
      .sort()
      .join(' ');
  }

  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function collapse(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function snapshot(extraIgnore) {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.body) return { dom: '', text: '' };
    const ignore = DEFAULT_IGNORE.concat(Array.isArray(extraIgnore) ? extraIgnore : []).join(',');
    const ids = new Map();
    const lines = [];

    const walk = (node, depth) => {
      const indent = '  '.repeat(Math.min(depth, 40));
      if (node.nodeType === 3) {
        const text = collapse(node.nodeValue || '');
        if (text) lines.push(`${indent}"${text.length > 160 ? `${text.slice(0, 160)}…` : text}"`);
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node;
      if (SKIP_TAGS.has(el.tagName)) return;
      try {
        if (el.matches(ignore)) return;
      } catch {
        // an invalid user selector must not break the snapshot
      }
      const tag = el.tagName.toLowerCase();
      const attrs = [];
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name;
        if (!KEEP_ATTRIBUTES.has(name) && !name.startsWith('aria-')) continue;
        let value = attr.value;
        if (name === 'class') value = normalizeClass(value);
        else if (name === 'style') value = value.split(';').map((part) => part.trim()).filter(Boolean).sort().join('; ');
        if (name === 'href' || name === 'src') value = value.replace(/^https?:\/\/[^/]+/, '');
        value = normalizeIds(value, ids);
        if (value.length > 120) value = `${value.slice(0, 120)}…`;
        attrs.push(`${name}=${JSON.stringify(value)}`);
      }
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        attrs.push(`value=${JSON.stringify(String(el.value).slice(0, 120))}`);
        if (el.type === 'checkbox' || el.type === 'radio') attrs.push(`checked=${el.checked}`);
        if (el.disabled) attrs.push('disabled');
      }
      if (tag === 'svg') {
        lines.push(`${indent}<svg ${attrs.join(' ')} #${hash(el.innerHTML || '')}>`);
        return;
      }
      lines.push(`${indent}<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
      if (tag === 'iframe') return;
      for (const child of Array.from(el.childNodes)) walk(child, depth + 1);
    };
    walk(doc.body, 0);

    let text = '';
    try {
      text = (doc.body.innerText || '')
        .split('\n')
        .map(collapse)
        .filter(Boolean)
        .join('\n');
    } catch {
      text = '';
    }
    return { dom: lines.join('\n'), text };
  }

  // ---------------------------------------------------------------------------------------------
  // React DevTools hook

  const HOOK = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
  const renderers = [];
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
      renderers.push({
        id,
        version: (renderer && renderer.version) || null,
        bundleType: renderer ? renderer.bundleType : null, // 1 = development build
        packageName: (renderer && renderer.rendererPackageName) || null,
      });
    } catch (error) {
      recordError('inject', error);
    }
    return id;
  };

  const originalCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function onCommitFiberRoot(rendererId, root) {
    try {
      handleCommit(root);
    } catch (error) {
      recordError('commit', error);
    }
    if (typeof originalCommit === 'function') return originalCommit.apply(this, arguments);
    return undefined;
  };

  // ---------------------------------------------------------------------------------------------
  // Public API

  current = newStep('(load)');

  g.__RENDER_AUDIT__ = {
    version: VERSION,
    /** Ends the current step, starts `nextName` if given, and returns the ended step's data. */
    endStep(nextName) {
      flushObservers();
      const step = current;
      current = typeof nextName === 'string' ? newStep(nextName) : null;
      // The runner starts a step only after the page has settled, so a step's first commit is
      // caused by its own action and can't be a cascade of the previous step's last commit.
      previousCommit = null;
      if (!step) return null;
      step.endedAt = now();
      return serializeStep(step);
    },
    idleMs() {
      return now() - (lastCommitAt || installedAt);
    },
    status() {
      return {
        version: VERSION,
        hook: hookMode,
        renderers,
        commits: totalCommits,
        types: typeInfo.length,
        idleMs: round(now() - (lastCommitAt || installedAt)),
        errors: errors.slice(),
      };
    },
    types() {
      return typeInfo.map((info) => ({ ...info }));
    },
    typeRef(id) {
      return typeRefs[id] || null;
    },
    snapshot,
  };
})();
