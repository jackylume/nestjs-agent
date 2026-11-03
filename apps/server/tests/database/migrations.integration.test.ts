import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const execFileAsync = promisify(execFile);
const serverDirectory = fileURLToPath(new URL('../../', import.meta.url));
const migrationsDirectory = new URL('../../prisma/migrations/', import.meta.url);

describe.skipIf(process.env.MIGRATION_DB_INTEGRATION !== '1')('Prisma 迁移历史', () => {
  let admin: PrismaClient | undefined;
  let database: PrismaClient | undefined;
  let databaseName: string | undefined;
  let databaseUrl: string;

  beforeAll(() => {
    const envFile = new URL('../../../../.env', import.meta.url);
    if (existsSync(envFile)) loadEnvFile(envFile);
    const connectionString = process.env.DATABASE_URL;
    if (
      !connectionString ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)
    ) {
      throw new Error('迁移集成测试仅支持本机 PostgreSQL，请检查 DATABASE_URL。');
    }
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  });

  beforeEach(async () => {
    const name = `migration_it_${randomUUID().replaceAll('-', '')}`;
    await admin!.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    databaseName = name;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    databaseUrl = url.toString();
    database = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
  });

  afterEach(async () => {
    await database?.$disconnect();
    database = undefined;
    if (databaseName) {
      await admin!.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      databaseName = undefined;
    }
  });

  afterAll(async () => {
    await admin?.$disconnect();
  });

  function prisma(...args: string[]) {
    return execFileAsync('pnpm', ['exec', 'prisma', ...args], {
      cwd: serverDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 30_000,
    });
  }

  it('空库能完整部署且与模型一致，再次部署不重复执行', async () => {
    await prisma('migrate', 'deploy');
    await prisma(
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    );

    const applied = await database!.$queryRaw<{ migration_name: string }[]>`
      SELECT * FROM "_prisma_migrations" ORDER BY migration_name
    `;
    const expected = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(applied.map((migration) => migration.migration_name)).toEqual(expected);

    await prisma('migrate', 'deploy');
    expect(
      await database!.$queryRaw`SELECT * FROM "_prisma_migrations" ORDER BY migration_name`,
    ).toEqual(applied);
  }, 60_000);

  it('恢复迁移能重建缺失的会话表，重复执行时保留已有会话', async () => {
    await prisma('migrate', 'deploy');
    const restoreFile = 'prisma/migrations/20261026220000_restore_session_table/migration.sql';
    await prisma('db', 'execute', '--file', restoreFile);

    const user = await database!.user.create({
      data: { username: 'migration_test', passwordHash: 'test-only' },
    });
    await database!.$executeRaw`
      INSERT INTO "Session" (id, "refreshTokenHash", "userId", "expiresAt")
      VALUES ('test-session', 'test-hash', ${user.id}, '2030-01-01')
    `;
    const sessions = await database!.$queryRaw`SELECT * FROM "Session"`;

    await prisma('db', 'execute', '--file', restoreFile);
    expect(await database!.$queryRaw`SELECT * FROM "Session"`).toEqual(sessions);
    expect(
      await database!.$queryRaw`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'Session' ORDER BY indexname
      `,
    ).toEqual([
      { indexname: 'Session_pkey' },
      { indexname: 'Session_refreshTokenHash_key' },
      { indexname: 'Session_userId_expiresAt_idx' },
    ]);
    await database!.user.delete({ where: { id: user.id } });
    expect(await database!.$queryRaw`SELECT * FROM "Session"`).toEqual([]);
  }, 60_000);
});
