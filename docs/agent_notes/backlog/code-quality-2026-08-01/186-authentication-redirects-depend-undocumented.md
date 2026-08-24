# 186. Authentication redirects rely on undocumented precedence between two valid navigation props

Status: Not started
Theme: typed redirect contracts · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The authentication round trip supplies both `to` and `href` to TanStack Router's `Navigate`, with different destinations, and relies on `href` winning. Both properties are valid public navigation options; the undocumented contract is their precedence when they are supplied simultaneously.

That distinction matters because `href`-only navigation remains appropriate for the dynamic post-login destination. The debt is the duplicate destination representation and its reliance on framework internals. Unit tests cannot validate the real precedence because they use a handwritten `Navigate` stub, leaving one E2E spec to catch a router upgrade that silently drops an invite's return path.

The login and registration routes also lack validated search contracts even though `returnTo` is security-sensitive and the repository already uses route-level search validation elsewhere. Contributors maintaining the auth guards must reason about URL construction, open-redirect validation, render-behind behavior, router precedence, and test-stub fidelity at once.

## Evidence

- `packages/client/src/components/common/auth-guard.tsx:25-41` — unauthenticated navigation supplies `to="/login"` and a separately built `href`, with a comment stating that `href` must win at runtime.
- `packages/client/src/components/common/guest-guard.tsx:25-37` — the resume path repeats the two-prop convention with `to="/dashboard"` and an `href` read from the current search string.
- `packages/client/src/components/common/auth-guard.tsx:33-39` and `packages/client/src/components/common/guest-guard.tsx:30-35` — both guards contain stand-down branches that prevent a render-behind guard from overwriting the destination after navigation commits.
- `packages/client/src/lib/login-redirect.ts:32-61` — `isSafeReturnTo` is already the validation authority, while `buildLoginHref` and `readReturnTo` manually serialize and parse the query parameter around it.
- `packages/client/src/routes/login-route.ts:12-16` and `packages/client/src/routes/register-route.ts:12-16` — both routes are wrapped by `GuestGuard`, but neither declares `validateSearch`.
- `packages/client/src/routes/campaign-detail-route.ts:8-26` — the client already has an established route pattern that narrows unknown search input into a typed optional field through `validateSearch`.
- `e2e/join-return-to.spec.ts:13-24` — the real-router regression explicitly documents the dual-prop precedence, the caret-ranged dependency risk, the limitation of unit stubs, and its role as the only real-router proof.
- `packages/client/package.json:26` — `@tanstack/react-router` is caret-ranged as `^1.170.17`.
- `packages/client/src/test/mock-react-router.tsx:109-121` — the local `Navigate` stub merely exposes `to` and `href` as DOM attributes; it cannot establish which one the real router follows.
- `e2e/page-objects/join.po.ts:21-31` — the E2E page object verifies the decoded `returnTo` value on `/login` and the resumed `/join/:code` pathname.

## Proposed direction

1. Give both guest routes a typed search contract. Add `validateSearch` to `login-route.ts` and `register-route.ts`, producing `{ returnTo?: string }` by delegating to the existing `isSafeReturnTo` function. Using the same contract on both routes lets their shared `GuestGuard` read validated search uniformly. Mirror the narrowing style already used by `campaign-detail-route.ts`.

2. Replace `AuthGuard`'s dual-prop redirect with typed navigation:

   ```tsx
   <Navigate
     to="/login"
     search={returnTo ? { returnTo } : {}}
   />
   ```

   The destination route's search contract becomes the single validation boundary instead of `AuthGuard` constructing a complete URL through `buildLoginHref`. `buildLoginHref` may disappear or shrink to an internal compatibility helper, but `isSafeReturnTo` remains the one validation authority.

3. Encapsulate resume navigation in one small adapter, such as `ResumeNavigate`. It reads the validated `returnTo` value from guest-route search and renders either href-only `<Navigate href={returnTo} />` or typed `<Navigate to="/dashboard" />`. The raw dynamic href is valid and unavoidable because the destination is not one route literal; the adapter's purpose is to make it the sole raw-href boundary and eliminate conflicting props.

4. Update the guard tests and `packages/client/src/test/mock-react-router.tsx` so the stub exposes typed `search` and single-prop usage. Rewrite, rather than delete, the stub's documentation to explain that unit tests verify the adapter's inputs but not real-router navigation.

5. Retain `e2e/join-return-to.spec.ts` as the real-router round-trip proof. Rewrite its header comment around the typed search contract and href-only resume adapter. Keep semantic assertions on the decoded `returnTo` value rather than coupling the test to raw query-string encoding.

6. Extend the route, guard, and `login-redirect` tests to cover safe `/path`, query, and fragment targets; unsafe external, scheme-relative, backslash, login, and register targets; dashboard fallback; and both `/login` and `/register` search validation.

## Scope / caveats

- `href`-only navigation is not a hack and must not be described as one. Only the current dependence on precedence between simultaneous `to` and `href` props is being removed.
- Preserve both guards' `isGuestPath` stand-down branches verbatim in behavior. They prevent a destination-clobbering render-behind bug that is separate from the dual-prop problem.
- Do not loosen or otherwise change the open-redirect rules in `packages/client/src/lib/login-redirect.ts:32-45`.
- Validation must reject unsafe `returnTo` values both when search enters a guest route and when the resume adapter consumes it; no unvalidated fallback read should bypass the route contract.
- TanStack Router may serialize `/`, `?`, or `#` differently from `URLSearchParams`. Tests should assert the decoded search value and final destination, not exact encoded bytes.
- The existing E2E remains mandatory because a handwritten router stub cannot prove actual navigation behavior.
