-- Alter dimension of "Memory"."embedding" from vector(1536) to vector(2048)
ALTER TABLE "Memory" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "Memory" ADD COLUMN "embedding" vector(2048);
