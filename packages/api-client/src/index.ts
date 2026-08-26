import type {
  ApiEnvelope,
  AppBalance,
  AppChannel,
  AppModel,
  AppPlan,
  AppTask,
  AppUser,
  AuthPayload,
  BootstrapPayload,
} from "@zihui/contracts";

export interface ApiClientOptions {
  baseUrl: string;
  channel: AppChannel;
  fetchImpl?: typeof fetch;
  getAccessToken?: () => string | null | undefined;
  setAccessToken?: (token: string | null) => void;
  credentials?: RequestCredentials;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: Record<string, unknown>;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code || "api_error";
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

function trimBase(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("API base URL is required");
  return normalized;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly channel: AppChannel;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessToken?: ApiClientOptions["getAccessToken"];
  private readonly setAccessToken?: ApiClientOptions["setAccessToken"];
  private readonly credentials: RequestCredentials;

  constructor(options: ApiClientOptions) {
    this.baseUrl = trimBase(options.baseUrl);
    this.channel = options.channel;
    this.fetchImpl = options.fetchImpl || fetch;
    this.getAccessToken = options.getAccessToken;
    this.setAccessToken = options.setAccessToken;
    this.credentials = options.credentials || "same-origin";
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const rawUrl = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const absolute = /^https?:\/\//i.test(rawUrl);
    const url = new URL(rawUrl, "http://zihui.local");
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Channel", this.channel);
    const token = this.getAccessToken?.();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const requestUrl = absolute ? url.toString() : `${url.pathname}${url.search}`;
    const response = await this.fetchImpl(requestUrl, {
      ...options,
      body:
        options.body === undefined || options.body instanceof FormData
          ? (options.body as BodyInit | null | undefined)
          : JSON.stringify(options.body),
      credentials: options.credentials || this.credentials,
      headers,
    });
    const requestId = response.headers.get("X-Request-Id") || undefined;
    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiClientError("Invalid API response", { status: response.status, requestId });
    }
    if (!response.ok || payload?.error) {
      const error = payload?.error || {};
      if (response.status === 401) this.setAccessToken?.(null);
      throw new ApiClientError(error.message || `API request failed (${response.status})`, {
        status: response.status,
        code: error.code,
        details: error.details,
        requestId: payload?.meta?.request_id || requestId,
      });
    }
    return (payload?.data ?? payload) as T;
  }

  bootstrap(): Promise<BootstrapPayload> {
    return this.request<BootstrapPayload>("/bootstrap");
  }

  login(identifier: string, password: string): Promise<AuthPayload> {
    return this.request<AuthPayload>("/auth/password/login", {
      method: "POST",
      body: { identifier, password },
    });
  }

  register(payload: { email: string; password: string; nickname: string; username?: string }): Promise<AuthPayload> {
    return this.request<AuthPayload>("/auth/password/register", { method: "POST", body: payload });
  }

  me(): Promise<AppUser> {
    return this.request<AppUser>("/auth/me");
  }

  refresh(): Promise<AuthPayload> {
    return this.request<AuthPayload>("/auth/refresh", { method: "POST" });
  }

  logout(): Promise<void> {
    return this.request<void>("/auth/logout", { method: "POST" });
  }

  models(type?: string): Promise<AppModel[]> {
    return this.request<AppModel[]>("/models", { query: type ? { type } : undefined });
  }

  plans(): Promise<AppPlan[]> {
    return this.request<AppPlan[]>("/billing/plans");
  }

  balance(): Promise<AppBalance[]> {
    return this.request<AppBalance[]>("/billing/balance");
  }

  task<TRequest = Record<string, unknown>, TResult = unknown>(id: string): Promise<AppTask<TRequest, TResult>> {
    return this.request<AppTask<TRequest, TResult>>(`/tasks/${encodeURIComponent(id)}`);
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}

export type { ApiEnvelope } from "@zihui/contracts";
