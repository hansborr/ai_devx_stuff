# Dependency License Audit

Snapshot date: 2026-06-16.

Run the production dependency audit after `bun install`:

```bash
bun run audit:licenses
```

The default mode follows the production dependency closure from the workspace
`dependencies` fields. It fails if it finds strong copyleft licenses (`AGPL`,
`GPL`, `SSPL`) or licenses that require manual copyleft review (`LGPL`, `MPL`,
`EPL`, `CDDL`, `CPL`, `OSL`, `RPL`).

Current production result:

- Packages audited: 318
- Strong copyleft licenses: none
- Copyleft-review licenses: none
- Unknown or unlicensed package metadata: none

Full installed-tree mode is available for dev-tooling review:

```bash
bun run audit:licenses -- --all
```

As of this snapshot, full mode intentionally fails because dev tooling includes
`yamllint-js` (`GPL-3.0-or-later`) and several `MPL-2.0` packages
(`axe-core`, `lightningcss`, and platform packages). Those packages are not in
the production dependency closure, but should be reviewed before redistributing
installed development dependencies or bundled tool binaries.

This is a package-metadata audit, not legal advice.
