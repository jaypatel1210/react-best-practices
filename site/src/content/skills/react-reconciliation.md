---
title: "Keys and component identity"
headline: "Know when React keeps a component's state and when it starts over, and control both on purpose."
description: "How React matches elements by type, position and key, and how to keep or reset state on purpose: list keys, inline components, keyed resets and stable trees."
group: rendering
rules:
  - "React keeps a component's state while the same type sits in the same position with the same key."
  - "Define components at module scope. A component created during render is a new type every time, so it remounts."
  - "Key list items by a stable ID from the data. Never use the index for lists that change, or a key generated during render."
  - "The same type in the same place shares state, so give different entities different keys."
  - "Reset state with a key instead of an effect, and put the key on the smallest subtree that should start fresh."
  - "Keep the tree's shape stable: don't swap content for a spinner during a refetch, and don't toggle a wrapper's type."
  - "To keep hidden UI's state, hide it with CSS or use Activity on React 19.2+ instead of unmounting it."
prompts:
  - "This input loses focus after every keystroke. What's wrong?"
  - "When I switch tabs, the form keeps the text from the other tab. How do I reset it?"
  - "Are the keys in this list right?"
  - "Why does this editor lose its draft whenever the data refreshes?"
---

React keeps a component's state, DOM and effects alive only while it believes the same component sits in the same place. This skill teaches Claude exactly how React decides that, by type, position and key, so it can explain a whole family of bugs with one model: inputs that lose focus on every keystroke, state that leaks from one tab or record to the next, list rows that show another item's data, and drafts that vanish when a spinner or a wrapper toggles.

With it, Claude defines components at module scope, keys lists by stable IDs assigned when data arrives, and keys a component by the entity it edits instead of resetting state in an effect. It keeps the tree's shape stable through refetches and layout changes, and reaches for CSS hiding or `<Activity>` on React 19.2+ when hidden UI should keep its state.

Claude also treats a remount as a tool with a cost. It puts reset keys on the smallest subtree that should start fresh, and doesn't use a remount to cover up problems that have direct fixes, such as fetch race conditions.
