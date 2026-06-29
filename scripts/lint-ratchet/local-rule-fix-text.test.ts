import { describe, expect, it } from "vitest";

import type { RuleDocsEntry } from "../lib/lint-rule-docs.js";
import { type LocalRuleMessageForFix, localRuleMessageHowToFixFor } from "./local-rule-fix-text.js";

// Base fixture builder: every test starts from a valid RuleDocsEntry and
// overrides only the fields under test. `pairedGuide: "none"` keeps the
// appended-guide clause out of the way unless a test opts in.
function entry(overrides: Partial<RuleDocsEntry> = {}): RuleDocsEntry {
  return {
    id: "local/example-rule",
    description: "An example rule.",
    principle: "Keep things tidy.",
    category: "maintainability",
    pairedGuide: "none",
    repairKind: "manual",
    ...overrides,
  };
}

function messageWithFix(tail: string): LocalRuleMessageForFix {
  return { message: `Why: it is wrong. How to fix: ${tail}` };
}

describe("localRuleMessageHowToFixFor — codemod repairKind", () => {
  it("returns the rendered 'How to fix:' tail when the message carries one", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "codemod", repairCommand: "bun run codemod:x" }),
      messageWithFix("split the helper into two functions."),
    );
    expect(result).toBe("split the helper into two functions.");
  });

  it("falls back to `Run \\`<repairCommand>\\`.` when the message has no tail", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "codemod", repairCommand: "bun run codemod:x" }),
      { message: "no markers here" },
    );
    expect(result).toBe("Run `bun run codemod:x`.");
  });

  it("throws when repairKind is codemod but repairCommand is undefined", () => {
    expect(() =>
      localRuleMessageHowToFixFor(
        entry({ repairKind: "codemod", repairCommand: undefined }),
        messageWithFix("anything."),
      ),
    ).toThrow("Rule local/example-rule declares repairKind=codemod without a repairCommand");
  });
});

describe("localRuleMessageHowToFixFor — autofix repairKind", () => {
  it("returns the rendered tail when present", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "autofix" }),
      messageWithFix("reorder the imports."),
    );
    expect(result).toBe("reorder the imports.");
  });

  it("falls back to `Run \\`bun run lint:fix\\`.` when there is no tail", () => {
    const result = localRuleMessageHowToFixFor(entry({ repairKind: "autofix" }), {
      message: "plain message without markers",
    });
    expect(result).toBe("Run `bun run lint:fix`.");
  });
});

describe("localRuleMessageHowToFixFor — suggestion repairKind", () => {
  function suggestionMessage(
    desc: unknown,
    fixText: unknown,
    extra: Partial<LocalRuleMessageForFix> = {},
  ): LocalRuleMessageForFix {
    return {
      message: "plain message",
      suggestions: [{ desc, fix: { text: fixText } }],
      ...extra,
    };
  }

  it("renders the concrete-suggestion text for exactly one well-formed suggestion", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage("Use const", "const x = 1;"),
    );
    expect(result).toBe('Apply ESLint suggestion "Use const": replace with `const x = 1;`.');
  });

  it("trims the desc but preserves the fix text verbatim", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage("  Use const  ", "const x = 1;"),
    );
    expect(result).toBe('Apply ESLint suggestion "Use const": replace with `const x = 1;`.');
  });

  it("falls back to the manual rendering when there is not exactly one suggestion", () => {
    const zero = localRuleMessageHowToFixFor(entry({ repairKind: "suggestion" }), {
      message: "Why: bad. How to fix: do the manual thing.",
      suggestions: [],
    });
    expect(zero).toBe("do the manual thing.");

    const two = localRuleMessageHowToFixFor(entry({ repairKind: "suggestion" }), {
      message: "Why: bad. How to fix: do the manual thing.",
      suggestions: [
        { desc: "a", fix: { text: "x" } },
        { desc: "b", fix: { text: "y" } },
      ],
    });
    expect(two).toBe("do the manual thing.");
  });

  it("falls back to manual when desc is empty, blank, or not a string", () => {
    const empty = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage("", "const x = 1;", { message: "Why: x. How to fix: manual one." }),
    );
    expect(empty).toBe("manual one.");

    const blank = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage("   ", "const x = 1;", { message: "Why: x. How to fix: manual one." }),
    );
    expect(blank).toBe("manual one.");

    const nonString = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage(42, "const x = 1;", { message: "Why: x. How to fix: manual one." }),
    );
    expect(nonString).toBe("manual one.");
  });

  it("falls back to manual when fix.text is empty, multi-line, or not a string", () => {
    const blank = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage("Use const", "   ", { message: "Why: x. How to fix: manual one." }),
    );
    expect(blank).toBe("manual one.");

    const multiline = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage("Use const", "line1\nline2", {
        message: "Why: x. How to fix: manual one.",
      }),
    );
    expect(multiline).toBe("manual one.");

    const nonString = localRuleMessageHowToFixFor(
      entry({ repairKind: "suggestion" }),
      suggestionMessage("Use const", 7, { message: "Why: x. How to fix: manual one." }),
    );
    expect(nonString).toBe("manual one.");
  });

  it("falls back to manual when the suggestion fix is missing entirely", () => {
    const result = localRuleMessageHowToFixFor(entry({ repairKind: "suggestion" }), {
      message: "Why: x. How to fix: manual one.",
      suggestions: [{ desc: "Use const" }],
    });
    expect(result).toBe("manual one.");
  });
});

describe("localRuleMessageHowToFixFor — manual repairKind and fixTextFromMessage", () => {
  it("renders the 'How to fix:' tail for a manual rule", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "manual" }),
      messageWithFix("rewrite by hand."),
    );
    expect(result).toBe("rewrite by hand.");
  });

  it("uses the whole trimmed message when there is no 'Why: ' prefix", () => {
    const result = localRuleMessageHowToFixFor(entry({ repairKind: "manual" }), {
      message: "  How to fix: ignored because there is no Why prefix  ",
    });
    expect(result).toBe("How to fix: ignored because there is no Why prefix");
  });

  it("uses the whole message when 'Why: ' is present but the 'How to fix: ' marker is absent", () => {
    // Pins the idx === -1 guard: no marker means no negative-index slice; the
    // whole-message fallback is used instead of garbage.
    const result = localRuleMessageHowToFixFor(entry({ repairKind: "manual" }), {
      message: "Why: this is bad but there is no marker",
    });
    expect(result).toBe("Why: this is bad but there is no marker");
  });

  it("falls back past an empty tail to the whole message", () => {
    // Pins the tail.length > 0 branch: an empty tail yields undefined, so the
    // whole-message fallback wins rather than an empty string.
    const result = localRuleMessageHowToFixFor(entry({ repairKind: "manual" }), {
      message: "Why: bad. How to fix:    ",
    });
    expect(result).toBe("Why: bad. How to fix:");
  });

  it("falls back to the default fix text when the message is blank", () => {
    const result = localRuleMessageHowToFixFor(entry({ repairKind: "manual" }), {
      message: "   ",
    });
    expect(result).toBe("Resolve this local lint finding.");
  });
});

describe("localRuleMessageHowToFixFor — appendPairedGuide", () => {
  it("does not append a guide clause when pairedGuide is 'none'", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "manual", pairedGuide: "none" }),
      messageWithFix("do the thing."),
    );
    expect(result).toBe("do the thing.");
    expect(result).not.toContain("See ");
  });

  it("appends 'See <guide>.' with a single space when the text already ends in punctuation", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "manual", pairedGuide: "docs/guides/example.md" }),
      messageWithFix("do the thing."),
    );
    expect(result).toBe("do the thing. See docs/guides/example.md.");
  });

  it("inserts '. ' before 'See' when the text does not end in punctuation", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "manual", pairedGuide: "docs/guides/example.md" }),
      messageWithFix("do the thing"),
    );
    expect(result).toBe("do the thing. See docs/guides/example.md.");
  });

  it("does not duplicate the guide when the text already references it", () => {
    const result = localRuleMessageHowToFixFor(
      entry({ repairKind: "manual", pairedGuide: "docs/guides/example.md" }),
      messageWithFix("see docs/guides/example.md for context."),
    );
    expect(result).toBe("see docs/guides/example.md for context.");
    // Exactly one occurrence — the dedupe guard suppressed the appended clause.
    expect(result.match(/docs\/guides\/example\.md/gu)).toHaveLength(1);
  });
});
