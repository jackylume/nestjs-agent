export interface ApiResponse<T = unknown> {
  code: number;
  success: boolean;
  data: T | null;
  msg: string;
}

export interface HealthResponse {
  status: 'ok';
}

export interface DatabaseHealthResponse extends HealthResponse {
  database: 'connected';
}

export interface RedisHealthResponse extends HealthResponse {
  redis: 'connected';
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface UserResponse {
  id: number;
  username: string;
}

export type RegisterResponse = UserResponse;

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}
