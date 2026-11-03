-- 为已有会话增加稳定标识，保留用户及会话到期时间。
ALTER TABLE "Session" ADD COLUMN "id" TEXT;
UPDATE "Session" SET "id" = gen_random_uuid()::text;
ALTER TABLE "Session" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "Session" RENAME COLUMN "tokenHash" TO "refreshTokenHash";
ALTER TABLE "Session" DROP CONSTRAINT "Session_pkey";
ALTER TABLE "Session" ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");
