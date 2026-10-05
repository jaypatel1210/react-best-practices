---
title: "Error handling"
headline: "Keep failures local: a fallback that fits, a report, and a retry that works."
description: "Where to place React error boundaries, what they can't catch, how to route async errors into them, and how to build a retry that actually retries."
group: data
rules:
  - "An uncaught render error unmounts the whole React root. Always have a root boundary."
  - "Add a boundary per route and around each independent widget, not around every component."
  - "Boundaries catch render, lifecycle and effect errors. They don't see event handlers or promise callbacks."
  - "Handle expected failures next to the action, and send unexpected async errors to the nearest boundary."
  - "Every catch recovers, shows something or reports, and usually does two of the three."
  - "A retry must change the input first: refetch or clear the cache in onReset, or reset with resetKeys."
  - "Report errors with their component stack, and never show raw error messages to users."
prompts:
  - "One broken widget blanks our whole dashboard. Can you contain it?"
  - "Our error boundary doesn't catch this failed request. Why?"
  - "Add error boundaries and error reporting to this app."
---

Every app ships bugs, so this skill teaches Claude to decide how far a failure can spread. Claude places a root boundary as the last line of defense, a boundary per route so the app shell stays usable, and boundaries around independent regions such as charts, feeds and third-party embeds, each with a fallback sized to fit.

Claude knows what boundaries can't see. Errors from event handlers, promise callbacks and timers happen outside rendering, so Claude handles expected failures next to the action with specific UI, and re-throws unexpected ones into the nearest boundary with `useThrowToBoundary` or the data library's built-in option. Swallowed errors, unchecked `res.ok` and `try`/`catch` around JSX get flagged in review.

Recovery is part of the design. Claude wires `onReset` to refetch or clear the failing data, uses `resetKeys` to reset on navigation, and reports every error with its component stack. The skill includes a dependency-free, tested `ErrorBoundary` and `useThrowToBoundary` hook for projects that don't already use a library.
