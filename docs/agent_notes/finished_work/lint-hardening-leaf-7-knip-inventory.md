# Leaf 7 Knip Inventory

Date: 2026-05-16
Branch: feat/lint-hardening-leaf-7
Knip version: 6.12.2

## Command

`bun x knip --no-progress`

Exit code: 1

## Config Notes

Single root `knip.config.ts` was chosen because Musi has three package workspaces plus root-owned scripts, ESLint rules, Playwright e2e tests, and CI/hook config. The root workspace `"."` owns non-package entry points; package workspaces own their app/package source. This mirrors Knip's documented monorepo shape where root `entry` / `project` must live under `workspaces["."]`.

Enabled plugins:

- Root: Bun, ESLint, GitHub Actions, Husky, Playwright, Prettier, Stryker, TypeScript, Vitest.
- Client: Vite, Vitest, TypeScript, TanStack Router, Tailwind.
- Server: Prisma, TypeScript, Vitest.
- Shared: TypeScript, Vitest.

Notes from iteration:

- Codemod fixture trees are ignored because they are test data and were producing fixture-only unlisted dependency reports.
- Shell scripts are kept as root entries but not root project files, because Knip reported that `.sh` is not registered as an analyzable project compiler.
- `includeEntryExports` is enabled so private-monorepo public surfaces are inventoried instead of silently exempted.

## Pass 1 Counts

- Unused files: 9
- Unused dependencies: 1
- Unused devDependencies: 4
- Unlisted dependencies: 0
- Unresolved imports: 0
- Unused exports: 135
- Unused exported types: 258
- Configuration hints: 0

## Pass 2 Result

Pass 2 tightened `knip.config.ts`, applied only the two high-confidence
devDependency deletions, added `bun run sensor:knip`, and wired the sensor into
`doctor` as report-only.

Final `bun run sensor:knip` inventory after carve-outs and deletions:

- Unused files: 0
- Unused dependencies: 0
- Unused devDependencies: 0
- Unlisted dependencies: 0
- Unresolved imports: 0
- Unused exports: 87
- Unused exported types: 74
- Configuration hints: 0

Deferred follow-up: Leaf 7b should triage the remaining unused exports and
unused exported types one finding at a time. No broad export/type deletion
landed in Pass 2.

## Pass 1 Raw Stdout

```text
Unused files (9)
packages/server/src/seed/generate-class-features.ts                           
packages/server/src/seed/generate-srd-rules-glossary.ts                       
packages/server/src/seed/generate-srd-spells.ts                               
packages/server/src/seed/generate-subclasses.ts                               
packages/server/src/utils/__type-tests__/character-class-restrictions.ts      
packages/server/src/utils/__type-tests__/character-spell-slot-restrictions.ts 
packages/server/src/utils/__type-tests__/character-stats-restrictions.ts      
packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts
packages/server/src/utils/__type-tests__/encounter-restrictions.ts            
Unused dependencies (1)
@prisma/client  packages/server/package.json:36:6
Unused devDependencies (4)
jscpd                            package.json:91:6                
@tanstack/react-router-devtools  packages/client/package.json:45:6
@types/bcryptjs                  packages/server/package.json:48:6
pino-pretty                      packages/server/package.json:50:6
Unused exports (135)
TEST_PASSWORD                                e2e/helpers/test-data.ts:3:14                                              
uniqueEmail                        function  e2e/helpers/test-data.ts:18:17                                             
validFrequency                     function  packages/client/src/components/homebrew/monster/monster-form-data.ts:355:17
buildDraftFromStats                function  packages/client/src/components/sheet/ability-scores-state.ts:15:17         
computeDraftChanges                function  packages/client/src/components/sheet/ability-scores-state.ts:26:17         
badgeVariants                                packages/client/src/components/ui/badge.tsx:32:17                          
DialogClose                                  packages/client/src/components/ui/dialog.tsx:102:3                         
DialogOverlay                                packages/client/src/components/ui/dialog.tsx:107:3                         
DialogPortal                                 packages/client/src/components/ui/dialog.tsx:108:3                         
DialogTrigger                                packages/client/src/components/ui/dialog.tsx:110:3                         
PopoverAnchor                                packages/client/src/components/ui/popover.tsx:29:19                        
ScrollBar                                    packages/client/src/components/ui/scroll-area.tsx:44:22                    
SelectGroup                                  packages/client/src/components/ui/select.tsx:140:3                         
SelectLabel                                  packages/client/src/components/ui/select.tsx:142:3                         
SelectScrollDownButton                       packages/client/src/components/ui/select.tsx:143:3                         
SelectScrollUpButton                         packages/client/src/components/ui/select.tsx:144:3                         
SelectSeparator                              packages/client/src/components/ui/select.tsx:145:3                         
SheetClose                                   packages/client/src/components/ui/sheet.tsx:110:3                          
SheetOverlay                                 packages/client/src/components/ui/sheet.tsx:114:3                          
SheetPortal                                  packages/client/src/components/ui/sheet.tsx:115:3                          
resolveMonsterParticipant          function  packages/client/src/components/vtt/drawer/monster-stat-block-state.ts:26:17
createTRPCClientInstance           function  packages/client/src/lib/trpc.ts:44:17                                      
INITIAL_STATE                                packages/client/src/stores/combat-store.ts:56:10                           
DEFAULT_CELL_SIZE_PX                         packages/client/src/stores/map-canvas-store.ts:576:10                      
INITIAL_STATE                                packages/client/src/stores/vtt-drawer-store.ts:137:10                      
buildEncounterSummary              function  packages/client/src/test/fixtures-encounter.ts:94:17                       
TEST_MAP_DETAIL_WITH_BG                      packages/client/src/test/fixtures-map.ts:54:14                             
buildTrait                         function  packages/client/src/test/fixtures-srd.ts:22:17                             
buildSubspecies                    function  packages/client/src/test/fixtures-srd.ts:28:17                             
buildClassFeature                  function  packages/client/src/test/fixtures-srd.ts:52:17                             
buildSubclass                      function  packages/client/src/test/fixtures-srd.ts:63:17                             
buildClass                         function  packages/client/src/test/fixtures-srd.ts:91:17                             
buildFeat                          function  packages/client/src/test/fixtures-srd.ts:110:17                            
buildEquipmentOption               function  packages/client/src/test/fixtures-srd.ts:124:17                            
buildBackground                    function  packages/client/src/test/fixtures-srd.ts:143:17                            
createTestQueryClient              function  packages/client/src/test/render-helper.tsx:7:17                            
createTestQueryClient              function  packages/client/src/test/wizard-test-utils.tsx:17:17                       
ACCESS_TOKEN_EXPIRY_SECONDS                  packages/server/src/config/auth.ts:45:14                                   
getRedisUrl                        function  packages/server/src/config/redis.ts:7:17                                   
getRedisClient                     function  packages/server/src/config/redis.ts:11:17                                  
closeRedis                         function  packages/server/src/config/redis.ts:22:23                                  
SEED_USERS                                   packages/server/src/seed/seed-users.ts:8:14                                
computeAdjustedTurnIndex           function  packages/server/src/services/character-delete.ts:81:17                     
validateSubclassInDb               function  packages/server/src/services/level-up/subclass.ts:48:23                    
CASTER_INCLUDE                               packages/server/src/services/spell-casting/load-participants.ts:11:14      
SPELL_TARGET_INCLUDE                         packages/server/src/services/spell-casting/load-participants.ts:22:14      
getTestPasswordHash                function  packages/server/src/test/fixtures.ts:12:17                                 
middleware                                   packages/server/src/trpc/trpc.ts:81:14                                     
lockTurnIndexForRemoval                      packages/server/src/utils/encounter-helpers.ts:157:3                       
reindexSortOrders                            packages/server/src/utils/encounter-helpers.ts:158:3                       
DEFAULT_LINE_WIDTH_FT                        packages/shared/src/map/area-template.ts:18:14                             
DRAWING_SHAPE_TYPES                          packages/shared/src/map/drawing.ts:11:14                                   
DEFAULT_STROKE_COLOR                         packages/shared/src/map/drawing.ts:14:14                                   
MIN_STROKE_WIDTH                             packages/shared/src/map/drawing.ts:17:14                                   
MAX_STROKE_WIDTH                             packages/shared/src/map/drawing.ts:18:14                                   
DEFAULT_STROKE_WIDTH                         packages/shared/src/map/drawing.ts:21:14                                   
drawingShapeTypeSchema                       packages/shared/src/map/drawing.ts:30:14                                   
freehandShapeSchema                          packages/shared/src/map/drawing.ts:45:14                                   
lineShapeSchema                              packages/shared/src/map/drawing.ts:55:14                                   
rectangleShapeSchema                         packages/shared/src/map/drawing.ts:66:14                                   
circleShapeSchema                            packages/shared/src/map/drawing.ts:77:14                                   
FOG_MODE_HIDE_ALL                            packages/shared/src/map/fog.ts:8:14                                        
FOG_MODE_REVEAL_ALL                          packages/shared/src/map/fog.ts:11:14                                       
FOG_MODES                                    packages/shared/src/map/fog.ts:13:14                                       
MAX_FOG_REGIONS                              packages/shared/src/map/fog.ts:19:14                                       
fogModeSchema                                packages/shared/src/map/fog.ts:37:14                                       
DAMAGE_TYPES                                 packages/shared/src/rules/damage-types.ts:7:14                             
isValidDamageTypeName              function  packages/shared/src/rules/damage-types.ts:27:17                            
CR_ONE_EIGHTH                                packages/shared/src/rules/xp.ts:9:14                                       
CR_ONE_QUARTER                               packages/shared/src/rules/xp.ts:10:14                                      
CR_ONE_HALF                                  packages/shared/src/rules/xp.ts:11:14                                      
notificationCampaignDataSchema               packages/shared/src/schemas/campaign.ts:27:14                              
notificationWhisperDataSchema                packages/shared/src/schemas/campaign.ts:32:14                              
campaignMemberCharacterSchema                packages/shared/src/schemas/campaign.ts:121:14                             
hpMethodSchema                               packages/shared/src/schemas/character-inputs.ts:256:14                     
characterSchema                              packages/shared/src/schemas/character.ts:94:14                             
characterClassSchema                         packages/shared/src/schemas/character.ts:114:14                            
characterProficiencySchema                   packages/shared/src/schemas/character.ts:157:14                            
characterSpellSlotSchema                     packages/shared/src/schemas/character.ts:175:14                            
characterFeatSchema                          packages/shared/src/schemas/character.ts:185:14                            
asiChoiceDataSchema                          packages/shared/src/schemas/character.ts:211:14                            
featChoiceDataSchema                         packages/shared/src/schemas/character.ts:217:14                            
metamagicChoiceDataSchema                    packages/shared/src/schemas/character.ts:222:14                            
levelUpChoiceDataSchema                      packages/shared/src/schemas/character.ts:227:14                            
characterLevelChoiceSchema                   packages/shared/src/schemas/character.ts:258:14                            
characterMetamagicSchema                     packages/shared/src/schemas/character.ts:269:14                            
characterSummarySchema                       packages/shared/src/schemas/character.ts:298:14                            
homebrewExportEntrySchema                    packages/shared/src/schemas/homebrew-export.ts:44:14                       
weaponCategorySchema                         packages/shared/src/schemas/inventory.ts:29:14                             
magicItemSummarySchema                       packages/shared/src/schemas/magic-item.ts:75:14                            
MAP_LAYER_TYPES                              packages/shared/src/schemas/map.ts:43:14                                   
mapSchema                                    packages/shared/src/schemas/map.ts:53:14                                   
mapSummarySchema                             packages/shared/src/schemas/map.ts:119:14                                  
monsterSpellEntrySchema                      packages/shared/src/schemas/monster.ts:77:14                               
monsterSummarySchema                         packages/shared/src/schemas/monster.ts:184:14                              
npcSchema                                    packages/shared/src/schemas/npc.ts:9:14                                    
hitDiceResultSchema                          packages/shared/src/schemas/rest-inputs.ts:19:14                           
subclassSchema                               packages/shared/src/schemas/srd.ts:169:14                                  
equipmentOptionItemSchema                    packages/shared/src/schemas/srd.ts:221:14                                  
runCodeIntelCliCommand             function  scripts/code-intel/cli-main.ts:27:23                                       
DAEMON_FALLBACK_ERROR_NAME                   scripts/code-intel/daemon-server.ts:25:14                                  
DEFAULT_DAEMON_ROOT_DIR                      scripts/code-intel/daemon-state.ts:20:14                                   
formatResults                      function  scripts/code-intel/format.ts:69:17                                         
formatDefinitionNameMiss           function  scripts/code-intel/format.ts:108:17                                        
formatDependentsProjectSummary     function  scripts/code-intel/format.ts:131:17                                        
collectImportEdges                 function  scripts/code-intel/import-graph.ts:39:17                                   
importDeclarationHasRuntimeEdge    function  scripts/code-intel/import-graph.ts:86:17                                   
exportDeclarationHasRuntimeEdge    function  scripts/code-intel/import-graph.ts:94:17                                   
addResolvedEdge                    function  scripts/code-intel/import-graph.ts:102:17                                  
collectViMockSpecifiers            function  scripts/code-intel/import-graph.ts:113:17                                  
literalFirstArgument               function  scripts/code-intel/import-graph.ts:126:17                                  
uniqueEdges                        function  scripts/code-intel/import-graph.ts:135:17                                  
serverUsage                        function  scripts/code-intel/server-cli.ts:94:17                                     
ROUTER_ROOT                                  scripts/codemods/lib/trpc-shared-schema.ts:16:14                           
SHARED_SCHEMA_ROOT                           scripts/codemods/lib/trpc-shared-schema.ts:17:14                           
namedImportSpecifiers              function  scripts/codemods/lib/trpc-shared-schema.ts:75:17                           
collectSharedSchemaValueImports    function  scripts/codemods/lib/trpc-shared-schema.ts:83:17                           
specifierText                      function  scripts/codemods/lib/trpc-shared-schema.ts:121:17                          
normalizedImportText               function  scripts/codemods/lib/trpc-shared-schema.ts:127:17                          
discoverRouterFiles                function  scripts/codemods/lib/trpc-shared-schema.ts:229:17                          
targetHasIdentifier                function  scripts/codemods/lib/trpc-shared-schema.ts:373:17                          
isProcedureSchemaCall              function  scripts/codemods/lib/trpc-shared-schema.ts:377:17                          
propertyAssignmentName             function  scripts/codemods/lib/trpc-shared-schema.ts:401:17                          
variableDeclarationName            function  scripts/codemods/lib/trpc-shared-schema.ts:413:17                          
getTopLevelConstSchemas            function  scripts/codemods/lib/trpc-shared-schema.ts:426:17                          
codemodErrorReason                 function  scripts/codemods/lib/trpc-shared-schema.ts:462:17                          
removeMatchingTypeOnlyNamedImport  function  scripts/codemods/lib/trpc-shared-schema.ts:568:17                          
hasTypeOnlyImport                  function  scripts/codemods/lib/trpc-shared-schema.ts:592:17                          
ensureValueImportAvailable         function  scripts/codemods/lib/trpc-shared-schema.ts:609:17                          
hasReference                       function  scripts/codemods/lib/trpc-shared-schema.ts:755:17                          
removeUnusedNamedImport            function  scripts/codemods/lib/trpc-shared-schema.ts:762:17                          
DEFAULT_EFFECTIVE_LINES_THRESHOLD            scripts/drift-ai/comments.ts:21:14                                         
DEFAULT_COMMENT_RATIO_WARN                   scripts/drift-ai/comments.ts:26:14                                         
AUTO_CONFIG_FILENAME                         scripts/drift-ai/config.ts:6:14                                            
strongTokens                       function  scripts/drift-ai/ghost-files.ts:126:17                                     
Unused exported types (258)
ApiCharacterSpellSlot              interface  e2e/helpers/api.ts:179:18                                                 
MapToolbarViewControls             interface  packages/client/src/components/campaign/maps/map-toolbar.tsx:10:18        
MapToolbarFogControls              interface  packages/client/src/components/campaign/maps/map-toolbar.tsx:19:18        
MapToolbarDrawingControls          interface  packages/client/src/components/campaign/maps/map-toolbar.tsx:25:18        
MapToolbarTemplateControls         interface  packages/client/src/components/campaign/maps/map-toolbar.tsx:35:18        
CharacterSummary                   type       packages/client/src/components/character-card.tsx:10:15                   
FilterOption                       interface  packages/client/src/components/common/filter-select.tsx:8:18              
FilterSelectAllOption              interface  packages/client/src/components/common/filter-select.tsx:13:18             
BackgroundFormData                 type       …client/src/components/homebrew/background/background-form-fields.tsx:9:15
ClassFormData                      type       packages/client/src/components/homebrew/class/class-form-fields.tsx:14:15 
ItemFormData                       type       packages/client/src/components/homebrew/item/item-form-fields.tsx:19:15   
MagicItemFormData                  type       …lient/src/components/homebrew/magic-item/magic-item-form-fields.tsx:14:15
MonsterFormData                    type       …ages/client/src/components/homebrew/monster/monster-form-fields.tsx:19:15
SpellFormData                      type       packages/client/src/components/homebrew/spell/spell-form-fields.tsx:11:15 
SubclassFormData                   type       …es/client/src/components/homebrew/subclass/subclass-form-fields.tsx:15:15
BadgeProps                         interface  packages/client/src/components/ui/badge.tsx:25:18                         
ButtonProps                        interface  packages/client/src/components/ui/button.tsx:33:18                        
ToolHandlerRegistry                type       packages/client/src/hooks/canvas-input/tool-handlers.ts:317:15            
CanvasInputResult                  type       packages/client/src/hooks/canvas-input/use-canvas-input.ts:149:34         
PresenceUserInfo                   type       packages/client/src/hooks/use-campaign-presence.ts:21:15                  
ApplyInput                         interface  packages/client/src/hooks/vtt-drawer/use-weapon-attack.ts:24:18           
CombatDialogActions                type       packages/client/src/stores/combat-store.ts:57:15                          
CombatDialogState                  type       packages/client/src/stores/combat-store.ts:57:36                          
CombatStore                        type       packages/client/src/stores/combat-store.ts:57:55                          
FogDrawState                       type       packages/client/src/stores/map-canvas-store.ts:579:3                      
MapCanvasActions                   type       packages/client/src/stores/map-canvas-store.ts:581:3                      
MapCanvasState                     type       packages/client/src/stores/map-canvas-store.ts:582:3                      
MapCanvasStore                     type       packages/client/src/stores/map-canvas-store.ts:583:3                      
MeasurementState                   type       packages/client/src/stores/map-canvas-store.ts:585:3                      
StagePosition                      type       packages/client/src/stores/map-canvas-store.ts:587:3                      
TargetPickActivateOptions          type       packages/client/src/stores/map-canvas-store.ts:588:3                      
TargetPickCallback                 type       packages/client/src/stores/map-canvas-store.ts:589:3                      
TargetPickCancel                   type       packages/client/src/stores/map-canvas-store.ts:590:3                      
TargetPickFilter                   type       packages/client/src/stores/map-canvas-store.ts:591:3                      
TargetPickState                    type       packages/client/src/stores/map-canvas-store.ts:592:3                      
TemplateState                      type       packages/client/src/stores/map-canvas-store.ts:593:3                      
DrawerMode                         type       packages/client/src/stores/vtt-drawer-store.ts:138:15                     
VttDrawerActions                   type       packages/client/src/stores/vtt-drawer-store.ts:138:41                     
VttDrawerState                     type       packages/client/src/stores/vtt-drawer-store.ts:138:59                     
SeedCasterType                     type       packages/server/src/seed/seed-srd-classes.ts:4:13                         
SeedSubclassCasterType             type       packages/server/src/seed/seed-srd-subclass-data.ts:4:13                   
AssertTurnOpts                     type       packages/server/src/services/combat-actions/combat-actions.ts:26:3        
CombatChatPayload                  type       packages/server/src/services/combat-actions/combat-actions.ts:30:3        
TurnValidationResult               type       packages/server/src/services/combat-actions/combat-actions.ts:33:3        
CombatChatPayload                  type       packages/server/src/services/combat-actions/types.ts:12:35                
CreateNotificationParams           interface  packages/server/src/services/notification-service.ts:18:18                
CampaignTestUserOptions            interface  packages/server/src/test/campaign-test-context.ts:18:18                   
CharacterStatsRow                  interface  packages/server/src/utils/encounter-query.ts:34:18                        
EncounterFromState                 type       packages/server/src/utils/encounter-state-mutations.ts:37:13              
EncounterToState                   type       packages/server/src/utils/encounter-state-mutations.ts:38:13              
MapTokenCharacterData              interface  packages/server/src/utils/map-types.ts:7:18                               
AuthzCallerContext                 interface  packages/server/src/utils/request-logger.ts:13:18                         
AuthzOutcome                       type       packages/server/src/utils/request-logger.ts:33:13                         
MutationOutcome                    type       packages/server/src/utils/request-logger.ts:62:13                         
BroadcastOutcome                   type       packages/server/src/utils/request-logger.ts:95:13                         
ScriptLogFields                    type       packages/server/src/utils/script-logger.ts:1:13                           
DrawingShapeType                   type       packages/shared/src/map/drawing.ts:32:13                                  
FreehandShape                      type       packages/shared/src/map/drawing.ts:52:13                                  
LineShape                          type       packages/shared/src/map/drawing.ts:63:13                                  
RectangleShape                     type       packages/shared/src/map/drawing.ts:74:13                                  
CircleShape                        type       packages/shared/src/map/drawing.ts:84:13                                  
WeaponProperty                     type       packages/shared/src/rules/attack-damage.ts:29:13                          
WeaponCategory                     type       packages/shared/src/rules/attack-damage.ts:31:13                          
ArmorCategory                      type       packages/shared/src/rules/character-rules.ts:163:13                       
UnarmoredDefenseType               type       packages/shared/src/rules/character-rules.ts:170:13                       
RefreshResponse                    type       packages/shared/src/schemas/auth.ts:53:13                                 
RegisterResponse                   type       packages/shared/src/schemas/auth.ts:64:13                                 
SuccessResponse                    type       packages/shared/src/schemas/auth.ts:74:13                                 
ChangePasswordResponse             type       packages/shared/src/schemas/auth.ts:82:13                                 
UpdateProfileInput                 type       packages/shared/src/schemas/auth.ts:94:13                                 
ChangePasswordInput                type       packages/shared/src/schemas/auth.ts:106:13                                
DeleteAccountInput                 type       packages/shared/src/schemas/auth.ts:114:13                                
CreateCampaignInput                type       packages/shared/src/schemas/campaign-inputs.ts:22:13                      
GetCampaignInput                   type       packages/shared/src/schemas/campaign-inputs.ts:34:13                      
DeleteCampaignInput                type       packages/shared/src/schemas/campaign-inputs.ts:42:13                      
UpdateCampaignInput                type       packages/shared/src/schemas/campaign-inputs.ts:62:13                      
CreateInviteInput                  type       packages/shared/src/schemas/campaign-inputs.ts:87:13                      
ListInvitesInput                   type       packages/shared/src/schemas/campaign-inputs.ts:99:13                      
RevokeInviteInput                  type       packages/shared/src/schemas/campaign-inputs.ts:111:13                     
JoinCampaignInput                  type       packages/shared/src/schemas/campaign-inputs.ts:136:13                     
AssignCharacterInput               type       packages/shared/src/schemas/campaign-inputs.ts:149:13                     
UnassignCharacterInput             type       packages/shared/src/schemas/campaign-inputs.ts:157:13                     
CampaignMemberRole                 type       packages/shared/src/schemas/campaign.ts:10:13                             
Campaign                           type       packages/shared/src/schemas/campaign.ts:71:13                             
CampaignMember                     type       packages/shared/src/schemas/campaign.ts:83:13                             
JoinCampaignResult                 type       packages/shared/src/schemas/campaign.ts:102:13                            
ListOutput                         type       packages/shared/src/schemas/campaign.ts:164:13                            
GetCharacterInput                  type       packages/shared/src/schemas/character-inputs.ts:103:13                    
DeleteCharacterInput               type       packages/shared/src/schemas/character-inputs.ts:111:13                    
ProficiencyType                    type       packages/shared/src/schemas/character.ts:63:13                            
ProficiencyLevel                   type       packages/shared/src/schemas/character.ts:66:13                            
FeatSource                         type       packages/shared/src/schemas/character.ts:69:13                            
FeatureSource                      type       packages/shared/src/schemas/character.ts:72:13                            
LevelChoiceType                    type       packages/shared/src/schemas/character.ts:82:13                            
Character                          type       packages/shared/src/schemas/character.ts:112:13                           
CharacterClass                     type       packages/shared/src/schemas/character.ts:123:13                           
CharacterLevelChoice               type       packages/shared/src/schemas/character.ts:267:13                           
ListOutput                         type       packages/shared/src/schemas/character.ts:320:13                           
ChatMessageType                    type       packages/shared/src/schemas/chat-inputs.ts:18:13                          
SendChatMessageInput               type       packages/shared/src/schemas/chat-inputs.ts:33:13                          
ListChatMessagesInput              type       packages/shared/src/schemas/chat-inputs.ts:47:13                          
CombatChatPayload                  type       packages/shared/src/schemas/combat-action.ts:17:13                        
CombatSpellCastResponse            type       packages/shared/src/schemas/combat-action.ts:73:13                        
AttemptAttackResponse              type       packages/shared/src/schemas/combat-action.ts:84:13                        
DiceRollInput                      type       packages/shared/src/schemas/dice-inputs.ts:23:13                          
CreateEncounterInput               type       packages/shared/src/schemas/encounter-inputs.ts:30:13                     
UpdateEncounterInput               type       packages/shared/src/schemas/encounter-inputs.ts:40:13                     
DeleteEncounterInput               type       packages/shared/src/schemas/encounter-inputs.ts:48:13                     
GetEncounterInput                  type       packages/shared/src/schemas/encounter-inputs.ts:56:13                     
ListEncountersInput                type       packages/shared/src/schemas/encounter-inputs.ts:65:13                     
TransitionEncounterStateInput      type       packages/shared/src/schemas/encounter-inputs.ts:78:13                     
AddCharacterParticipantInput       type       packages/shared/src/schemas/encounter-inputs.ts:106:13                    
AddMonsterParticipantInput         type       packages/shared/src/schemas/encounter-inputs.ts:126:13                    
AddNpcParticipantInput             type       packages/shared/src/schemas/encounter-inputs.ts:143:13                    
RemoveParticipantInput             type       packages/shared/src/schemas/encounter-inputs.ts:185:13                    
SetInitiativeInput                 type       packages/shared/src/schemas/encounter-inputs.ts:194:13                    
LinkParticipantToTokenInput        type       packages/shared/src/schemas/encounter-inputs.ts:297:13                    
UnlinkParticipantFromTokenInput    type       packages/shared/src/schemas/encounter-inputs.ts:306:13                    
AutoLinkTokensInput                type       packages/shared/src/schemas/encounter-inputs.ts:314:13                    
AutoLinkTokensResult               type       packages/shared/src/schemas/encounter-inputs.ts:320:13                    
ParticipantType                    type       packages/shared/src/schemas/encounter.ts:28:13                            
Encounter                          type       packages/shared/src/schemas/encounter.ts:80:13                            
ListOutput                         type       packages/shared/src/schemas/encounter.ts:177:13                           
EchoInput                          type       packages/shared/src/schemas/health-inputs.ts:5:13                         
HealthCheckResponse                type       packages/shared/src/schemas/health.ts:11:13                               
HealthEchoResponse                 type       packages/shared/src/schemas/health.ts:17:13                               
LinkCollectionOutput               type       packages/shared/src/schemas/homebrew-campaign.ts:7:13                     
UnlinkCollectionOutput             type       packages/shared/src/schemas/homebrew-campaign.ts:11:13                    
ListCampaignCollectionsOutput      type       packages/shared/src/schemas/homebrew-campaign.ts:15:13                    
ListCampaignEntriesOutput          type       packages/shared/src/schemas/homebrew-campaign.ts:19:13                    
CreateCollectionInput              type       packages/shared/src/schemas/homebrew-inputs.ts:26:13                      
UpdateCollectionInput              type       packages/shared/src/schemas/homebrew-inputs.ts:37:13                      
DeleteCollectionInput              type       packages/shared/src/schemas/homebrew-inputs.ts:45:13                      
GetCollectionInput                 type       packages/shared/src/schemas/homebrew-inputs.ts:53:13                      
ListCollectionsInput               type       packages/shared/src/schemas/homebrew-inputs.ts:61:13                      
CreateEntryInput                   type       packages/shared/src/schemas/homebrew-inputs.ts:82:13                      
UpdateEntryInput                   type       packages/shared/src/schemas/homebrew-inputs.ts:104:13                     
DeleteEntryInput                   type       packages/shared/src/schemas/homebrew-inputs.ts:112:13                     
GetEntryInput                      type       packages/shared/src/schemas/homebrew-inputs.ts:120:13                     
LinkCollectionInput                type       packages/shared/src/schemas/homebrew-inputs.ts:143:13                     
UnlinkCollectionInput              type       packages/shared/src/schemas/homebrew-inputs.ts:152:13                     
ListCampaignCollectionsInput       type       packages/shared/src/schemas/homebrew-inputs.ts:160:13                     
ListCampaignEntriesInput           type       packages/shared/src/schemas/homebrew-inputs.ts:170:13                     
ExportCollectionInput              type       packages/shared/src/schemas/homebrew-inputs.ts:182:13                     
HomebrewFeature                    type       packages/shared/src/schemas/homebrew.ts:93:13                             
HomebrewSpeciesTrait               type       packages/shared/src/schemas/homebrew.ts:110:13                            
HomebrewCollection                 type       packages/shared/src/schemas/homebrew.ts:275:13                            
ListCollectionsOutput              type       packages/shared/src/schemas/homebrew.ts:359:13                            
ListEntriesOutput                  type       packages/shared/src/schemas/homebrew.ts:363:13                            
ItemSourceType                     type       packages/shared/src/schemas/inventory.ts:23:13                            
ArmorProperties                    type       packages/shared/src/schemas/inventory.ts:56:13                            
DeleteOutput                       type       packages/shared/src/schemas/inventory.ts:115:13                           
ListOutput                         type       packages/shared/src/schemas/invite.ts:7:13                                
ListMagicItemsInput                type       packages/shared/src/schemas/magic-item-inputs.ts:30:13                    
GetMagicItemInput                  type       packages/shared/src/schemas/magic-item-inputs.ts:38:13                    
SearchMagicItemsInput              type       packages/shared/src/schemas/magic-item-inputs.ts:48:13                    
MagicItemCharges                   type       packages/shared/src/schemas/magic-item.ts:43:13                           
MagicItemVariant                   type       packages/shared/src/schemas/magic-item.ts:50:13                           
ListMagicItemsResponse             type       packages/shared/src/schemas/magic-item.ts:91:13                           
SearchOutput                       type       packages/shared/src/schemas/magic-item.ts:95:13                           
CreateMapInput                     type       packages/shared/src/schemas/map-inputs.ts:66:13                           
UpdateMapInput                     type       packages/shared/src/schemas/map-inputs.ts:80:13                           
DeleteMapInput                     type       packages/shared/src/schemas/map-inputs.ts:88:13                           
GetMapInput                        type       packages/shared/src/schemas/map-inputs.ts:96:13                           
ListMapsInput                      type       packages/shared/src/schemas/map-inputs.ts:104:13                          
CreateTokenInput                   type       packages/shared/src/schemas/map-inputs.ts:127:13                          
UpdateTokenInput                   type       packages/shared/src/schemas/map-inputs.ts:144:13                          
MoveTokenInput                     type       packages/shared/src/schemas/map-inputs.ts:155:13                          
DeleteTokenInput                   type       packages/shared/src/schemas/map-inputs.ts:164:13                          
CreateLayerInput                   type       packages/shared/src/schemas/map-inputs.ts:185:13                          
UpdateLayerInput                   type       packages/shared/src/schemas/map-inputs.ts:196:13                          
DeleteLayerInput                   type       packages/shared/src/schemas/map-inputs.ts:205:13                          
VttMap                             type       packages/shared/src/schemas/map.ts:66:13                                  
ListOutput                         type       packages/shared/src/schemas/map.ts:134:13                                 
ListMonstersInput                  type       packages/shared/src/schemas/monster-inputs.ts:41:13                       
GetMonsterInput                    type       packages/shared/src/schemas/monster-inputs.ts:49:13                       
SearchMonstersInput                type       packages/shared/src/schemas/monster-inputs.ts:59:13                       
LegendaryActions                   type       packages/shared/src/schemas/monster.ts:69:13                              
ListMonstersResponse               type       packages/shared/src/schemas/monster.ts:204:13                             
SearchOutput                       type       packages/shared/src/schemas/monster.ts:208:13                             
CreateNoteInput                    type       packages/shared/src/schemas/note-inputs.ts:31:13                          
UpdateNoteInput                    type       packages/shared/src/schemas/note-inputs.ts:53:13                          
DeleteNoteInput                    type       packages/shared/src/schemas/note-inputs.ts:65:13                          
CampaignNote                       type       packages/shared/src/schemas/note.ts:29:13                                 
ListNotificationsInput             type       packages/shared/src/schemas/notification-inputs.ts:25:13                  
MarkNotificationReadInput          type       packages/shared/src/schemas/notification-inputs.ts:37:13                  
ListNotificationsResponse          type       packages/shared/src/schemas/notification-inputs.ts:49:13                  
MarkAllReadResult                  type       packages/shared/src/schemas/notification-inputs.ts:55:13                  
CreateNpcInput                     type       packages/shared/src/schemas/npc-inputs.ts:26:13                           
UpdateNpcInput                     type       packages/shared/src/schemas/npc-inputs.ts:45:13                           
DeleteNpcInput                     type       packages/shared/src/schemas/npc-inputs.ts:57:13                           
Npc                                type       packages/shared/src/schemas/npc.ts:24:13                                  
ListOutput                         type       packages/shared/src/schemas/npc.ts:37:13                                  
SocketErrorPayload                 type       packages/shared/src/schemas/socket-events.ts:93:13                        
PresenceHeartbeatPayload           type       packages/shared/src/schemas/socket-events.ts:103:13                       
RecoverAllOutput                   type       packages/shared/src/schemas/spell-casting-inputs.ts:73:13                 
DropConcentrationInput             type       packages/shared/src/schemas/spell-casting-inputs.ts:86:13                 
SpellAttackType                    type       packages/shared/src/schemas/spell.ts:27:13                                
SpellComponent                     type       packages/shared/src/schemas/spell.ts:48:13                                
SpellSource                        type       packages/shared/src/schemas/spell.ts:52:13                                
CharacterSpell                     type       packages/shared/src/schemas/spell.ts:100:13                               
ToggleSpellPreparedInput           type       packages/shared/src/schemas/spell.ts:158:13                               
ListCharacterSpellsInput           type       packages/shared/src/schemas/spell.ts:167:13                               
ListOutput                         type       packages/shared/src/schemas/spell.ts:171:13                               
Condition                          type       packages/shared/src/schemas/srd-reference.ts:13:13                        
DamageType                         type       packages/shared/src/schemas/srd-reference.ts:25:13                        
Language                           type       packages/shared/src/schemas/srd-reference.ts:38:13                        
SrdWeaponProperty                  type       packages/shared/src/schemas/srd-reference.ts:50:13                        
SrdWeaponMastery                   type       packages/shared/src/schemas/srd-reference.ts:62:13                        
Alignment                          type       packages/shared/src/schemas/srd-reference.ts:75:13                        
MagicSchool                        type       packages/shared/src/schemas/srd-reference.ts:87:13                        
SrdProficiency                     type       packages/shared/src/schemas/srd-reference.ts:101:13                       
RulesGlossaryCategory              type       packages/shared/src/schemas/srd-reference.ts:116:13                       
RulesGlossaryEntry                 type       packages/shared/src/schemas/srd-reference.ts:125:13                       
AbilityScore                       type       packages/shared/src/schemas/srd.ts:37:13                                  
Skill                              type       packages/shared/src/schemas/srd.ts:46:13                                  
SkillWithAbility                   type       packages/shared/src/schemas/srd.ts:52:13                                  
Species                            type       packages/shared/src/schemas/srd.ts:93:13                                  
Class                              type       packages/shared/src/schemas/srd.ts:145:13                                 
SubclassReference                  type       packages/shared/src/schemas/srd.ts:182:13                                 
FeatType                           type       packages/shared/src/schemas/srd.ts:197:13                                 
EquipmentOptionItem                type       packages/shared/src/schemas/srd.ts:229:13                                 
Background                         type       packages/shared/src/schemas/srd.ts:250:13                                 
EquipmentWeaponData                type       packages/shared/src/schemas/srd.ts:288:13                                 
EquipmentArmorData                 type       packages/shared/src/schemas/srd.ts:298:13                                 
Equipment                          type       packages/shared/src/schemas/srd.ts:313:13                                 
SrdGetByIdInput                    type       packages/shared/src/schemas/srd.ts:325:13                                 
SrdListClassFeaturesInput          type       packages/shared/src/schemas/srd.ts:335:13                                 
SrdListEquipmentInput              type       packages/shared/src/schemas/srd.ts:343:13                                 
SrdListSubclassesInput             type       packages/shared/src/schemas/srd.ts:351:13                                 
GetAllOutput                       type       packages/shared/src/schemas/srd.ts:370:13                                 
ListConditionsOutput               type       packages/shared/src/schemas/srd.ts:374:13                                 
ListDamageTypesOutput              type       packages/shared/src/schemas/srd.ts:378:13                                 
ListLanguagesOutput                type       packages/shared/src/schemas/srd.ts:382:13                                 
ListWeaponPropertiesOutput         type       packages/shared/src/schemas/srd.ts:386:13                                 
ListWeaponMasteryPropertiesOutput  type       packages/shared/src/schemas/srd.ts:390:13                                 
ListAlignmentsOutput               type       packages/shared/src/schemas/srd.ts:396:13                                 
ListMagicSchoolsOutput             type       packages/shared/src/schemas/srd.ts:400:13                                 
ListSrdProficienciesOutput         type       packages/shared/src/schemas/srd.ts:404:13                                 
ListRulesGlossaryOutput            type       packages/shared/src/schemas/srd.ts:408:13                                 
ListWeaponMasteriesInput           type       packages/shared/src/schemas/weapon-mastery-inputs.ts:43:13                
ListOutput                         type       packages/shared/src/schemas/weapon-mastery-inputs.ts:47:13                
SetOutput                          type       packages/shared/src/schemas/weapon-mastery-inputs.ts:51:13                
SpawnedDaemonHandle                type       scripts/code-intel/daemon-process.ts:14:13                                
CodeIntelDaemonProtocolVersion     type       scripts/code-intel/daemon-protocol.ts:5:13                                
DaemonLifecycleFailureKind         type       scripts/code-intel/lifecycle-probe.ts:16:13                               
ServerCliCommand                   type       scripts/code-intel/server-cli.ts:30:13                                    
TestReason                         type       scripts/code-intel/types.ts:10:13                                         
DriftAiDuplicatesConfig            type       scripts/drift-ai/config.ts:14:13                                          
DriftAiCommentsConfig              type       scripts/drift-ai/config.ts:19:13                                          
DriftAiGhostFilesConfig            type       scripts/drift-ai/config.ts:23:13                                          
DriftAiChecksConfig                type       scripts/drift-ai/config.ts:32:13                                          
StatLike                           type       scripts/drift-ai/current-inventory.ts:24:13                               
JscpdFileEntry                     type       scripts/drift-ai/duplicates.ts:15:13                                      
JscpdReport                        type       scripts/drift-ai/duplicates.ts:28:13                                      
DuplicateScopeKey                  type       scripts/drift-ai/duplicates.ts:168:13                                     
JscpdRunnerResult                  type       scripts/drift-ai/duplicates.ts:261:13                                     
GhostFileMatchKind                 type       scripts/drift-ai/ghost-files.ts:55:13
```

## YOUR-TAKE: Unused Files

Likely true dead code:

- None I would delete in Pass 1.

Likely intentional public surface / keep:

- `packages/server/src/utils/__type-tests__/*.ts`: compile-only negative type tests referenced by docs and local lint-rule logic, not imported by design. Pass 2 should probably keep these and configure Knip with an explicit entry/ignoreFiles policy for this directory.

Likely false positive from missing plugin/config:

- None from an ecosystem plugin. The type-test files are a Musi-local compile-only pattern rather than a missing Knip plugin.

Borderline - needs human judgment:

- `packages/server/src/seed/generate-class-features.ts`, `generate-srd-rules-glossary.ts`, `generate-srd-spells.ts`, `generate-subclasses.ts`: they are one-time/manual SRD generator scripts with shebang/usage comments. If these are still part of the SRD refresh workflow, mark them as entries; otherwise they are deletion candidates after confirming generated outputs are durable.

## YOUR-TAKE: Unused Dependencies

Likely true dead code:

- None confirmed.

Likely intentional public surface / keep:

- None.

Likely false positive from missing plugin/config:

- `@prisma/client`: generated Prisma client files import `@prisma/client/runtime/client`, but `packages/server/src/generated/prisma` is gitignored and intentionally outside Knip's project graph. Pass 2 should likely keep the dependency and add a narrow Knip dependency ignore/comment.

Borderline - needs human judgment:

- None.

## YOUR-TAKE: Unused DevDependencies

Likely true dead code:

- `@tanstack/react-router-devtools`: no source references found in the client.
- `@types/bcryptjs`: `bcryptjs` v3 appears to provide its own types; source imports `bcryptjs`, not `@types/bcryptjs`.

Likely intentional public surface / keep:

- None.

Likely false positive from missing plugin/config:

- `jscpd`: used by `scripts/drift-ai/duplicates.ts` through `node_modules/.bin/jscpd`, not an import or package-script binary call Knip can see.
- `pino-pretty`: used by Fastify/Pino transport target string `target: "pino-pretty"` in `packages/server/src/app.ts`; Knip's Pino visitor does not catch this Fastify logger shape.

Borderline - needs human judgment:

- None.

## YOUR-TAKE: Unused Exports

Likely true dead code:

- Test fixture helpers such as `TEST_PASSWORD`, `uniqueEmail`, `buildEncounterSummary`, `TEST_MAP_DETAIL_WITH_BG`, and several `fixtures-srd.ts` builders look like strong Pass 2 cleanup candidates if direct test search confirms no dynamic access.
- Some internal helper exports look suspicious because they are in feature modules rather than public package surfaces: `validFrequency`, `buildDraftFromStats`, `computeDraftChanges`, `resolveMonsterParticipant`, and `createTRPCClientInstance`.

Likely intentional public surface / keep:

- Shared map/rules/schema exports such as drawing/fog constants, schema values, and XP constants are exported through `@musi/shared` subpaths. They may be intended contract surface even when currently unused.
- UI primitive component exports from `components/ui/*` may be intentionally shadcn-style public component surface.
- Code-intel top-level/API-related exports may be intentional script API surface even when not used by the CLI path.

Likely false positive from missing plugin/config:

- None obvious after the fixture and nested Vitest config fixes.

Borderline - needs human judgment:

- Server utility/service exports such as Redis helpers, `SEED_USERS`, `middleware`, `lockTurnIndexForRemoval`, and `reindexSortOrders` need module-owner review. They may be debug/test affordances or stale public exports.
- Codemod helper exports in `scripts/codemods/lib/trpc-shared-schema.ts` may be intentionally exported for tests, but many look removable if tests only exercise the top-level codemods.

## YOUR-TAKE: Unused Exported Types

Likely true dead code:

- Component-local prop/form/store types in client modules, e2e-only API helper types, and script-internal parser/config types are likely cleanup candidates where they are not imported across files.

Likely intentional public surface / keep:

- The large `packages/shared/src/schemas/**` group is likely intentional contract surface: exported Zod-derived types are part of the shared package API even when some are not currently imported.
- Some store/hook exported types may be intentional test or extension surface.

Likely false positive from missing plugin/config:

- None obvious. This category is mostly a policy question caused by `includeEntryExports`, not a missing plugin.

Borderline - needs human judgment:

- Shared schema/rules type exports should be decided as a class before Pass 2. Either treat shared package exports as intentional public API and annotate, or authorize cleanup of unimported shared contract types.
- Client UI and store types should be reviewed by feature owners; deleting exported type modifiers may be safer than deleting files/values.

## Open Questions For Orchestrator

1. Should Pass 2 preserve the full `@musi/shared` exported schema/rules type surface, or should unused shared exports be eligible for cleanup in this private monorepo?
2. Should `packages/server/src/utils/__type-tests__/*.ts` become explicit Knip entries/ignored unused files?
3. Are the four SRD generator scripts still part of the supported SRD refresh workflow?
4. Should `jscpd`, `pino-pretty`, and `@prisma/client` be added to a documented Knip dependency ignore list in Pass 2?
5. Are shadcn-style extra UI primitive exports intentionally kept for future use, or should unused primitive exports be removed?
