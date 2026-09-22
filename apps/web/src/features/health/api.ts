import type { DatabaseHealthResponse, HealthResponse } from '@nestjs-agent/shared';
import { http } from '@/lib/http';

export const getHealth = () => http.Get<HealthResponse>('/health', { cacheFor: 0 });
export const getDatabaseHealth = () =>
  http.Get<DatabaseHealthResponse>('/health/db', { cacheFor: 0 });
