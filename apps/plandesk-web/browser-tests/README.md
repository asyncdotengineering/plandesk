# Browser harness — prototype frame contract

Real-browser (Chromium / Playwright) checks for behaviour jsdom cannot observe:
sandbox enforcement, CSP headers on the render endpoint, opaque-origin frames,
and later shim/postMessage contracts. This suite is **not** part of
`vitest run` / `pnpm test`.

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

| path                 | role                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `fixtures/server.ts` | ephemeral `plandesk serve`, health poll, seed project + html/markdown artifacts, teardown     |
| `fixtures/frame.ts`  | `mountHtmlArtifactFrame` — frames a **served** render URL with `sandbox="allow-scripts"`      |
| `smoke.spec.ts`      | discriminative smoke: framed script `postMessage`s; fails if `allow-scripts` is removed       |
| `csp.spec.ts`        | header-borne CSP: direct unframed nav, one assertion per escape vector, meta-removal, own-nav |

## Mounting

Screens are mounted by URL:

```
${baseUrl}/api/v1/artifacts/:id/render
```

Do **not** use `srcdoc` — it cannot prove header-borne CSP (`connect-src 'none'`,
the CSP `sandbox` directive). `mountHtmlArtifactFrame` is the single mounting
primitive; smoke and CSP specs both use it (or the same iframe.src pattern).

## Adding one assertion per requirement

Each Design §10 REQ should become **one** focused spec (or one `test()` inside a
describe), not a second harness. Pattern:

1. Reuse `startHarnessServer` (or `seedHtmlArtifact`) so the artifact under test
   is real API content, not a hand-rolled express app.
2. Frame it via `mountHtmlArtifactFrame` / `artifactRenderUrl` — assert against
   the **contract** (REQ text / CSP / sandbox flags), not incidental markup.
3. Prefer an observation the browser can falsify (message received, fetch
   failed, script did not run) over string checks. String CSP checks also live
   in `@plandesk/api` (`html-artifact.test.ts`) and the CLI preview tests.
4. Bound every wait. Absence of an event must fail the test, not hang CI.

### Consuming tasks (extend this harness; do not invent another)

- **Build the prototype frame shim** — modes, selection, navigation, wheel, highlight
- **Add Arrange, Interact and Comment modes** — canvas chrome and pointer routing

Those tasks own the shim and canvas modes. The render route is in place; this
package owns the runner and the fixture lifecycle they plug into.
