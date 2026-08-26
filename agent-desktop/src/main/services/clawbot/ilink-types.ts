// 微信 ClawBot（iLink 协议）类型定义。
// 字段结构以腾讯官方 npm 包 @tencent-weixin/openclaw-weixin 源码（src/api/types.ts）为准。
// 注意：iLink 无 webhook，「回调」= getupdates 长轮询；无历史消息 API。

/** 每条 POST body 必带的基础信息 */
export interface ILinkBaseInfo {
  channel_version: string
  /** UA 串，仅用于观测，≤256 字节 ASCII */
  bot_agent: string
}

/** 媒体 CDN 引用（入站下载与出站发送共用） */
export interface CDNMedia {
  encrypt_query_param?: string
  /** base64：解出 16 字节原始 key（图片）或 32 字符 hex 串（文件/语音/视频）再 fromhex */
  aes_key?: string
  /** 0=只加密 fileid，1=打包缩略图/中图 */
  encrypt_type?: number
  /** v2.1.1+，优先使用 */
  full_url?: string
}

export interface TextItem {
  text?: string
}

export interface ImageItem {
  media?: CDNMedia
  thumb_media?: CDNMedia
  /** 16 字节 key 的 hex，入站解密优先于 media.aes_key */
  aeskey?: string
  url?: string
  mid_size?: number
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
  hd_size?: number
}

export interface VoiceItem {
  media?: CDNMedia
  /** 1=pcm 2=adpcm 3=feature 4=speex 5=amr 6=silk 7=mp3 8=ogg-speex */
  encode_type?: number
  bits_per_sample?: number
  sample_rate?: number
  /** 毫秒 */
  playtime?: number
  /** 服务端语音识别结果，可能为空 */
  text?: string
}

export interface FileItem {
  media?: CDNMedia
  file_name?: string
  /** 明文 MD5 */
  md5?: string
  /** 明文字节数（字符串） */
  len?: string
}

export interface VideoItem {
  media?: CDNMedia
  thumb_media?: CDNMedia
  video_size?: number
  play_length?: number
  video_md5?: string
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
}

export interface RefMsg {
  message_item?: MessageItem
  /** 被引用消息的摘要 */
  title?: string
}

/** MessageItem.type 枚举 */
export const MESSAGE_ITEM_TYPE = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12
} as const

export interface MessageItem {
  type?: number
  create_time_ms?: number
  update_time_ms?: number
  is_completed?: boolean
  msg_id?: string
  ref_msg?: RefMsg
  text_item?: TextItem
  image_item?: ImageItem
  voice_item?: VoiceItem
  file_item?: FileItem
  video_item?: VideoItem
}

/** message_type: 0=NONE 1=USER(入站) 2=BOT(出站) */
export const MESSAGE_TYPE = { NONE: 0, USER: 1, BOT: 2 } as const
/** message_state: 0=NEW 1=GENERATING(流式) 2=FINISH */
export const MESSAGE_STATE = { NEW: 0, GENERATING: 1, FINISH: 2 } as const

export interface WeixinMessage {
  seq?: number
  message_id?: string
  client_id?: string
  /** 用户：xxx@im.wechat */
  from_user_id?: string
  /** Bot：xxx@im.bot */
  to_user_id?: string
  create_time_ms?: number
  update_time_ms?: number
  delete_time_ms?: number
  session_id?: string
  /** 非空=群聊消息（官方暂未开放，桥直接忽略） */
  group_id?: string
  message_type?: number
  message_state?: number
  /** 回复时原样回传，服务端靠它关联对话窗口；不可复用旧消息的 token */
  context_token?: string
  item_list?: MessageItem[]
}

// ===== 登录（get_bot_qrcode / get_qrcode_status） =====

export interface GetBotQrcodeResponse {
  /** 轮询标识 */
  qrcode?: string
  /** 可扫码的链接（不是图片数据），需自行渲染成二维码 */
  qrcode_img_content?: string
}

/** get_qrcode_status 状态枚举 */
export type QrStatus =
  | 'wait'                 // 未扫码，继续轮询
  | 'scaned'               // 已扫码待确认
  | 'need_verifycode'      // 需要输入微信端显示的数字配对码
  | 'verify_code_blocked'  // 配对码多次错误，需刷新二维码
  | 'scaned_but_redirect'  // IDC 重定向：后续请求切到 https://{redirect_host}
  | 'binded_redirect'      // 该账号已绑定本实例
  | 'expired'              // 二维码过期，需刷新
  | 'confirmed'            // 成功

export interface QrStatusResponse {
  status?: QrStatus
  redirect_host?: string
  /** confirmed 时返回 */
  bot_token?: string
  /** confirmed 时返回，格式 xxx@im.bot；每次扫码登录都会变化 */
  ilink_bot_id?: string
  ilink_user_id?: string
  /** confirmed 时返回，可能覆盖默认 https://ilinkai.weixin.qq.com，必须尊重 */
  baseurl?: string
}

// ===== 长轮询（getupdates） =====

export interface GetUpdatesResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  /** 新游标，下次请求必须回传并持久化，否则重复收消息 */
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

/** 会话失效错误码：收到后应暂停该账号调用 60 分钟，再重新扫码登录 */
export const ERRCODE_SESSION_TIMEOUT = -14

// ===== 发送（sendmessage） =====

export interface OutboundMessage {
  /** 必须为空字符串 */
  from_user_id: ''
  /** 入站消息的 from_user_id（xxx@im.wechat） */
  to_user_id: string
  /** 防重 id，作 messageId 返回；每条消息独立生成 */
  client_id: string
  message_type: number
  message_state: number
  /** 入站消息携带的 context_token 原样回传 */
  context_token: string
  item_list: MessageItem[]
}

export interface SendMessageResponse {
  ret?: number
  errcode?: number
  errmsg?: string
}

// ===== 上传（getuploadurl） =====

/** media_type: 1=IMAGE 2=VIDEO 3=FILE 4=VOICE */
export const UPLOAD_MEDIA_TYPE = { IMAGE: 1, VIDEO: 2, FILE: 3, VOICE: 4 } as const

export interface GetUploadUrlRequest {
  /** 16 字节随机 hex */
  filekey: string
  media_type: number
  to_user_id: string
  /** 明文大小 */
  rawsize: number
  /** 明文 MD5（hex） */
  rawfilemd5: string
  /** PKCS7 后密文大小 */
  filesize: number
  thumb_rawsize?: number
  thumb_rawfilemd5?: string
  thumb_filesize?: number
  no_need_thumb?: boolean
  /** 16 字节 key 的 hex */
  aeskey: string
}

export interface GetUploadUrlResponse {
  /** 业务错误码（社区实证 getuploadurl 限流也回 ret=-2，此时无上传参数） */
  ret?: number
  errcode?: number
  errmsg?: string
  upload_param?: string
  thumb_upload_param?: string
  /** v2.1.1+ 优先用，无需客户端拼接 */
  upload_full_url?: string
}

// ===== 输入状态（getconfig / sendtyping） =====

export interface GetConfigResponse {
  ret?: number
  /** base64，按用户缓存，TTL 24 小时 */
  typing_ticket?: string
}

/** sendtyping status: 1=TYPING（显示"正在输入"） 2=CANCEL */
export const TYPING_STATUS = { TYPING: 1, CANCEL: 2 } as const
