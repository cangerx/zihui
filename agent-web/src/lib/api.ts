import axios from "axios";
import { featureFlags } from "@/lib/features";
import { getTenantCode } from "@/lib/tenant";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || "/api/app/v1"
).replace(/\/+$/, "");

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: attach token + agent code
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const agentCode = getTenantCode();
    if (agentCode) {
      config.headers["X-Agent-Code"] = agentCode;
    }
  }
  return config;
});

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        // Clear token and reset auth store
        const { useAuthStore } = require("@/store/auth");
        useAuthStore.getState().logout();
        // Dispatch custom event; LoginModal listens and opens
        window.dispatchEvent(new Event("auth:unauthorized"));
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// Auth API
export const authAPI = {
  register: (data: { email: string; password: string; nickname: string }) =>
    api.post("/auth/register", data),
  login: (data: { email: string; password: string }) =>
    api.post("/auth/login", data),
  sendCode: (data: { phone: string }) => api.post("/auth/send-code", data),
  phoneLogin: (data: { phone: string; code: string; invite_code?: string }) =>
    api.post("/auth/phone-login", data),
  oauthLogin: (data: { provider: string; code: string }) =>
    api.post("/auth/oauth", data),
  sendEmailCode: (data: { email: string; purpose?: string }) =>
    api.post("/auth/send-email-code", data),
  emailLogin: (data: { email: string; code: string; invite_code?: string }) =>
    api.post("/auth/email-login", data),
  forgotPassword: (data: { email: string }) =>
    api.post("/auth/forgot-password", data),
  resetPassword: (data: { email: string; code: string; new_password: string }) =>
    api.post("/auth/reset-password", data),
  getProfile: () => api.get("/auth/profile"),
  refreshToken: () => api.post("/auth/refresh"),
};

// User API
export const userAPI = {
  getCredits: () => api.get("/user/credits"),
  getCreditLogs: (params?: { page?: number; page_size?: number }) =>
    api.get("/user/credit-logs", { params }),
  getUsageStats: () => api.get("/user/usage-stats"),
  updateProfile: (data: { nickname?: string; avatar?: string }) =>
    api.put("/user/profile", data),
  changePassword: (data: { old_password: string; new_password: string }) =>
    api.put("/user/password", data),
  deleteAccount: () => api.delete("/user/account"),
};

// Package API (public)
export const packageAPI = {
  list: () => api.get("/packages"),
};

// Order API
export const orderAPI = {
  list: () => api.get("/orders"),
  create: (data: { package_id?: number; type: string; payment_method: string; amount?: number; credits?: number }) =>
    api.post("/orders", data),
  get: (id: number) => api.get(`/orders/${id}`),
  payStatus: (orderNo: string) => api.get(`/order-status/${orderNo}`),
  mockPay: (orderNo: string) => {
    if (!featureFlags.mockPayment) {
      return Promise.reject(new Error("Mock payment is disabled"));
    }
    return api.post(`/payment/mock-pay/${orderNo}`);
  },
};

// Redeem API
export const redeemAPI = {
  redeem: (code: string) => api.post("/redeem", { code }),
};

// Notification API (public)
export const notificationAPI = {
  list: () => api.get("/notifications"),
};

// Ad API (public)
export const adAPI = {
  list: (slot?: string) => api.get("/ads", { params: slot ? { slot } : {} }),
};

// App modules API (public)
export const appAPI = {
  modules: () => api.get("/app/modules"),
  apps: () => api.get("/app/apps"),
  loginMethods: () => api.get("/app/login-methods"),
  siteConfig: (params?: { agent_code?: string; domain?: string }) =>
    api.get("/app/site-config", { params }),
  plugins: () => api.get("/app/plugins"),
};

// System API
export const systemAPI = {
  version: () => api.get("/system/version"),
};

// Model API (public)
export const modelAPI = {
  list: (type?: string) => api.get("/models", { params: type ? { type } : {} }),
  imageModels: () => api.get("/models/image-models"),
};

// Chat API
export const chatAPI = {
  listConversations: () => api.get("/conversations"),
  createConversation: (data: { title?: string; model: string }) =>
    api.post("/conversations", data),
  getConversation: (id: number) => api.get(`/conversations/${id}`),
  updateConversation: (id: number, data: { title?: string; pinned?: boolean }) =>
    api.put(`/conversations/${id}`, data),
  deleteConversation: (id: number) => api.delete(`/conversations/${id}`),
  sendMessage: (id: number, data: { content: string; model?: string }) =>
    api.post(`/conversations/${id}/messages`, data),
};

// Upload API
export const uploadAPI = {
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 });
  },
};

// Image AI API
export const imageAPI = {
  // AI 商品图
  productPhoto: (data: FormData) =>
    api.post("/image/product-photo", data, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 }),
  // 智能抠图
  cutout: (data: FormData) =>
    api.post("/image/cutout", data, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 }),
  // AI 消除
  eraser: (data: FormData) =>
    api.post("/image/eraser", data, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 }),
  // AI 扩图
  expand: (data: FormData) =>
    api.post("/image/expand", data, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 }),
  // 变清晰
  upscale: (data: FormData) =>
    api.post("/image/upscale", data, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 }),
  // AI 海报
  poster: (data: { prompt: string; category?: string; size?: string; model?: string; quality?: string; resolution?: string }) =>
    api.post("/image/poster", data, { timeout: 120000 }),
  // 图片生成（通用文生图）
  generate: (data: { prompt: string; model?: string; size?: string; n?: number; quality?: string; resolution?: string; ratio?: string; image_urls?: string[]; apply_brand?: boolean }) =>
    api.post("/image/generate", data, { timeout: 120000 }),
  // 优化提示词
  optimizePrompt: (prompt: string) =>
    api.post<{ optimized_prompt: string }>("/image/optimize-prompt", { prompt }, { timeout: 30000 }),
};

// Generation status API (polling)
export const generationAPI = {
  get: (id: number) => api.get(`/generations/${id}`),
  list: (params?: { page?: number; page_size?: number; type?: string; status?: string }) =>
    api.get("/generations", { params }),
  delete: (id: number) => api.delete(`/generations/${id}`),
};

// Canvas projects API
export const canvasAPI = {
  list: () => api.get("/canvases"),
  get: (id: number) => api.get(`/canvases/${id}`),
  create: (data: { name?: string; nodes?: any[]; thumbnail?: string }) =>
    api.post("/canvases", data),
  update: (id: number, data: { name?: string; nodes?: any[]; thumbnail?: string }) =>
    api.put(`/canvases/${id}`, data),
  delete: (id: number) => api.delete(`/canvases/${id}`),
};

// Space API (user asset space)
export const spaceAPI = {
  quota: () => api.get("/space/quota"),
  listFolders: () => api.get("/space/folders"),
  createFolder: (name: string) => api.post("/space/folders", { name }),
  renameFolder: (id: number, name: string) => api.put(`/space/folders/${id}`, { name }),
  deleteFolder: (id: number) => api.delete(`/space/folders/${id}`),
  listFiles: (params?: { folder_id?: string; page?: number; page_size?: number; asset_type?: string }) =>
    api.get("/space/files", { params }),
  uploadFile: (file: File, folderId?: number, assetType?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (folderId) fd.append("folder_id", String(folderId));
    if (assetType) fd.append("asset_type", assetType);
    return api.post("/space/files", fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 });
  },
  moveFile: (id: number, folderId: number | null) => api.put(`/space/files/${id}`, { folder_id: folderId || 0 }),
  renameFile: (id: number, name: string) => api.put(`/space/files/${id}`, { name }),
  deleteFile: (id: number) => api.delete(`/space/files/${id}`),
};

// Brand Kit API (multi-brand, Lovart-style)
export const brandAPI = {
  list: () => api.get("/brand-kits"),
  get: (id: number) => api.get(`/brand-kits/${id}`),
  create: (data: {
    brand_name?: string;
    description?: string;
    design_guide?: string;
    colors?: string;
    fonts?: string;
    keywords?: string;
    logos?: string;
    brand_images?: string;
    logo_file_ids?: string;
  }) => api.post("/brand-kits", data),
  update: (id: number, data: {
    brand_name?: string;
    description?: string;
    design_guide?: string;
    colors?: string;
    fonts?: string;
    keywords?: string;
    logos?: string;
    brand_images?: string;
    logo_file_ids?: string;
  }) => api.put(`/brand-kits/${id}`, data),
  delete: (id: number) => api.delete(`/brand-kits/${id}`),
  setDefault: (id: number) => api.put(`/brand-kits/${id}/default`),
  parseManual: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post(`/brand-kits/${id}/parse-manual`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    });
  },
};

// Prompt Template API
export const promptTemplateAPI = {
  list: (category?: string) =>
    api.get("/prompt-templates", { params: category ? { category } : {} }),
  categories: () => api.get("/prompt-templates/categories"),
};

export const copywritingAPI = {
  history: (params?: any) => api.get("/copywriting/history", { params }),
  deleteHistory: (id: number) => api.delete(`/copywriting/history/${id}`),
};

// Video API
export const videoAPI = {
  generate: (data: { prompt: string; mode: string; duration: string; ratio: string; image?: string }) =>
    api.post("/video/generate", data, { timeout: 180000 }),
  generateFromImage: (data: FormData) =>
    api.post("/video/generate-from-image", data, { headers: { "Content-Type": "multipart/form-data" }, timeout: 180000 }),
};

// Referral API
export const referralAPI = {
  stats: () => api.get("/referral/stats"),
  commissions: () => api.get("/referral/commissions"),
  invitees: () => api.get("/referral/invitees"),
};

// Agent panel API
export const agentAPI = {
  threshold: () => api.get("/agent/threshold"),
  apply: (data: { site_name: string; code: string }) => api.post("/agent/apply", data),
  getProfile: () => api.get("/agent/profile"),
  updateProfile: (data: Record<string, string>) => api.put("/agent/profile", data),
  updateDomain: (domain: string) => api.put("/agent/domain", { custom_domain: domain }),
  verifyDomain: () => api.post("/agent/domain/verify"),
  stats: () => api.get("/agent/stats"),
  users: () => api.get("/agent/users"),
  commissions: () => api.get("/agent/commissions"),
  packages: () => api.get("/agent/packages"),
  updatePackage: (data: { package_id: number; price: number; enabled?: boolean }) =>
    api.put("/agent/packages", data),
  withdrawals: () => api.get("/agent/withdrawals"),
  requestWithdrawal: (data: { amount: number; method: string; account: string; account_name: string }) =>
    api.post("/agent/withdrawals", data),
};

// Inspiration API
export const inspirationAPI = {
  list: (params?: { tag?: string; page?: number; page_size?: number }) =>
    api.get("/inspirations", { params }),
  tags: () => api.get("/inspirations/tags"),
  publish: (data: { generation_id: number; title?: string; description?: string; tag?: string }) =>
    api.post("/inspirations/publish", data),
};

// Image proxy — fetches a cross-origin image through the backend to bypass CORS
export async function fetchImageViaProxy(src: string): Promise<Blob> {
  const res = await api.get("/image-proxy", {
    params: { url: src },
    responseType: "blob",
    timeout: 30000,
  });
  return res.data;
}

// Template API
export const templateAPI = {
  list: (params?: {
    page?: number; page_size?: number;
    category?: string; scene?: string; usage?: string;
    industry?: string; style?: string; color?: string;
    layout?: string; search?: string; sort_by?: string;
  }) => api.get("/templates", { params }),
  filters: () => api.get("/templates/filters"),
};
