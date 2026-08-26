import { create } from "zustand";
import { authAPI } from "@/lib/api";
import type { AppUser } from "@zihui/contracts";

interface User {
  id: number;
  username?: string;
  email: string;
  phone: string | null;
  nickname: string;
  avatar: string | null;
  role: string;
  status: string;
  vip_level?: number;
  vip_expires_at?: string | null;
  invite_code?: string;
  balances?: { type: string; amount: number }[];
}

export type { User };

function toLegacyUser(user: AppUser): User {
  return {
    id: user.id,
    username: user.username || undefined,
    email: user.email || "",
    phone: user.phone,
    nickname: user.nickname,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    balances: user.balances,
  };
}

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
        user: toLegacyUser(res.data.user),
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
