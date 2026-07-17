// @ts-check
import { describe, expect, it } from "vitest";

import { jsxRuleTester, makeRuleTester } from "./rule-tester.js";
import rule from "./type-assertion-boundary.js";

const nonTestFilename = "packages/server/src/services/foo.ts";

const ruleTester = makeRuleTester();

const jsxTester = jsxRuleTester;
const jsxFilename = "packages/client/src/components/Foo.tsx";

describe("type-assertion-boundary", () => {
  it("requires boundary comments for non-test type assertions", () => {
    ruleTester.run("type-assertion-boundary", rule, {
      valid: [
        {
          code: "const x = value as const;",
          filename: nonTestFilename,
        },
        {
          code: "const x = { count: 5 } as const;",
          filename: nonTestFilename,
        },
        {
          code: "const x = value as Foo;",
          filename: "packages/server/src/services/foo.test.ts",
        },
        {
          code: "const x = value as Foo;",
          filename: "packages/server/src/services/foo.test-helper.ts",
        },
        {
          code: "const x = value as Foo;",
          filename: "e2e/foo.spec.ts",
        },
        {
          code: [
            "const x = JSON.parse(raw) as Report; // type-assertion-boundary: json - parsed persisted report payload",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // A chained double cast is one escape hatch: the outer cast is the
          // inner cast's ancestor, not a competing sibling, so one trailing
          // marker covers the whole chain.
          code: [
            "const y = x as unknown as Foo; // type-assertion-boundary: interop - runtime invariant widening",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "/** type-assertion-boundary: framework - jsdoc accepted */",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "/**",
            " * type-assertion-boundary: framework - multi-line jsdoc accepted",
            " */",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // JSDoc that explains first, then carries the marker on a later line:
          // the canonical explanation-first shape an agent writes for an interop cast.
          code: [
            "/**",
            " * Object.entries widens keys to string on this branch, so the indexed",
            " * access needs narrowing that TS cannot follow from the runtime invariant.",
            " * type-assertion-boundary: interop - keys come from validated ability deltas",
            " */",
            "const current = freshStats[key] as number;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // Marker on the last content line, after two prose lines.
          code: [
            "/**",
            " * The upstream package omits a stable runtime field on this response.",
            " * We know it is always present for the discriminated branch we handle.",
            " * type-assertion-boundary: framework - upstream lib type is too wide here",
            " */",
            "const event = value as LibraryEvent;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: framework - fastify request body validated by zod handler schema",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // A contiguous two-line `//` block whose marker is on the FIRST line:
          // the run directly above the statement is treated as one logical block.
          code: [
            "// type-assertion-boundary: framework - fastify request body",
            "// validated by the zod handler schema for this route",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // Three-line `//` block, marker on the first line, reason on the last.
          code: [
            "// type-assertion-boundary: interop - upstream package omits a",
            "// stable runtime field that we know is always present on this",
            "// branch of the response union",
            "const event = value as LibraryEvent;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: prisma - include shape is fixed by local query helper",
            "const campaign = result as CampaignWithCharacters;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: test - partial mock intentionally covers only this branch",
            "const fake = value as MockedService;",
          ].join("\n"),
          filename: "packages/server/src/services/test-support.ts",
        },
        {
          code: [
            "/* type-assertion-boundary: framework - inline before cast */ const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "/** type-assertion-boundary: framework - jsdoc inline before cast */ const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: framework - prettier inserted a blank line",
            "",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: interop - upstream package omits stable runtime field",
            "const event = value as LibraryEvent;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // Reviewer judgment catches vague reasons; the rule only requires a non-empty reason.
          code: [
            "// type-assertion-boundary: framework - make TS happy",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // A block-above marker is statement-scoped: one marker covers every cast
          // in the statement below it (the asi.ts Object.entries pattern).
          code: [
            "// type-assertion-boundary: interop - keys come from validated ability deltas",
            "const pair = [first as number, second as number];",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // An `as const` never needs a marker, so it must not compete in the
          // nearest-cast contest: the trailing marker binds to the real cast even
          // when an exempt const assertion sits between it and the comment.
          code: [
            "foo(x as Foo, y as const); // type-assertion-boundary: framework - real cast justified",
          ].join("\n"),
          filename: nonTestFilename,
        },
      ],
      invalid: [
        {
          code: "const x = value as Foo;",
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          code: [
            "// type-assertion-boundary: convenience - I hate types",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "invalidCategory" }],
        },
        {
          code: ["// type-assertion-boundary: framework -   ", "const x = value as Foo;"].join(
            "\n",
          ),
          filename: nonTestFilename,
          errors: [{ messageId: "emptyReason" }],
        },
        {
          code: [
            "// type-assertion-boundary: framework - request body",
            'console.log("interrupt");',
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          code: [
            "// type-assertion-boundary: framework - too far away",
            "",
            "",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          // Line comments must not accept a `*` prefix (that shape is JSDoc-only).
          code: [
            "// * type-assertion-boundary: framework - stray asterisk in line comment",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          // Prose on the SAME line as the marker still fails: the per-line anchor
          // requires only whitespace/asterisks before `type-assertion-boundary:`,
          // so words between the anchor and the marker break the match.
          code: [
            "/**",
            " * see type-assertion-boundary: framework - marker after prose on one line",
            " */",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          code: "const x = <Foo>value;",
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          // A hyphen-extended category is not one of the five: the hyphen must not
          // read as the reason separator, so this reports invalidCategory (not valid).
          code: [
            "// type-assertion-boundary: framework-legacy - because it was here first",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "invalidCategory" }],
        },
        {
          // Bare hyphen-suffix form with no real reason: the `-x` must not read as
          // separator-plus-reason, so this reports invalidCategory (not valid, not emptyReason).
          code: ["// type-assertion-boundary: framework-x", "const x = value as Foo;"].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "invalidCategory" }],
        },
        {
          // A trailing marker covers only the nearest-preceding cast on its line; the
          // earlier cast on the same line is not blessed by a reason written for another.
          code: [
            "foo(x as A, y as B); // type-assertion-boundary: json - one reason for both casts",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
      ],
    });
  });

  it("accepts Prettier-shaped JSX trailing boundary comments", () => {
    expect(() => {
      jsxTester.run("type-assertion-boundary (jsx trailing comments)", rule, {
        valid: [
          {
            code: [
              "const el = (",
              "  <Input",
              "    value={",
              "      form[key] as string",
              "    } /* type-assertion-boundary: framework - form field cast */",
              "  />",
              ");",
            ].join("\n"),
            filename: jsxFilename,
          },
          {
            code: [
              "const el = (",
              "  <Input value={ form[key] as string } /* type-assertion-boundary: framework - inline */ />",
              ");",
            ].join("\n"),
            filename: jsxFilename,
          },
        ],
        invalid: [],
      });
    }).not.toThrow();
  });

  it("rejects JSX assertions with no boundary comment", () => {
    expect(() => {
      jsxTester.run("type-assertion-boundary (jsx missing comment)", rule, {
        valid: [],
        invalid: [
          {
            code: [
              "const el = (",
              "  <Input",
              "    value={",
              "      form[key] as string",
              "    }",
              "  />",
              ");",
            ].join("\n"),
            filename: jsxFilename,
            errors: [{ messageId: "missingBoundary" }],
          },
        ],
      });
    }).not.toThrow();
  });

  it("rejects multiline detached JSX boundary comments", () => {
    expect(() => {
      jsxTester.run("type-assertion-boundary (jsx multiline detached comment)", rule, {
        valid: [],
        invalid: [
          {
            code: [
              "const el = (",
              "  <Input",
              "    value={",
              "      form[key] as string",
              "    }",
              "    other={bar} /* type-assertion-boundary: framework - detached prop comment */",
              "  />",
              ");",
            ].join("\n"),
            filename: jsxFilename,
            errors: [{ messageId: "missingBoundary" }],
          },
        ],
      });
    }).not.toThrow();
  });

  it("rejects inline detached JSX boundary comments", () => {
    expect(() => {
      jsxTester.run("type-assertion-boundary (jsx inline detached comment)", rule, {
        valid: [],
        invalid: [
          {
            code: [
              "const el = (",
              "  <Input value={form[key] as string} other={bar} /* type-assertion-boundary: framework - detached prop comment */ />",
              ");",
            ].join("\n"),
            filename: jsxFilename,
            errors: [{ messageId: "missingBoundary" }],
          },
        ],
      });
    }).not.toThrow();
  });
});
