import { create } from "zustand";
import { authAPI } from "@/lib/api";

interface User {
  id: number;
  email: string;
  phone: string;
  nickname: string;
  avatar: string;
  role: string;
  status: string;
  vip_level: number;
  vip_expires_at: string | null;
  invite_code: string;
}

export type { User };

interface Credits {
  balance: number;
  total_recharged: number;
  total_consumed: number;
}

interface AuthState {
  user: User | null;
  credits: Credits | null;
  token: string | null;
  isLoading: boolean;
  setToken: (token: string) => void;
  setUser: (user: User) => void;
  fetchProfile: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  credits: null,
  token: typeof window !== "undefined" ? localStorage.getItem("token") : null,
  isLoading: false,

  setToken: (token: string) => {
    localStorage.setItem("token", token);
    set({ token });
  },

  setUser: (user: User) => set({ user }),

  fetchProfile: async () => {
    try {
      set({ isLoading: true });
      const res = await authAPI.getProfile();
      set({
        user: res.data.user,
        credits: res.data.credits,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ user: null, credits: null, token: null });
  },
}));
