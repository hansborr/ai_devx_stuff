/**
 * Validate the 15 S3 component-adjudication answers against the S3 contract and
 * merge them into working/phase5/s3-adjudication.json.
 *
 * Usage: node merge-s3.mjs <scratchdir> <packdir> [--write]
 */
import fs from 'node:fs';
import path from 'node:path';

const [scratch, pack, ...rest] = process.argv.slice(2);
const write = rest.includes('--write');

const assign = JSON.parse(fs.readFileSync(path.join(pack, 'working/phase5/s3/assignments.json'), 'utf8'));
const noms = JSON.parse(fs.readFileSync(path.join(pack, 'working/phase5/s2-nominations.json'), 'utf8'));
const packFiles = new Set(fs.readdirSync(pack).filter((f) => /^\d{3}-.*\.md$/.test(f) || /^\d{3}-PLAN\.md$/.test(f)));

const nomBy = new Map();
for (const n of noms.nominations) nomBy.set([...n.pair].sort().join('|'), n);

const RELATIONS = ['duplicate', 'subsumes', 'collides', 'contradicts', 'distinct'];
const REMEDIES = ['merge', 'add-relation', 'narrow-scope', 'no-action'];
const errors = [];
const warnings = [];
const merged = [];
const tally = { duplicate: 0, subsumes: 0, collides: 0, contradicts: 0, distinct: 0 };
const remedyTally = { merge: 0, 'add-relation': 0, 'narrow-scope': 0, 'no-action': 0 };
let pairsRuled = 0;
let overturned = 0;

for (const a of assign.assignments) {
  const id = a.id;
  const msg = path.join(scratch, `s3-${id.replace(/^s3-/, '')}.msg`);
  let ans;
  try {
    ans = JSON.parse(fs.readFileSync(msg, 'utf8'));
  } catch (e) {
    errors.push(`${id}: unreadable/invalid JSON (${e.message})`);
    continue;
  }
  const E = (m) => errors.push(`${id}: ${m}`);
  const W = (m) => warnings.push(`${id}: ${m}`);
  if (ans.contractVersion !== 1) E(`contractVersion ${ans.contractVersion}`);
  if (ans.step !== 's3') E(`step ${ans.step}`);
  if (ans.assignment !== id) W(`assignment "${ans.assignment}" != "${id}"`);
  if (!Array.isArray(ans.components)) { E('components not an array'); continue; }

  // an assignment may bundle several components (the pNN paired assignments)
  // A `component` assignment is one connected component; a `singleton-batch`
  // bundles several disjoint 2-file components, one per assigned pair.
  const declaredCount = a.kind === 'singleton-batch' ? a.pairs.length : 1;
  if (ans.components.length !== declaredCount) {
    W(`components ${ans.components.length} != declared ${declaredCount}`);
  }

  for (const c of ans.components) {
    if (!Array.isArray(c.files) || c.files.length < 2) { E('component files < 2'); continue; }
    for (const f of c.files) if (!packFiles.has(f)) E(`unknown file ${f}`);
    const expected = new Set();
    for (let i = 0; i < c.files.length; i++)
      for (let j = i + 1; j < c.files.length; j++) expected.add([c.files[i], c.files[j]].sort().join('|'));
    const seen = new Set();
    for (const m of c.matrix ?? []) {
      const key = [...m.pair].sort().join('|');
      if (seen.has(key)) E(`duplicate matrix pair ${key}`);
      seen.add(key);
      if (!expected.has(key)) E(`matrix pair outside component: ${key}`);
      if (!RELATIONS.includes(m.relation)) E(`bad relation ${m.relation} on ${key}`);
      if ((m.relation === 'subsumes') !== (m.subsumer != null)) E(`subsumer/relation mismatch on ${key}`);
      if (m.subsumer != null && !m.pair.includes(m.subsumer)) E(`subsumer not in pair on ${key}`);
      const nom = nomBy.get(key);
      if (nom && m.s2Hypothesis == null) W(`s2Hypothesis null but S2 nominated ${key}`);
      if (!nom && m.s2Hypothesis != null) W(`s2Hypothesis set but S2 did not nominate ${key}`);
      if (m.agreesWithS2 === false) overturned++;
      tally[m.relation] = (tally[m.relation] ?? 0) + 1;
      pairsRuled++;
    }
    for (const k of expected) if (!seen.has(k)) E(`matrix missing pair ${k}`);

    const r = c.remedy ?? {};
    if (!REMEDIES.includes(r.kind)) E(`bad remedy kind ${r.kind}`);
    else remedyTally[r.kind]++;
    if ((r.kind === 'merge') !== (r.survivingFile != null)) E(`survivingFile/remedy mismatch (${r.kind})`);
    if (r.survivingFile != null && !c.files.includes(r.survivingFile)) E(`survivingFile not in component`);
    const hasEdges = Array.isArray(r.edges) && r.edges.length > 0;
    if ((r.kind === 'add-relation') !== hasEdges) W(`edges/remedy mismatch (${r.kind}, ${hasEdges ? 'edges' : 'none'})`);
    if ((r.kind === 'narrow-scope') !== (r.narrowedFile != null)) E(`narrowedFile/remedy mismatch (${r.kind})`);
    if ((r.kind === 'narrow-scope') !== (r.boundary != null)) E(`boundary/remedy mismatch (${r.kind})`);
    if (!r.detail || String(r.detail).length < 40) E(`remedy detail too thin`);
    for (const e of r.edges ?? []) {
      if (!packFiles.has(e.from)) E(`edge.from unknown ${e.from}`);
      if (!packFiles.has(e.to)) E(`edge.to unknown ${e.to}`);
      if (!e.recordIn || !e.text) E(`edge missing recordIn/text (${e.from}->${e.to})`);
    }
    merged.push({ assignment: id, ...c });
  }
}

// every assigned file must appear in exactly one ruled component
const assignedFiles = new Set(assign.assignments.flatMap((a) => a.files ?? (a.components ?? []).flatMap((c) => c.files)));
const ruledFiles = new Map();
for (const c of merged) for (const f of c.files) ruledFiles.set(f, (ruledFiles.get(f) ?? 0) + 1);
for (const f of assignedFiles) if (!ruledFiles.has(f)) errors.push(`file never ruled: ${f}`);
for (const [f, n] of ruledFiles) if (n > 1) warnings.push(`file ruled in ${n} components: ${f}`);
for (const f of ruledFiles.keys()) if (!assignedFiles.has(f)) warnings.push(`ruled file not assigned: ${f}`);

const out = {
  contractVersion: 1,
  step: 's3',
  auditTargetSha: 'ebf096580b31f604861fadb3d4cbd4079da4f017',
  assignmentsCollected: assign.assignments.length,
  components: merged,
  summary: {
    componentsRuled: merged.length,
    pairsRuled,
    byRelation: tally,
    s2Overturned: overturned,
    byRemedy: remedyTally,
    filesCovered: ruledFiles.size,
  },
  validation: { errors, warnings },
};

console.log(JSON.stringify(out.summary, null, 1));
console.log(`errors: ${errors.length}`);
for (const e of errors) console.log('  E ' + e);
console.log(`warnings: ${warnings.length}`);
for (const w of warnings) console.log('  W ' + w);

if (write) {
  const p = path.join(pack, 'working/phase5/s3-adjudication.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 1) + '\n');
  console.log('wrote ' + p);
}
