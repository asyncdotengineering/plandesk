# Browser harness — prototype frame contract

Real-browser (Chromium / Playwright) checks for behaviour jsdom cannot observe:
sandbox enforcement, CSP, opaque-origin frames, and later shim/postMessage
contracts. This suite is **not** part of `vitest run` / `pnpm test`.

## Run

From the repo root (or this package):

```bash
pnpm --filter plandesk-web test:browser
```

Requires a built CLI (`pnpm build`) — the fixture boots
`packages/plandesk-cli/bin/plandesk serve` on an ephemeral loopback port, the
same binary `scripts/validate.sh` uses.

`pnpm validate` runs this suite after its existing gates (`cmd:browser_contract OK`).

## Layout

| path                 | role                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `fixtures/server.ts` | ephemeral `plandesk serve`, health poll, seed project + html/markdown artifacts, teardown |
| `fixtures/frame.ts`  | parent page that frames HTML with `sandbox="allow-scripts"` (mirrors `sandboxForTarget`)  |
| `smoke.spec.ts`      | discriminative smoke: framed script `postMessage`s; fails if `allow-scripts` is removed   |

## Adding one assertion per requirement

Each Design §10 REQ should become **one** focused spec (or one `test()` inside a
describe), not a second harness. Pattern:

1. Reuse `startHarnessServer` (or extend the seed) so the artifact under test is
   real API content, not a hand-rolled express app.
2. Frame it the way the product will (`fixtures/frame.ts`, or the shim once it
   exists) — assert against the **contract** (REQ text / CSP / sandbox flags),
   not against incidental markup you just wrote.
3. Prefer an observation the browser can falsify (message received, fetch
   failed, script did not run) over string checks. String CSP checks already
   live in `packages/plandesk-cli/src/preview.test.ts`; do not duplicate them
   here.
4. Bound every wait. Absence of an event must fail the test, not hang CI.

### Consuming tasks (extend this harness; do not invent another)

- **Build the prototype frame shim** — modes, selection, navigation, wheel, highlight
- **Add Arrange, Interact and Comment modes** — canvas chrome and pointer routing
- **Serve screens from a render endpoint** — origin-parameterised CSP on the serve path

Those tasks own the shim, canvas modes, and render route. This package only
owns the runner and the fixture lifecycle they plug into.
