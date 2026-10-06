# Animation

Frame-time animation for a canvas application: easing, tweens, composers,
motion paths and a scene system that can drive a demo or a timeline export.

Everything here is pure TypeScript (`src/core/animation`, `src/core/motion`,
`src/core/scene`), driven by an external clock, and deterministic given a seed.

## Principles

1. **Advance by `dt`, never by wall-clock reads inside the library.** The caller
   owns the loop (rAF in the editor, a frame stepper in tests/exports), so the
   same code drives a 60 Hz preview, a 30 fps export and an instant unit test.
2. **Absolute time for sequencing, delta time for playback.** A scene cursor
   advances by `dt`, but `scene.add(effect, at)` positions work on an absolute
   timeline — pausing and resuming cannot drift the schedule.
3. **No allocation in the update path.** Tween state lives on the instance;
   particle state lives in a pooled `Float32Array`.
4. **Overshoot is data, not a bug.** Eased values are allowed to leave `[0,1]`;
   paths extrapolate past their end point, which is what makes `backOut` and
   elastic snaps read correctly. Only `smooth` clamps.

## Easing (`animation/easing.ts`)

26 named curves plus cubic-Bézier construction:

```
linear        quadIn/Out/InOut     cubicIn/Out/InOut    quartIn/Out/InOut
quintIn/Out/InOut  sineIn/Out/InOut  expoIn/Out/InOut    circIn/Out/InOut
backIn/Out/InOut   elasticIn/Out/InOut  bounceOut
smoothstep    smootherstep  smooth  backOut(x)  elasticOut(t)
getEasing(name | fn)   EASING_NAMES   easeRaw(name, t)
```

`getEasing` accepts a name, a function or `undefined` (→ `linear`), so presets
can store a string while hot paths hold a resolved function.

## Tweens (`animation/tween.ts`)

```ts
const t = new Tween({ from: 0, to: 64, duration: 800, ease: 'easeOutCubic',
                      delay: 100, repeat: 2, pingPong: true });
t.update(dt);            // returns leftover ms after the tween ended
t.value;                 // current interpolated value
t.isTerminal();          // true once every repeat is exhausted
```

Semantics that matter:

| Behaviour | Rule |
| --- | --- |
| Delay | Consumed inside `update`; the first frame never jumps. |
| Repeat / pingPong / reverse | Computed from total elapsed, so long frames do not desynchronise. |
| **Leftover time** | `update(dt)` returns the milliseconds it did *not* consume. Sequence steps chain by handing that leftover to the next tween, which is how two segments join **seam-free** without an error-accumulating loop. |
| Lifecycle | `LifecycleStatus = 'idle' \| 'running' \| 'complete'`; `isTerminal()` includes `'complete'`. |

Specialisations:

* `TweenVec` — several numbers share one clock (position + colour).
* `Sequence` — children play back to back, leftover time carried forward.
* `Parallel` — children share a clock; finishes when the longest does.
* `stagger(items, perItemDelay)` — the cascade used for row/column reveals.
* `Animator` — registry of named tweens with `play/pause/seek/finished`.

## Motion paths (`motion/paths.ts`)

Path kinds: `line`, `arc`, `circle`, `ellipse`, `bezier`, `quadratic`,
`polyline`, `lissajous`, `sine`, `spiral`, `randomWalk`. Each samples by
normalised `t` with arc-length parameterisation, so a curve moves at constant
speed instead of bunching at the corners.

`Body` adds movement on top: velocity, damping, spring-to-target and a
repulsion field. `paths.ts` also exports deterministic `randomWalk` and
`repulsion` helpers that take an `Rng`, so a scene replay reproduces exactly.

## Scenes (`scene/scene.ts`)

A `Scene` is a timeline of work for one owner (a demo, a preset preview, an
export):

```ts
const scene = new Scene({ name: 'cipherlock intro', loop: true, tailHold: 1200 });
scene.add(entrance, { at: 0 });        // absolute position
scene.wait(400);                       // cursor-relative gap
scene.add(door, { at: 'after' });      // appended after the cursor
scene.pause();                         // manual resume
scene.trigger('flash', { intensity: 1 });
scene.onTrigger('flash', (payload) => bloom(1));
```

* The cursor only moves through `add`/`wait`; `pause()` freezes it until `resume()`.
* `tailHold` keeps the last frame alive before a loop restarts.
* `SceneDirector` runs a scene and hands a **new scene** over cleanly
  (transition handover: outgoing state is captured, incoming starts from zero).

Determinism: the director owns an `Rng` seeded from `--seed`; triggers and
scene randomness derive from it, so `npm run demo -- --seed 7` is reproducible.

## Where animation runs in the app

| Loop | Owner | Stops when |
| --- | --- | --- |
| Timeline playback | `App.tsx` rAF, advances `timeline.currentFrame` at `fps` | paused / no keyframes |
| Cell effects | `EditorCanvas.tsx` rAF → `cellFxRuntime.frame(grid, dt)` | every one-shot settled → loop cancels itself |
| Scene demos | scene runner | scene not looping and all tweens terminal |

Both rAF loops clamp `dt` to 64 ms so a backgrounded tab cannot teleport the
animation on resume.

## Determinism

* `Rng` (`core/util.ts`) is a seeded xorshift-style generator with `next()`,
  `int(min,max)`, `range(min,max)`, `pick(array)` and `fork()`.
* Effects hash per-cell values through `cellSalt(ctx, x, y, salt)`, where
  `salt` folds in the pipeline seed — same seed ⇒ same pattern, different seed
  ⇒ visibly different pattern.

## Tests

| Concern | Test |
| --- | --- |
| easing curves, shape and clamping | `tests/unit/easing.test.ts` |
| tween timing, leftover time, repeat, lifecycle | `tests/unit/tween.test.ts` |
| paths, arc length, body physics | `tests/unit/paths.test.ts` |
| scene cursor, triggers, tail hold, loop, handover | `tests/unit/scene.test.ts` |
| seed determinism of animated effects | `tests/unit/fx.test.ts` |
