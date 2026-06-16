# Client Effects (`useEffect`)

Read this before reaching for `useEffect` in `packages/client/src/`. Musi's
VTT domain has plenty of legitimate effects (sockets, canvas, presence, browser
APIs), so the hook is not banned — but most new effects an agent writes are one
of the patterns below in disguise. Pick the non-effect path first.

## The decision rule

Effects are only for synchronizing with external systems (socket, DOM, browser
APIs) — and socket work goes through the existing `SocketProvider` and
invalidation hooks. Everything else has a better home:

| You want to… | Do this instead of an effect |
| --- | --- |
| Sync with the socket | Use `SocketProvider` and the existing invalidation hooks, not a hand-rolled subscription. |
| Compute a value from props/state | Compute it during render (derived state), not in an effect. |
| React to a user action | Put the logic in the event handler. |
| Fetch data | Use tRPC + TanStack Query, never an effect. |
| Reset dialog/form state when a prop changes | Prefer a `key` remount over an effect that clears state. |

Smell test: if an effect only calls a `setState` synchronously, it is probably
one of the above in disguise.

## What enforces this

The accepted `set-state-in-effect` floor is frozen by the
`ratchet/react-hooks-set-state-in-effect-client` ratchet — a new synchronous
`setState` in an effect fails at commit time. See
`docs/guides/lint-ratchet.md` for how the ratchet works and how to drain it.
