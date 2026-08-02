# Vendored prototype libraries

Browser builds checked in for offline screen rendering. `sourceUrl` in the
manifest is provenance only — materialisation and render never fetch.

| file | source | license |
| --- | --- | --- |
| `libraries/mermaid@11.16.0.js` | https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js | MIT |
| `libraries/chart.js@4.5.1.js` | https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js | MIT |

Obtained 2026-08-02 via `curl` against jsDelivr (npm package contents).
Hashes asserted by `src/libraries/manifest.test.ts` against the real files.
