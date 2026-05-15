# Coverage Cadence

Coverage is an out-of-band health check. Do not add it to `verify:changed`,
pre-push hooks, or CI without reopening the build decision.

## Manual Run

Run this from the repo root:

```bash
bun run test:coverage
```

The most recent baseline snapshot was recorded under `AUD-COV-001` /
`AUD-COV-002` (see `docs/agent_notes/LOG.md` 2026-05-13 entries); the original
audit notes were deleted on 2026-05-14. The next cadence run should write a
fresh baseline to a new tracked path under `docs/agent_notes/` (not the
ignored `coverage/` output) and update this guide to point at it. After a run,
record `lines`, `statements`, `functions`, and `branches` from
`coverage/coverage-summary.json` for each tracked scope.

Use `git log -p` against the previously tracked baseline (or the new tracked
path, once established) as the comparison point.

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
