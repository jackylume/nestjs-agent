import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class DatabaseService extends PrismaClient implements OnApplicationShutdown {
  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error('缺少 DATABASE_URL，请将根目录 .env.example 复制为 .env 并配置数据库。');
    }

    const logger = new Logger(DatabaseService.name);
    const adapter = new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 3000,
        query_timeout: 3000,
        max: 10,
      },
      {
        onPoolError: (error) => logger.error('PostgreSQL 连接池错误', error.stack),
      },
    );
    super({ adapter });
  }

  async checkConnection(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
