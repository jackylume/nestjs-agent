import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error('缺少 DATABASE_URL，请将根目录 .env.example 复制为 .env 并配置数据库。');
    }

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
      max: 10,
    });
    this.pool.on('error', (error) => this.logger.error('PostgreSQL 连接池错误', error.stack));
  }

  async checkConnection(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
