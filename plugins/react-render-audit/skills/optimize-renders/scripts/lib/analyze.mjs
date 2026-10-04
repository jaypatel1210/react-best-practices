// Turns measured runs into a diagnosis: per-step totals (median of runs), per-component render
// counts and reasons, and ranked hotspots, each mapped to a react-* skill, a fix and a safety
// class (auto: behavior-preserving; ask: changes timing or state lifetime; suggest: changes DOM).
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { classifyFile } from './sourcemap.mjs';
import { median, readJson, round, table, writeJson } from './util.mjs';

const REASONS = ['state', 'context', 'props', 'contextUnstable', 'propsUnstable', 'parent', 'self'];
const NUMERIC = ['renders', 'mounts', 'unmounts', 'remounts', 'identityChurn', 'wasted', 'selfMs', 'cascades'];
const MAX_FIELDS = ['maxSelfMs', 'instances', 'maxPerCommit'];

export function loadRuns(dir) {
  if (!existsSync(dir)) throw new Error(`No runs in ${dir}`);
  const files = readdirSync(dir)
    .filter((name) => /^run-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!files.length) throw new Error(`No run-N.json files in ${dir}`);
  return {
    dir,
    meta: readJson(join(dir, 'meta.json'), {}),
    runs: files.map((name) => readJson(join(dir, name))),
    snaps: files.map((name) => readJson(join(dir, name.replace(/\.json$/, '.snap.json')), { steps: [] })),
  };
}

export function scenariosOf(audit, label) {
  const dir = join(audit, 'runs', label);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function keyFor(type) {
  return `${type.file || '?'}#${type.name}`;
}

function emptyCounts() {
  const counts = { reasons: Object.fromEntries(REASONS.map((reason) => [reason, 0])) };
  for (const field of [...NUMERIC, ...MAX_FIELDS]) counts[field] = 0;
  return counts;
}

/** Merges the runs of one scenario. Everything numeric is the median across runs. */
export function aggregate(data, { scope = [], repoRoot } = {}) {
  const { runs } = data;
  const components = new Map(); // key -> { key, name, file, line, memo, compiled, kind }
  const steps = [];

  runs.forEach((run, r) => {
    for (const step of run.steps) {
      let slot = steps[step.index];
      if (!slot) {
        slot = { index: step.index, name: step.name, action: step.action, totals: [], comps: new Map(), sources: new Map(), network: step.network, console: step.console };
        steps[step.index] = slot;
      }
      const stats = step.stats || { components: [], sources: [], commits: 0, renders: 0, wasted: 0, mounts: 0, cascadeCommits: 0, renderMs: 0, longFrames: {}, interactions: {} };
      const types = ((run.documents || [])[step.doc] || { types: [] }).types;
      const keyOf = (id) => {
        const type = types[id];
        if (!type) return null;
        const key = keyFor(type);
        const known = components.get(key);
        if (!known) components.set(key, { key, name: type.name, file: type.file || null, line: type.line || null, memo: !!type.memo, compiled: !!type.compiled, kind: type.kind });
        else {
          known.memo ||= !!type.memo;
          known.compiled ||= !!type.compiled;
        }
        return key;
      };
      slot.totals[r] = {
        commits: stats.commits,
        renders: stats.renders,
        wasted: stats.wasted,
        mounts: stats.mounts,
        cascades: stats.cascadeCommits,
        renderMs: stats.renderMs,
        longFrameMs: (stats.longFrames && stats.longFrames.maxMs) || 0,
        blockingMs: (stats.longFrames && stats.longFrames.blockingMs) || 0,
        interactionMs: (stats.interactions && stats.interactions.maxMs) || 0,
        settled: step.settled,
        durationMs: stats.durationMs || 0,
      };
      for (const row of stats.components) {
        const key = keyOf(row.id);
        if (!key) continue;
        let entry = slot.comps.get(key);
        if (!entry) {
          entry = { perRun: [], detail: null };
          slot.comps.set(key, entry);
        }
        const acc = entry.perRun[r] || (entry.perRun[r] = emptyCounts());
        for (const field of NUMERIC) acc[field] += row[field] || 0;
        for (const field of MAX_FIELDS) acc[field] = Math.max(acc[field], row[field] || 0);
        for (const reason of REASONS) acc.reasons[reason] += (row.reasons && row.reasons[reason]) || 0;
        if (!entry.detail || entry.detailRun === r) {
          // Details (which props, hooks, contexts) come from one run; they repeat across runs.
          const detail = entry.detail || (entry.detail = { props: {}, hooks: {}, contexts: {}, causedBy: {}, owners: {} });
          entry.detailRun = r;
          for (const [prop, kinds] of Object.entries(row.props || {})) {
            const target = detail.props[prop] || (detail.props[prop] = { changed: 0, fn: 0, sameContent: 0, element: 0 });
            for (const kind of Object.keys(target)) target[kind] += kinds[kind] || 0;
          }
          for (const [label, hook] of Object.entries(row.hooks || {})) {
            const target = detail.hooks[label] || (detail.hooks[label] = { count: 0, sample: hook.sample });
            target.count += hook.count;
          }
          for (const [name, context] of Object.entries(row.contexts || {})) {
            const target = detail.contexts[name] || (detail.contexts[name] = { changed: 0, unstable: 0, provider: context.provider });
            target.changed += context.changed;
            target.unstable += context.unstable;
          }
          for (const [field, map] of [['causedBy', row.causedBy], ['owners', row.owners]]) {
            for (const [id, n] of Object.entries(map || {})) {
              const other = keyOf(Number(id));
              if (other) detail[field][other] = (detail[field][other] || 0) + n;
            }
          }
        }
      }
      for (const source of stats.sources || []) {
        const key = keyOf(source.id);
        if (!key) continue;
        let entry = slot.sources.get(key);
        if (!entry) {
          entry = { perRun: [] };
          slot.sources.set(key, entry);
        }
        const acc = entry.perRun[r] || (entry.perRun[r] = { triggers: 0, renders: 0, wasted: 0, mounts: 0 });
        acc.triggers += source.triggers;
        acc.renders += source.renders;
        acc.wasted += source.wasted;
        acc.mounts += source.mounts;
      }
    }
  });

  for (const info of components.values()) info.category = classifyFile(info.file, { scope, repoRoot });
  const runCount = runs.length;
  const med = (perRun, pick) => median(Array.from({ length: runCount }, (_, r) => (perRun[r] ? pick(perRun[r]) : 0)));

  const outSteps = steps.filter(Boolean).map((slot) => {
    for (const [key, entry] of slot.comps) {
      const category = components.get(key).category;
      entry.perRun.forEach((acc, r) => {
        if (!acc || !slot.totals[r]) return;
        const totals = slot.totals[r];
        totals.remounts = (totals.remounts || 0) + acc.remounts + acc.identityChurn;
        if (category === 'scope') {
          totals.scopeRenders = (totals.scopeRenders || 0) + acc.renders;
          totals.scopeWasted = (totals.scopeWasted || 0) + acc.wasted;
        }
      });
    }
    const totalsField = (field) => med(slot.totals, (totals) => totals[field] || 0);
    const renderValues = slot.totals.map((totals) => (totals ? totals.renders : 0));
    const comps = [];
    for (const [key, entry] of slot.comps) {
      const counts = emptyCounts();
      for (const field of NUMERIC) counts[field] = round(med(entry.perRun, (acc) => acc[field]), 2);
      for (const field of MAX_FIELDS) counts[field] = round(med(entry.perRun, (acc) => acc[field]), 2);
      for (const reason of REASONS) counts.reasons[reason] = med(entry.perRun, (acc) => acc.reasons[reason]);
      comps.push({ key, ...counts, ...entry.detail });
    }
    const sources = [];
    for (const [key, entry] of slot.sources) {
      sources.push({ key, triggers: med(entry.perRun, (acc) => acc.triggers), renders: med(entry.perRun, (acc) => acc.renders), wasted: med(entry.perRun, (acc) => acc.wasted), mounts: med(entry.perRun, (acc) => acc.mounts) });
    }
    // Renders started by state that lives inside the scope, wherever the re-rendered components live.
    const fromScope = sources.filter((source) => components.get(source.key).category === 'scope');
    return {
      index: slot.index,
      name: slot.name,
      action: slot.action,
      commits: totalsField('commits'),
      renders: totalsField('renders'),
      wasted: totalsField('wasted'),
      mounts: totalsField('mounts'),
      remounts: totalsField('remounts'),
      cascades: totalsField('cascades'),
      scopeRenders: totalsField('scopeRenders'),
      scopeWasted: totalsField('scopeWasted'),
      scopeCaused: round(fromScope.reduce((sum, source) => sum + source.renders, 0), 1),
      scopeCausedWasted: round(fromScope.reduce((sum, source) => sum + source.wasted, 0), 1),
      renderMs: round(totalsField('renderMs'), 1),
      longFrameMs: round(totalsField('longFrameMs'), 1),
      blockingMs: round(totalsField('blockingMs'), 1),
      interactionMs: round(totalsField('interactionMs'), 1),
      settled: slot.totals.every((totals) => !totals || totals.settled),
      spread: { min: Math.min(...renderValues), max: Math.max(...renderValues) },
      components: comps.sort((a, b) => b.renders - a.renders),
      sources: sources.sort((a, b) => b.wasted - a.wasted),
    };
  });
  return { steps: outSteps, components };
}

// ---------------------------------------------------------------------------------------------
// Hotspots

function describeProp(name, kinds) {
  const parts = [];
  if (kinds.fn) parts.push(`new function ×${kinds.fn}`);
  if (kinds.sameContent) parts.push(`new object/array with the same content ×${kinds.sameContent}`);
  if (kinds.element) parts.push(`new JSX element ×${kinds.element}`);
  return parts.length ? `${name} (${parts.join(', ')})` : null;
}

function propFix(props) {
  const kinds = new Set();
  for (const value of Object.values(props)) {
    if (value.fn) kinds.add('fn');
    if (value.sameContent) kinds.add('object');
    if (value.element) kinds.add('element');
  }
  const fixes = [];
  if (kinds.has('fn')) fixes.push('give callbacks a stable identity (useCallback, a state setter, or a latest-ref callback; pass ids instead of binding them in an inline arrow)');
  if (kinds.has('object')) fixes.push('hoist constant objects/arrays to module scope or useMemo derived ones');
  if (kinds.has('element')) fixes.push('pass elements that keep their identity (create them in a parent that does not re-render, or memoize them)');
  return fixes.join('; ');
}

function topEntries(map, n, info) {
  return Object.entries(map || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => `${info.get(key) ? info.get(key).name : key} ×${round(count, 1)}`);
}

function sumComponents(steps) {
  const totals = new Map();
  for (const step of steps) {
    for (const comp of step.components) {
      let total = totals.get(comp.key);
      if (!total) {
        total = { key: comp.key, ...emptyCounts(), props: {}, hooks: {}, contexts: {}, causedBy: {}, owners: {}, steps: [] };
        totals.set(comp.key, total);
      }
      for (const field of NUMERIC) total[field] += comp[field];
      for (const field of MAX_FIELDS) total[field] = Math.max(total[field], comp[field]);
      for (const reason of REASONS) total.reasons[reason] += comp.reasons[reason];
      for (const field of ['causedBy', 'owners']) for (const [key, n] of Object.entries(comp[field] || {})) total[field][key] = (total[field][key] || 0) + n;
      for (const [prop, kinds] of Object.entries(comp.props || {})) {
        const target = total.props[prop] || (total.props[prop] = { changed: 0, fn: 0, sameContent: 0, element: 0 });
        for (const kind of Object.keys(target)) target[kind] += kinds[kind] || 0;
      }
      for (const [label, hook] of Object.entries(comp.hooks || {})) {
        const target = total.hooks[label] || (total.hooks[label] = { count: 0, sample: hook.sample });
        target.count += hook.count;
      }
      for (const [name, context] of Object.entries(comp.contexts || {})) {
        const target = total.contexts[name] || (total.contexts[name] = { changed: 0, unstable: 0, provider: context.provider });
        target.changed += context.changed;
        target.unstable += context.unstable;
      }
      if (comp.renders) total.steps.push(step.name);
    }
  }
  return totals;
}

function findByName(info, name) {
  for (const component of info.values()) if (component.name === name && component.category !== 'external') return component;
  for (const component of info.values()) if (component.name === name) return component;
  return null;
}

/**
 * Ranked hotspots across every step, page load included (re-renders right after the first
 * render, from providers and effects, are as fixable as the ones an interaction causes).
 */
export function hotspots(aggregated, { scopeConfigured }) {
  const { steps, components: info } = aggregated;
  const totals = sumComponents(steps);
  // Only the app's own compiled components say React Compiler is on (libraries ship compiled code).
  const anyCompiled = [...info.values()].some((component) => component.compiled && component.category !== 'external');
  const out = [];
  const avgSelf = (total) => (total.renders ? total.selfMs / total.renders : 0);
  const fixable = (component) => component && (component.category === 'scope' || (!scopeConfigured && component.category === 'project'));
  const add = (hotspot) => {
    const at = hotspot.at || info.get(hotspot.key);
    out.push({
      ...hotspot,
      component: info.get(hotspot.key) ? info.get(hotspot.key).name : hotspot.component,
      file: at ? at.file : null,
      line: at ? at.line : null,
      fixIn: at ? at.name : null,
      inScope: fixable(at),
      score: round(hotspot.score, 1),
    });
  };

  // 1. A state change that re-renders many components whose props didn't change. One hotspot per
  //    component and changed state, because each piece of state needs its own fix.
  const cascades = new Map();
  for (const step of steps) {
    const byKey = new Map(step.components.map((comp) => [comp.key, comp]));
    for (const source of step.sources) {
      if (!source.triggers) continue;
      const own = byKey.get(source.key);
      const labels = own ? Object.keys(own.hooks || {}).sort() : [];
      const groupKey = `${source.key}|${labels.join(',')}`;
      let group = cascades.get(groupKey);
      if (!group) {
        group = { key: source.key, hooks: {}, triggers: 0, renders: 0, wasted: 0, steps: [], actions: new Set(), victims: new Map(), victimMs: 0, contextDriven: false };
        cascades.set(groupKey, group);
      }
      group.triggers += source.triggers;
      group.renders += source.renders;
      group.wasted += source.wasted;
      group.steps.push(step.name);
      group.actions.add(step.action);
      if (own) {
        for (const [label, hook] of Object.entries(own.hooks || {})) {
          const target = group.hooks[label] || (group.hooks[label] = { count: 0, sample: hook.sample });
          target.count += hook.count;
        }
        if (!labels.length && own.reasons.context + own.reasons.contextUnstable > 0) group.contextDriven = true;
      }
      for (const comp of step.components) {
        const n = comp.causedBy && comp.causedBy[source.key];
        if (!n) continue;
        group.victims.set(comp.key, (group.victims.get(comp.key) || 0) + n);
        group.victimMs += (comp.renders ? comp.selfMs / comp.renders : 0) * n;
      }
    }
  }
  // Ignore cascades too small to matter next to the rest of the page.
  const totalWasted = steps.reduce((sum, step) => sum + step.wasted, 0);
  const minWasted = Math.max(3, totalWasted * 0.005);
  for (const group of cascades.values()) {
    // Context-driven cascades are reported as context hotspots.
    if (group.wasted < minWasted || group.renders < 5 || group.contextDriven) continue;
    const hooks = Object.entries(group.hooks).map(([label, hook]) => `${label} (${hook.sample}) ×${round(hook.count, 1)}`);
    const victims = [...group.victims.entries()].sort(([, a], [, b]) => b - a);
    const fromViewport = [...group.actions].some((action) => action === 'resize' || action === 'scroll');
    // Raw pixels (1280 → 1000) call for a coarser value; a flag or an index (false → true,
    // 0 → 1) is already coarse and just lives too high.
    const pixels = Object.values(group.hooks).some((hook) => {
      const match = /^(-?\d+(?:\.\d+)?) → (-?\d+(?:\.\d+)?)$/.exec(hook.sample || '');
      return !!match && Math.max(Math.abs(Number(match[1])), Math.abs(Number(match[2]))) >= 50;
    });
    const coarsen = fromViewport && pixels;
    const name = info.get(group.key).name;
    const firstHook = Object.keys(group.hooks)[0] || 'update';
    add({
      kind: 'cascade',
      key: group.key,
      title: coarsen
        ? `Viewport size in ${name} re-renders its whole subtree`
        : fromViewport
          ? `Scroll-driven ${firstHook} in ${name} re-renders ${round(group.wasted, 1)} components that don’t use it`
          : `${name}’s ${firstHook} re-renders ${round(group.wasted, 1)} components that don’t use it`,
      evidence: [
        `${round(group.triggers, 1)} update(s) in: ${[...new Set(group.steps)].join('; ')}`,
        hooks.length ? `changed state: ${hooks.join(', ')}` : 'changed state: not a hook it owns directly; check the custom hooks and stores it calls',
        `re-rendered ${round(group.renders, 1)} components, ${round(group.wasted, 1)} of them with unchanged props`,
        `most re-rendered: ${victims.slice(0, 5).map(([key, n]) => `${info.get(key) ? info.get(key).name : key} ×${round(n, 1)}`).join(', ')}`,
      ],
      metrics: { triggers: group.triggers, rendersCaused: group.renders, wastedCaused: group.wasted, victimMs: round(group.victimMs, 1) },
      skill: 'react-rerenders',
      rule: coarsen ? 'Know what state your hooks hide (store coarse values)' : 'Move state down / pass the unaffected subtree as children',
      fix: coarsen
        ? 'Store a coarse value (a breakpoint boolean from matchMedia or useSyncExternalStore) instead of raw pixels, or call the hook in the leaf that needs it.'
        : fromViewport
          ? 'This value changes while the user scrolls, but it lives in this component, so every change re-renders everything it renders. Move the state and the scroll/visibility listener into the component that displays it (the sticky element, the navigation), or pass the rest of the page in as children.'
          : 'Move this state (and the elements that read it) into the smallest component that uses it, or have this component accept the unaffected subtree as children/element props. Memoize only what genuinely depends on the value.',
      safety: 'auto',
      score: group.wasted * (1 + group.victimMs / Math.max(group.wasted, 1)),
    });
  }

  for (const total of totals.values()) {
    const component = info.get(total.key);
    // 2. memo() defeated by unstable props.
    if (component.memo && total.reasons.propsUnstable >= 2) {
      const props = Object.entries(total.props).map(([name, kinds]) => describeProp(name, kinds)).filter(Boolean);
      const ownerKey = Object.entries(total.owners).sort(([, a], [, b]) => b - a)[0];
      const owner = ownerKey ? info.get(ownerKey[0]) : null;
      add({
        kind: 'memo-broken',
        key: total.key,
        at: owner || component,
        title: `memo(${component.name}) re-renders anyway: unstable props`,
        evidence: [
          `${round(total.reasons.propsUnstable, 1)} of ${round(total.renders, 1)} renders came from props that only changed identity: ${props.join('; ')}`,
          owner ? `props are created in ${owner.name}` : 'props come from its parent',
          `${round(total.instances, 1)} instance(s), ~${round(avgSelf(total), 2)} ms each (dev build)`,
        ],
        metrics: { renders: total.renders, wasted: total.wasted, instances: total.instances },
        skill: 'react-memoization',
        rule: 'memo needs every prop to keep its identity',
        fix: `In ${owner ? owner.name : 'the parent'}: ${propFix(total.props)}.`,
        safety: 'auto',
        score: total.reasons.propsUnstable * (1 + avgSelf(total)),
      });
    }
    // 5. setState inside an effect: an extra commit for every change.
    if (total.cascades >= 1) {
      const hooks = Object.entries(total.hooks).map(([label, hook]) => `${label} (${hook.sample})`);
      add({
        kind: 'effect-cascade',
        key: total.key,
        title: `${component.name} sets state in an effect right after rendering`,
        evidence: [`${round(total.cascades, 1)} extra commit(s) started by ${component.name} immediately after a commit it rendered in`, hooks.length ? `state set: ${hooks.join(', ')}` : ''].filter(Boolean),
        metrics: { cascades: total.cascades, renders: total.renders },
        skill: 'react-effects',
        rule: 'Derive during render; you might not need an effect',
        fix: 'Compute the value during render (or in the event handler that causes the change) instead of copying it into state from an effect; reset with a key if it must follow an identity.',
        safety: 'auto',
        score: total.cascades * (3 + avgSelf(total) * 2),
      });
    }
    // 6. Expensive renders that are legitimately caused (the value really changed).
    const legit = total.reasons.props + total.reasons.state + total.reasons.context;
    if (total.maxSelfMs >= 16 && legit > 0) {
      add({
        kind: 'heavy-render',
        key: total.key,
        title: `${component.name} takes ${round(total.maxSelfMs, 1)} ms to render during interactions`,
        evidence: [`${round(total.renders, 1)} render(s), up to ${round(total.maxSelfMs, 1)} ms each (dev build; production is faster but proportional)`, `steps: ${[...new Set(total.steps)].join('; ')}`],
        metrics: { renders: total.renders, maxSelfMs: total.maxSelfMs },
        skill: 'react-responsiveness',
        rule: 'Keep interactions under 50 ms of main-thread work',
        fix: 'Defer the expensive part with useDeferredValue or startTransition behind a memo() boundary, or memoize the costly computation; keep the input itself urgent.',
        safety: 'ask',
        score: total.maxSelfMs / 4,
      });
    }
    // 9. React Compiler is on, but this hot component wasn't compiled.
    if (anyCompiled && !component.compiled && total.wasted >= 5) {
      add({
        kind: 'compiler-skipped',
        key: total.key,
        title: `React Compiler skipped ${component.name}`,
        evidence: [`other components are compiled, ${component.name} is not, and it had ${round(total.wasted, 1)} wasted renders`],
        metrics: { wasted: total.wasted },
        skill: 'react-memoization',
        rule: 'Fix Rules of React violations so the compiler can memoize',
        fix: 'Run the React Compiler lint rules on this file and fix what they report (mutation during render, reading refs during render, conditional hooks).',
        safety: 'auto',
        score: total.wasted * 0.5,
      });
    }
  }

  // 4. Remounts. When a component remounts, everything it creates remounts with it, so each
  //    remounting component is grouped under its root cause: a component type created during
  //    render, or the highest remounting owner (a key or tree-shape change).
  const remounting = new Map();
  for (const total of totals.values()) if (total.remounts + total.identityChurn > 0) remounting.set(total.key, total);
  const topOwner = (total) => {
    const entry = Object.entries(total.owners).sort(([, a], [, b]) => b - a)[0];
    return entry ? entry[0] : null;
  };
  const rootOf = (key) => {
    let current = key;
    const seen = new Set([key]);
    for (;;) {
      const total = remounting.get(current);
      if (total.identityChurn > 0) return current; // created during render: always its own cause
      const owner = topOwner(total);
      if (!owner || !remounting.has(owner) || seen.has(owner)) return current;
      seen.add(owner);
      current = owner;
    }
  };
  const remountGroups = new Map();
  for (const key of remounting.keys()) {
    const root = rootOf(key);
    if (!remountGroups.has(root)) remountGroups.set(root, []);
    if (key !== root) remountGroups.get(root).push(remounting.get(key));
  }
  for (const [rootKey, followers] of remountGroups) {
    const total = remounting.get(rootKey);
    const component = info.get(rootKey);
    const churn = total.identityChurn > 0;
    const ownerKey = topOwner(total);
    const owner = ownerKey ? info.get(ownerKey) : null;
    const count = total.remounts + total.identityChurn;
    const followerCount = followers.reduce((sum, follower) => sum + follower.remounts + follower.identityChurn, 0);
    followers.sort((a, b) => b.remounts + b.identityChurn - (a.remounts + a.identityChurn));
    add({
      kind: churn ? 'component-in-render' : 'remount',
      key: rootKey,
      // A component created during render is fixed where it's defined; a remount where its
      // key or position is decided (its owner).
      at: churn ? component : owner || component,
      title: churn ? `${component.name} is a new component type on every render` : `${component.name} remounts during interactions`,
      evidence: [
        churn
          ? `${round(total.identityChurn, 1)} time(s) a new ${component.name} type replaced the previous one, destroying its state, DOM and focus`
          : `${round(total.remounts, 1)} unmount+mount(s) of the same type in one commit (key or tree shape changed)${owner ? `; created by ${owner.name}` : ''}`,
        followers.length
          ? `its subtree remounts with it: ${followers.slice(0, 6).map((follower) => `${info.get(follower.key).name} ×${round(follower.remounts + follower.identityChurn, 1)}`).join(', ')}${followers.length > 6 ? `, and ${followers.length - 6} more` : ''}`
          : '',
        `steps: ${[...new Set(total.steps)].join('; ')}`,
      ].filter(Boolean),
      metrics: { remounts: total.remounts, identityChurn: total.identityChurn, mounts: total.mounts, subtreeRemounts: followerCount },
      skill: 'react-reconciliation',
      rule: churn ? 'Define components at module scope' : 'Keep keys and tree shape stable',
      fix: churn
        ? `Move the ${component.name} definition (or the HOC/styled call that creates it) out of the component it's declared in, to module scope; pass what it closed over as props.`
        : 'Use stable keys from data identity and keep the same element type at the same position; toggle props instead of swapping wrappers.',
      safety: churn ? 'auto' : 'ask',
      score: (count + followerCount * 0.5) * (3 + avgSelf(total)),
    });
  }

  // 3. Context values that change identity without changing content.
  const contexts = new Map();
  for (const total of totals.values()) {
    for (const [name, context] of Object.entries(total.contexts)) {
      if (!context.unstable) continue;
      const entry = contexts.get(name) || { name, provider: context.provider, renders: 0, consumers: [] };
      entry.renders += context.unstable;
      entry.consumers.push([total.key, context.unstable]);
      contexts.set(name, entry);
    }
  }
  for (const context of contexts.values()) {
    if (context.renders < 2) continue;
    const provider = context.provider ? findByName(info, context.provider) : null;
    add({
      kind: 'context-value',
      key: provider ? provider.key : context.consumers[0][0],
      at: provider || info.get(context.consumers[0][0]),
      component: context.provider || '(provider)',
      title: `${context.name} gets a new value object on every ${context.provider || 'provider'} render`,
      evidence: [
        `${round(context.renders, 1)} consumer render(s) where the value was a new object with the same content`,
        `consumers: ${context.consumers.sort(([, a], [, b]) => b - a).slice(0, 5).map(([key, n]) => `${info.get(key).name} ×${round(n, 1)}`).join(', ')}`,
      ],
      metrics: { consumerRenders: context.renders },
      skill: 'react-context',
      rule: 'Memoize context values; split state and actions',
      fix: `In ${context.provider || 'the provider'}: build the value with useMemo and its functions with useCallback; if some consumers only need actions, split them into a separate context.`,
      safety: 'auto',
      score: context.renders * 2,
    });
  }

  // 7. Large lists rendered in one commit (load included).
  for (const total of totals.values()) {
    if (total.maxPerCommit < 100) continue;
    const component = info.get(total.key);
    add({
      kind: 'large-list',
      key: total.key,
      title: `${round(total.maxPerCommit, 0)} ${component.name} rows render in a single commit`,
      evidence: [`up to ${round(total.maxPerCommit, 0)} instances rendered together`],
      metrics: { maxPerCommit: total.maxPerCommit },
      skill: 'react-large-lists',
      rule: 'Paginate or virtualize long lists',
      fix: 'Virtualize the list (react-window, @tanstack/react-virtual) or paginate; memoize rows with stable props first if most of their renders are wasted.',
      safety: 'suggest',
      score: total.maxPerCommit / 20,
    });
  }

  // 8. Steps that never went quiet: something renders without user input.
  for (const step of steps) {
    if (step.settled || step.commits < 10) continue;
    const top = step.sources.slice(0, 3).map((source) => (info.get(source.key) ? info.get(source.key).name : source.key));
    const firstKey = step.sources[0] && step.sources[0].key;
    add({
      kind: 'continuous',
      key: firstKey,
      component: top[0] || '?',
      title: `Renders keep happening after "${step.name}" without input`,
      evidence: [`${step.commits} commits and the page never went quiet; updates came from: ${top.join(', ') || 'unknown'}`],
      metrics: { commits: step.commits },
      skill: 'react-rerenders',
      rule: 'Isolate high-frequency state (timers, animation, polling) in leaves',
      fix: 'Move timer/animation/polling state into the small component that displays it, or drive animations with CSS or refs instead of state.',
      safety: 'ask',
      score: step.commits / 2,
    });
  }

  out.sort((a, b) => Number(b.inScope) - Number(a.inScope) || b.score - a.score);
  out.forEach((hotspot, i) => (hotspot.id = `H${i + 1}`));
  return out;
}

// ---------------------------------------------------------------------------------------------

export function analyzeScenario(config, label, scenario) {
  const dir = join(config.audit, 'runs', label, scenario);
  const data = loadRuns(dir);
  const aggregated = aggregate(data, { scope: config.scope || [], repoRoot: config.repoRoot });
  const found = hotspots(aggregated, { scopeConfigured: (config.scope || []).length > 0 });
  const all = aggregated.steps;
  const sum = (field) => round(all.reduce((total, step) => total + (step[field] || 0), 0), 1);
  const byComponent = new Map();
  for (const step of all) {
    for (const comp of step.components) {
      const entry = byComponent.get(comp.key) || { key: comp.key, renders: 0, wasted: 0, mounts: 0, selfMs: 0, reasons: {} };
      entry.renders += comp.renders;
      entry.wasted += comp.wasted;
      entry.mounts += comp.mounts;
      entry.selfMs += comp.selfMs;
      for (const [reason, n] of Object.entries(comp.reasons)) entry.reasons[reason] = (entry.reasons[reason] || 0) + n;
      byComponent.set(comp.key, entry);
    }
  }
  const unstable = aggregated.steps.filter((step) => step.spread.max > 0 && (step.spread.max - step.spread.min) / step.spread.max > 0.05);
  const result = {
    scenario,
    label,
    meta: data.meta,
    runs: data.runs.length,
    react: data.runs[0] && data.runs[0].react,
    scope: config.scope || [],
    totals: {
      renders: sum('renders'),
      scopeRenders: sum('scopeRenders'),
      scopeCaused: sum('scopeCaused'),
      scopeCausedWasted: sum('scopeCausedWasted'),
      wasted: sum('wasted'),
      scopeWasted: sum('scopeWasted'),
      commits: sum('commits'),
      remounts: sum('remounts'),
      cascades: sum('cascades'),
      longFrameMs: Math.max(0, ...all.map((step) => step.longFrameMs)),
      interactionMs: Math.max(0, ...all.map((step) => step.interactionMs)),
    },
    deterministic: unstable.length === 0,
    unstableSteps: unstable.map((step) => ({ name: step.name, min: step.spread.min, max: step.spread.max })),
    steps: aggregated.steps.map(({ components, sources, ...step }) => ({
      ...step,
      top: components.slice(0, 25),
      sources: sources.slice(0, 10),
    })),
    components: [...aggregated.components.values()],
    byComponent: [...byComponent.values()]
      .map((entry) => ({ ...entry, renders: round(entry.renders, 1), wasted: round(entry.wasted, 1), mounts: round(entry.mounts, 1), selfMs: round(entry.selfMs, 1) }))
      .sort((a, b) => b.renders - a.renders),
    hotspots: found,
  };
  writeJson(join(dir, 'analysis.json'), result);
  return result;
}

export function analyzeLabel(config, label, { scenario } = {}) {
  const names = scenario ? [scenario] : scenariosOf(config.audit, label);
  if (!names.length) throw new Error(`No measured scenarios under ${join(config.audit, 'runs', label)}. Run measure first.`);
  return names.map((name) => analyzeScenario(config, label, name));
}

export function formatAnalysis(result, { top = 8, appRoot } = {}) {
  const info = new Map(result.components.map((component) => [component.key, component]));
  const where = (file, line) => (file ? `${appRoot ? relative(appRoot, file) : file}${line ? `:${line}` : ''}` : '(file unknown)');
  const lines = [];
  const meta = result.meta || {};
  lines.push(`Scenario "${result.scenario}" [${result.label}] — ${result.runs} run(s)${meta.warmup ? ` + ${meta.warmup} warm-up` : ''}, ${meta.chrome || 'Chrome'}, React ${(result.react && result.react.version) || '?'}${result.react && result.react.development ? ' (dev build)' : ''}, CPU ${meta.cpu || 1}× on interactions`);
  if (result.scope.length) lines.push(`Scope: ${result.scope.map((dir) => (appRoot ? relative(appRoot, dir) || '.' : dir)).join(', ')}`);
  lines.push('');
  const rows = [['#', 'step', 'commits', 'renders', 'wasted', 'from scope', 'remounts', 'longest frame', 'settled']];
  for (const step of result.steps) {
    rows.push([step.index, step.name, step.commits, step.renders, step.wasted, step.scopeCaused || 0, step.remounts || 0, step.longFrameMs ? `${step.longFrameMs} ms` : '—', step.settled ? 'yes' : 'NO']);
  }
  lines.push(table(rows, { indent: '  ' }));
  lines.push(
    result.deterministic
      ? '  Render counts were identical (within 5%) across runs.'
      : `  Render counts varied across runs in: ${result.unstableSteps.map((step) => `${step.name} (${step.min}–${step.max})`).join(', ')}; compare medians and keep data stable.`,
  );
  lines.push('');
  const t = result.totals;
  lines.push(`Totals (all steps): ${t.renders} renders, ${t.wasted} wasted, ${t.remounts} remounts, ${t.cascades} effect cascades, ${t.commits} commits${result.scope.length ? `; ${t.scopeCaused} renders (${t.scopeCausedWasted} wasted) were started by state inside the scope` : ''}`);

  const most = result.byComponent.filter((entry) => entry.renders > 0).slice(0, 12);
  if (most.length) {
    lines.push('', 'Most rendered components (all steps):');
    const compRows = [['component', 'renders', 'wasted', 'main reason', 'self ms', 'where']];
    for (const entry of most) {
      const component = info.get(entry.key) || {};
      const reason = Object.entries({ ...entry.reasons, mount: entry.mounts }).sort(([, a], [, b]) => b - a)[0];
      compRows.push([`${component.name}${component.memo ? ' (memo)' : ''}`, round(entry.renders, 1), round(entry.wasted, 1), reason && reason[1] ? reason[0] : '—', round(entry.selfMs, 1), `${where(component.file, component.line)}${component.category === 'scope' ? '' : ` [${component.category}]`}`]);
    }
    lines.push(table(compRows, { indent: '  ' }));
  }

  const inScope = result.hotspots.filter((hotspot) => hotspot.inScope);
  const outside = result.hotspots.filter((hotspot) => !hotspot.inScope);
  lines.push('', inScope.length ? `Hotspots you can fix in scope (ranked):` : 'No hotspots inside the scope.');
  for (const hotspot of inScope.slice(0, top)) {
    lines.push(`  ${hotspot.id} [${hotspot.kind}] ${hotspot.title}`);
    lines.push(`     fix in ${hotspot.fixIn || hotspot.component} — ${where(hotspot.file, hotspot.line)}`);
    for (const line of hotspot.evidence) lines.push(`     · ${line}`);
    lines.push(`     → ${hotspot.skill}: ${hotspot.rule}. ${hotspot.fix} [${hotspot.safety}]`);
  }
  if (inScope.length > top) lines.push(`  … ${inScope.length - top} more in analysis.json`);
  if (outside.length) {
    lines.push('', `Outside the scope (${outside.length}): ${outside.slice(0, 6).map((hotspot) => `${hotspot.id} ${hotspot.kind} in ${hotspot.fixIn || hotspot.component}`).join(', ')}`);
  }
  lines.push('', `Full detail: runs/${result.label}/${result.scenario}/analysis.json in the audit directory.`);
  return lines.join('\n');
}
