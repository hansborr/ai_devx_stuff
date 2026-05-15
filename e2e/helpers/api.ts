/**
 * Direct API helpers for E2E tests.
 *
 * These bypass the UI to create test data quickly (e.g. characters).
 * Use when the UI flow itself isn't what we're testing.
 */
import { execFileSync } from "node:child_process";

import { type APIRequestContext, request } from "@playwright/test";

const DEFAULT_SERVER_PORT = "8001";

function gitPath(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function isSecondaryWorktree(): boolean {
  const commonDir = gitPath(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const gitDir = gitPath(["rev-parse", "--path-format=absolute", "--git-dir"]);
  return commonDir !== null && gitDir !== null && commonDir !== gitDir;
}

function resolveServerBaseUrl(): string {
  const explicitUrl = process.env["E2E_SERVER_URL"];
  if (explicitUrl) return explicitUrl;

  const serverPort = process.env["SERVER_PORT"];
  if (serverPort) return `http://localhost:${serverPort}`;

  if (isSecondaryWorktree()) {
    throw new Error(
      "E2E_SERVER_URL or SERVER_PORT must be set for E2E API helpers in a secondary worktree; run `bun run worktree:init` and load the generated .env, or set E2E_SERVER_URL explicitly.",
    );
  }

  return `http://localhost:${DEFAULT_SERVER_PORT}`;
}

const SERVER_BASE_URL = resolveServerBaseUrl();

interface TrpcResult<T> {
  result: { data: T };
}

/**
 * Create a shared API request context. Call `dispose()` when done.
 * Reuse across multiple calls in a single beforeAll to avoid overhead.
 */
export async function createApiContext(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: SERVER_BASE_URL });
}

/** Call a tRPC mutation via HTTP POST. */
async function trpcMutate<T>(
  ctx: APIRequestContext,
  path: string,
  payload: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await ctx.post(`/trpc/${path}`, { data: payload, headers });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`tRPC ${path} failed (${String(resp.status())}): ${body}`);
  }
  const json = (await resp.json()) as TrpcResult<T>;
  return json.result.data;
}

/** Call a tRPC query via HTTP GET. */
async function trpcQuery<T>(
  ctx: APIRequestContext,
  path: string,
  payload: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const input = encodeURIComponent(JSON.stringify(payload));
  const resp = await ctx.get(`/trpc/${path}?input=${input}`, { headers });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`tRPC ${path} failed (${String(resp.status())}): ${body}`);
  }
  const json = (await resp.json()) as TrpcResult<T>;
  return json.result.data;
}

/** Register a user via the API. */
export async function apiRegister(
  ctx: APIRequestContext,
  email: string,
  password: string,
  displayName: string,
): Promise<{ user: { id: string; email: string; displayName: string } }> {
  return trpcMutate(ctx, "auth.register", { email, password, displayName });
}

/** Log in via the API and return an access token. */
export async function apiLogin(
  ctx: APIRequestContext,
  email: string,
  password: string,
): Promise<{ accessToken: string; user: { id: string; email: string; displayName: string } }> {
  return trpcMutate(ctx, "auth.login", { email, password });
}

/** Create a minimal character via the API. Returns the character ID. */
export async function apiCreateCharacter(
  ctx: APIRequestContext,
  token: string,
  opts: {
    name: string;
    speciesId?: string;
    subspeciesId?: string;
    classId?: string;
    backgroundId?: string;
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
  },
): Promise<{ id: string }> {
  const { name, subspeciesId, ...overrides } = opts;
  const input = { name, ...DEFAULT_CHARACTER_INPUT, ...overrides };
  return trpcMutate(
    ctx,
    "character.create",
    subspeciesId ? { ...input, subspeciesId } : input,
    token,
  );
}

/** Create an equipped custom inventory item. */
export async function apiCreateInventoryItem(
  ctx: APIRequestContext,
  token: string,
  input: {
    characterId: string;
    name: string;
    itemType: "weapon" | "armor" | "shield" | "gear" | "tool" | "consumable" | "other";
    equipped?: boolean;
    properties?: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  return trpcMutate(ctx, "inventory.create", input, token);
}

/** Add a known spell to a character. */
export async function apiAddCharacterSpell(
  ctx: APIRequestContext,
  token: string,
  input: { characterId: string; spellId: string; source: "class" | "species" | "feat" | "item" },
): Promise<{ id: string }> {
  return trpcMutate(ctx, "characterSpell.add", input, token);
}

/** Toggle a known leveled spell's prepared state. */
export async function apiToggleSpellPrepared(
  ctx: APIRequestContext,
  token: string,
  input: { characterId: string; spellId: string; campaignId?: string },
): Promise<{ id: string; prepared: boolean }> {
  return trpcMutate(ctx, "characterSpell.togglePrepared", input, token);
}

export interface ApiCharacterSpellSlot {
  id: string;
  characterId: string;
  spellLevel: number;
  total: number;
  used: number;
}

export interface ApiCharacterDetail {
  id: string;
  name: string;
  stats: { concentrationSpellId: string | null } | null;
  spellSlots: ApiCharacterSpellSlot[];
}

/** Fetch a character with spell-slot and concentration state. */
export async function apiGetCharacter(
  ctx: APIRequestContext,
  token: string,
  input: { id: string },
): Promise<ApiCharacterDetail> {
  return trpcQuery(ctx, "character.get", input, token);
}

/** Cast a spell via the non-combat spell router. */
export async function apiCastSpell(
  ctx: APIRequestContext,
  token: string,
  input: {
    characterId: string;
    spellId: string;
    castAtLevel: number;
    ritual?: boolean;
    campaignId?: string;
  },
): Promise<{ persisted: boolean }> {
  return trpcMutate(ctx, "castSpell.cast", input, token);
}

export interface ApiChatMessage {
  id: string;
  campaignId: string;
  content: string;
  type: "chat" | "system" | "roll" | "combat" | "whisper";
}

/** List recent campaign chat messages. */
export async function apiListChatMessages(
  ctx: APIRequestContext,
  token: string,
  input: { campaignId: string },
): Promise<{ messages: ApiChatMessage[] }> {
  return trpcQuery(ctx, "chat.list", input, token);
}

/** Create a campaign via the API. */
export async function apiCreateCampaign(
  ctx: APIRequestContext,
  token: string,
  input: { name: string; description?: string },
): Promise<{ id: string }> {
  return trpcMutate(ctx, "campaign.create", input, token);
}

/** Create a map for a campaign. */
export async function apiCreateMap(
  ctx: APIRequestContext,
  token: string,
  input: { campaignId: string; name: string; width: number; height: number; gridSize?: number },
): Promise<{ id: string }> {
  return trpcMutate(ctx, "map.create", { gridType: "square", ...input }, token);
}

/** Update an encounter's metadata. */
export async function apiUpdateEncounter(
  ctx: APIRequestContext,
  token: string,
  input: { id: string; mapId?: string | null },
): Promise<{ id: string }> {
  return trpcMutate(ctx, "encounter.update", input, token);
}

export interface ApiEncounterParticipant {
  id: string;
  name: string;
  type: "character" | "monster" | "npc";
  characterId: string | null;
}

export interface ApiEncounterSummary {
  id: string;
  name: string;
}

export interface ApiEncounterDetail extends ApiEncounterSummary {
  participants: ApiEncounterParticipant[];
}

/** List encounters for a campaign. */
export async function apiListEncounters(
  ctx: APIRequestContext,
  token: string,
  input: { campaignId: string },
): Promise<ApiEncounterSummary[]> {
  return trpcQuery(ctx, "encounter.list", input, token);
}

/** Fetch a single encounter. */
export async function apiGetEncounter(
  ctx: APIRequestContext,
  token: string,
  input: { id: string },
): Promise<ApiEncounterDetail> {
  return trpcQuery(ctx, "encounter.get", input, token);
}

/** Create a token on a map. */
export async function apiCreateMapToken(
  ctx: APIRequestContext,
  token: string,
  input: {
    mapId: string;
    type: "character" | "monster" | "object";
    label: string;
    x: number;
    y: number;
    characterId?: string;
    encounterParticipantId?: string;
    color?: string;
  },
): Promise<{ id: string }> {
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
  input: { campaignId: string },
): Promise<{ code: string }> {
  return trpcMutate(ctx, "invite.create", input, token);
}

/** Join a campaign via invite code. */
export async function apiJoinCampaign(
  ctx: APIRequestContext,
  token: string,
  input: { code: string },
): Promise<{ campaignId: string }> {
  return trpcMutate(ctx, "invite.join", input, token);
}

export const DEFAULT_CHARACTER_INPUT = {
  speciesId: "species-human",
  backgroundId: "background-soldier",
  classId: "class-fighter",
  strength: 15,
  dexterity: 14,
  constitution: 13,
  intelligence: 12,
  wisdom: 10,
  charisma: 8,
} as const;
