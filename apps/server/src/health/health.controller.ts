import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type {
  DatabaseHealthResponse,
  HealthResponse,
  RedisHealthResponse,
} from '@nestjs-agent/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../redis/redis.service.js';

@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  health(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('db')
  async databaseHealth(): Promise<DatabaseHealthResponse> {
    try {
      await this.database.checkConnection();
      return { status: 'ok', database: 'connected' };
    } catch {
      throw new ServiceUnavailableException('数据库暂不可用');
    }
  }

  @Get('redis')
  async redisHealth(): Promise<RedisHealthResponse> {
    await this.redis.checkConnection();
    return { status: 'ok', redis: 'connected' };
  }
}
