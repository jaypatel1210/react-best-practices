---
title: "Effects and cleanup"
headline: "Write fewer effects, keep their dependencies honest, and release everything they acquire."
description: "When useEffect is the wrong tool, how to keep dependency arrays honest without loops, and how to clean up listeners, timers and sockets so nothing leaks."
group: state
rules:
  - "An effect synchronizes with something outside React. With no external system involved, compute during render or act in the handler."
  - "Replace effect chains with values derived during render. Each link costs a render and a frame of mismatched values."
  - "Dependencies describe the code. To change the list, change what the effect reads, and never silence exhaustive-deps."
  - "Objects, arrays and functions built during render are new every time. Build them inside the effect, or depend on primitives."
  - "Every effect that acquires something returns a cleanup that releases it: listeners, timers, sockets, observers, widgets."
  - "If StrictMode's setup, cleanup, setup run causes a visible problem, fix the cleanup instead of guarding with a ref."
  - "Render, state initializers, updaters and reducers must stay pure, because React may run them twice."
prompts:
  - "This component keeps refetching in a loop. Can you find out why?"
  - "After switching screens a few times, our keyboard shortcut fires several times. What's leaking?"
  - "Do I need a useEffect for this, or can it be computed?"
  - "Review the effects in this file for missing cleanups and dependency problems."
---

Most effect bugs come from effects that shouldn't exist, or from effects that don't say what they depend on and never undo what they did. This skill teaches Claude to ask first which external system an effect synchronizes with. When the answer is "none", Claude derives the value during render, sets related state together in the event handler, or resets with a `key`, and the extra renders and inconsistent frames go away with the effect.

When an effect is the right tool, Claude writes its dependency array from the code instead of choosing it. Objects and functions move inside the effect, constants move to module scope, updaters replace reads of the state being set, and `useEffectEvent` (React 19.2+) or a latest-value ref covers callbacks the effect calls but shouldn't re-run for. That's how the silent refetch loops and stale closures disappear.

Every effect Claude writes releases what it acquires: listeners removed with the same function or a signal, timers cleared, sockets closed, observers disconnected, widgets destroyed, requests aborted. Claude also knows where leaks hide outside effects, and how to find them with heap snapshots.
