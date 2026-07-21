import { expect, test } from "./fixtures.js";
import {
  apiAddCharacterSpell,
  apiCastSpell,
  type ApiCharacterDetail,
  apiCreateCharacter,
  apiCreateInventoryItem,
  apiCreateMap,
  apiCreateMapToken,
  type ApiEncounterDetail,
  type ApiEncounterParticipant,
  type ApiEncounterSummary,
  apiGetCharacter,
  apiGetEncounter,
  apiLevelUpCharacter,
  apiListChatMessages,
  apiListCombatLogs,
  apiListEncounters,
  apiLogin,
  apiToggleSpellPrepared,
  apiUpdateEncounter,
  createApiContext,
} from "./helpers/api.js";
import { type DmPlayerCampaign, setupDmAndPlayer } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_SHORT } from "./helpers/timeouts.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";
import { EncounterPO } from "./page-objects/encounter.po.js";
import { VttDrawerPO } from "./page-objects/vtt-drawer.po.js";
import type { BrowserCombatSpellResponse } from "./page-objects/vtt-drawer-response.js";

const DM_TOKEN = { x: 1, y: 1 } as const;
const PLAYER_TOKEN = { x: 3, y: 1 } as const;
const PLAYER_BACKUP_TOKEN = { x: 3, y: 3 } as const;
const MONSTER_TOKEN = { x: 5, y: 1 } as const;
const COMMONER_TOKEN = { x: 5, y: 3 } as const;
const CAST_ONLY_AOE_PLACEMENT = { x: 8, y: 1 } as const;
const FIREBALL_PLACEMENT = { x: 3, y: 1 } as const;
const PLAYER_WEAPON = "Dagger";
const PLAYER_SPELL = "Fire Bolt";
const PLAYER_SAVE_SPELL = "Sacred Flame";
const PLAYER_DAMAGE_AOE_SPELL = "Fireball";
const PLAYER_CAST_ONLY_AOE_SPELL = "Fog Cloud";
const PLAYER_CONFLICT_SPELL = "Detect Magic";
const FIRE_BOLT = "spell-fire-bolt";
const SACRED_FLAME = "spell-sacred-flame";
const FIREBALL = "spell-fireball";
const FOG_CLOUD = "spell-fog-cloud";
const DETECT_MAGIC = "spell-detect-magic";
const SERVER_DERIVED_SAVE_DC = 14;
const FIRST_TURN_CHECK_TIMEOUT = 500;

test.describe("Encounter combat lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  let ctx: DmPlayerCampaign;
  let dmEncounter: EncounterPO;
  let playerEncounter: EncounterPO;
  let dmDrawer: VttDrawerPO;
  let playerDrawer: VttDrawerPO;
  const dmCharName = uniqueName("Fighter");
  const playerCharName = uniqueName("Wizard");
  const encounterName = uniqueName("BattleE2E");
  let dmCharacterId: string;
  let playerCharacterId: string;
  let combatMapId = "";
  let encounterId = "";

  test.beforeAll(async ({ browser }) => {
    ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "combatDm",
      playerPrefix: "combatPlayer",
      campaignPrefix: "CombatE2E",
    });

    // Create characters via API (much faster than UI wizard)
    const api = await createApiContext();
    const dmLogin = await apiLogin(api, ctx.dmUser.email, ctx.dmUser.password);
    const dmCharacter = await apiCreateCharacter(api, dmLogin.accessToken, { name: dmCharName });
    dmCharacterId = dmCharacter.id;

    const playerLogin = await apiLogin(api, ctx.playerUser.email, ctx.playerUser.password);
    const playerCharacter = await apiCreateCharacter(api, playerLogin.accessToken, {
      name: playerCharName,
      speciesId: "species-elf",
      subspeciesId: "subspecies-elven-lineage-high-elf",
      classId: "class-wizard",
      backgroundId: "background-sage",
      constitution: 14,
      intelligence: 16,
      wisdom: 16,
      charisma: 14,
    });
    playerCharacterId = playerCharacter.id;
    await apiLevelUpCharacter(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      classId: "class-wizard",
    });
    await apiLevelUpCharacter(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      classId: "class-wizard",
      subclassId: "subclass-evoker",
    });
    await apiLevelUpCharacter(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      classId: "class-wizard",
      asiChoice: {
        featId: "feat-ability-score-improvement",
        asiIncreases: [{ ability: "CON", amount: 2 }],
      },
    });
    await apiLevelUpCharacter(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      classId: "class-wizard",
    });
    await apiLevelUpCharacter(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      classId: "class-cleric",
    });
    await apiCreateInventoryItem(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      name: PLAYER_WEAPON,
      itemType: "weapon",
      equipped: true,
      properties: {
        damageDice: "1d4",
        damageType: "piercing",
        weaponCategory: "simple",
        properties: ["Finesse", "Light", "Thrown"],
        rangeNormal: 20,
        rangeLong: 60,
      },
    });
    await apiAddCharacterSpell(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: FIRE_BOLT,
      source: "class",
    });
    await apiAddCharacterSpell(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: SACRED_FLAME,
      source: "class",
    });
    await apiAddCharacterSpell(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: FIREBALL,
      source: "class",
    });
    await apiToggleSpellPrepared(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: FIREBALL,
    });
    await apiAddCharacterSpell(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: FOG_CLOUD,
      source: "class",
    });
    await apiToggleSpellPrepared(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: FOG_CLOUD,
    });
    await apiAddCharacterSpell(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: DETECT_MAGIC,
      source: "class",
    });
    await apiToggleSpellPrepared(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: DETECT_MAGIC,
    });
    await api.dispose();

    // Reload so browser picks up the API-created characters, then assign
    await ctx.dmPage.reload();
    await ctx.dmDetail.clickTab("Members");
    await ctx.dmDetail.assignCharacter(dmCharName);

    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Members");
    await ctx.playerDetail.assignCharacter(playerCharName);

    // Reload DM page so it picks up the player's character assignment
    await ctx.dmPage.reload();
    await ctx.dmDetail.clickTab("Encounters");
    await ctx.playerDetail.clickTab("Encounters");

    dmEncounter = new EncounterPO(ctx.dmPage);
    playerEncounter = new EncounterPO(ctx.playerPage);
    dmDrawer = new VttDrawerPO(ctx.dmPage);
    playerDrawer = new VttDrawerPO(ctx.playerPage);
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  // ── Setup phase ──────────────────────────────────────────────────────

  test("DM creates an encounter", async () => {
    await dmEncounter.createEncounter(encounterName);
    await dmEncounter.expectEncounterVisible(encounterName);
  });

  test("DM opens encounter and adds participants", async () => {
    await dmEncounter.openEncounter(encounterName);
    await dmEncounter.expectState("setup");

    // Add both player characters
    await dmEncounter.clickAddParticipant();
    await dmEncounter.addCharacter(dmCharName);
    await dmEncounter.addCharacter(playerCharName);

    // Goblin Warrior has only ambiguous actions; Commoner's Club is structured.
    await dmEncounter.addMonster("Goblin Warrior");
    await dmEncounter.addMonster("Commoner");
    await dmEncounter.closeAddParticipantDialog();

    // Verify all participants visible
    await expect(ctx.dmPage.getByText(dmCharName)).toBeVisible({ timeout: TIMEOUT_SHORT });
    await expect(ctx.dmPage.getByText(playerCharName)).toBeVisible({ timeout: TIMEOUT_SHORT });
    await expect(ctx.dmPage.getByText("Goblin Warrior")).toBeVisible({ timeout: TIMEOUT_SHORT });
    await expect(ctx.dmPage.getByText("Commoner")).toBeVisible({ timeout: TIMEOUT_SHORT });
  });

  test("DM links the encounter to a map with combat tokens", async () => {
    const api = await createApiContext();
    const dmLogin = await apiLogin(api, ctx.dmUser.email, ctx.dmUser.password);
    const encounters = await apiListEncounters(api, dmLogin.accessToken, {
      campaignId: ctx.campaignId,
    });
    const encounterSummary = findEncounter(encounters, encounterName);
    encounterId = encounterSummary.id;
    const encounter = await apiGetEncounter(api, dmLogin.accessToken, {
      id: encounterSummary.id,
    });
    const map = await apiCreateMap(api, dmLogin.accessToken, {
      campaignId: ctx.campaignId,
      name: uniqueName("DrawerMap"),
      width: 12,
      height: 8,
      gridSize: 5,
    });
    combatMapId = map.id;
    expect(combatMapId).toBe(map.id);
    await apiUpdateEncounter(api, dmLogin.accessToken, { id: encounter.id, mapId: map.id });

    const dmParticipant = findParticipant(encounter, dmCharName);
    const playerParticipant = findParticipant(encounter, playerCharName);
    const monsterParticipant = findParticipant(encounter, "Goblin Warrior");
    const commonerParticipant = findParticipant(encounter, "Commoner");
    await apiCreateMapToken(api, dmLogin.accessToken, {
      mapId: map.id,
      type: "character",
      characterId: dmCharacterId,
      encounterParticipantId: dmParticipant.id,
      label: dmCharName,
      color: "#2563eb",
      ...DM_TOKEN,
    });
    await apiCreateMapToken(api, dmLogin.accessToken, {
      mapId: map.id,
      type: "character",
      characterId: playerCharacterId,
      encounterParticipantId: playerParticipant.id,
      label: playerCharName,
      color: "#16a34a",
      ...PLAYER_TOKEN,
    });
    await apiCreateMapToken(api, dmLogin.accessToken, {
      mapId: map.id,
      type: "monster",
      encounterParticipantId: monsterParticipant.id,
      label: "Goblin Warrior",
      color: "#dc2626",
      ...MONSTER_TOKEN,
    });
    await apiCreateMapToken(api, dmLogin.accessToken, {
      mapId: map.id,
      type: "monster",
      encounterParticipantId: commonerParticipant.id,
      label: "Commoner",
      color: "#b45309",
      ...COMMONER_TOKEN,
    });
    await api.dispose();

    await ctx.dmPage.reload();
    await ctx.dmDetail.clickTab("Encounters");
    await dmEncounter.openEncounter(encounterName);
  });

  test("player sees encounter in list", async () => {
    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Encounters");
    await playerEncounter.expectEncounterVisible(encounterName);
  });

  // ── Initiative & start ───────────────────────────────────────────────

  test("DM rolls initiative and starts combat", async () => {
    await dmEncounter.rollInitiative();
    await dmEncounter.startCombat();
    await dmEncounter.expectState("active");
    await dmEncounter.expectRound(1);
    await dmEncounter.expectTurn(1, 4);
  });

  // ── Combat turns ─────────────────────────────────────────────────────

  test("DM advances until it is the player character's turn", async () => {
    const initList = ctx.dmPage.getByRole("list", { name: "Initiative order" });
    const target = `${playerCharName}Current`;

    const turnCheckTimeouts = [
      FIRST_TURN_CHECK_TIMEOUT,
      TIMEOUT_SHORT,
      TIMEOUT_SHORT,
      TIMEOUT_SHORT,
      TIMEOUT_SHORT,
    ];

    for (const timeout of turnCheckTimeouts) {
      // First iteration: DOM is already current, so a quick check suffices.
      // After each advance: the UI needs time to refetch and re-render,
      // so use a full timeout to avoid overshooting the target turn.
      try {
        await expect(initList).toContainText(target, { timeout });
        break;
      } catch {
        await dmEncounter.advanceTurn();
      }
    }
    await expect(initList).toContainText(target, { timeout: TIMEOUT_SHORT });
  });

  test("player turn pointer follows the DM advance live without a reload", async () => {
    // ux-audit P0-2 regression: open the encounter on the player WITHOUT a
    // reload, then advance the turn on the DM. The player's "Current" highlight
    // and round display must move within one broadcast — the audited bug was
    // that the counter updated but the highlight stayed on the previous
    // combatant until a hard refresh, diverging the two clients.
    await playerEncounter.openEncounter(encounterName);
    await playerEncounter.expectState("active");

    // Resolve the current highlight to one of the known participant names so
    // the comparison is stable across DM/player views (the DM sees monster HP
    // the player does not, so full-row text can legitimately differ).
    const knownNames = [dmCharName, playerCharName, "Goblin Warrior", "Commoner"];
    const currentName = (rowText: string): string =>
      knownNames.find((name) => rowText.includes(name)) ?? rowText;

    // Capture the shared starting pointer from both clients (no reload yet).
    const beforeCurrent = currentName(await dmEncounter.currentParticipantName());
    expect(currentName(await playerEncounter.currentParticipantName())).toBe(beforeCurrent);

    // DM advances; wait until the DM's own highlight has actually moved so we
    // assert against the real next combatant rather than a stale read.
    await dmEncounter.advanceTurn();
    await expect
      .poll(async () => currentName(await dmEncounter.currentParticipantName()), {
        timeout: TIMEOUT_SHORT,
      })
      .not.toBe(beforeCurrent);
    const afterCurrent = currentName(await dmEncounter.currentParticipantName());

    // The player must converge to the same new current combatant live.
    await expect
      .poll(async () => currentName(await playerEncounter.currentParticipantName()), {
        timeout: TIMEOUT_SHORT,
      })
      .toBe(afterCurrent);

    // Restore the serial-flow invariant: subsequent tests expect the player
    // character to be the current combatant. Cycle the pointer back to them,
    // confirming the player view live-syncs on each advance (mirrors the
    // try/catch advance pattern used by the DM-only advance test above).
    const dmInitList = ctx.dmPage.getByRole("list", { name: "Initiative order" });
    const playerTarget = `${playerCharName}Current`;
    for (const timeout of [TIMEOUT_SHORT, TIMEOUT_SHORT, TIMEOUT_SHORT, TIMEOUT_SHORT]) {
      try {
        await expect(dmInitList).toContainText(playerTarget, { timeout });
        break;
      } catch {
        await dmEncounter.advanceTurn();
      }
    }
    await dmEncounter.expectCurrentParticipant(playerCharName);
    await expect
      .poll(async () => playerEncounter.currentParticipantName(), { timeout: TIMEOUT_SHORT })
      .toContain(playerCharName);
  });

  test("drawer access follows token ownership and DM visibility", async () => {
    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Encounters");
    await playerEncounter.openEncounter(encounterName);
    await playerDrawer.waitForMap();

    await playerEncounter.expectState("active");
    await playerEncounter.expectCurrentParticipant(playerCharName);

    await playerDrawer.openMySheet();
    await playerDrawer.expectEditable();
    await playerDrawer.closeDrawer();

    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);
    await playerDrawer.expectCharacterDrawer();
    await playerDrawer.expectEditable();
    await playerDrawer.closeDrawer();

    await playerDrawer.openSheetFromToken(DM_TOKEN);
    await playerDrawer.expectReadOnly();
    await playerDrawer.closeDrawer();

    await playerDrawer.expectNoOpenSheetForToken(MONSTER_TOKEN);

    await ctx.dmPage.reload();
    await ctx.dmDetail.clickTab("Encounters");
    await dmEncounter.openEncounter(encounterName);
    await dmDrawer.openSheetFromToken(MONSTER_TOKEN);
    await dmDrawer.expectMonsterDrawer();
    await dmDrawer.closeDrawer();

    // Player does NOT have DM controls
    await playerEncounter.expectNoEncounterControls();
  });

  test("player opens the drawer from the multi-token action-bar dropdown", async () => {
    const api = await createApiContext();
    const dmLogin = await apiLogin(api, ctx.dmUser.email, ctx.dmUser.password);
    await apiCreateMapToken(api, dmLogin.accessToken, {
      mapId: combatMapId,
      type: "character",
      characterId: playerCharacterId,
      label: `${playerCharName} backup`,
      color: "#0f766e",
      ...PLAYER_BACKUP_TOKEN,
    });
    await api.dispose();

    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Encounters");
    await playerEncounter.openEncounter(encounterName);
    await playerDrawer.waitForMap();

    await playerDrawer.openMySheetFromDropdown(`${playerCharName} (${playerCharName} backup)`);
    await playerDrawer.expectEditable();
    await playerDrawer.expectNoActionEconomy();
    await playerDrawer.closeDrawer();
  });

  test("player attacks from the drawer against the monster", async () => {
    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Encounters");
    await playerEncounter.openEncounter(encounterName);

    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);
    await playerDrawer.attackWithWeapon(PLAYER_WEAPON, MONSTER_TOKEN);
    await playerEncounter.expectCombatLogEntry(PLAYER_WEAPON);
    await playerDrawer.closeDrawer();
  });

  test("structured Commoner Club exposes one Attack control and reaches attemptAttack", async () => {
    await ctx.dmPage.reload();
    await ctx.dmDetail.clickTab("Encounters");
    await dmEncounter.openEncounter(encounterName);

    await dmDrawer.openSheetFromToken(COMMONER_TOKEN);
    await dmDrawer.attackWithMonsterAction("Club", PLAYER_TOKEN);
    await dmEncounter.expectCombatLogEntry("Club");
    await dmDrawer.closeDrawer();

    await dmDrawer.openSheetFromToken(MONSTER_TOKEN);
    await dmDrawer.expectNoMonsterAttackControls();
    await dmDrawer.closeDrawer();
  });

  test("Fire Bolt damages the picked target through structured combat and logs the spell", async () => {
    const api = await createApiContext();
    const dmLogin = await apiLogin(api, ctx.dmUser.email, ctx.dmUser.password);
    const beforeEncounter = await apiGetEncounter(api, dmLogin.accessToken, { id: encounterId });
    const target = findParticipant(beforeEncounter, "Commoner");
    const beforeHp = participantCurrentHp(target);
    const beforeLogs = await apiListCombatLogs(api, dmLogin.accessToken, { encounterId });

    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Encounters");
    await playerEncounter.openEncounter(encounterName);
    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);

    const { attempts, totalDamage } = await playerDrawer.castSingleTargetCombatSpellUntilDamage(
      PLAYER_SPELL,
      COMMONER_TOKEN,
      target.id,
      8,
    );

    expect(totalDamage).toBeGreaterThan(0);
    const afterEncounter = await apiGetEncounter(api, dmLogin.accessToken, { id: encounterId });
    expect(participantCurrentHp(findParticipant(afterEncounter, "Commoner"))).toBe(
      Math.max(0, beforeHp - totalDamage),
    );
    const afterLogs = await apiListCombatLogs(api, dmLogin.accessToken, { encounterId });
    const fireBoltLogsBefore = beforeLogs.logs.filter(
      (log) => log.action === "spell" && log.description.includes(PLAYER_SPELL),
    );
    const fireBoltLogsAfter = afterLogs.logs.filter(
      (log) => log.action === "spell" && log.description.includes(PLAYER_SPELL),
    );
    expect(fireBoltLogsAfter).toHaveLength(fireBoltLogsBefore.length + attempts);
    expect(fireBoltLogsAfter.at(-1)?.rolls).toHaveProperty("spellResults");

    await api.dispose();
    await playerDrawer.closeDrawer();
  });

  test("Sacred Flame uses the server-derived save ability and DC", async () => {
    const api = await createApiContext();
    const dmLogin = await apiLogin(api, ctx.dmUser.email, ctx.dmUser.password);
    const beforeEncounter = await apiGetEncounter(api, dmLogin.accessToken, { id: encounterId });
    const target = findParticipant(beforeEncounter, "Goblin Warrior");
    const beforeHp = participantCurrentHp(target);

    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);
    const result = await playerDrawer.castSingleTargetCombatSpell(PLAYER_SAVE_SPELL, MONSTER_TOKEN);
    expect(result.spellResults).toHaveLength(1);
    const saveResult = requireSavingThrowResult(result, PLAYER_SAVE_SPELL);
    expect(saveResult.targetParticipantId).toBe(target.id);
    expect(saveResult.saveAbility).toBe("DEX");
    expect(saveResult.saveDc).toBe(SERVER_DERIVED_SAVE_DC);

    const afterEncounter = await apiGetEncounter(api, dmLogin.accessToken, { id: encounterId });
    expect(participantCurrentHp(findParticipant(afterEncounter, "Goblin Warrior"))).toBe(
      Math.max(0, beforeHp - saveResult.totalDamage),
    );

    await api.dispose();
    await playerDrawer.closeDrawer();
  });

  test("Fireball updates every overlapped participant from one slot and plural response", async () => {
    const api = await createApiContext();
    const playerLogin = await apiLogin(api, ctx.playerUser.email, ctx.playerUser.password);
    const dmLogin = await apiLogin(api, ctx.dmUser.email, ctx.dmUser.password);
    const beforeCharacter = await apiGetCharacter(api, playerLogin.accessToken, {
      id: playerCharacterId,
    });
    const beforeUsed = spellSlotUsed(beforeCharacter, 3);
    const beforeEncounter = await apiGetEncounter(api, dmLogin.accessToken, { id: encounterId });

    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);
    const result = await playerDrawer.castAoeCombatSpell(
      PLAYER_DAMAGE_AOE_SPELL,
      3,
      FIREBALL_PLACEMENT,
      2,
    );

    expect(result.spellResults.length).toBeGreaterThanOrEqual(2);
    for (const spellResult of result.spellResults) {
      expect(spellResult.type).toBe("savingThrow");
      expect(spellResult.damageRolls).toEqual(result.spellResults[0]?.damageRolls);
    }

    const afterCharacter = await apiGetCharacter(api, playerLogin.accessToken, {
      id: playerCharacterId,
    });
    expect(spellSlotUsed(afterCharacter, 3)).toBe(beforeUsed + 1);

    const afterEncounter = await apiGetEncounter(api, dmLogin.accessToken, { id: encounterId });
    for (const participantName of [dmCharName, playerCharName]) {
      const beforeParticipant = findParticipant(beforeEncounter, participantName);
      const afterParticipant = findParticipant(afterEncounter, participantName);
      const spellResult = requireParticipantSpellResult(
        result,
        beforeParticipant.id,
        participantName,
      );
      const beforeHp = participantCurrentHp(beforeParticipant);
      const afterHp = participantCurrentHp(afterParticipant);
      expect(afterHp).toBe(Math.max(0, beforeHp - spellResult.totalDamage));
      expect(afterHp).toBeLessThan(beforeHp);
    }

    await api.dispose();
    await playerDrawer.closeDrawer();
  });

  test("Fog Cloud stays on castSpell.cast with slot, concentration, and chat", async () => {
    const api = await createApiContext();
    const playerLogin = await apiLogin(api, ctx.playerUser.email, ctx.playerUser.password);
    const before = await apiGetCharacter(api, playerLogin.accessToken, { id: playerCharacterId });
    const beforeUsed = spellSlotUsed(before, 1);

    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);
    await playerDrawer.castAoeSpellCastOnly(
      PLAYER_CAST_ONLY_AOE_SPELL,
      1,
      CAST_ONLY_AOE_PLACEMENT,
      2,
    );

    const after = await apiGetCharacter(api, playerLogin.accessToken, { id: playerCharacterId });
    const chat = await apiListChatMessages(api, playerLogin.accessToken, {
      campaignId: ctx.campaignId,
    });
    expect(spellSlotUsed(after, 1)).toBe(beforeUsed + 1);
    expect(after.stats?.concentrationSpellId).toBe(FOG_CLOUD);
    expect(
      chat.messages.some((m) => m.content.includes(`casts ${PLAYER_CAST_ONLY_AOE_SPELL}`)),
    ).toBe(true);
    await api.dispose();
    await playerDrawer.closeDrawer();
  });

  test("concentration conflict Cancel aborts the drawer cast", async () => {
    const api = await createApiContext();
    const playerLogin = await apiLogin(api, ctx.playerUser.email, ctx.playerUser.password);
    await apiCastSpell(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      spellId: FOG_CLOUD,
      castAtLevel: 1,
      campaignId: ctx.campaignId,
    });
    const before = await apiGetCharacter(api, playerLogin.accessToken, { id: playerCharacterId });
    const beforeUsed = spellSlotUsed(before, 1);

    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);
    await playerDrawer.cancelConcentrationConflict(PLAYER_CONFLICT_SPELL);

    const after = await apiGetCharacter(api, playerLogin.accessToken, { id: playerCharacterId });
    expect(spellSlotUsed(after, 1)).toBe(beforeUsed);
    expect(after.stats?.concentrationSpellId).toBe(FOG_CLOUD);
    await api.dispose();
    await playerDrawer.closeDrawer();
  });

  test("ambiguous class-source Fire Bolt never calls the combat mutation", async () => {
    const api = await createApiContext();
    const playerLogin = await apiLogin(api, ctx.playerUser.email, ctx.playerUser.password);
    const dmLogin = await apiLogin(api, ctx.dmUser.email, ctx.dmUser.password);
    await apiLevelUpCharacter(api, playerLogin.accessToken, {
      characterId: playerCharacterId,
      classId: "class-sorcerer",
    });
    const beforeLogs = await apiListCombatLogs(api, dmLogin.accessToken, { encounterId });

    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Encounters");
    await playerEncounter.openEncounter(encounterName);
    await playerDrawer.openSheetFromToken(PLAYER_TOKEN);
    await playerDrawer.castSingleSpellCastOnly(PLAYER_SPELL);

    const afterLogs = await apiListCombatLogs(api, dmLogin.accessToken, { encounterId });
    expect(afterLogs.logs).toHaveLength(beforeLogs.logs.length);
    await api.dispose();
    await playerDrawer.closeDrawer();
  });

  test("combat log shows the drawer weapon action", async () => {
    await ctx.dmPage.reload();
    await ctx.dmDetail.clickTab("Encounters");
    await dmEncounter.openEncounter(encounterName);

    await dmEncounter.expectCombatLogEntry(PLAYER_WEAPON);
  });

  // ── HP attribution (ux-audit P0-3) ───────────────────────────────────

  test("sheet-side HP adjust during combat surfaces an attributed combat-log entry", async () => {
    // Regression for the Second Wind family: a player adjusting their own HP
    // from the sheet during active combat used to broadcast only
    // character:updated and write no combat log, so the DM saw tracked HP
    // "silently revert". Now every sheet HP write on a character in an active
    // encounter appends an attributed combat-log entry the DM can see live.
    //
    // The in-VTT drawer sheet renders HP read-only (no Amount/Damage control);
    // the selectable HP-write surface for a player is the STANDALONE character
    // sheet. The server attributes any `character.adjustHp` on a character in an
    // active encounter regardless of which client fired it, so damaging HP from
    // the standalone sheet must surface the entry on the DM's encounter view.
    await ctx.dmPage.reload();
    await ctx.dmDetail.clickTab("Encounters");
    await dmEncounter.openEncounter(encounterName);

    const playerSheet = new CharacterSheetPO(ctx.playerPage);
    await ctx.playerPage.goto(`/characters/${playerCharacterId}?campaignId=${ctx.campaignId}`);
    await playerSheet.expectName(playerCharName);
    await playerSheet.damageHp(2);

    // The DM, watching the encounter, sees the attributed entry without a
    // reload — the HP write broadcasts encounter:updated post-commit.
    await dmEncounter.expectCombatLogEntry("HP adjustment");

    // Restore the serial-flow invariant: subsequent tests reload the player
    // page expecting the campaign detail view, so navigate back off the
    // standalone character sheet we visited above.
    await ctx.playerPage.goto(`/campaigns/${ctx.campaignId}`);
  });

  // ── Pause / Resume ───────────────────────────────────────────────────

  test("DM pauses and resumes combat", async () => {
    await dmEncounter.pause();
    await dmEncounter.expectState("paused");

    await dmEncounter.resume();
    await dmEncounter.expectState("active");
  });

  // ── End encounter ────────────────────────────────────────────────────

  test("DM ends the encounter and XP summary is shown", async () => {
    await dmEncounter.endEncounter();
    await dmEncounter.expectResolvedState();
    await dmEncounter.expectXpSummary();
  });

  test("player sees resolved encounter", async () => {
    await ctx.playerPage.reload();
    await ctx.playerDetail.clickTab("Encounters");
    await playerEncounter.openEncounter(encounterName);
    await playerEncounter.expectResolvedState();
  });
});

function findEncounter(
  encounters: readonly ApiEncounterSummary[],
  name: string,
): ApiEncounterSummary {
  const encounter = encounters.find((e) => e.name === name);
  if (!encounter) throw new Error(`Encounter not found: ${name}`);
  return encounter;
}

function findParticipant(encounter: ApiEncounterDetail, name: string): ApiEncounterParticipant {
  const participant = encounter.participants.find((p) => p.name === name);
  if (!participant) throw new Error(`Participant not found: ${name}`);
  return participant;
}

function spellSlotUsed(character: ApiCharacterDetail, level: number): number {
  const slot = character.spellSlots.find((s) => s.spellLevel === level);
  if (!slot) throw new Error(`Spell slot not found for level ${String(level)}`);
  return slot.used;
}

type BrowserSpellResult = BrowserCombatSpellResponse["spellResults"][number];
type BrowserSavingThrowResult = Extract<BrowserSpellResult, { type: "savingThrow" }>;

function participantCurrentHp(participant: ApiEncounterParticipant): number {
  if (participant.currentHp === null) {
    throw new Error(`Participant has no current HP: ${participant.name}`);
  }
  return participant.currentHp;
}

function requireSavingThrowResult(
  result: BrowserCombatSpellResponse,
  spellName: string,
): BrowserSavingThrowResult {
  const spellResult = result.spellResults[0];
  if (!spellResult || spellResult.type !== "savingThrow") {
    throw new Error(`${spellName} did not return a saving throw result`);
  }
  return spellResult;
}

function requireParticipantSpellResult(
  result: BrowserCombatSpellResponse,
  participantId: string,
  participantName: string,
): BrowserSpellResult {
  const spellResult = result.spellResults.find(
    (candidate) => candidate.targetParticipantId === participantId,
  );
  if (!spellResult) throw new Error(`Missing Fireball result for ${participantName}`);
  return spellResult;
}
