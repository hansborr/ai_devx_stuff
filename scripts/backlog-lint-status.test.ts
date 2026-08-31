import { describe, expect, it } from "vitest";

import { lifecycleFromStatus, terminalStatus } from "./backlog-lint-status.js";

describe("lifecycleFromStatus", () => {
  it("reads a bare terminal token as terminal", () => {
    expect(lifecycleFromStatus("Done")).toBe("terminal");
    expect(lifecycleFromStatus("Superseded by 142")).toBe("terminal");
  });

  it("reads a bare active token as actionable", () => {
    expect(lifecycleFromStatus("Parked task index")).toBe("actionable");
    expect(lifecycleFromStatus("Ready")).toBe("actionable");
  });

  it("defaults to actionable when the status carries no recognized token", () => {
    expect(lifecycleFromStatus("Not started")).toBe("actionable");
    expect(lifecycleFromStatus("Approved 2026-07-21 — owner signed off")).toBe("actionable");
  });

  it("honors the vocabulary's negation semantics", () => {
    expect(lifecycleFromStatus("Proposed — NOT implemented")).toBe("actionable");
  });

  it("lets the first clause that declares a state win", () => {
    // The note's own state is the leading clause; later clauses report on
    // sub-items and must not flip the note itself.
    expect(lifecycleFromStatus("largely landed. DL-1 and A11Y-1 are Done")).toBe("actionable");
    expect(lifecycleFromStatus("Closed — all 55 findings landed")).toBe("terminal");
  });

  it("still reads a later clause when no earlier clause declares a state", () => {
    expect(lifecycleFromStatus("Not started; done elsewhere")).toBe("terminal");
  });

  it("lets a terminal word win inside the clause that carries it", () => {
    // Punctuation decides the clause, and a terminal word anywhere in a clause
    // is part of that clause's statement — so the two spellings differ.
    expect(lifecycleFromStatus("Parked superseded by 142")).toBe("terminal");
    expect(lifecycleFromStatus("Parked. Superseded by 142")).toBe("actionable");
  });

  it("reads a leading completion word as the note's own closure", () => {
    expect(lifecycleFromStatus("Landed on fix/cq-084")).toBe("terminal");
    expect(lifecycleFromStatus("**Landed 2026-07-27 on branch `feat/cq-slice-h`**")).toBe(
      "terminal",
    );
    expect(lifecycleFromStatus("Complete disposition ledger")).toBe("terminal");
  });

  it("reads a leading companion-role word as a record that asks for no work", () => {
    expect(lifecycleFromStatus("Reference — standing rulings for the pack")).toBe("terminal");
    expect(lifecycleFromStatus("Provenance record (shared context; not a task leaf)")).toBe(
      "terminal",
    );
  });

  it("keeps a hedged, attributed, or negated completion word actionable", () => {
    // The ruling is lead-position only: everything here reports on something
    // else, or hedges, so the note itself still asks for work.
    expect(lifecycleFromStatus("largely landed (reconciled 2026-07-19)")).toBe("actionable");
    expect(lifecycleFromStatus("HC-1 landed (`1fdea456`); HS-1 is half-landed")).toBe("actionable");
    expect(
      lifecycleFromStatus("Active residue after the docs audit. Landed/design-complete leaves"),
    ).toBe("actionable");
    expect(lifecycleFromStatus("Not landed yet")).toBe("actionable");
    expect(lifecycleFromStatus("Parked — the provenance record lives in DRAIN.md")).toBe(
      "actionable",
    );
  });

  it("reads a leading plain-English closure verb as terminal", () => {
    // 2026-08-30 residue ruling: these mean exactly what `done`/`rejected`
    // already mean, so they join the terminal list rather than a second one.
    expect(lifecycleFromStatus("Finished — all four slices landed")).toBe("terminal");
    expect(lifecycleFromStatus("Cancelled — owner decision; retained as evidence")).toBe(
      "terminal",
    );
    expect(lifecycleFromStatus("Finalized and landed on `main`")).toBe("terminal");
    expect(lifecycleFromStatus("Not finished")).toBe("actionable");
  });

  it("reads a leading archival role word as a record that asks for no work", () => {
    expect(lifecycleFromStatus("Historical — nothing here is in flight")).toBe("terminal");
    expect(lifecycleFromStatus("Final audit record")).toBe("terminal");
  });

  it("keeps an archival role word actionable away from the lead position", () => {
    // `historical` and `final` are ordinary adjectives mid-status: they
    // describe a section or a measurement, not the note's own state.
    expect(lifecycleFromStatus("Parked — the historical finding stays as evidence")).toBe(
      "actionable",
    );
    expect(lifecycleFromStatus("In progress — final parity measurements pending")).toBe(
      "actionable",
    );
  });

  it("lets a hedge neutralize a terminal word the way a negation does", () => {
    expect(
      lifecycleFromStatus("Mostly drained — 7 of 9 implemented; 10 and the 05 probe remain"),
    ).toBe("actionable");
    expect(lifecycleFromStatus("PARTIALLY IMPLEMENTED (reconciled 2026-07-13)")).toBe("actionable");
  });

  it("only lets a hedge reach the terminal word it precedes", () => {
    // "Done for the pairing half" is a completed note that happens to name a
    // half; the qualifier must come first to qualify anything.
    expect(lifecycleFromStatus("Done for the pairing half; the boundary half is deferred")).toBe(
      "terminal",
    );
  });

  it("differs from terminalStatus only where an active clause precedes a terminal one", () => {
    // terminalStatus answers "does this text assert completion anywhere?" for
    // index-row/leaf drift; lifecycleFromStatus answers "what state does this
    // note declare for itself?". This is the one shape where they disagree.
    expect(terminalStatus("largely landed. DL-1 and A11Y-1 are Done")).toBe(true);
    expect(lifecycleFromStatus("largely landed. DL-1 and A11Y-1 are Done")).toBe("actionable");
  });
});

describe("terminalStatus", () => {
  it.each([
    "done",
    "implemented",
    "shipped",
    "closed",
    "drained",
    "cancelled",
    "finalized",
    "finished",
    "Done — landed",
    "Implemented 2026-07-07",
    "Done for the pairing half",
  ])("reads %j as finished", (status) => {
    expect(terminalStatus(status)).toBe(true);
  });

  it.each([
    "unimplemented",
    "not implemented",
    "NOT implemented",
    "not really done",
    "not yet fully implemented",
    "Proposed — NOT implemented. Re-verify.",
    "Design recorded",
    "Ready",
    "Mostly drained",
    "Not finished",
  ])("reads %j as not finished", (status) => {
    expect(terminalStatus(status)).toBe(false);
  });

  // The two cases below document accepted tokenizer QUIRKS, not endorsed
  // semantics. They pin the current behavior so a future tokenizer change
  // that alters either is a deliberate decision, not an accident.

  it("quirk: a negation neutralizes every later terminal token in its clause", () => {
    // "not" carries to the end of the clause (there is no punctuation between),
    // so the affirmative "shipped" is also neutralized and the status reads
    // active even though the author meant it as finished.
    expect(terminalStatus("not done but shipped")).toBe(false);
  });

  it("quirk: hyphens split clauses, so a negated hyphenated status reads terminal", () => {
    // "-" is a clause boundary; "not-yet-done" splits into three clauses and
    // the bare "done" clause carries no negation, so the status reads finished
    // despite the negation. Pre-existing blindness (the old \s+ split had it too).
    expect(terminalStatus("not-yet-done")).toBe(true);
  });
});
