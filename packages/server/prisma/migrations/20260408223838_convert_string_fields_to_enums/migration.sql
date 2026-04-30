-- CreateEnum
CREATE TYPE "spell_school" AS ENUM ('abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation');

-- CreateEnum
CREATE TYPE "spell_attack_type" AS ENUM ('melee', 'ranged');

-- CreateEnum
CREATE TYPE "ability_abbreviation" AS ENUM ('STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA');

-- CreateEnum
CREATE TYPE "equipment_category" AS ENUM ('weapon', 'armor', 'shield', 'gear', 'tool', 'focus', 'ammunition', 'pack', 'instrument', 'gaming');

-- CreateEnum
CREATE TYPE "magic_item_category" AS ENUM ('armor', 'weapon', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand', 'wondrous_item');

-- CreateEnum
CREATE TYPE "magic_item_rarity" AS ENUM ('common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact', 'varies');

-- AlterTable: spells - convert string columns to enums with USING cast
ALTER TABLE "spells"
  ALTER COLUMN "school" TYPE "spell_school" USING "school"::"spell_school",
  ALTER COLUMN "attack_type" TYPE "spell_attack_type" USING "attack_type"::"spell_attack_type",
  ALTER COLUMN "saving_throw" TYPE "ability_abbreviation" USING "saving_throw"::"ability_abbreviation";

-- AlterTable: equipment - convert category to enum
ALTER TABLE "equipment"
  ALTER COLUMN "category" TYPE "equipment_category" USING "category"::"equipment_category";

-- AlterTable: magic_items - convert category and rarity to enums
ALTER TABLE "magic_items"
  ALTER COLUMN "category" TYPE "magic_item_category" USING "category"::"magic_item_category",
  ALTER COLUMN "rarity" TYPE "magic_item_rarity" USING "rarity"::"magic_item_rarity";

-- Note: equipment_category_idx, magic_items_category_idx, and
-- magic_items_rarity_idx all pre-exist from earlier migrations.
