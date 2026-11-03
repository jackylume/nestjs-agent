import type { IncomingMessage } from 'node:http';
import type { UserResponse } from '@nestjs-agent/shared';

export interface AuthenticatedUser extends UserResponse {
  sessionId: string;
}

export interface AuthRequest extends IncomingMessage {
  user: AuthenticatedUser;
}
