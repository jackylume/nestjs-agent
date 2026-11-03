import type { UserResponse } from '@nestjs-agent/shared';
import { http } from '@/api/http';

export const getUserInfo = () => http.Get<UserResponse>('/user/info');
