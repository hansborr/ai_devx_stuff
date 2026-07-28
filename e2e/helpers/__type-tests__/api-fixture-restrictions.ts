// Negative type test — pins the deliberate surface of the `helpers/api.ts`
// seeding fixtures. Those wrappers infer their field and enum types from
// `AppRouter` so a renamed or retyped procedure input fails the typecheck lane,
// but inference must not turn them into full mutation proxies: each helper
// documents a focused job and silently drops anything outside it.
//
// This file fails to compile if a fixture widens back to the whole procedure
// input, because the `@ts-expect-error` directives below would then go unused.
// `scripts/typecheck.sh` compiles it through `tsconfig.e2e.json`; Playwright
// never collects it (not a `*.spec.ts`).

import type { ApiCreateCharacterOptions, ApiLevelUpCharacterInput } from "../api.js";

// Known-good usages first, so narrowing can't overshoot and reject what the
// specs actually pass.
export const _minimalCharacter: ApiCreateCharacterOptions = { name: "Aria" };

export const _fullyOverriddenCharacter: ApiCreateCharacterOptions = {
  name: "Aria",
  speciesId: "species-elf",
  subspeciesId: "subspecies-high-elf",
  backgroundId: "background-sage",
  classId: "class-wizard",
  strength: 8,
  dexterity: 14,
  constitution: 12,
  intelligence: 16,
  wisdom: 10,
  charisma: 13,
};

export const _characterPersonalityIsNotFixtureSurface: ApiCreateCharacterOptions = {
  name: "Aria",
  // @ts-expect-error -- the fixture creates a minimal defaulted character; personality text is a UI flow, not seed data
  traits: "Curious to a fault",
};

export const _characterEquipmentIsNotFixtureSurface: ApiCreateCharacterOptions = {
  name: "Aria",
  // @ts-expect-error -- starting equipment is not defaulted here; seed inventory through apiCreateInventoryItem
  startingEquipment: [{ equipmentId: "equipment-dagger", quantity: 1 }],
};

export const _fullyPopulatedLevelUp: ApiLevelUpCharacterInput = {
  characterId: "character-1",
  classId: "class-wizard",
  subclassId: "subclass-evoker",
  metamagicIds: ["metamagic-quickened-spell"],
  asiChoice: {
    featId: "feat-ability-score-improvement",
    asiIncreases: [{ ability: "CON", amount: 2 }],
  },
};

export const _levelUpHpMethodIsOwnedByTheHelper: ApiLevelUpCharacterInput = {
  characterId: "character-1",
  // @ts-expect-error -- the helper always sends "average"; a caller-chosen method would be overwritten
  hpMethod: "roll",
};

export const _levelUpHpRolledIsOwnedByTheHelper: ApiLevelUpCharacterInput = {
  characterId: "character-1",
  // @ts-expect-error -- hpMethod is fixed to "average", so a rolled HP value would be accepted and then silently dropped
  hpRolled: 6,
};
