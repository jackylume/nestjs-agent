import type { RefreshTokenRequest } from '@nestjs-agent/shared';
import { IsString, Matches } from 'class-validator';

export class RefreshTokenDto implements RefreshTokenRequest {
  @IsString({ message: 'Refresh Token 必须是字符串' })
  @Matches(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[a-f0-9]{64}$/, {
    message: 'Refresh Token 格式无效',
  })
  refreshToken!: string;
}
