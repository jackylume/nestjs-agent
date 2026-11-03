-- 将会话迁移到 Redis；认证版本用于改密后撤销所有旧会话。
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

-- 旧登录会话不迁移，部署后需要重新登录。
DROP TABLE "Session";
