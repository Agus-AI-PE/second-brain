-- Move embeddings to Qdrant; store Mistral file id for OCR
ALTER TABLE "Memory" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "Memory" ADD COLUMN "mistralFileId" TEXT;
DROP EXTENSION IF EXISTS vector;
