/*
 * Element finder for react-render-audit scenario steps: text, label, placeholder, test id and CSS
 * selector targets. (Role targets are resolved through the accessibility tree by the runner.)
 *
 * The runner injects this before the page's own scripts, next to the render tracker (measure,
 * inspect) or the timing collector (bench), and calls window.__RENDER_AUDIT_FIND__(target).
 */
(() => {
  'use strict';

  const g = globalThis;
  try {
    if (typeof window !== 'undefined' && window.top !== window) return; // main frame only
  } catch {
    return;
  }
  if (g.__RENDER_AUDIT_FIND__) return;

  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],[tabindex]';

  function collapse(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function matches(actual, expected, exact) {
    const a = collapse(String(actual || '')).toLowerCase();
    const b = collapse(String(expected || '')).toLowerCase();
    if (!b) return false;
    return exact ? a === b : a.includes(b);
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    return !style || (style.visibility !== 'hidden' && style.display !== 'none');
  }

  function byText(text, exact) {
    const found = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!matches(node.nodeValue, text, false)) continue;
      let el = node.parentElement;
      if (!el) continue;
      if (exact && !matches(el.textContent, text, true)) continue;
      el = el.closest(INTERACTIVE) || el;
      if (!seen.has(el)) {
        seen.add(el);
        found.push(el);
      }
    }
    // Form controls whose visible text is their value (input type=submit/button)
    for (const input of Array.from(document.querySelectorAll('input[type="submit"],input[type="button"]'))) {
      if (matches(input.value, text, exact) && !seen.has(input)) found.push(input);
    }
    return found;
  }

  function byLabel(label, exact) {
    const found = [];
    for (const el of Array.from(document.querySelectorAll('label'))) {
      if (matches(el.textContent, label, exact) && el.control) found.push(el.control);
    }
    for (const el of Array.from(document.querySelectorAll('[aria-label]'))) {
      if (matches(el.getAttribute('aria-label'), label, exact)) found.push(el);
    }
    return found;
  }

  function find(target) {
    if (!target || typeof document === 'undefined' || !document.body) return null;
    let candidates = [];
    if (target.selector) candidates = Array.from(document.querySelectorAll(target.selector));
    else if (target.testId) candidates = Array.from(document.querySelectorAll(`[data-testid="${String(target.testId).replace(/"/g, '\\"')}"]`));
    else if (target.placeholder) {
      candidates = Array.from(document.querySelectorAll('[placeholder]')).filter((el) =>
        matches(el.getAttribute('placeholder'), target.placeholder, target.exact),
      );
    } else if (target.label) candidates = byLabel(target.label, target.exact);
    else if (target.text) candidates = byText(target.text, target.exact);
    const visible = candidates.filter(isVisible);
    return visible[target.nth || 0] || null;
  }

  try {
    Object.defineProperty(g, '__RENDER_AUDIT_FIND__', { value: find, configurable: true, writable: true, enumerable: false });
  } catch {
    g.__RENDER_AUDIT_FIND__ = find;
  }
})();
