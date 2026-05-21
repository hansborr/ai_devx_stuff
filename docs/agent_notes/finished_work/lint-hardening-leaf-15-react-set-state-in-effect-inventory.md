# Leaf 15 Inventory: react-hooks/set-state-in-effect

Status: Resolved — verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-15-react-set-state-in-effect.
Throwaway config: /tmp/eslint-react-set-state-in-effect.config.js
(not committed).

Scope: `packages/client/src/**/*.{ts,tsx}`, excluding test files. No
test files produced findings in this run.

## Resolution

- Verdict: `react-hooks/set-state-in-effect` **deferred** for this
  client source scope. All 24 findings are intentional UI state
  synchronization patterns: dialog resets, props-to-local draft state,
  external resource/socket bridges, or non-trivial state-machine resets.
- The rule still cannot distinguish the bug class it wants from the
  accepted patterns in this codebase. The current probe reports 24
  findings, one more than Leaf 14's 23-warning inventory, but the delta
  does not change the shape: dialog/form/resource synchronization still
  dominates.
- No production code or eslint.config.js changes landed; the rule stays
  off. Enabling it now would require broad inline disables or a larger
  UI state-pattern refactor with route/dialog coverage.
- No obvious 1-2 line bug-prevention rewrite fell out of the inventory.
  The two non-dialog state-machine sites could be redesigned in a future
  UI state pass, but neither is a clear bug or isolated lint-hardening
  cleanup.

## Summary

- Total findings: 24
- dialog-reset: 11
- props-to-local-state: 6
- external-system-sync: 5
- derived-state: 0
- cleanup-reset: 0
- other: 2

Config note: the final probe used the throwaway `/tmp` config requested
for this leaf:

```bash
bun run eslint --config /tmp/eslint-react-set-state-in-effect.config.js \
  "packages/client/src/**/*.{ts,tsx}"
```

The run reported 24 errors and 0 warnings, matching the expected
current total for this branch. The earlier Leaf 14 inventory reported
23 warnings, so this re-inventory records a +1 finding delta without a
material category change.

## Findings

### dialog-reset

- `packages/client/src/components/campaign/members/join-campaign-dialog.tsx:89`
  — closing the dialog resets the invite-code draft, field errors, and
  mutation state. Brief excerpt:

  ```ts
  if (!open) {
    setCode(initialCode ?? "");
    setFieldErrors({});
  ```

- `packages/client/src/components/campaign/settings/create-campaign-dialog.tsx:107`
  — closing the create-campaign dialog clears the local form and
  validation errors through `resetForm`. Brief excerpt:

  ```ts
  useEffect(() => {
    if (!open) {
      resetForm();
  ```

- `packages/client/src/components/campaign/tokens/add-token-dialog.tsx:223`
  — opening the add-token dialog from a map click seeds the editable
  coordinate fields from the click location. Brief excerpt:

  ```ts
  if (open && initialX != null && initialY != null) {
    setForm((f) => ({ ...f, x: String(initialX), y: String(initialY) }));
  }
  ```

- `packages/client/src/components/homebrew/collections/collection-dialog.tsx:119`
  — opening the create/edit collection dialog refreshes the local draft
  from the selected collection or defaults. Brief excerpt:

  ```ts
  useEffect(() => {
    if (open) resetForm();
  }, [open, resetForm]);
  ```

- `packages/client/src/components/homebrew/collections/delete-collection-dialog.tsx:36`
  — opening the destructive confirmation dialog clears the typed
  confirmation value. Brief excerpt:

  ```ts
  useEffect(() => {
    if (open) setConfirmName("");
  }, [open]);
  ```

- `packages/client/src/components/homebrew/entries/delete-entry-dialog.tsx:36`
  — opening the destructive entry confirmation dialog clears the typed
  confirmation value. Brief excerpt:

  ```ts
  useEffect(() => {
    if (open) setConfirmName("");
  }, [open]);
  ```

- `packages/client/src/components/homebrew/entries/entry-dialog.tsx:180`
  — opening the homebrew entry dialog resets the editor draft and clears
  validation errors. Brief excerpt:

  ```ts
  if (open) {
    resetForm();
    setFieldErrors({});
  ```

- `packages/client/src/components/sheet/cast-spell-dialog.tsx:143`
  — selecting a spell resets the cast-level and casting-option controls
  for that dialog session. Brief excerpt:

  ```ts
  if (spell) {
    setCastLevel(spell.level);
    setRitual(false);
  ```

- `packages/client/src/components/sheet/level-up-state.ts:106` — opening
  the level-up dialog resets HP, ASI, class, subclass, and metamagic
  choices for the new session. Brief excerpt:

  ```ts
  if (open) {
    setHpMethod("average");
    setHpRolled(MIN_ROLL);
  ```

- `packages/client/src/components/sheet/rest-dialog.tsx:285` — opening
  the rest dialog resets short-rest hit-dice spending. Brief excerpt:

  ```ts
  useEffect(() => {
    if (open) setHitDiceToSpend(0);
  }, [open]);
  ```

- `packages/client/src/components/sheet/weapon-mastery-dialog.tsx:108`
  — the open edge seeds local selection state from the character's
  current masteries. Brief excerpt:

  ```ts
  if (open && !prevOpen.current) {
    setSelected(new Set(currentMasteries.map((m) => m.weaponName)));
  }
  ```

### props-to-local-state

- `packages/client/src/components/campaign/maps/edit-map-dialog.tsx:83`
  — the selected map's persisted fields are copied into editable dialog
  state when the upstream map changes. Brief excerpt:

  ```ts
  if (map) {
    setName(map.name);
    const bg = map.backgroundImageUrl ?? "";
  ```

- `packages/client/src/components/campaign/notes/note-editor.tsx:151`
  — the selected note is mirrored into a local editor draft so the user
  can edit before saving. Brief excerpt:

  ```ts
  useEffect(() => {
    setTitle(note?.title ?? "");
    setContent(note?.content ?? "");
  ```

- `packages/client/src/components/campaign/npcs/npc-editor.tsx:156`
  — the NPC editor refreshes its local field object and errors when the
  selected NPC prop changes. Brief excerpt:

  ```ts
  useEffect(() => {
    setFields(defaultsFromNpc(npc));
    setFieldErrors({});
  ```

- `packages/client/src/components/campaign/tokens/edit-token-dialog.tsx:134`
  — the token prop is copied into editable form state for the edit
  dialog. Brief excerpt:

  ```ts
  if (token) {
    setForm({
      label: token.label,
  ```

- `packages/client/src/components/sheet/dm-editable-score.tsx:32` — the
  DM score input refreshes its draft value from the saved score while it
  is not being edited. Brief excerpt:

  ```ts
  useEffect(() => {
    if (!isEditing) setLocalValue(String(score));
  }, [score, isEditing]);
  ```

- `packages/client/src/components/sheet/edit-item-dialog.tsx:60` — the
  item prop is mirrored into local form fields so changes can be
  reviewed before submit. Brief excerpt:

  ```ts
  useEffect(() => {
    setName(item.name);
    setItemType(item.itemType);
  ```

### external-system-sync

- `packages/client/src/components/campaign/maps/create-map-dialog.tsx:217`
  — the effect bridges a browser `File` object URL into React preview
  state and revokes it during cleanup. Brief excerpt:

  ```ts
  const objectUrl = URL.createObjectURL(imageFile);
  setPreviewUrl(objectUrl);
  return () => {
  ```

- `packages/client/src/components/campaign/maps/edit-map-dialog.tsx:49`
  — the map image preview hook manages browser object URLs and resolved
  upload URLs as an external resource lifecycle. Brief excerpt:

  ```ts
  const objectUrl = URL.createObjectURL(imageFile);
  setPreviewUrl(objectUrl);
  return () => {
  ```

- `packages/client/src/hooks/socket-context.tsx:47` — socket lifecycle
  teardown clears the React socket reference after disconnecting the
  external Socket.io client. Brief excerpt:

  ```ts
  socketRef.current.disconnect();
  socketRef.current = null;
  setSocket(null);
  ```

- `packages/client/src/hooks/use-background-image.ts:17` — the image
  loader bridges browser `Image` load/error events into React state and
  clears stale image state when no URL is available. Brief excerpt:

  ```ts
  if (!url) {
    setImage(null);
    return;
  }
  ```

- `packages/client/src/hooks/use-campaign-presence.ts:71` — socket room
  membership drives the online-user map; clearing it when disconnected
  is part of that external synchronization. Brief excerpt:

  ```ts
  if (!socket || !campaignId || !isConnected) {
    setOnlineMap(new Map());
    return;
  }
  ```

### derived-state

No findings. The current hits are not pure render-time derivations that
can be replaced with `useMemo` or inline expressions without changing
state-machine behavior.

### cleanup-reset

No findings. Some external-system effects also clean up external
resources, but the reported sites are lifecycle bridge resets rather
than cleanup-only state writes.

### other

- `packages/client/src/components/campaign/combat/combat-map-bridges.ts:16`
  — combat movement tracking resets a turn baseline and accumulated
  movement distance when the active turn/map state changes. Brief
  excerpt:

  ```ts
  if (!map || encounter.state !== "active") {
    setTurnStartPos(null);
    setDistanceFt(0);
  ```

- `packages/client/src/hooks/use-debounced-cursor-list.ts:55` — the
  paginated list hook resets accumulated cursor state when the debounced
  search/filter key changes. Brief excerpt:

  ```ts
  if (state.resetKey === resetKey) return;
  setState({ resetKey, cursor: undefined, accumulated: [] });
  }, [resetKey, state.resetKey]);
  ```

Both sites are state-machine resets rather than simple derived values.
They could be revisited during a broader UI state-pattern pass, but
neither indicates an infinite loop, missing dependency, or small
lint-only refactor.

## Recommended next step

"Defer `react-hooks/set-state-in-effect` for the client source scope — all 24 current findings are intentional dialog resets, props-to-local draft sync, external resource/socket bridges, or non-trivial state-machine resets, so enabling it now would require broad disables or behavior refactors without surfacing a clear bug."

Revisit only if a future UI state refactor introduces shared dialog/form
patterns with tests, or if the rule gains options that can exempt
intentional local draft, dialog reset, and external bridge effects.
