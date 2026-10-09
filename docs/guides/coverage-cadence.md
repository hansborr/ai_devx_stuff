# Coverage Cadence

Coverage is an out-of-band health check. Do not add it to `verify:changed`,
pre-push hooks, or CI without reopening the build decision.

## Manual Run

Run this from the repo root:

```bash
bun run test:coverage
```

The last baseline recorded as a tracked note lives in the codebase audit's
coverage note, `docs/agent_notes/in_progress/codebase-audit/coverage.md`.
Commit `54f2eb910` recorded it under `AUD-COV-001` on 2026-05-13; commit
`61c98f348` is the note's last revision before `dda70f1f9` deleted it from the
working tree on 2026-05-14. It is still retrievable from Git history — run this
from the repository root:

```bash
git show 61c98f348:docs/agent_notes/in_progress/codebase-audit/coverage.md
```

That revision holds the `AUD-COV-001` snapshot, the `AUD-COV-002`
floor-calibration tables, and the `Fresh Run - 2026-05-13` tables.

Read those tables as provenance, not as a comparison point. They were measured
before the coverage denominator in `vitest.config.ts` was narrowed to
production files (commits `d1b7ecb91`, `106ac576b`, and `d6bbc91c1`, all
2026-08-30), so they and a fresh run count different sets of files and the
difference between them is mostly denominator. Re-derive a comparison point on
the current denominator instead, and record which run it came from.

The newest measurement on the current denominator is committed in
`vitest.config.ts`'s floors comment, re-derived 2026-08-30 from a full
`bun run test:coverage`. Use it as the interim comparison point.

The next cadence run should write a fresh baseline to a new tracked path under
`docs/agent_notes/` (not the ignored `coverage/` output) and update this guide
to point at it. After a run, record `lines`, `statements`, `functions`, and
`branches` from `coverage/coverage-summary.json` for each tracked scope. Once
that path exists, use `git log -p` against it as the comparison point.

Open a follow-up leaf when any configured floor makes `bun run test:coverage`
fail. If the command still passes, open a follow-up when any tracked
line/statement/function metric drops by at least 1.00 percentage point from
the prior baseline, or any branch metric drops by at least 0.50 percentage
points. Branch coverage is tracked separately because it is the quickest
coverage signal for missing control-flow assertions.

Run the check weekly, preferably on a weekend, so slow coverage work does not
compete with the normal edit loop.

## Baseline Helper

This helper prints the same aggregate scopes used by the baseline note:

```bash
bun - <<'EOF'
const { readFileSync } = await import("node:fs");
const root = `${process.cwd()}/`;
const data = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
const scopes = [
  ["all", ""],
  ["packages/shared", "packages/shared/"],
  ["packages/server", "packages/server/"],
  ["packages/client", "packages/client/"],
  ["scripts", "scripts/"],
  ["eslint-rules", "eslint-rules/"],
  ["root config", "eslint.config.js"],
];
const metrics = ["lines", "statements", "functions", "branches"];
const pct = ({ covered, total }) =>
  total === 0 ? 100 : Math.floor((covered / total) * 10000) / 100;
const empty = () =>
  Object.fromEntries(metrics.map((metric) => [metric, { covered: 0, total: 0 }]));
const add = (target, summary) => {
  for (const metric of metrics) {
    target[metric].covered += summary[metric].covered;
    target[metric].total += summary[metric].total;
  }
};
for (const [label, prefix] of scopes) {
  const totals = prefix === "" ? data.total : empty();
  let files = prefix === "" ? Object.keys(data).filter((file) => file !== "total").length : 0;
  if (prefix !== "") {
    for (const [file, summary] of Object.entries(data)) {
      if (file === "total") continue;
      const rel = file.startsWith(root) ? file.slice(root.length) : file;
      if (rel === prefix || rel.startsWith(prefix)) {
        files += 1;
        add(totals, summary);
      }
    }
  }
  const rendered = metrics
    .map((metric) => {
      const value = pct(totals[metric]).toFixed(2);
      return `${metric} ${value}% (${totals[metric].covered}/${totals[metric].total})`;
    })
    .join(" | ");
  console.log(`${label} (${files} files): ${rendered}`);
}
EOF
```

## Host-Side Automation (Optional)

The timer lives on the host, outside the devcontainer. Agents in the container
cannot install or enable it. Adjust `%h/src/musi` if the checkout is elsewhere.

Create `~/.config/systemd/user/musi-coverage.service` on the host:

```ini
[Unit]
Description=Musi weekly coverage audit

[Service]
Type=oneshot
WorkingDirectory=%h/src/musi
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env bash -lc 'mkdir -p "%h/.local/state/musi"; devcontainer exec --workspace-folder "%h/src/musi" bash -lc "bun run test:coverage" >> "%h/.local/state/musi/coverage.log" 2>&1'
```

Create `~/.config/systemd/user/musi-coverage.timer` on the host:

```ini
[Unit]
Description=Run Musi coverage weekly

[Timer]
OnCalendar=Sat *-*-* 09:00:00
Persistent=true
Unit=musi-coverage.service

[Install]
WantedBy=timers.target
```

Enable and inspect it from the host:

```bash
systemctl --user daemon-reload
systemctl --user enable --now musi-coverage.timer
systemctl --user list-timers musi-coverage.timer
tail -f ~/.local/state/musi/coverage.log
```

Disable it from the host:

```bash
systemctl --user disable --now musi-coverage.timer
```
