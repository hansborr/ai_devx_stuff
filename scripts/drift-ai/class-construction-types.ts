// Shared types and heuristic vocabulary for the class-construction evidence
// inventory (prototype lane, task 48a). This is the library half of the
// never-instantiated-classes prototype: it models class declarations plus the
// construction/reference evidence and caveat signals SEPARATELY, so the later
// advisory output (task 48) can never collapse "no `new` expression" into a
// dead-code verdict. No `DriftCheckId`, subcommand, or advisory row lives here.

import { toPosix } from "./path-util.js";

export type ClassConstructionSourceInput = {
  readonly filePath: string;
  readonly source: string;
};

export type ClassExportStatus = "named" | "default" | "internal";

type ClassDeclarationKind = "declaration" | "expression";

export type ClassHeritage = {
  readonly extends: readonly string[];
  readonly implements: readonly string[];
};

// The static shape of a class declaration / expression, independent of any
// reference evidence. `name` is the referenceable identifier used to attribute
// cross-file evidence; `displayName` is always present for stable ids/ordering.
export type ClassDeclarationInfo = {
  readonly id: string;
  readonly filePath: string;
  readonly name: string | undefined;
  readonly displayName: string;
  readonly kind: ClassDeclarationKind;
  readonly exportStatus: ClassExportStatus;
  readonly startLine: number;
  readonly endLine: number;
  readonly decorators: readonly string[];
  readonly heritage: ClassHeritage;
  readonly staticFactoryMethods: readonly string[];
};

// Every reference identifier/string is classified into exactly one bucket so a
// single use is never double-counted. `value` is the residual non-type,
// non-construction reference (argument, `Foo.staticMethod()`, re-render, ...).
export type ClassReferenceBucket =
  | "new"
  | "subclass"
  | "jsx"
  | "custom-element"
  | "decorator"
  | "value"
  | "type"
  | "string-keyed";

export type ClassReferenceEvent = {
  readonly name: string;
  readonly bucket: ClassReferenceBucket;
  readonly filePath: string;
  readonly isTestFile: boolean;
};

// Counts kept deliberately separate. The advisory layer must report these as
// distinct signals; it must NOT sum them into a single "is it used" boolean.
export type ClassConstructionEvidence = {
  readonly newExpressions: number;
  readonly subclassings: number;
  readonly jsxReferences: number;
  readonly customElementRegistrations: number;
  readonly decoratorReferences: number;
  readonly valueReferences: number;
  readonly typeOnlyReferences: number;
  readonly stringKeyedReferences: number;
};

export type ClassConstructionRecord = ClassDeclarationInfo & {
  readonly evidence: ClassConstructionEvidence;
  readonly caveats: readonly string[];
};

export type ClassConstructionInventory = {
  readonly classes: readonly ClassConstructionRecord[];
};

// Layered onto every record so a downstream consumer (task 48, the corpus tests)
// can attach evidence a single-file AST scan cannot show -- dynamic-import-only
// reachability, reflection, or an injected dead-code FP-trap corpus label.
export type ClassCaveatLabeler = (filePath: string) => readonly string[];

export type ClassConstructionOptions = {
  readonly caveatLabeler?: ClassCaveatLabeler;
  readonly testFilePattern?: RegExp;
  readonly factoryMethodNames?: Iterable<string>;
};

const RISKY_CONTEXT_PREFIX = "risky-context: ";

// The standing reminder carried by every record: zero construction evidence is a
// lead, never a verdict. It enumerates the live contexts a never-`new`ed class
// can legitimately be constructed through.
export const CLASS_CONSTRUCTION_STANDING_CAVEAT =
  "the absence of a `new` expression is not a dead-code verdict: a class can be constructed by a " +
  "DI container, an ORM, a framework router/registry, a React or JSX render, a custom-element " +
  "registry, a static factory, reflection / string-keyed lookup, a subclass instance, or only in " +
  "tests. Treat zero construction evidence as a lead to investigate, never as proof the class is " +
  "never instantiated.";

// Risky-context kinds. Returned as caveat labels rather than silently suppressing
// the class, so the evidence stays visible while the danger stays attached.
export type ClassRiskyContext =
  | "di-or-decorator"
  | "orm-entity"
  | "react-class-component"
  | "custom-element"
  | "factory-static-construction"
  | "reflection-string-keyed"
  | "instantiated-via-subclass"
  | "test-or-fixture-only-construction"
  | "anonymous-untrackable"
  | "ambiguous-name-shared-evidence";

// Decorator name -> di-or-decorator is keyed on "any decorator present"; these
// extra sets refine the more specific framework caveats.
export const DEFAULT_ORM_ENTITY_DECORATORS: readonly string[] = [
  "Entity",
  "Table",
  "Model",
  "Schema",
  "ObjectType",
  "Node",
];

export const DEFAULT_ORM_BASE_NAMES: readonly string[] = ["BaseEntity", "Model", "ActiveRecord"];

export const DEFAULT_REACT_BASE_NAMES: readonly string[] = ["Component", "PureComponent"];

export const DEFAULT_CUSTOM_ELEMENT_BASE_NAMES: readonly string[] = [
  "HTMLElement",
  "LitElement",
  "HTMLButtonElement",
  "HTMLDivElement",
  "HTMLInputElement",
];

export const DEFAULT_FACTORY_METHOD_NAMES: readonly string[] = [
  "create",
  "from",
  "of",
  "make",
  "build",
  "getInstance",
  "instance",
  "fromJSON",
  "parse",
];

export function classRecordId(filePath: string, displayName: string): string {
  return `${toPosix(filePath)}#${displayName}`;
}

export function riskyContextCaveat(kind: ClassRiskyContext): string {
  return `${RISKY_CONTEXT_PREFIX}${kind}`;
}
