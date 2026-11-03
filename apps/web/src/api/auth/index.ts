import type {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
} from '@nestjs-agent/shared';
import { http } from '@/api/http';

export const register = (data: RegisterRequest) =>
  http.Post<RegisterResponse>('/auth/register', data);

export const login = (data: LoginRequest) => http.Post<LoginResponse>('/auth/login', data);

export const refreshToken = (token: string) =>
  http.Post<LoginResponse>('/auth/refresh', { refreshToken: token });

export const logout = (token: string) =>
  http.Post<null>('/auth/logout', undefined, { headers: { Authorization: `Bearer ${token}` } });

export const changePassword = (data: ChangePasswordRequest) =>
  http.Post<null>('/auth/change-password', data);
