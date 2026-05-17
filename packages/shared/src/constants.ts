import { z } from "zod";

/** Package version — surfaced by the `/health` endpoint and OpenAPI metadata. */
export const VERSION = "0.0.0";

// ---------------------------------------------------------------------------
// Game mechanic limits
// ---------------------------------------------------------------------------

export const MAX_DEATH_SAVES = 3;
export const MAX_EXHAUSTION = 6;
export const MAX_SPELL_LEVEL = 9;
export const CANTRIP_LEVEL = 0;
export const MAX_HP = 9999;
export const MAX_AC = 99;
export const MAX_HIT_DICE = 20;
export const MAX_CURRENCY = 999_999;

// ---------------------------------------------------------------------------
// Field length limits
// ---------------------------------------------------------------------------

/** Max length for ID string fields (CUIDs, slugs, etc.) */
export const MAX_ID_LENGTH = 128;

/** Reusable Zod schema for ID fields — non-empty string with max length. */
export const idField = z.string().min(1).max(MAX_ID_LENGTH);

// ---------------------------------------------------------------------------
// Text field limits
// ---------------------------------------------------------------------------

export const MAX_NAME_LENGTH = 100;
export const MAX_TEXT_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Combat-roll string limits
// ---------------------------------------------------------------------------

/** Bare dice notation (e.g. "1d8", "2d6") with no modifier — modifiers go in
 *  damageBonus. Shared by attack-roll-inputs and spell-action-inputs schemas. */
export const DICE_NOTATION_REGEX = /^\d+d\d+$/;
export const DICE_NOTATION_MESSAGE = "Must be dice notation without modifiers (e.g. 1d8, 2d6)";
export const MAX_DICE_NOTATION_LENGTH = 50;

/** Damage type label cap shared by custom attack and custom spell inputs. */
export const MAX_DAMAGE_TYPE_LENGTH = 50;

/** Highest face on a d20 — bounds natural roll fields in attack/spell results. */
export const MAX_D20_ROLL = 20;

// ---------------------------------------------------------------------------
// Date/time schema helper
// ---------------------------------------------------------------------------

/**
 * Accepts both ISO strings (from tRPC serialization) and Date objects
 * (from Prisma), normalizing to an ISO string. This resolves the
 * `string | Date` type ambiguity — consumers always get `string`.
 */
export const dateTimeField = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString() : v));
