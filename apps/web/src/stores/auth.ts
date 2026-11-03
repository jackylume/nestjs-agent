import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const NESTJS_AGENT_AUTH = 'NESTJS_AGENT_AUTH';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  sessionVersion: number;
  setSession: (tokens: Tokens) => void;
  renewSession: (tokens: Tokens) => void;
  getToken: () => string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      sessionVersion: 0,
      setSession: ({ accessToken, refreshToken }) =>
        set((state) => ({
          token: accessToken,
          refreshToken,
          sessionVersion: state.sessionVersion + 1,
        })),
      renewSession: ({ accessToken, refreshToken }) => set({ token: accessToken, refreshToken }),
      getToken: () => get().token,
      setToken: (token) =>
        set((state) => ({ token, refreshToken: null, sessionVersion: state.sessionVersion + 1 })),
      clearToken: () =>
        set((state) => ({
          token: null,
          refreshToken: null,
          sessionVersion: state.sessionVersion + 1,
        })),
    }),
    {
      name: NESTJS_AGENT_AUTH,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ token, refreshToken }) => ({ token, refreshToken }),
    },
  ),
);

function sessionId(refreshToken: string | null): string | null {
  // Refresh Token 由服务端签发为 session UUID + 随机秘密；轮换时 UUID 保持不变。
  return refreshToken?.split('.')[0] ?? null;
}

export function syncAuthStorage(): AuthState {
  const serialized = localStorage.getItem(NESTJS_AGENT_AUTH);
  let token: string | null = null;
  let refreshToken: string | null = null;
  if (serialized) {
    try {
      const saved: unknown = JSON.parse(serialized);
      if (
        saved &&
        typeof saved === 'object' &&
        'state' in saved &&
        saved.state &&
        typeof saved.state === 'object'
      ) {
        if ('token' in saved.state && typeof saved.state.token === 'string')
          token = saved.state.token;
        if ('refreshToken' in saved.state && typeof saved.state.refreshToken === 'string')
          refreshToken = saved.state.refreshToken;
      }
    } catch {
      // 损坏的存储不能作为登录凭证。
    }
  }
  const current = useAuthStore.getState();
  if (current.token !== token || current.refreshToken !== refreshToken) {
    const sameSession =
      !!refreshToken && sessionId(refreshToken) === sessionId(current.refreshToken);
    useAuthStore.setState({
      token,
      refreshToken,
      sessionVersion: current.sessionVersion + (sameSession ? 0 : 1),
    });
  }
  return useAuthStore.getState();
}

window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === NESTJS_AGENT_AUTH) syncAuthStorage();
});
