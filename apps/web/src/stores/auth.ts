import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  getToken: () => string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      getToken: () => get().token,
      setToken: (token) => set({ token }),
      clearToken: () => set({ token: null }),
    }),
    {
      name: 'nestjs-agent-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ token }) => ({ token }),
    },
  ),
);
