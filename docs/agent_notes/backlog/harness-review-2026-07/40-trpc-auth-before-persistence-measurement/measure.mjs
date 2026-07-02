// @ts-check

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

import rule, { DEFAULT_BOUNDARY_NAMES, allowlistKey } from "./trpc-auth-before-persistence-rule.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../..");
const routerRoot = path.join(repoRoot, "packages/server/src/routers");
const ruleId = "leaf40/trpc-auth-before-persistence";
const sanctionedBoundaryNames = [
  ...DEFAULT_BOUNDARY_NAMES,
  "assertEncounterDm",
  "assertCollectionReadAccess",
  "assertAuthor",
  "loadNoteForMutation",
];

/**
 * @param {Record<string, readonly number[]>} entries
 * @returns {Map<string, string>}
 */
function classified(entries, label) {
  const result = new Map();
  for (const [file, lines] of Object.entries(entries)) {
    for (const line of lines) result.set(`${file}:${String(line)}`, label);
  }
  return result;
}

const seedOnlyRemoved = classified(
  {
    "packages/server/src/routers/encounter-map.ts": [27, 33, 40, 57, 66, 75, 97, 101, 128],
    "packages/server/src/routers/encounter.ts": [134, 154, 198, 230, 236],
    "packages/server/src/routers/homebrew.ts": [211, 230, 253, 297, 348, 359, 376, 397],
    "packages/server/src/routers/note.ts": [225, 243],
  },
  "False positive: after sanctioned router boundary",
);

const sanctionedClassifications = new Map([
  ...classified(
    {
      "packages/server/src/routers/auth.ts": [
        113, 128, 146, 200, 223, 224, 225, 256, 270, 281, 292, 297, 311, 322, 334,
      ],
    },
    "False positive: auth/session/account lifecycle",
  ),
  ...classified(
    {
      "packages/server/src/routers/magic-item.ts": [105, 124, 142],
      "packages/server/src/routers/monster.ts": [157, 182, 198],
      "packages/server/src/routers/srd.ts": [
        430, 434, 445, 449, 453, 496, 501, 506, 511, 516, 524, 529, 534, 539,
      ],
    },
    "False positive: public content read",
  ),
  ...classified(
    {
      "packages/server/src/routers/campaign.ts": [127, 150, 159, 172],
      "packages/server/src/routers/character.ts": [58, 96, 113],
      "packages/server/src/routers/homebrew.ts": [138, 191],
      "packages/server/src/routers/invite.ts": [144, 197],
      "packages/server/src/routers/notification.ts": [32, 37, 58, 70, 85],
    },
    "False positive: user-scoped or self-owned flow",
  ),
  ...classified(
    {
      "packages/server/src/routers/encounter.ts": [82, 259],
      "packages/server/src/routers/homebrew.ts": [154, 203, 223, 238, 268, 286, 308, 369, 384],
      "packages/server/src/routers/inventory.ts": [109],
      "packages/server/src/routers/invite.ts": [122],
      "packages/server/src/routers/map.ts": [51],
      "packages/server/src/routers/npc.ts": [150, 177],
    },
    "False positive: parent/author lookup before auth decision",
  ),
]);

const zeroFindingProcedureAllowlist = [
  ["packages/server/src/routers/auth.ts", "register"],
  ["packages/server/src/routers/auth.ts", "login"],
  ["packages/server/src/routers/auth.ts", "refresh"],
  ["packages/server/src/routers/auth.ts", "logout"],
  ["packages/server/src/routers/auth.ts", "getCurrentUser"],
  ["packages/server/src/routers/auth.ts", "updateProfile"],
  ["packages/server/src/routers/auth.ts", "changePassword"],
  ["packages/server/src/routers/auth.ts", "deleteAccount"],
  ["packages/server/src/routers/campaign.ts", "list"],
  ["packages/server/src/routers/campaign.ts", "get"],
  ["packages/server/src/routers/campaign.ts", "create"],
  ["packages/server/src/routers/campaign.ts", "delete"],
  ["packages/server/src/routers/character.ts", "list"],
  ["packages/server/src/routers/character.ts", "get"],
  ["packages/server/src/routers/character.ts", "create"],
  ["packages/server/src/routers/encounter.ts", "get"],
  ["packages/server/src/routers/encounter.ts", "delete"],
  ["packages/server/src/routers/encounter.ts", "setInitiative"],
  ["packages/server/src/routers/homebrew.ts", "listCollections"],
  ["packages/server/src/routers/homebrew.ts", "getCollection"],
  ["packages/server/src/routers/homebrew.ts", "createCollection"],
  ["packages/server/src/routers/homebrew.ts", "updateCollection"],
  ["packages/server/src/routers/homebrew.ts", "deleteCollection"],
  ["packages/server/src/routers/homebrew.ts", "listEntries"],
  ["packages/server/src/routers/homebrew.ts", "getEntry"],
  ["packages/server/src/routers/homebrew.ts", "createEntry"],
  ["packages/server/src/routers/homebrew.ts", "updateEntry"],
  ["packages/server/src/routers/homebrew.ts", "deleteEntry"],
  ["packages/server/src/routers/homebrew.ts", "exportCollection"],
  ["packages/server/src/routers/inventory.ts", "delete"],
  ["packages/server/src/routers/invite.ts", "getInvite"],
  ["packages/server/src/routers/invite.ts", "acceptInvite"],
  ["packages/server/src/routers/invite.ts", "join"],
  ["packages/server/src/routers/invite.ts", "revoke"],
  ["packages/server/src/routers/magic-item.ts", "list"],
  ["packages/server/src/routers/magic-item.ts", "get"],
  ["packages/server/src/routers/magic-item.ts", "search"],
  ["packages/server/src/routers/map.ts", "get"],
  ["packages/server/src/routers/monster.ts", "list"],
  ["packages/server/src/routers/monster.ts", "get"],
  ["packages/server/src/routers/monster.ts", "search"],
  ["packages/server/src/routers/notification.ts", "list"],
  ["packages/server/src/routers/notification.ts", "markRead"],
  ["packages/server/src/routers/notification.ts", "markAllRead"],
  ["packages/server/src/routers/notification.ts", "getUnreadCount"],
  ["packages/server/src/routers/npc.ts", "delete"],
  ["packages/server/src/routers/npc.ts", "getById"],
  ["packages/server/src/routers/npc.ts", "update"],
  ["packages/server/src/routers/srd.ts", "getAll"],
  ["packages/server/src/routers/srd.ts", "listConditions"],
  ["packages/server/src/routers/srd.ts", "listDamageTypes"],
  ["packages/server/src/routers/srd.ts", "listLanguages"],
  ["packages/server/src/routers/srd.ts", "listWeaponProperties"],
  ["packages/server/src/routers/srd.ts", "listWeaponMasteryProperties"],
  ["packages/server/src/routers/srd.ts", "listAlignments"],
  ["packages/server/src/routers/srd.ts", "listMagicSchools"],
  ["packages/server/src/routers/srd.ts", "listSrdProficiencies"],
  ["packages/server/src/routers/srd.ts", "listRulesGlossary"],
].map(([file, procedure]) => allowlistKey(path.join(repoRoot, file), procedure));

function routerFiles() {
  return readdirSync(routerRoot)
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => !entry.endsWith(".test.ts"))
    .filter((entry) => !entry.endsWith(".spec.ts"))
    .filter((entry) => !entry.endsWith(".test-helper.ts"))
    .sort()
    .map((entry) => path.join(routerRoot, entry));
}

async function lintRouters(options) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaVersion: 2022, sourceType: "module" },
        },
        plugins: {
          leaf40: {
            rules: { "trpc-auth-before-persistence": rule },
          },
        },
        rules: {
          [ruleId]: ["error", options],
        },
      },
    ],
  });

  return eslint.lintFiles(routerFiles());
}

function messages(results) {
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === ruleId)
      .map((message) => ({
        file: path.relative(repoRoot, result.filePath).replaceAll("\\", "/"),
        line: message.line,
        column: message.column,
        message: message.message,
      })),
  );
}

function classifyFindings(findings, classificationMap) {
  const classes = new Map();
  const unclassified = [];
  for (const finding of findings) {
    const key = `${finding.file}:${String(finding.line)}`;
    const classification = classificationMap.get(key);
    if (!classification) {
      unclassified.push(`${key}:${String(finding.column)} ${finding.message}`);
      continue;
    }
    classes.set(classification, (classes.get(classification) ?? 0) + 1);
  }
  return { classes, unclassified };
}

function assertCount(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${String(expected)} finding(s), got ${String(actual)}`);
  }
}

async function runPass(name, options, expected, classificationMap) {
  const findings = messages(await lintRouters(options));
  assertCount(name, findings.length, expected);
  const { classes, unclassified } = classifyFindings(findings, classificationMap);
  if (unclassified.length > 0) {
    throw new Error(`${name}: unclassified finding(s):\n${unclassified.join("\n")}`);
  }
  const falsePositives = [...classes.values()].reduce((sum, count) => sum + count, 0);
  console.log(`${name}: ${String(findings.length)} findings, 0 true positives, ${String(falsePositives)} false positives`);
  for (const [classification, count] of [...classes].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(`  ${String(count).padStart(2, " ")} ${classification}`);
  }
}

const files = routerFiles();
assertCount("router file count", files.length, 29);
console.log(`router files measured: ${String(files.length)}`);

await runPass(
  "seed six auth helpers only",
  { boundaryNames: DEFAULT_BOUNDARY_NAMES },
  91,
  new Map([...sanctionedClassifications, ...seedOnlyRemoved]),
);
await runPass(
  "seed helpers plus sanctioned router boundaries",
  { boundaryNames: sanctionedBoundaryNames },
  67,
  sanctionedClassifications,
);
await runPass(
  "sanctioned boundaries plus explicit current-inventory allowlist",
  {
    boundaryNames: sanctionedBoundaryNames,
    procedureAllowlist: zeroFindingProcedureAllowlist,
  },
  0,
  new Map(),
);
