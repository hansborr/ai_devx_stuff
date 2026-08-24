#!/usr/bin/env node
/**
 * Phase 5 step 2a packet builder (dependency-free ESM; `bun <path>` or `node <path>`).
 *
 * Joins the 1c adjudication onto the pooled 1b candidates and emits one author
 * packet per accepted promotion, plus the chunk assignment (4 per consult) and
 * `promotion-map.json`. Merge-with-promotion candidates are folded into their
 * target's packet as extra evidence/origin rows rather than getting a file.
 *
 * New leaves are numbered monotonically from the first free number at or above
 * 204; existing leaves 001-203 are never renumbered. `--start N` overrides the
 * base (a second reject round appends after the first round's maximum).
 *
 * usage: node build-2a-packets.mjs [--round N] [--start N]   (default round 1)
 *
 * `--round N` (N > 1) reads `adjudication-rN.json` against
 * `1c-rN/pooled-candidates.json` and writes to `working/phase5/2a-rN/` +
 * `promotion-map-rN.json`, so each earlier round's packets stay on disk as the
 * record of what those authors were actually given. A later round needs no
 * `--start`: the base derives from the live pack.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const phase5 = join(packRoot, 'working', 'phase5');
const argRound = process.argv.indexOf('--round');
const round = argRound === -1 ? 1 : Number(process.argv[argRound + 1]);
if (!Number.isSafeInteger(round) || round < 1) throw new Error(`--round must be an integer >= 1, got ${round}`);
const suffix = round === 1 ? '' : `-r${round}`;
const outDir = join(phase5, `2a${suffix}`);

const argStart = process.argv.indexOf('--start');
const explicitStart = argStart === -1 ? null : Number(process.argv[argStart + 1]);

const adjudication = JSON.parse(readFileSync(join(phase5, `adjudication${suffix}.json`), 'utf8'));
const pooled = JSON.parse(readFileSync(join(phase5, `1c${suffix}`, 'pooled-candidates.json'), 'utf8'));
const byId = new Map(pooled.candidates.map((c) => [c.promotionId, c]));

const decisions = adjudication.decisions ?? [];
const decisionById = new Map(decisions.map((d) => [d.promotionId, d]));

const accepted = decisions.filter(
  (d) => d.ruling === 'new-leaf' || d.ruling === 'augment-existing-leaf',
);
const merges = decisions.filter((d) => d.ruling === 'merge-with-promotion');

// --- numbering ---------------------------------------------------------------
const existingNumbers = readdirSync(packRoot)
  .filter((f) => /^\d{3}[-.].*\.md$/.test(f))
  .map((f) => Number(f.slice(0, 3)));
const base = explicitStart ?? Math.max(204, Math.max(...existingNumbers) + 1);

const slugify = (title, max = 52) => {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (const w of words) {
    const next = out.length ? `${out.join('-')}-${w}` : w;
    if (next.length > max && out.length) break;
    out.push(w);
  }
  return out.join('-');
};

let next = base;
const assignments = [];
for (const d of accepted) {
  const isNew = d.ruling === 'new-leaf';
  const number = isNew ? String(next++).padStart(3, '0') : d.targetLeaf.slice(0, 3);
  const file = isNew ? `${number}-${slugify(d.title)}.md` : d.targetLeaf;
  assignments.push({ promotionId: d.promotionId, ruling: d.ruling, number, file, decision: d });
}

// --- packets -----------------------------------------------------------------
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'packets'), { recursive: true });

const fmtEvidence = (ev) =>
  ev
    .map((e) => {
      const loc = e.line == null ? e.measurement : `${e.path}:${e.line}${e.endLine ? `-${e.endLine}` : ''}`;
      const path = e.line == null ? `\`${e.path}\`` : `\`${loc}\``;
      const measure = e.line == null ? ` — measurement: ${e.measurement}` : '';
      return `- ${path}${measure} — ${e.note ?? ''}`;
    })
    .join('\n');

const mergedInto = new Map();
for (const m of merges) {
  const list = mergedInto.get(m.mergeInto) ?? [];
  list.push(m);
  mergedInto.set(m.mergeInto, list);
}

for (const a of assignments) {
  const d = a.decision;
  const cand = byId.get(d.promotionId);
  const folded = mergedInto.get(d.promotionId) ?? [];
  const companionPlan = d.ruling === 'augment-existing-leaf' && existsSync(join(packRoot, `${a.number}-PLAN.md`))
    ? `${a.number}-PLAN.md`
    : null;
  const lines = [
    `# Author packet — ${d.promotionId} → \`${a.file}\``,
    '',
    `- Ruling: **${d.ruling}**${d.ruling === 'augment-existing-leaf' ? ` (edit \`${d.targetLeaf}\` in place)` : ''}`,
    `- Leaf number: **${a.number}**`,
    `- Title (settled): ${d.title}`,
    `- Theme: ${cand?.title ?? d.title}`,
    `- Area: ${d.area} · Severity: **${d.severity}** · Size: **${d.size}** · Confidence: ${d.confidence}`,
    `- AUDIT_TARGET_SHA: \`${adjudication.auditTargetSha}\``,
    `- priorPackReviewSha: \`${adjudication.priorPackReviewSha}\``,
    '',
    '## Settled direction (implement this; do not re-open it)',
    '',
    d.settledDirection ?? '(none recorded)',
    '',
    ...(d.augmentInstruction
      ? [
          '## Augment instruction (what to add or change in the target leaf)',
          '',
          d.augmentInstruction,
          '',
          `**The Area/Severity/Size above grade the material you are adding, not the host leaf.** Leave \`${d.targetLeaf}\`'s own \`Theme · Area · Severity · Size\` header exactly as it stands — a cross-cutting host does not get re-graded because a smaller addition lands inside it. (Round 1's acceptance gate proposed exactly that rewrite on all three augmentations and the orchestrator refused it; this line exists so the question does not come up again.)`,
          '',
          ...(companionPlan
            ? [
                `**This host has a companion plan, \`${companionPlan}\`, and it is in scope for you.** Return it as a second file block, revised so its slice sequence carries the material you are adding. In round 2 the plan was left out of scope and the acceptance gate caught the drift as a packet-fidelity defect that no in-file correction could close.`,
                '',
              ]
            : []),
        ]
      : []),
    '## Problem statement from the promotion candidate',
    '',
    cand?.problem ?? '(none)',
    '',
    '## Verified evidence (existence-checked at step 1b)',
    '',
    fmtEvidence(cand?.evidence ?? []),
    '',
    '## Author constraints (all must be honored)',
    '',
    ...(d.authorConstraints?.length ? d.authorConstraints.map((c) => `- ${c}`) : ['- (none)']),
    '',
    '## Prior-pack residual (what is left uncovered by the named record)',
    '',
    ...((d.priorPackResidual ?? []).length
      ? d.priorPackResidual.map((r) => `- \`${r.ref}\` — ${r.residual}`)
      : ['- (none)']),
    '',
    '## Provenance (origins — carry into the leaf Source line context)',
    '',
    ...(cand?.origins ?? []).map(
      (o) =>
        `- ${o.consult} · ${o.lane} · \`${o.sourceItemId}\` — original title: "${o.originalTitle}"; rejected because: ${o.rejectionReason}`,
    ),
    '',
    '## Existing-leaf relations',
    '',
    `- Dedup basis from 1c: ${d.dedupBasis ?? '(none)'}`,
    ...(cand?.existingLeafHints ?? []).map((h) => `- promoter hint (non-authoritative): ${h}`),
    '',
  ];

  if (folded.length) {
    lines.push('## Folded-in promotions (merge-with-promotion rulings)', '');
    for (const m of folded) {
      const mc = byId.get(m.promotionId);
      lines.push(
        `### ${m.promotionId} — ${m.title}`,
        '',
        `Contribution: ${m.mergeContribution}`,
        '',
        mc?.problem ?? '',
        '',
        fmtEvidence(mc?.evidence ?? []),
        '',
      );
    }
  }

  writeFileSync(join(outDir, 'packets', `${d.promotionId}.md`), `${lines.join('\n')}\n`);
}

// --- chunking + promotion map ------------------------------------------------
const chunks = [];
for (let i = 0; i < assignments.length; i += 4) {
  chunks.push({
    chunk: `au2a-${String(chunks.length + 1).padStart(2, '0')}`,
    members: assignments.slice(i, i + 4).map((a) => ({
      promotionId: a.promotionId,
      file: a.file,
      ruling: a.ruling,
      packet: `working/phase5/2a${suffix}/packets/${a.promotionId}.md`,
    })),
  });
}

writeFileSync(join(outDir, 'chunks.json'), `${JSON.stringify({ base, chunks }, null, 2)}\n`);
writeFileSync(
  join(phase5, `promotion-map${suffix}.json`),
  `${JSON.stringify(
    {
      step: `2a${suffix}`,
      auditTargetSha: adjudication.auditTargetSha,
      numberingBase: base,
      entries: assignments.map((a) => ({
        promotionId: a.promotionId,
        ruling: a.ruling,
        leafFile: a.file,
        leafNumber: a.number,
        mergedPromotionIds: (mergedInto.get(a.promotionId) ?? []).map((m) => m.promotionId),
      })),
      rejected: decisions.filter((d) => d.ruling === 'reject').map((d) => d.promotionId),
    },
    null,
    2,
  )}\n`,
);

// --- sanity ------------------------------------------------------------------
for (const m of merges) {
  const target = decisionById.get(m.mergeInto);
  if (!target) throw new Error(`${m.promotionId} merges into unknown ${m.mergeInto}`);
  if (target.ruling === 'merge-with-promotion' || target.ruling === 'reject') {
    throw new Error(`${m.promotionId} merges into ${m.mergeInto} whose ruling is ${target.ruling}`);
  }
}

console.log(
  `accepted ${accepted.length} (${accepted.filter((a) => a.ruling === 'new-leaf').length} new from ${base}), ` +
    `${merges.length} merged, ${decisions.length - accepted.length - merges.length} rejected; ` +
    `${chunks.length} author chunks`,
);
