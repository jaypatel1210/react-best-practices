// The tracker test suite, run against each React version (see tracker*.test.mjs). The tracker
// must already be installed (imported) before the given React DOM was loaded.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

export function trackerSuite(label, React, createRoot) {
  const { Component, act, createContext, createElement: h, memo, useContext, useEffect, useId, useState, useSyncExternalStore } = React;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const audit = globalThis.__RENDER_AUDIT__;

  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    audit.endStep('setup');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    audit.endStep();
  });

  /** Runs `fn` inside act() as its own step and returns the step's data. */
  function step(name, fn) {
    audit.endStep(name);
    act(fn);
    return audit.endStep('idle');
  }

  /** Component rows of a step keyed by display name (rows of same-named types are summed). */
  function byName(stepData) {
    const names = new Map(audit.types().map((type) => [type.id, type.name]));
    const out = {};
    for (const row of stepData.components) {
      const name = names.get(row.id);
      if (!out[name]) out[name] = { ...row, ids: [row.id] };
      else {
        out[name].renders += row.renders;
        out[name].mounts += row.mounts;
        out[name].identityChurn += row.identityChurn;
        out[name].ids.push(row.id);
      }
    }
    return out;
  }

  function typeId(name) {
    return audit.types().find((type) => type.name === name).id;
  }

  describe(`tracker on React ${label}`, () => {
    it('registers the React renderer as a development build', () => {
      const status = audit.status();
      expect(status.hook).toBe('installed');
      expect(status.renderers.length).toBeGreaterThan(0);
      expect(status.renderers[0].bundleType).toBe(1);
      expect(status.errors).toEqual([]);
    });

    it('counts mounts and classifies why each component re-rendered', () => {
      let increment;
      function Display({ count }) {
        return h('span', null, count);
      }
      function Plain({ label }) {
        return h('i', null, label);
      }
      const MemoStable = memo(function MemoStable({ label }) {
        return h('b', null, label);
      });
      const MemoUnstable = memo(function MemoUnstable({ style }) {
        return h('u', { style }, 'x');
      });
      function App() {
        const [count, setCount] = useState(0);
        increment = () => setCount((value) => value + 1);
        return h(
          'div',
          null,
          h(Display, { count }),
          h(Plain, { label: 'a' }),
          h(MemoStable, { label: 'b' }),
          h(MemoUnstable, { onPick: () => {}, style: { color: 'red' } }),
        );
      }

      const mount = byName(step('mount', () => root.render(h(App))));
      expect(Object.keys(mount).sort()).toEqual(['App', 'Display', 'MemoStable', 'MemoUnstable', 'Plain']);
      expect(mount.App.mounts).toBe(1);

      const data = step('click', () => increment());
      const update = byName(data);
      expect(update.App.reasons.state).toBe(1);
      expect(update.App.hooks['useState #1']).toEqual({ count: 1, sample: '0 → 1' });
      expect(update.Display.reasons.props).toBe(1);
      expect(update.Display.wasted).toBe(0);
      expect(update.Plain.reasons.parent).toBe(1);
      expect(update.Plain.wasted).toBe(1);
      expect(update.MemoStable).toBeUndefined();
      expect(update.MemoUnstable.reasons.propsUnstable).toBe(1);
      expect(update.MemoUnstable.props.onPick.fn).toBe(1);
      expect(update.MemoUnstable.props.style.sameContent).toBe(1);
      expect(data.renders).toBe(4);
      expect(data.wasted).toBe(2);

      const appId = typeId('App');
      expect(update.Plain.causedBy[appId]).toBe(1);
      expect(update.MemoUnstable.owners[appId]).toBe(1);
      const source = data.sources.find((entry) => entry.id === appId);
      expect(source).toMatchObject({ triggers: 1, renders: 4, wasted: 2 });

      const types = audit.types();
      expect(types.find((type) => type.name === 'MemoStable').memo).toBe(true);
      expect(types.find((type) => type.name === 'Plain').memo).toBe(false);
      expect(typeof update.Plain.selfMs).toBe('number');
    });

    it('records render time per component and per cause, including the subtree of a wasted render', () => {
      const spin = (ms) => {
        const end = performance.now() + ms;
        while (performance.now() < end);
      };
      let bump;
      function TimedLeaf() {
        spin(2);
        return h('i', null, 'leaf');
      }
      function TimedPanel() {
        spin(2);
        return h('div', null, h(TimedLeaf));
      }
      function TimedPage() {
        const [n, setN] = useState(0);
        bump = () => setN((value) => value + 1);
        return h('section', null, h('b', null, n), h(TimedPanel));
      }

      const mount = step('mount', () => root.render(h(TimedPage)));
      expect(byName(mount).TimedPanel.mountMs).toBeGreaterThanOrEqual(1.5);
      expect(mount.mountMs).toBeGreaterThanOrEqual(3);

      const data = step('bump', () => bump());
      const rows = byName(data);
      // Both re-renders were wasted: the panel's own 2 ms, and 4 ms with the leaf it re-rendered.
      expect(rows.TimedPanel.wastedMs).toBeGreaterThanOrEqual(1.5);
      expect(rows.TimedPanel.updateMs).toBe(rows.TimedPanel.wastedMs);
      expect(rows.TimedPanel.wastedTreeMs).toBeGreaterThanOrEqual(rows.TimedPanel.wastedMs + 1.5);
      expect(rows.TimedPage.wastedMs).toBe(0);
      expect(data.wastedMs).toBeGreaterThanOrEqual(3);
      // The state change in TimedPage caused them, so their time is charged to it.
      const cause = data.sources.find((entry) => entry.id === typeId('TimedPage'));
      expect(cause.wastedMs).toBeGreaterThanOrEqual(3);
      expect(cause.ms).toBeGreaterThanOrEqual(cause.wastedMs);
    });

    it('detects context consumers re-rendered by a new value with the same content', () => {
      const Settings = createContext(null);
      Settings.displayName = 'SettingsContext';
      let bump;
      const Reader = memo(function Reader() {
        const settings = useContext(Settings);
        return h('p', null, settings.theme);
      });
      function SettingsProvider({ flip }) {
        const [n, setN] = useState(0);
        bump = () => setN((value) => value + 1);
        const theme = flip && n % 2 === 1 ? 'light' : 'dark';
        return h(Settings.Provider, { value: { theme } }, h(Reader), h('span', null, n));
      }

      step('mount', () => root.render(h(SettingsProvider, { flip: false })));
      const unstable = byName(step('bump', () => bump()));
      expect(unstable.Reader.reasons.contextUnstable).toBe(1);
      expect(unstable.Reader.contexts.SettingsContext).toMatchObject({ unstable: 1, changed: 0, provider: 'SettingsProvider' });
      expect(unstable.Reader.wasted).toBe(1);

      step('remount', () => root.render(h(SettingsProvider, { flip: true })));
      const changed = byName(step('bump again', () => bump()));
      expect(changed.Reader.reasons.context).toBe(1);
      expect(changed.Reader.wasted).toBe(0);
    });

    it('flags remounts and component types created during render', () => {
      let bump;
      function Keyed() {
        return h('s', null, 'k');
      }
      function Parent() {
        const [n, setN] = useState(0);
        bump = () => setN((value) => value + 1);
        function Inner() {
          return h('em', null, 'inner');
        }
        return h('div', null, h(Inner), h(Keyed, { key: n }));
      }

      step('mount', () => root.render(h(Parent)));
      const update = byName(step('bump', () => bump()));
      expect(update.Keyed.remounts).toBe(1);
      expect(update.Inner.identityChurn).toBe(1);
      expect(update.Inner.mounts).toBe(1);
    });

    it('detects a second commit caused by setState in an effect', () => {
      let setValue;
      function Mirror({ value }) {
        const [copy, setCopy] = useState(value);
        useEffect(() => {
          setCopy(value);
        }, [value]);
        return h('span', null, copy);
      }
      function Host() {
        const [value, set] = useState(1);
        setValue = set;
        return h(Mirror, { value });
      }

      step('mount', () => root.render(h(Host)));
      const data = step('change', () => setValue(2));
      const update = byName(data);
      expect(data.commits).toBe(2);
      expect(data.cascadeCommits).toBe(1);
      expect(update.Mirror.cascades).toBe(1);
      expect(update.Mirror.renders).toBe(2);
    });

    it('labels class state, custom-hook state and external stores', () => {
      let bumpClass;
      let toggle;
      class Counter extends Component {
        state = { n: 0, other: 'x' };
        render() {
          bumpClass = () => this.setState((state) => ({ n: state.n + 1 }));
          return h('span', null, this.state.n);
        }
      }
      function useToggle() {
        const [on, setOn] = useState(false);
        return [on, () => setOn((value) => !value)];
      }
      function Panel() {
        const [name] = useState('panel');
        const [open, flip] = useToggle();
        toggle = flip;
        return h('div', null, name, String(open));
      }
      const store = {
        value: 0,
        listeners: new Set(),
        subscribe: (listener) => {
          store.listeners.add(listener);
          return () => store.listeners.delete(listener);
        },
        get: () => store.value,
        set(value) {
          store.value = value;
          store.listeners.forEach((listener) => listener());
        },
      };
      function StoreReader() {
        const value = useSyncExternalStore(store.subscribe, store.get);
        return h('span', null, value);
      }

      step('mount', () => root.render(h('div', null, h(Counter), h(Panel), h(StoreReader))));
      expect(byName(step('class', () => bumpClass())).Counter.hooks).toHaveProperty(['this.state (n)']);
      expect(byName(step('toggle', () => toggle())).Panel.hooks).toHaveProperty(['useState #2']);
      const external = byName(step('store', () => store.set(5))).StoreReader;
      expect(external.reasons.state).toBe(1);
      expect(external.hooks).toHaveProperty(['useSyncExternalStore #1']);
    });

    it('snapshots the DOM with generated ids replaced by stable placeholders', () => {
      function Field() {
        const id = useId();
        return h('label', { htmlFor: id }, 'Name', h('input', { id, defaultValue: 'Ada' }));
      }
      step('mount', () => root.render(h(Field)));
      const { dom, text } = audit.snapshot();
      expect(dom).toContain('for="#id1"');
      expect(dom).toContain('id="#id1"');
      expect(dom).toContain('value="Ada"');
      expect(dom).not.toMatch(/[«:]r\d/);
      expect(typeof text).toBe('string');
    });
  });
}
