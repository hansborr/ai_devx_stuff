-- Step 1: Add scalar spellcasting columns to monsters
ALTER TABLE "monsters" ADD COLUMN IF NOT EXISTS "spellcasting_ability" TEXT;
ALTER TABLE "monsters" ADD COLUMN IF NOT EXISTS "spellcasting_dc" INTEGER;
ALTER TABLE "monsters" ADD COLUMN IF NOT EXISTS "spellcasting_attack_bonus" INTEGER;
ALTER TABLE "monsters" ADD COLUMN IF NOT EXISTS "spellcasting_header_text" TEXT;

-- Step 2: Create monster_spells junction table
CREATE TABLE IF NOT EXISTS "monster_spells" (
    "id" TEXT NOT NULL,
    "monster_id" TEXT NOT NULL,
    "spell_id" TEXT,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,

    CONSTRAINT "monster_spells_pkey" PRIMARY KEY ("id")
);

-- Step 3: Add indexes and constraints
CREATE INDEX IF NOT EXISTS "monster_spells_spell_id_idx" ON "monster_spells"("spell_id");
CREATE UNIQUE INDEX IF NOT EXISTS "monster_spells_monster_id_name_key" ON "monster_spells"("monster_id", "name");

ALTER TABLE "monster_spells" DROP CONSTRAINT IF EXISTS "monster_spells_monster_id_fkey";
ALTER TABLE "monster_spells" ADD CONSTRAINT "monster_spells_monster_id_fkey"
    FOREIGN KEY ("monster_id") REFERENCES "monsters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "monster_spells" DROP CONSTRAINT IF EXISTS "monster_spells_spell_id_fkey";
ALTER TABLE "monster_spells" ADD CONSTRAINT "monster_spells_spell_id_fkey"
    FOREIGN KEY ("spell_id") REFERENCES "spells"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Steps 4-8: Only run backfill and drop if the old JSON column still exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'monsters' AND column_name = 'spellcasting'
  ) THEN
    -- Step 4: Backfill scalar columns from JSON
    UPDATE "monsters" SET
        "spellcasting_ability" = "spellcasting"->>'ability',
        "spellcasting_dc" = ("spellcasting"->>'dc')::int,
        "spellcasting_attack_bonus" = ("spellcasting"->>'attackBonus')::int,
        "spellcasting_header_text" = "spellcasting"->>'headerText'
    WHERE "spellcasting" IS NOT NULL;

    -- Step 5: Backfill at-will spells
    INSERT INTO "monster_spells" ("id", "monster_id", "name", "frequency")
    SELECT gen_random_uuid()::text, m."id", spell_name, 'at_will'
    FROM "monsters" m,
         jsonb_array_elements_text(m."spellcasting"->'atWill') AS spell_name
    WHERE m."spellcasting" IS NOT NULL
      AND m."spellcasting"->'atWill' IS NOT NULL
    ON CONFLICT ("monster_id", "name") DO NOTHING;

    -- Step 6: Backfill daily spells (key "1" -> "1/day", key "2" -> "2/day")
    INSERT INTO "monster_spells" ("id", "monster_id", "name", "frequency")
    SELECT gen_random_uuid()::text, m."id", spell_name,
           CASE freq_key WHEN '1' THEN '1/day' WHEN '2' THEN '2/day' ELSE freq_key || '/day' END
    FROM "monsters" m,
         jsonb_each(m."spellcasting"->'daily') AS kv(freq_key, spell_list),
         jsonb_array_elements_text(kv.spell_list) AS spell_name
    WHERE m."spellcasting" IS NOT NULL
      AND m."spellcasting"->'daily' IS NOT NULL
    ON CONFLICT ("monster_id", "name") DO NOTHING;

    -- Step 7: Match spell names to spell IDs
    UPDATE "monster_spells" ms SET "spell_id" = s."id"
    FROM "spells" s
    WHERE LOWER(ms."name") = LOWER(s."name");

    -- Step 8: Drop old JSON column
    ALTER TABLE "monsters" DROP COLUMN "spellcasting";
  END IF;
END $$;
