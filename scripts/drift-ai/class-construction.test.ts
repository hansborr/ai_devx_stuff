import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLASS_CONSTRUCTION_STANDING_CAVEAT,
  type ClassCaveatLabeler,
  type ClassConstructionRecord,
  type ClassConstructionSourceInput,
  inventoryClasses,
  riskyContextCaveat,
} from "./class-construction.js";
import {
  DEFAULT_DEAD_CODE_CORPUS_DIR,
  findDeadCodeCorpusLabel,
  loadDeadCodeCorpusLabels,
} from "./dead-code-corpus.js";

function inventory(files: Readonly<Record<string, string>>): readonly ClassConstructionRecord[] {
  const sources: ClassConstructionSourceInput[] = Object.entries(files).map(
    ([filePath, source]) => ({ filePath, source }),
  );
  return inventoryClasses(sources).classes;
}

function recordNamed(
  records: readonly ClassConstructionRecord[],
  name: string,
): ClassConstructionRecord {
  const record = records.find((entry) => entry.name === name);
  if (record === undefined) throw new Error(`no class record named ${name}`);
  return record;
}

describe("inventoryClasses declarations", () => {
  it("records name, kind, export status, heritage, and static factory methods", () => {
    const records = inventory({
      "src/service.ts":
        "interface Disposable { dispose(): void }\n" +
        "export class Service extends Base implements Disposable {\n" +
        "  static create(): Service { return new Service(); }\n" +
        "  dispose(): void {}\n" +
        "}\n",
    });
    const service = recordNamed(records, "Service");
    expect(service.kind).toBe("declaration");
    expect(service.exportStatus).toBe("named");
    expect(service.heritage).toEqual({ extends: ["Base"], implements: ["Disposable"] });
    expect(service.staticFactoryMethods).toEqual(["create"]);
    expect(service.startLine).toBeLessThanOrEqual(service.endLine);
  });

  it("records decorators and treats a default export as the `default` display name", () => {
    const records = inventory({
      "src/widget.ts":
        "function Injectable() { return (t: unknown) => t; }\n" +
        "@Injectable()\n" +
        "export default class Widget {}\n",
    });
    const widget = recordNamed(records, "Widget");
    expect(widget.decorators).toEqual(["Injectable"]);
    expect(widget.exportStatus).toBe("default");
    expect(widget.displayName).toBe("Widget");
  });

  it("derives a referenceable name and export status for a named class expression", () => {
    const records = inventory({ "src/factory.ts": "export const Builder = class {};\n" });
    const builder = recordNamed(records, "Builder");
    expect(builder.kind).toBe("expression");
    expect(builder.exportStatus).toBe("named");
  });

  it("marks an anonymous class expression untrackable with a stable display id", () => {
    const records = inventory({ "src/handlers.ts": "const handlers = [class {}];\n" });
    expect(records).toHaveLength(1);
    const anon = records[0];
    expect(anon?.name).toBeUndefined();
    expect(anon?.displayName).toMatch(/^class@L\d+$/u);
    expect(anon?.caveats).toContain(riskyContextCaveat("anonymous-untrackable"));
  });
});

describe("inventoryClasses evidence buckets", () => {
  it("counts new expressions and separates type-only references", () => {
    const records = inventory({
      "src/widget.ts": "export class Widget {}\n",
      "src/use-widget.ts":
        "import { Widget } from './widget';\n" +
        "export function make(): Widget { return new Widget(); }\n",
    });
    const widget = recordNamed(records, "Widget");
    expect(widget.evidence.newExpressions).toBe(1);
    expect(widget.evidence.typeOnlyReferences).toBe(1);
    expect(widget.evidence.valueReferences).toBe(0);
    // An import specifier alone is not treated as construction evidence.
    expect(widget.caveats).toEqual([CLASS_CONSTRUCTION_STANDING_CAVEAT]);
  });

  it("keeps type-only references out of the construction buckets", () => {
    const records = inventory({
      "src/config.ts": "export class Config {}\n",
      "src/read.ts":
        "import type { Config } from './config';\n" +
        "export function read(c: Config): void {}\n" +
        "export let current: Config | undefined;\n",
    });
    const config = recordNamed(records, "Config");
    expect(config.evidence.typeOnlyReferences).toBe(2);
    expect(config.evidence.newExpressions).toBe(0);
    expect(config.evidence.valueReferences).toBe(0);
  });

  it("records a value reference and a static factory method without a `new`", () => {
    const records = inventory({
      "src/service.ts":
        "export class Service {\n" +
        "  private constructor() {}\n" +
        "  static create(): Service { return new Service(); }\n" +
        "}\n",
      "src/use-service.ts":
        "import { Service } from './service';\nexport const svc = Service.create();\n",
    });
    const service = recordNamed(records, "Service");
    expect(service.staticFactoryMethods).toEqual(["create"]);
    expect(service.evidence.valueReferences).toBe(1);
    expect(service.caveats).toContain(riskyContextCaveat("factory-static-construction"));
  });

  it("counts decorator-metadata references separately from value references", () => {
    const records = inventory({
      "src/payment.service.ts": "export class PaymentService {}\n",
      "src/billing.module.ts":
        "import { PaymentService } from './payment.service';\n" +
        "function Module(meta: { providers: unknown[] }) { return (t: unknown) => t; }\n" +
        "@Module({ providers: [PaymentService] })\n" +
        "export class BillingModule {}\n",
    });
    const payment = recordNamed(records, "PaymentService");
    expect(payment.evidence.decoratorReferences).toBe(1);
    expect(payment.evidence.valueReferences).toBe(0);
  });

  it("counts JSX references and subclassings as distinct construction evidence", () => {
    const records = inventory({
      "src/panel.tsx":
        "import { Component } from 'react';\n" +
        "export class Panel extends Component { render() { return null; } }\n" +
        "export class FancyPanel extends Panel { render() { return null; } }\n",
      "src/app.tsx":
        "import { Panel } from './panel';\nexport function App() { return <Panel title='x' />; }\n",
    });
    const panel = recordNamed(records, "Panel");
    expect(panel.evidence.jsxReferences).toBe(1);
    expect(panel.evidence.subclassings).toBe(1);
  });

  it("counts custom-element registrations from `customElements.define`", () => {
    const records = inventory({
      "src/badge.ts":
        "export class BadgeElement extends HTMLElement {}\n" +
        "customElements.define('x-badge', BadgeElement);\n",
    });
    const badge = recordNamed(records, "BadgeElement");
    expect(badge.evidence.customElementRegistrations).toBe(1);
  });

  it("attributes a named class expression's evidence to its binding name", () => {
    const records = inventory({
      "src/outer.ts": "export const Outer = class Inner {};\n",
      "src/use-outer.ts": "import { Outer } from './outer';\nexport const x = new Outer();\n",
    });
    const outer = recordNamed(records, "Outer");
    expect(outer.kind).toBe("expression");
    expect(outer.evidence.newExpressions).toBe(1);
  });

  it("ignores a namespace-import alias that collides with a class name", () => {
    const records = inventory({
      "src/foo.ts": "export class Foo {}\n",
      "src/prod.ts": "import * as Foo from './unrelated';\nexport { Foo };\n",
    });
    const foo = recordNamed(records, "Foo");
    expect(foo.evidence.valueReferences).toBe(0);
  });

  it("does not treat a re-export source name as a value reference", () => {
    const records = inventory({
      "src/foo.ts": "export class Foo {}\n",
      "src/barrel.ts": "import { Foo } from './foo';\nexport { Foo as Bar };\n",
    });
    expect(recordNamed(records, "Foo").evidence.valueReferences).toBe(0);
  });

  it("counts a window.customElements.define registration", () => {
    const records = inventory({
      "src/badge.ts":
        "export class BadgeElement extends HTMLElement {}\n" +
        "window.customElements.define('x-badge', BadgeElement);\n",
    });
    expect(recordNamed(records, "BadgeElement").evidence.customElementRegistrations).toBe(1);
  });

  it("counts string-keyed references for reflection-style access", () => {
    const records = inventory({
      "src/actions.ts": "export class SecretAction {}\n",
      "src/dispatch.ts":
        "import { SecretAction } from './actions';\n" +
        "const registry: Record<string, unknown> = {};\n" +
        "registry['SecretAction'] = SecretAction;\n",
    });
    const action = recordNamed(records, "SecretAction");
    expect(action.evidence.stringKeyedReferences).toBe(1);
    expect(action.evidence.valueReferences).toBe(1);
  });
});

describe("inventoryClasses risky-context caveats", () => {
  it("always carries the standing caveat", () => {
    const records = inventory({ "src/plain.ts": "export class Plain {}\n" });
    expect(recordNamed(records, "Plain").caveats).toContain(CLASS_CONSTRUCTION_STANDING_CAVEAT);
  });

  it("labels decorated and ORM-entity classes", () => {
    const records = inventory({
      "src/character.entity.ts":
        "function Entity() { return (t: unknown) => t; }\n" +
        "@Entity()\nexport class CharacterEntity { id = 1; }\n",
    });
    const entity = recordNamed(records, "CharacterEntity");
    expect(entity.caveats).toContain(riskyContextCaveat("di-or-decorator"));
    expect(entity.caveats).toContain(riskyContextCaveat("orm-entity"));
  });

  it("labels an ORM base by inheritance and its subclass as instantiated-via-subclass", () => {
    const records = inventory({
      "src/spell.ts": "class BaseEntity {}\nexport class Spell extends BaseEntity {}\n",
    });
    expect(recordNamed(records, "Spell").caveats).toContain(riskyContextCaveat("orm-entity"));
    expect(recordNamed(records, "BaseEntity").caveats).toContain(
      riskyContextCaveat("instantiated-via-subclass"),
    );
  });

  it("labels a React class component and a custom element", () => {
    const records = inventory({
      "src/panel.tsx":
        "import { Component } from 'react';\n" +
        "export class Panel extends Component { render() { return null; } }\n",
      "src/badge.ts": "export class BadgeElement extends HTMLElement {}\n",
    });
    expect(recordNamed(records, "Panel").caveats).toContain(
      riskyContextCaveat("react-class-component"),
    );
    expect(recordNamed(records, "BadgeElement").caveats).toContain(
      riskyContextCaveat("custom-element"),
    );
  });

  it("labels reflection and test-only construction", () => {
    const records = inventory({
      "src/secret.ts": "export class Secret {}\n",
      "src/secret.test.ts":
        "import { Secret } from './secret';\nconst s = new Secret();\nexport { s };\n",
      "src/lookup.ts": "const key = 'Secret';\nexport { key };\n",
    });
    const secret = recordNamed(records, "Secret");
    expect(secret.caveats).toContain(riskyContextCaveat("reflection-string-keyed"));
    expect(secret.caveats).toContain(riskyContextCaveat("test-or-fixture-only-construction"));
  });

  it("does not flag test-only construction when a production `new` also exists", () => {
    const records = inventory({
      "src/thing.ts": "export class Thing {}\n",
      "src/make.ts": "import { Thing } from './thing';\nexport const t = new Thing();\n",
      "src/make.test.ts":
        "import { Thing } from './thing';\nconst t2 = new Thing();\nexport { t2 };\n",
    });
    expect(recordNamed(records, "Thing").caveats).not.toContain(
      riskyContextCaveat("test-or-fixture-only-construction"),
    );
  });

  it("flags name-shared evidence when the same class name is declared twice", () => {
    const records = inventory({
      "a/helper.ts": "export class Helper {}\n",
      "b/helper.ts": "export class Helper {}\n",
    });
    for (const record of records) {
      expect(record.caveats).toContain(riskyContextCaveat("ambiguous-name-shared-evidence"));
    }
  });

  it("layers an injected caveat labeler onto every record's file", () => {
    const labeler: ClassCaveatLabeler = (filePath) =>
      filePath === "src/secret.ts" ? ["true-trap: dynamic-import-only"] : [];
    const { classes } = inventoryClasses(
      [{ filePath: "src/secret.ts", source: "export class Secret {}\n" }],
      {
        caveatLabeler: labeler,
      },
    );
    expect(classes[0]?.caveats).toContain("true-trap: dynamic-import-only");
  });
});

describe("inventoryClasses ordering", () => {
  it("sorts records by file path, start line, then display name", () => {
    const records = inventory({
      "src/b.ts": "export class Beta {}\n",
      "src/a.ts": "export class One {}\nexport class Two {}\n",
    });
    expect(records.map((record) => record.id)).toEqual([
      "src/a.ts#One",
      "src/a.ts#Two",
      "src/b.ts#Beta",
    ]);
  });
});

describe("dead-code FP-trap corpus calibration", () => {
  it("reads the lone corpus class as zero-construction, matching its known-unused label", () => {
    const records = inventoryClasses(readCorpusInputs()).classes;
    const adapter = recordNamed(records, "LegacyInitiativeAdapter");
    expect(adapter.evidence.newExpressions).toBe(0);
    expect(adapter.evidence.subclassings).toBe(0);
    expect(adapter.evidence.jsxReferences).toBe(0);
    expect(adapter.evidence.valueReferences).toBe(0);
    // No risky-context label fires, so the contrast class stays a genuine
    // candidate -- but it is reported as evidence, never as a verdict.
    expect(adapter.caveats).toEqual([CLASS_CONSTRUCTION_STANDING_CAVEAT]);

    const label = findDeadCodeCorpusLabel(loadDeadCodeCorpusLabels(), {
      filePath: "tombstones/obsolete-rules.ts",
      symbol: "LegacyInitiativeAdapter",
    });
    expect(label?.kind).toBe("known-unused");
  });

  it("preserves an injected trap label so a class in a trap file can never read as dead", () => {
    const labels = loadDeadCodeCorpusLabels();
    const trapLabeler: ClassCaveatLabeler = (filePath) =>
      labels.labels.filter((label) => label.path === filePath).map((l) => `${l.kind}: ${l.reason}`);
    const { classes } = inventoryClasses(
      [
        {
          filePath: "framework/routes/campaign-route.tsx",
          source: "export default class CampaignRoute {}\n",
        },
      ],
      { caveatLabeler: trapLabeler },
    );
    const route = classes[0];
    expect(route?.caveats).toContain(CLASS_CONSTRUCTION_STANDING_CAVEAT);
    expect(route?.caveats.some((caveat) => caveat.startsWith("true-trap:"))).toBe(true);
  });
});

function readCorpusInputs(): ClassConstructionSourceInput[] {
  return listCorpusSourceFiles(DEFAULT_DEAD_CODE_CORPUS_DIR, "").map((relativePath) => ({
    filePath: relativePath,
    source: readFileSync(path.join(DEFAULT_DEAD_CODE_CORPUS_DIR, relativePath), "utf8"),
  }));
}

function listCorpusSourceFiles(root: string, relativeDir: string): string[] {
  return readdirSync(path.join(root, relativeDir), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) return listCorpusSourceFiles(root, relativePath);
      return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [relativePath] : [];
    })
    .sort((left, right) => left.localeCompare(right, "en"));
}
