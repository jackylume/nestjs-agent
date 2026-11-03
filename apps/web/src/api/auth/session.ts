import type { LoginResponse } from '@nestjs-agent/shared';
import { logout, refreshToken } from '@/api/auth';
import { syncAuthStorage, useAuthStore } from '@/stores/auth';

let sessionQueue: Promise<unknown> = Promise.resolve();

function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  const request = sessionQueue.then(() =>
    navigator.locks ? navigator.locks.request('nestjs-agent-auth', operation) : operation(),
  );
  sessionQueue = request.catch(() => undefined);
  return request;
}

function getSession(version: number) {
  const auth = syncAuthStorage();
  if (auth.sessionVersion !== version)
    throw Object.assign(new Error('登录状态已变更'), { status: 401, code: 401 });
  return auth;
}

export function saveSession(session: LoginResponse): Promise<void> {
  return withSessionLock(async () => {
    useAuthStore.getState().setSession(session);
  });
}

// 调用方已经持有会话锁，退出时也可复用，避免重复申请同一把锁。
async function refreshSession(version: number, previousToken: string | null): Promise<string> {
  const auth = getSession(version);
  if (!auth.refreshToken) {
    if (auth.token) auth.clearToken();
    throw Object.assign(new Error('请重新登录'), { status: 401, code: 401 });
  }
  if (auth.refreshToken !== previousToken && auth.token) return auth.token;
  const requestedToken = auth.refreshToken;
  try {
    const session = await refreshToken(requestedToken).send();
    const current = getSession(version);
    if (current.refreshToken !== requestedToken) {
      if (current.token) return current.token;
      throw Object.assign(new Error('登录状态已变更'), { status: 401, code: 401 });
    }
    current.renewSession(session);
    return session.accessToken;
  } catch (error) {
    const current = syncAuthStorage();
    if (
      error instanceof Error &&
      'status' in error &&
      error.status === 401 &&
      current.sessionVersion === version
    ) {
      if (current.refreshToken !== requestedToken && current.token) return current.token;
      if (current.refreshToken === requestedToken) current.clearToken();
    }
    throw error;
  }
}

export function refreshAccessToken(version = syncAuthStorage().sessionVersion): Promise<string> {
  const { refreshToken: token } = getSession(version);
  return withSessionLock(() => refreshSession(version, token));
}

export function logoutSession(): Promise<void> {
  const version = syncAuthStorage().sessionVersion;
  return withSessionLock(async () => {
    const auth = getSession(version);
    if (auth.token) {
      try {
        await logout(auth.token).send();
      } catch (error) {
        if (!(error instanceof Error && 'status' in error && error.status === 401)) throw error;
        const token = await refreshSession(version, auth.refreshToken);
        await logout(token).send();
      }
    }
    const current = syncAuthStorage();
    if (current.sessionVersion === version) current.clearToken();
  });
}
