export type AppChannel = "desktop" | "web" | "h5" | "mini_program";

export type TaskStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ApiMeta {
  request_id: string;
  cursor?: string | null;
  next_cursor?: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
  meta: ApiMeta;
}

export interface UserBalance {
  type: "token" | "credit";
  amount: number;
}

export interface AppUser {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  nickname: string;
  avatar: string | null;
  role: "admin" | "user" | string;
  status: "active" | "disabled" | string;
  balances: UserBalance[];
  created_at: string | null;
}

export interface AuthTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_expires_in?: number;
}

export interface AuthPayload extends AuthTokens {
  user: AppUser;
}

export interface BootstrapFeature {
  enabled: boolean;
  requires_auth?: boolean;
}

export interface BootstrapPayload {
  api_version: "v1";
  channel: AppChannel;
  brand: {
    name: string;
    description: string;
    favicon?: string | null;
  };
  auth: {
    password: boolean;
    email_code: boolean;
    phone_sms: boolean;
    wechat_mini: boolean;
  };
  features: Record<string, BootstrapFeature>;
}

export interface AppModel {
  id: number;
  model_id: string;
  name: string;
  type: "chat" | "image" | "embedding" | string;
  provider_name: string;
  provider_type: string;
}

export interface AppPlan {
  id: number;
  code: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  duration_days: number;
  token_quota: number;
  credit_quota: number;
  storage_quota_bytes: number;
}

export interface AppBalance {
  type: "token" | "credit";
  wallet: number;
  plan: number;
  total: number;
}

export interface AppConversation {
  id: number;
  title: string;
  model: string;
  message_count: number;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  model: string;
  created_at: string;
}

export interface AppConversationDetail extends AppConversation {
  messages: AppMessage[];
}

export interface AppMessageSendResult {
  user_message: AppMessage;
  assistant_message: AppMessage;
}

export interface TaskResource {
  id?: string | number;
  url: string;
  mime?: string;
  width?: number;
  height?: number;
}

export interface AppTask<TRequest = Record<string, unknown>, TResult = unknown> {
  id: string;
  type: string;
  status: TaskStatus;
  progress: number;
  request: TRequest;
  result: TResult | null;
  error: { code: string; message: string } | null;
  created_at: string;
  updated_at: string;
}
