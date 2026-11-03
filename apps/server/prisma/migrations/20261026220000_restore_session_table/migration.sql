-- Only restore a manually removed table; fresh replay already created it.
DO $$
BEGIN
    IF to_regclass('"Session"') IS NULL THEN
        CREATE TABLE "Session" (
            "id" TEXT NOT NULL,
            "refreshTokenHash" TEXT NOT NULL,
            "userId" INTEGER NOT NULL,
            "expiresAt" TIMESTAMP(3) NOT NULL,

            CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
        );

        CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");
        CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

        ALTER TABLE "Session"
        ADD CONSTRAINT "Session_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
