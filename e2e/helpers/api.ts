/**
 * Direct API helpers for E2E tests.
 *
 * These bypass the UI to create test data quickly (e.g. characters).
 * Use when the UI flow itself isn't what we're testing.
 */
import type { AppRouter, AppRouterInputs, AppRouterOutputs } from "@musi/server/router-type";
import { type APIRequestContext, request } from "@playwright/test";

import { resolveServerBaseUrl } from "./environment.js";

/**
 * Browser-visible client origin (the Vite dev server). Vite proxies `/trpc`
 * and `/socket.io` to the API server (`packages/client/vite.config.ts`), so
 * auth cookies issued through this origin are scoped to the same host the
 * page loads from. Use this — not the direct server base URL — for any request whose
 * `Set-Cookie` the page must later present (the host-scoped `musi_refresh`
 * cookie would otherwise land in the wrong jar whenever `E2E_SERVER_URL`
 * uses a different hostname than the client origin, e.g. 127.0.0.1 vs
 * localhost). Token-authenticated data-seeding helpers don't need cookies
 * and keep using the direct server base URL.
 */

interface TrpcResult<T> {
  result: { data: T };
}

/**
 * Dotted `router.procedure` paths, split by HTTP verb so a query can never be
 * POSTed. The procedure record carries its own `_def.type`, which is what
 * makes the split derivable rather than a second hand-kept list.
 */
type RouterProcedures = AppRouter["_def"]["procedures"];

type ProcedurePathOfType<Type extends "mutation" | "query"> = {
  [Group in keyof RouterProcedures]: {
    [Name in keyof RouterProcedures[Group] & string]: RouterProcedures[Group][Name] extends {
      _def: { type: Type };
    }
      ? `${Group}.${Name}`
      : never;
  }[keyof RouterProcedures[Group] & string];
}[keyof RouterProcedures];

type MutationPath = ProcedurePathOfType<"mutation">;
type QueryPath = ProcedurePathOfType<"query">;

type ProcedureInput<Path extends string> = Path extends `${infer Group}.${infer Name}`
  ? Group extends keyof AppRouterInputs
    ? Name extends keyof AppRouterInputs[Group]
      ? AppRouterInputs[Group][Name]
      : never
    : never
  : never;

type ProcedureOutput<Path extends string> = Path extends `${infer Group}.${infer Name}`
  ? Group extends keyof AppRouterOutputs
    ? Name extends keyof AppRouterOutputs[Group]
      ? AppRouterOutputs[Group][Name]
      : never
    : never
  : never;

/**
 * Create a shared API request context. Call `dispose()` when done.
 * Reuse across multiple calls in a single beforeAll to avoid overhead.
 */
export async function createApiContext(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: resolveServerBaseUrl() });
}

/** Call a tRPC mutation via HTTP POST. */
async function trpcMutate<Path extends MutationPath>(
  ctx: APIRequestContext,
  path: Path,
  payload: ProcedureInput<Path>,
  token?: string,
): Promise<ProcedureOutput<Path>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await ctx.post(`/trpc/${path}`, { data: payload, headers });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`tRPC ${path} failed (${String(resp.status())}): ${body}`);
  }
  // type-assertion-boundary: json - tRPC response body parsed from JSON; narrowed to the procedure's declared output
  const json = (await resp.json()) as TrpcResult<ProcedureOutput<Path>>;
  return json.result.data;
}

/** Call a tRPC query via HTTP GET. */
async function trpcQuery<Path extends QueryPath>(
  ctx: APIRequestContext,
  path: Path,
  payload: ProcedureInput<Path>,
  token?: string,
): Promise<ProcedureOutput<Path>> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const input = encodeURIComponent(JSON.stringify(payload));
  const resp = await ctx.get(`/trpc/${path}?input=${input}`, { headers });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`tRPC ${path} failed (${String(resp.status())}): ${body}`);
  }
  // type-assertion-boundary: json - tRPC response body parsed from JSON; narrowed to the procedure's declared output
  const json = (await resp.json()) as TrpcResult<ProcedureOutput<Path>>;
  return json.result.data;
}

/** Register a user via the API. */
export async function apiRegister(
  ctx: APIRequestContext,
  email: string,
  password: string,
  displayName: string,
): Promise<AppRouterOutputs["auth"]["register"]> {
  return trpcMutate(ctx, "auth.register", { email, password, displayName });
}

/** Log in via the API and return an access token. */
export async function apiLogin(
  ctx: APIRequestContext,
  email: string,
  password: string,
): Promise<AppRouterOutputs["auth"]["login"]> {
  return trpcMutate(ctx, "auth.login", { email, password });
}

/**
 * The creation fields `DEFAULT_CHARACTER_INPUT` covers, plus the subspecies the
 * helper forwards conditionally. Named explicitly rather than taken as
 * `Partial<CreateInput>`: the field and enum *types* still come from the
 * procedure (so a rename or retype fails the typecheck lane), but the fixture
 * only claims to seed a minimal defaulted character. Personality text,
 * starting equipment, feats and anything added to the procedure later stay off
 * this surface — see `e2e/helpers/__type-tests__/api-fixture-restrictions.ts`.
 */
type ApiCreateCharacterOverride =
  | "speciesId"
  | "subspeciesId"
  | "backgroundId"
  | "classId"
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

/**
 * Create a minimal character via the API. Returns the character ID.
 *
 * Everything except the name falls back to `DEFAULT_CHARACTER_INPUT`.
 */
export type ApiCreateCharacterOptions = Pick<AppRouterInputs["character"]["create"], "name"> &
  Partial<Pick<AppRouterInputs["character"]["create"], ApiCreateCharacterOverride>>;

export async function apiCreateCharacter(
  ctx: APIRequestContext,
  token: string,
  opts: ApiCreateCharacterOptions,
): Promise<AppRouterOutputs["character"]["create"]> {
  const { name, subspeciesId, ...overrides } = opts;
  const input = { name, ...DEFAULT_CHARACTER_INPUT, ...overrides };
  return trpcMutate(
    ctx,
    "character.create",
    subspeciesId ? { ...input, subspeciesId } : input,
    token,
  );
}

/**
 * The level-up fields a caller controls. `hpMethod` *and* `hpRolled` are the
 * helper's: it always sends `"average"`, so a rolled value would typecheck and
 * then be dropped. Omitting only `hpMethod` would leave exactly that trap.
 */
export type ApiLevelUpCharacterInput = Pick<
  AppRouterInputs["character"]["levelUp"],
  "characterId" | "classId" | "subclassId" | "metamagicIds" | "asiChoice"
>;

/** Level a character in an existing or new class. Always takes average HP. */
export async function apiLevelUpCharacter(
  ctx: APIRequestContext,
  token: string,
  input: ApiLevelUpCharacterInput,
): Promise<AppRouterOutputs["character"]["levelUp"]> {
  return trpcMutate(ctx, "character.levelUp", { ...input, hpMethod: "average" }, token);
}

/** Create a custom inventory item. */
export async function apiCreateInventoryItem(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["inventory"]["create"],
): Promise<AppRouterOutputs["inventory"]["create"]> {
  return trpcMutate(ctx, "inventory.create", input, token);
}

/** Add a known spell to a character. */
export async function apiAddCharacterSpell(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["characterSpell"]["add"],
): Promise<AppRouterOutputs["characterSpell"]["add"]> {
  return trpcMutate(ctx, "characterSpell.add", input, token);
}

/** Toggle a known leveled spell's prepared state. */
export async function apiToggleSpellPrepared(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["characterSpell"]["togglePrepared"],
): Promise<AppRouterOutputs["characterSpell"]["togglePrepared"]> {
  return trpcMutate(ctx, "characterSpell.togglePrepared", input, token);
}

export type ApiCharacterDetail = AppRouterOutputs["character"]["get"];

/** Fetch a character with spell-slot and concentration state. */
export async function apiGetCharacter(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["character"]["get"],
): Promise<ApiCharacterDetail> {
  return trpcQuery(ctx, "character.get", input, token);
}

/** Cast a spell via the non-combat spell router. */
export async function apiCastSpell(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["castSpell"]["cast"],
): Promise<AppRouterOutputs["castSpell"]["cast"]> {
  return trpcMutate(ctx, "castSpell.cast", input, token);
}

/** List recent campaign chat messages. */
export async function apiListChatMessages(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["chat"]["list"],
): Promise<AppRouterOutputs["chat"]["list"]> {
  return trpcQuery(ctx, "chat.list", input, token);
}

/** List encounter combat logs in chronological order. */
export async function apiListCombatLogs(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["encounterCombat"]["listCombatLogs"],
): Promise<AppRouterOutputs["encounterCombat"]["listCombatLogs"]> {
  return trpcQuery(ctx, "encounterCombat.listCombatLogs", input, token);
}

/** Create a campaign via the API. */
export async function apiCreateCampaign(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["campaign"]["create"],
): Promise<AppRouterOutputs["campaign"]["create"]> {
  return trpcMutate(ctx, "campaign.create", input, token);
}

/** Create a map for a campaign. Square grid unless the caller says otherwise. */
export async function apiCreateMap(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["map"]["create"],
): Promise<AppRouterOutputs["map"]["create"]> {
  return trpcMutate(ctx, "map.create", { gridType: "square", ...input }, token);
}

/** Update an encounter's metadata. */
export async function apiUpdateEncounter(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["encounter"]["update"],
): Promise<AppRouterOutputs["encounter"]["update"]> {
  return trpcMutate(ctx, "encounter.update", input, token);
}

export type ApiEncounterSummary = AppRouterOutputs["encounter"]["list"][number];
export type ApiEncounterDetail = AppRouterOutputs["encounter"]["get"];
export type ApiEncounterParticipant = ApiEncounterDetail["participants"][number];

/** List encounters for a campaign. */
export async function apiListEncounters(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["encounter"]["list"],
): Promise<AppRouterOutputs["encounter"]["list"]> {
  return trpcQuery(ctx, "encounter.list", input, token);
}

/** Fetch a single encounter. */
export async function apiGetEncounter(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["encounter"]["get"],
): Promise<ApiEncounterDetail> {
  return trpcQuery(ctx, "encounter.get", input, token);
}

/** Create a token on a map, sized 1x1 and visible unless overridden. */
export async function apiCreateMapToken(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["mapToken"]["create"],
): Promise<AppRouterOutputs["mapToken"]["create"]> {
  return trpcMutate(
    ctx,
    "mapToken.create",
    {
      width: 1,
      height: 1,
      isVisible: true,
      color: input.color ?? "#6366f1",
      ...input,
    },
    token,
  );
}

/** Create an invite code for a campaign. */
export async function apiCreateInvite(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["invite"]["create"],
): Promise<AppRouterOutputs["invite"]["create"]> {
  return trpcMutate(ctx, "invite.create", input, token);
}

/** Join a campaign via invite code. */
export async function apiJoinCampaign(
  ctx: APIRequestContext,
  token: string,
  input: AppRouterInputs["invite"]["join"],
): Promise<AppRouterOutputs["invite"]["join"]> {
  return trpcMutate(ctx, "invite.join", input, token);
}

export const DEFAULT_CHARACTER_INPUT = {
  // Checked against the procedure input below, so a renamed or retyped
  // creation field fails the e2e typecheck instead of a browser test.
  speciesId: "species-human",
  backgroundId: "background-soldier",
  classId: "class-fighter",
  strength: 15,
  dexterity: 14,
  constitution: 13,
  intelligence: 12,
  wisdom: 10,
  charisma: 8,
} as const satisfies Partial<AppRouterInputs["character"]["create"]>;
