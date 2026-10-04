// @vitest-environment jsdom
// The in-page scripts the benchmark injects: the element finder and the timing collector.
// (Event Timing, Long Animation Frames and frame pacing need a real browser; tests/e2e.mjs
// checks those in Chrome.)
import '../skills/optimize-renders/scripts/finder.js';
import '../skills/optimize-renders/scripts/vitals.js';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const find = globalThis.__RENDER_AUDIT_FIND__;
const vitals = globalThis.__RA_VITALS__;

beforeAll(() => {
  // jsdom has no layout; give every element a size so the finder treats it as visible.
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: this.hidden ? 0 : 10, height: this.hidden ? 0 : 10 };
  };
});

describe('element finder', () => {
  it('finds targets by text, label, placeholder, test id and selector, skipping hidden ones', () => {
    document.body.innerHTML = `
      <label>Email <input id="email"></label>
      <button aria-label="Close dialog">×</button>
      <input placeholder="Search products">
      <div data-testid="slot-10">10:00</div>
      <button hidden>Add to cart</button>
      <article><span>Trail Runner</span><button><span>Add to cart</span></button></article>
      <input type="submit" value="Send">`;
    expect(find({ label: 'email' }).id).toBe('email');
    expect(find({ label: 'Close dialog' }).tagName).toBe('BUTTON');
    expect(find({ placeholder: 'search' }).placeholder).toBe('Search products');
    expect(find({ testId: 'slot-10' }).textContent).toBe('10:00');
    expect(find({ text: 'Add to cart' }).hidden).toBe(false);
    expect(find({ text: 'Add to cart' }).tagName).toBe('BUTTON');
    expect(find({ text: 'Send' }).value).toBe('Send');
    expect(find({ text: 'trail', exact: true })).toBeNull();
    expect(find({ selector: 'article button' }).tagName).toBe('BUTTON');
    expect(find({ text: 'Nothing here' })).toBeNull();
  });
});

describe('timing collector', () => {
  it('installs the DevTools hook and counts React commits per step without tracking renders', async () => {
    expect(vitals.status()).toMatchObject({ version: 1, hook: 'installed' });
    const container = document.createElement('div');
    document.body.appendChild(container);
    let bump;
    function Counter() {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return createElement('p', null, `count ${count}`);
    }
    const root = createRoot(container);
    await act(async () => root.render(createElement(Counter)));
    const load = vitals.end();
    expect(load).toMatchObject({ index: 0, name: 'load', inp: null, interactions: { count: 0 }, tbt: 0 });
    expect(load.react.commits).toBe(1);
    expect(vitals.status().renderers[0].bundleType).toBe(1);

    vitals.begin(1, 'bump twice');
    await act(async () => bump());
    await act(async () => bump());
    const step = vitals.end();
    expect(step).toMatchObject({ index: 1, name: 'bump twice' });
    expect(step.react.commits).toBe(2);
    expect(step.react.renderMs).toBeGreaterThanOrEqual(0);
    expect(container.textContent).toBe('count 2');
    expect(vitals.idleMs()).toBeGreaterThanOrEqual(0);
    expect(vitals.end()).toBeNull();
    await act(async () => root.unmount());
  });
});
