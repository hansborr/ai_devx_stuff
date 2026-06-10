// Public surface for the class-construction evidence inventory (prototype lane,
// task 48a). `inventoryClasses` parses a set of in-memory sources, inventories
// every class, attributes name-based reference evidence across the whole set,
// and attaches caveat labels for the risky construction contexts a static scan
// cannot rule out. It is library/test-only: no `DriftCheckId`, subcommand, or
// advisory row. Task 48 owns the user-facing never-instantiated-classes output.

import { ts } from "ts-morph";

import { collectClassDeclarations } from "./class-construction-declarations.js";
import { collectClassReferenceEvents } from "./class-construction-references.js";
import {
  CLASS_CONSTRUCTION_STANDING_CAVEAT,
  type ClassCaveatLabeler,
  type ClassConstructionEvidence,
  type ClassConstructionInventory,
  type ClassConstructionOptions,
  type ClassConstructionRecord,
  type ClassConstructionSourceInput,
  type ClassDeclarationInfo,
  type ClassReferenceBucket,
  type ClassReferenceEvent,
  DEFAULT_CUSTOM_ELEMENT_BASE_NAMES,
  DEFAULT_FACTORY_METHOD_NAMES,
  DEFAULT_ORM_BASE_NAMES,
  DEFAULT_ORM_ENTITY_DECORATORS,
  DEFAULT_REACT_BASE_NAMES,
  riskyContextCaveat,
} from "./class-construction-types.js";
import { toPosix } from "./path-util.js";
import { scriptKindFor } from "./ts-source-util.js";

export {
  CLASS_CONSTRUCTION_STANDING_CAVEAT,
  CLASS_RISKY_CONTEXTS,
  type ClassCaveatLabeler,
  type ClassConstructionEvidence,
  type ClassConstructionInventory,
  type ClassConstructionOptions,
  type ClassConstructionRecord,
  type ClassConstructionSourceInput,
  type ClassDeclarationInfo,
  type ClassReferenceBucket,
  type ClassReferenceEvent,
  type ClassRiskyContext,
  riskyContextCaveat,
} from "./class-construction-types.js";

// A class is considered "constructed somewhere" only through these buckets;
// type-only, decorator-metadata, and string-keyed references are tracked but do
// not count toward the test-only-construction determination.
const CONSTRUCTION_BUCKETS: ReadonlySet<ClassReferenceBucket> = new Set([
  "new",
  "subclass",
  "jsx",
  "custom-element",
  "value",
]);

const DEFAULT_TEST_FILE_PATTERN =
  /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|__mocks__|__fixtures__|fixtures)\//u;

type ParsedClassFile = {
  readonly filePath: string;
  readonly isTestFile: boolean;
  readonly sourceFile: ts.SourceFile;
};

export function inventoryClasses(
  sources: readonly ClassConstructionSourceInput[],
  options: ClassConstructionOptions = {},
): ClassConstructionInventory {
  const factoryNames = new Set(options.factoryMethodNames ?? DEFAULT_FACTORY_METHOD_NAMES);
  const testPattern = options.testFilePattern ?? DEFAULT_TEST_FILE_PATTERN;
  const parsed = sources.map((input) => parseInput(input, testPattern));
  const infos = parsed.flatMap((file) =>
    collectClassDeclarations(file.sourceFile, file.filePath, factoryNames),
  );
  const classNames = new Set(definedNames(infos));
  const events = parsed.flatMap((file) =>
    collectClassReferenceEvents(file.sourceFile, file.filePath, file.isTestFile, classNames),
  );
  const byName = groupEventsByName(events);
  const sharedNames = namesDeclaredMoreThanOnce(infos);
  const records = infos.map((info) =>
    buildRecord(info, eventsFor(info, byName), sharedNames, options.caveatLabeler),
  );
  return { classes: sortRecords(records) };
}

function parseInput(input: ClassConstructionSourceInput, testPattern: RegExp): ParsedClassFile {
  const filePath = toPosix(input.filePath);
  return {
    filePath,
    isTestFile: testPattern.test(filePath),
    sourceFile: ts.createSourceFile(
      input.filePath,
      input.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(input.filePath),
    ),
  };
}

function buildRecord(
  info: ClassDeclarationInfo,
  events: readonly ClassReferenceEvent[],
  sharedNames: ReadonlySet<string>,
  labeler: ClassCaveatLabeler | undefined,
): ClassConstructionRecord {
  const evidence = countEvidence(events);
  return {
    ...info,
    evidence,
    caveats: deriveCaveats(info, evidence, events, sharedNames, labeler),
  };
}

function deriveCaveats(
  info: ClassDeclarationInfo,
  evidence: ClassConstructionEvidence,
  events: readonly ClassReferenceEvent[],
  sharedNames: ReadonlySet<string>,
  labeler: ClassCaveatLabeler | undefined,
): string[] {
  return dedupePreserveOrder([
    CLASS_CONSTRUCTION_STANDING_CAVEAT,
    ...declarationCaveats(info, evidence),
    ...evidenceCaveats(info, evidence, events, sharedNames),
    ...(labeler?.(info.filePath) ?? []),
  ]);
}

function declarationCaveats(
  info: ClassDeclarationInfo,
  evidence: ClassConstructionEvidence,
): string[] {
  const caveats: string[] = [];
  if (info.decorators.length > 0) caveats.push(riskyContextCaveat("di-or-decorator"));
  if (isOrmEntity(info)) caveats.push(riskyContextCaveat("orm-entity"));
  if (isReactComponent(info)) caveats.push(riskyContextCaveat("react-class-component"));
  if (isCustomElement(info, evidence)) caveats.push(riskyContextCaveat("custom-element"));
  if (info.staticFactoryMethods.length > 0) {
    caveats.push(riskyContextCaveat("factory-static-construction"));
  }
  return caveats;
}

function evidenceCaveats(
  info: ClassDeclarationInfo,
  evidence: ClassConstructionEvidence,
  events: readonly ClassReferenceEvent[],
  sharedNames: ReadonlySet<string>,
): string[] {
  const caveats: string[] = [];
  if (evidence.stringKeyedReferences > 0)
    caveats.push(riskyContextCaveat("reflection-string-keyed"));
  if (evidence.subclassings > 0) caveats.push(riskyContextCaveat("instantiated-via-subclass"));
  if (isTestOnlyConstruction(events)) {
    caveats.push(riskyContextCaveat("test-or-fixture-only-construction"));
  }
  if (info.name === undefined) caveats.push(riskyContextCaveat("anonymous-untrackable"));
  else if (sharedNames.has(info.name))
    caveats.push(riskyContextCaveat("ambiguous-name-shared-evidence"));
  return caveats;
}

function isOrmEntity(info: ClassDeclarationInfo): boolean {
  return (
    info.decorators.some((name) => DEFAULT_ORM_ENTITY_DECORATORS.includes(name)) ||
    info.heritage.extends.some((name) => DEFAULT_ORM_BASE_NAMES.includes(name))
  );
}

function isReactComponent(info: ClassDeclarationInfo): boolean {
  return info.heritage.extends.some((name) => DEFAULT_REACT_BASE_NAMES.includes(name));
}

function isCustomElement(info: ClassDeclarationInfo, evidence: ClassConstructionEvidence): boolean {
  return (
    evidence.customElementRegistrations > 0 ||
    info.heritage.extends.some((name) => DEFAULT_CUSTOM_ELEMENT_BASE_NAMES.includes(name))
  );
}

function isTestOnlyConstruction(events: readonly ClassReferenceEvent[]): boolean {
  const construction = events.filter((event) => CONSTRUCTION_BUCKETS.has(event.bucket));
  return construction.length > 0 && construction.every((event) => event.isTestFile);
}

function countEvidence(events: readonly ClassReferenceEvent[]): ClassConstructionEvidence {
  return {
    newExpressions: countBucket(events, "new"),
    subclassings: countBucket(events, "subclass"),
    jsxReferences: countBucket(events, "jsx"),
    customElementRegistrations: countBucket(events, "custom-element"),
    decoratorReferences: countBucket(events, "decorator"),
    valueReferences: countBucket(events, "value"),
    typeOnlyReferences: countBucket(events, "type"),
    stringKeyedReferences: countBucket(events, "string-keyed"),
  };
}

function countBucket(events: readonly ClassReferenceEvent[], bucket: ClassReferenceBucket): number {
  return events.filter((event) => event.bucket === bucket).length;
}

function eventsFor(
  info: ClassDeclarationInfo,
  byName: ReadonlyMap<string, readonly ClassReferenceEvent[]>,
): readonly ClassReferenceEvent[] {
  return info.name === undefined ? [] : (byName.get(info.name) ?? []);
}

function definedNames(infos: readonly ClassDeclarationInfo[]): string[] {
  return infos.flatMap((info) => (info.name === undefined ? [] : [info.name]));
}

function groupEventsByName(
  events: readonly ClassReferenceEvent[],
): Map<string, ClassReferenceEvent[]> {
  const byName = new Map<string, ClassReferenceEvent[]>();
  for (const event of events) {
    const list = byName.get(event.name);
    if (list === undefined) byName.set(event.name, [event]);
    else list.push(event);
  }
  return byName;
}

function namesDeclaredMoreThanOnce(infos: readonly ClassDeclarationInfo[]): Set<string> {
  const counts = new Map<string, number>();
  for (const name of definedNames(infos)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function sortRecords(records: readonly ClassConstructionRecord[]): ClassConstructionRecord[] {
  return [...records].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath, "en") ||
      left.startLine - right.startLine ||
      left.displayName.localeCompare(right.displayName, "en"),
  );
}

function dedupePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
