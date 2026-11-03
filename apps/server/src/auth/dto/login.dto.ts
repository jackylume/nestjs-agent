import type { LoginRequest } from '@nestjs-agent/shared';
import { RegisterDto } from './register.dto.js';

export class LoginDto extends RegisterDto implements LoginRequest {}
