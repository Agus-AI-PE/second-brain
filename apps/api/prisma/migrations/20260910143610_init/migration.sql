-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "Memory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "telegramFileId" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "sourceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);
