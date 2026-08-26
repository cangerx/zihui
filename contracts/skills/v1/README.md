# Skill 分发契约 v1

本目录是授权端 Registry、云控镜像与桌面安装的唯一 v1 契约。

## 身份与版本

- `skill_id`：平台生成的 UUID，稳定且不复用。
- `version_id`：每个不可变版本的 UUID。
- `version`：SemVer 2.0.0，发布后包、manifest、摘要和签名均不得原地替换。
- `slug`：小写 kebab-case 展示别名，不用作安装身份。

## Manifest

`manifest.schema.json` 定义包内 `skill.json`。包必须包含 `skill.json` 与 `SKILL.md`；`files` 列出包内所有普通文件的相对 POSIX 路径。禁止绝对路径、`..`、反斜杠、空路径、符号链接和未声明文件。

`permissions` 只声明能力需求，不携带凭据：

- `filesystem`：`none` / `workspace_read` / `workspace_write`。
- `network.domains`：小写精确域名，禁止 URL、IP 与通配符。
- `commands`：允许调用的可执行文件名，不含参数。
- `mcp_servers`：需求的 MCP 稳定标识。
- `external_programs`：需求的外部程序标识。

## Canonical bytes 与签名

`signature-payload.fixture.json` 展示签名 payload。字节规则：

1. 输入必须严格匹配 `signature-payload.schema.json`，不接受额外字段。
2. 对每个 JSON object 按键的 Unicode code point 递归升序排列；array 顺序保持。
3. 使用 UTF-8 紧凑 JSON，不转义 Unicode 和 `/`，不追加换行。
4. `sha256` 是 Skill ZIP 原始字节的小写十六进制 SHA-256。
5. v1 签名算法标识为 `ed25519`；对 canonical bytes 签名，签名以 base64 传输。`key_id` 定位公钥，私钥只存在授权端。

公钥轮换时先分发新 key ID 和公钥，再用新钥发布版本；已安装版本所需旧公钥在兼容窗内保留。

## 状态与事件

- Skill：`draft` → `active` → `suspended` 或 `retired`。
- Version：`uploaded` → `scanning` → `pending_review` → `published` 或 `rejected`；`published` 只能转 `revoked`。
- 发布、撤回和 Skill 全局状态变更必须追加变更事件，`cursor` 为单调递增整数。
- 云控仅在成功验证一整批连续事件后提交游标；空批次不表示全部下架。

## API v1

- Registry 增量：`GET /api/skills/v1/events?after=<cursor>&limit=<1..500>`。
- Registry 授权下载：`POST /api/skills/v1/versions/{version_id}/download-ticket`。
- 云控桌面目录：`GET /api/client/skills/catalog?cursor=<cursor>`。
- 云控桌面下载：`POST /api/client/skills/versions/{version_id}/download-ticket`。

列表响应使用 `{data: [], next_cursor, has_more}`；下载票据使用 `{url, expires_at, sha256, signature, signature_algorithm, key_id}`。稳定错误码：`skill_not_found`、`version_not_found`、`version_not_published`、`version_revoked`、`skill_not_available`、`tenant_skill_disabled`、`download_ticket_expired`、`digest_mismatch`、`signature_invalid`、`manifest_invalid`、`package_unsafe`、`cursor_gap`。

