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

## Dialog reset convention

Keep resettable state in an internal component and key that component at the
dialog boundary. Include the controlled open state and, for edit dialogs, the
entity identity:

```tsx
function EditDialogState(props: EditDialogProps): ReactElement {
  const [name, setName] = useState(props.item.name);
  // render the controlled dialog and form
}

export function EditDialog(props: EditDialogProps): ReactElement {
  return <EditDialogState key={`${String(props.open)}:${props.item.id}`} {...props} />;
}
```

The remount resets all local form and mutation state together. Do not recreate
the same lifecycle with a `prevOpen` ref or a reset effect.

## What enforces this

Two no-new ratchets enforce the decision rule without banning `useEffect`:

- `ratchet/local-no-effect-misuse-client` reports imperative fetch/query calls
  and effects whose only work is synchronously updating React state. Its
  diagnostics name the query hook, render-time derivation, event-handler, and
  keyed-remount alternatives above.
- `ratchet/react-hooks-set-state-in-effect-client` retains the broader official
  React detector for synchronous `setState` calls in effects.

See `docs/guides/lint-ratchet.md` for how the ratchets work and how to drain
their accepted baseline debt.
