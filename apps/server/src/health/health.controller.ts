import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseHealthResponse, HealthResponse } from '@nestjs-agent/shared';
import { DatabaseService } from '../database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

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
}
