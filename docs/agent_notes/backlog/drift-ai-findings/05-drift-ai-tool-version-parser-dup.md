# 05. dolos-output and semgrep-output duplicate the CLI --version parser (parse*VersionOutput + versionFromLine + semver regex)

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-med · Size: S
Source: drift:ai near-duplicates (drift-baseline; both `versionFromLine` bodies read) · Confidence: med

## Problem
`scripts/drift-ai/dolos-output.ts` and `scripts/drift-ai/semgrep-output.ts` each implement the same external-CLI `--version` parser as two functions:

- A public line scanner — `parseDolosVersionOutput` / `parseSemgrepVersionOutput` — whose bodies are byte-identical: split on `/\r?\n/u`, trim, skip empties, return the first `versionFromLine` hit.
- A private `versionFromLine(line)` matcher that is identical except for the tool-name word boundary (`/\bdolos\b/iu` vs `/\bsemgrep\b/iu`).

The semver capture pattern `(\d+\.\d+\.\d+(?:[-+.][\w.-]+)?)` is copy-pasted at **four** call sites (dolos-output.ts:86, dolos-output.ts:89, semgrep-output.ts:29, semgrep-output.ts:33), in two flavors: an in-line "labeled banner" match and an anchored `^v?...$` bare-line match.

This clears the quality bar: it is genuine logic duplication (one scanner + one matcher copied across two modules) plus a single regex literal repeated four times. A robustness fix to the version grammar (e.g. accepting a two-segment `1.2`, or a `v`-prefixed labeled line) currently has to be made in two files and re-verified twice, and the two copies can silently drift. Extracting one shared helper parameterized by tool name removes the copy and defines the semver pattern once.

## Evidence
- `scripts/drift-ai/dolos-output.ts:34-42` — `parseDolosVersionOutput`: the line-scanner loop.
- `scripts/drift-ai/dolos-output.ts:84-91` — `versionFromLine`; `\bdolos\b` boundary; semver regex at lines 86 and 89.
- `scripts/drift-ai/semgrep-output.ts:17-25` — `parseSemgrepVersionOutput`: same scanner loop, identical structure.
- `scripts/drift-ai/semgrep-output.ts:27-35` — `versionFromLine`; identical except `\bsemgrep\b` boundary; semver regex at lines 29 and 33.
- `scripts/drift-ai/dolos-runner.ts:145` — sole caller of `parseDolosVersionOutput`, passes `` `${result.stdout}\n${result.stderr}` ``.
- `scripts/drift-ai/semgrep-runner.ts:174` — sole caller of `parseSemgrepVersionOutput`, same `stdout\nstderr` shape.
- Existing co-located util convention: `scripts/drift-ai/path-util.ts` + `path-util.test.ts`, `scripts/drift-ai/ts-source-util.ts`.

## Proposed fix
1. Add `scripts/drift-ai/tool-version.ts` exporting one helper, e.g. `parseToolVersionOutput(output: string, toolName: string): string | undefined`. Move the scanner loop and a `versionFromLine(line, toolName)` (build the boundary as `new RegExp(\`\\b${toolName}\\b\`, "iu")` — `toolName` is a hardcoded literal, not user input, so no escaping concern) into it. Define the semver fragment once as a module-local constant (e.g. `const SEMVER = String.raw\`\\d+\\.\\d+\\.\\d+(?:[-+.][\\w.-]+)?\``) and reuse it for both the labeled and the anchored `^v?(...)$` matches. Keep `iu` / `u` flags as today.
2. In `dolos-output.ts`: delete the private `versionFromLine` and replace `parseDolosVersionOutput`'s body with `return parseToolVersionOutput(output, "dolos");` Keep the named export so `dolos-runner.ts:145` and `dolos-output.test.ts` are untouched.
3. In `semgrep-output.ts`: same — delete the private `versionFromLine`, delegate `parseSemgrepVersionOutput` to `parseToolVersionOutput(output, "semgrep")`. Keeps `semgrep-runner.ts:174` and `semgrep-output.test.ts` untouched.
4. Add `scripts/drift-ai/tool-version.test.ts` (TDD: write first) covering: labeled banner with companion runtime lines (`"Dolos 2.9.3\nNode.js v20.12.2\n"` → `"2.9.3"`), bare-line semver (`"1.165.0"` → `"1.165.0"`), `semgrep`-labeled line among noise (`"warning: metrics\nsemgrep 1.165.0\n"` → `"1.165.0"`), and an unrecognized banner → `undefined`. These mirror the four existing assertions in `dolos-output.test.ts:28-38` and `semgrep-output.test.ts:15-26`; the existing per-module tests can stay as thin delegation smoke tests or be trimmed once the shared test exists.
5. Run the scripts project tests: `bun run test:scripts:file -- scripts/drift-ai/tool-version.test.ts` plus the two existing `*-output.test.ts` files.

## Verification / caveats
- False-positive risk is low: both `versionFromLine` bodies were read in full and differ only by the tool-name boundary; behavior is preserved by parameterizing that one token.
- Scope boundary: this is prototype-lane plumbing (per the module headers, neither file registers a drift check). Do not expand the version grammar as part of this refactor — keep it a pure behavior-preserving extraction so the diff is reviewable; any grammar improvement is a separate follow-up that now lives in one place.
- Double-check the regex constant builds the same compiled pattern (flags `u` on the anchored match, `iu` on the boundary) — a `String.raw` template plus `new RegExp` must reproduce the current literals exactly; prefer keeping the semver match itself as a literal `RegExp` if the template indirection reduces readability. The boundary regex is the only part that genuinely needs to be dynamic.
- Alternative considered and rejected: leaving the duplication and suppressing the near-duplicate finding via config. Not appropriate here — this is real, low-risk dedup with a single obvious shared home, matching the existing `path-util` / `ts-source-util` convention.
