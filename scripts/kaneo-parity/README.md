# Local Kaneo parity

This tooling captures real running applications and compares their PNGs. It does not start services, seed databases, fabricate responses or accept missing references. A passing tooling test is not screen acceptance.

```sh
node --test scripts/kaneo-parity/manifest.test.mjs
node scripts/kaneo-parity/capture.mjs /private/plan.json /path/to/source /tmp/new-capture-directory
node scripts/kaneo-parity/check.mjs /tmp/upstream-captures /tmp/candidate-captures /path/to/current/taskdesk
```

The coordinator can wire the final command as `check:kaneo-parity`. Output directories must be new and outside the source checkout. Keep private sessions and local seed exports outside Git. Capture requires existing Playwright Chromium; comparison uses its PNG matcher without starting a browser.

Upstream must be a clean checkout at `42bb801114aa1ae499228a53180f0cdbc5607964`. Candidate identity includes HEAD and a hash of tracked changes and untracked files. Compare on the same laptop, OS, architecture and Chromium version. Pixel budgets remain zero and snapshot updates are disabled. Failed, missing, stale, incorrectly sized, redirected and mismatched files fail the command.

Each capture plan supplies all 20 common screen names exported by `manifest.mjs`. No ready-made mapping is claimed: verify each upstream/candidate destination against its real seeded runtime first. Additional TaskDesk/portal screens need separate journey evidence; this matrix has no invented upstream equivalents.

Plan shape (one entry shown; all 20 are required):

```json
{
  "version": 1,
  "side": "candidate",
  "baseUrl": "http://localhost:5173",
  "apiUrl": "http://localhost:1337",
  "storageState": "private-session.json",
  "seed": {
    "kind": "persisted-api-export",
    "file": "normalised-persisted-seed.json",
    "probes": [
      { "path": "/api/REAL_ENDPOINT", "pointer": "/REAL_FIELD", "expected": "REAL_PERSISTED_VALUE" }
    ]
  },
  "screens": [
    {
      "name": "project-board",
      "path": "/REAL_BOARD_PATH",
      "expectedPath": "/REAL_FINAL_BOARD_PATH",
      "readySelector": "[data-testid=REAL_POPULATED_CONTENT]",
      "readyText": "REAL_PERSISTED_TITLE"
    }
  ]
}
```

Replace every placeholder. Use an authenticated session from the intended runtime. `seed.file` must be a byte-identical, normalised export of equivalent persisted fixture content in each app; resolve IDs outside that logical export. Probes read real API responses using the private session and compare JSON pointer values, without interception. Choose probes that establish the intended records, dates, people and states. Hash equality alone cannot establish that the export covers the intended journey; inspect that coverage in the phase review.

Capture waits for the exact final URL, visible content/text, loaded fonts/images, and two identical screenshot frames. It uses no network-idle wait or broad masks. Content changing continuously fails instead of producing an unstable baseline. Captures are 20 screens × desktop/tablet/mobile × light/dark (120 per side). The source, seed probes, render environment, destination, readiness and PNG hashes are recorded in each manifest. Historical screenshots without this metadata cannot pass this gate.
