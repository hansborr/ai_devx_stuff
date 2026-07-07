# 24. Self-explaining constraints: zodAlias and todoNeedsReference

Status: Done — reworded `zodAlias` to explain the literal-`z` AST matcher constraint and expanded `todoNeedsReference` with the accepted reference forms plus a drift guard.
Lens: rules · Area: discoverability · Severity: med · Size: S · Confidence: med-high
Theme: state-the-real-constraint · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Two rule messages state a demand without the information needed to satisfy
or understand it:
(a) `strict-shared-schemas/zodAlias` says "Shared schema lint rules require
Zod's runtime import to be named `z`" — circular ("the rule requires it
because a rule requires it"). The real reason: sibling rules' AST matchers
compare against the literal identifier `z`, so aliasing silently opts the
file out of strict-schema/strict-input coverage — that's the danger worth
stating.
(b) `no-llm-artifacts/todoNeedsReference` demands "a tracking reference"
but never says which forms its `TODO_REFERENCE_PATTERN` accepts (issue/PR
id, URL, `docs/roadmap`/`docs/agent_notes` path, or the literal words
"roadmap"/"agent note"). Agents guess at syntax.

## Evidence
- `eslint-rules/strict-shared-schemas.js:146-147` — zodAlias message.
- `eslint-rules/no-llm-artifacts.js:70-71` — todoNeedsReference message;
  `TODO_REFERENCE_PATTERN` in the same file defines the accepted forms.

## Proposed direction
(a) Reword the Why-clause: aliasing `z` disables sibling shared-schema
rules' detection for the whole file — that is why the name is fixed.
(b) Enumerate the accepted reference forms in the message. Note the shape
constraint: this message is currently EXEMPT (policy shape, ≤180 chars);
listing forms may not fit — either compress ("Link an issue/PR id, URL, or
docs/roadmap|agent_notes path") or convert to the Why/How shape (≤520).
Add a small test tying the message's enumerated forms to the pattern so
they can't drift.

## Scope / caveats
- Two rules, message-text only; fixtures + `message-guidance.test.js`
  must stay green; regenerate lint-guidance docs if embedded.
- For (b), the drift-guard test matters more than the exact wording — the
  pattern is the source of truth.
