# 0.4.0 COS 直传部署指南

适用版本：agent-build 0.4.0+

阅读对象：完成 0.4.0 升级（覆盖代码 + 跑 migration）后准备启用 COS 直传链路的运维人员。

> 不读这一份的前提：你已经看完 `CHANGELOG.md` 0.4.0 条目，理解为什么要做这个改造、新链路的形状、性能预期。本文档不再重复这些背景。

---

## 0. 一图概览

```
            (Azure 美东)                  (跨境推一次, 30-90s)         (大陆同地域内网, <5s)
GitHub Actions runner ──── COS upload ────► 4810-1304118579 ◄──── agent-build 302 redirect
   │                                          (build-artifacts/{build_id}/)
   │
   └── callback POST /api/build/callback ────► agent-build BuildCallbackController
                                                │
                                                ├─ HEAD 校验每个 file
                                                ├─ 落库 cos_object_prefix + artifact_files
                                                └─ wake 云控端

云控端拉文件: GET /dl/{token} → agent-build 现场签 COS GET URL → 302 → 云控端 follow
                                                                     │
                                                                     ▼
                                              cos3.xiaoyinet.cn (自定义 CDN 域名)
```

---

## 1. 前置准备（腾讯云控制台）

### 1.1 COS bucket

- **完整名**：`4810-1304118579`（控制台显示 `4810`，实际 SDK 必须用带 APPID 后缀的完整名）
- **地域**：`ap-guangzhou`（必须和 CVM 同地域，agent-build CVM 实测 `metadata.tencentyun.com` 返回 `ap-guangzhou`，对得上）
- **访问权限**：私有读写

### 1.2 Lifecycle 规则

进入 bucket → 基础配置 → 生命周期，添加规则：

| 项 | 值 |
|---|---|
| 名称 | `auto-cleanup-1d` |
| 状态 | 启用 |
| 应用范围 | 指定前缀 `build-artifacts/` |
| 当前版本对象 | **1 天后删除** |
| 未完成 multipart upload | **1 天后中止** |

### 1.3 CAM 子账号 + Policy

CAM → 用户列表 → 新建子用户：

- 类型：可访问资源并接收消息
- 用户名：`agent-build-cos`
- 访问方式：仅勾「编程访问」
- 控制台密码：不设
- 关联策略：先跳过

拿到 SecretId / SecretKey 后，CAM → 策略 → 新建自定义策略 → 按策略语法创建，名称 `agent-build-cos-policy`，内容（替换 `<APPID>` 和 `<BUCKET>`）：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "cos:HeadObject",
        "cos:GetObject",
        "cos:PutObject",
        "cos:DeleteObject",
        "cos:InitiateMultipartUpload",
        "cos:ListMultipartUploads",
        "cos:ListParts",
        "cos:UploadPart",
        "cos:CompleteMultipartUpload",
        "cos:AbortMultipartUpload"
      ],
      "resource": [
        "qcs::cos:ap-guangzhou:uid/1304118579:4810-1304118579/build-artifacts/*"
      ]
    }
  ]
}
```

策略创建后关联到 `agent-build-cos` 用户。

---

## 2. 升级 agent-build

### 2.1 覆盖代码 + migration

```bash
cd /www/wwwroot/your-build-domain.example.com

# 拉取 0.4.0 代码（按你既有的部署方式：Git pull 或 zip 解压覆盖）

/www/server/php/82/bin/php artisan migrate --force
# 应该看到：
#   Migrating: 2026_05_09_220000_create_system_settings_table
#   Migrated:  2026_05_09_220000_create_system_settings_table (XXms)
#   Migrating: 2026_05_09_223000_add_cos_object_prefix_to_build_requests
#   Migrated:  2026_05_09_223000_add_cos_object_prefix_to_build_requests (XXms)

rm -f bootstrap/cache/*.php
/www/server/php/82/bin/php artisan config:cache
```

### 2.2 删 .env 里临时 COS 配置（如有）

```bash
# 0.3.x 调试期间手工写过的 TENCENT_COS_* 已不再被代码读取，删掉避免混淆
sed -i '/^TENCENT_COS_/d' .env
sed -i '/^# Tencent Cloud COS/d' .env
grep -E '^TENCENT_COS|^# Tencent' .env  # 应无输出
```

### 2.3 在管理后台填 COS 凭证

1. 浏览器打开 `https://your-build-domain.example.com/admin/settings`
2. 登录后填表：

   | 字段 | 值 |
   |---|---|
   | 所属地域 Region | `ap-guangzhou` |
   | 存储桶 Bucket | `4810-1304118579` |
   | APPID | `1304118579` |
   | SecretId | `AKIDxxxxxxxx`（CAM 给的） |
   | SecretKey | `xxxxxxxx`（CAM 给的，留空表示保留旧值） |
   | 自定义访问域名 | `https://cos3.xiaoyinet.cn` |

3. 点「保存」→ 看到「已保存」toast，状态标签变绿「已配置」
4. 点「测试连通性」→ 看到 alert：`PUT/HEAD/DELETE all ok`，端点 `https://4810-1304118579.cos.ap-guangzhou.myqcloud.com`

如果测试失败：

- `put_failed: status=403` → CAM policy 没关联 / 没包含 PutObject 权限 / resource ARN 写错
- `cURL error` → CVM 到 cos.ap-guangzhou.myqcloud.com 网络异常（罕见，腾讯云内网默认互通）
- `cos_not_configured` → 表单没保存成功，刷新页面再填一次

---

## 3. GitHub Secrets 写入

打开 `https://github.com/your-org/your-build-repo/settings/secrets/actions`，**New repository secret** 添加 4 个（key 名严格一致，大小写敏感）：

| Name | Value |
|---|---|
| `TENCENT_COS_REGION` | `ap-guangzhou` |
| `TENCENT_COS_BUCKET` | `4810-1304118579` |
| `TENCENT_COS_SECRET_ID` | `AKIDxxxxxxxx` |
| `TENCENT_COS_SECRET_KEY` | `xxxxxxxx` |

GitHub Secrets 写入后**永远不可读**（只能用或重新设值），是存这种凭证的最佳位置。

---

## 4. 改造 GitHub Actions Workflow

仓库 `your-org/your-build-repo` 里的 `build-win.yml` 和 `build-mac.yml`，按下面 4 步改造。

### 4.1 删除 actions/upload-artifact 步骤

整段删除，类似：

```yaml
# 删掉这段
- name: Upload artifact
  uses: actions/upload-artifact@v4
  with:
    name: build-output-${{ inputs.build_id }}
    path: ./dist/
    retention-days: 1
```

### 4.2 在编译之后、callback 之前，加 3 个新 step

```yaml
# 1) 计算文件元数据 —— 输出 files JSON 给 callback step 用
- name: Compute artifact files metadata
  id: files
  shell: bash
  working-directory: ./dist
  run: |
    PRIMARY_EXT=".exe"
    if [ "${{ matrix.platform || 'win' }}" = "mac" ]; then
      PRIMARY_EXT=".dmg"
    fi

    files_json="["
    first=true
    for f in *; do
      [ -f "$f" ] || continue
      role=""
      lower=$(echo "$f" | tr '[:upper:]' '[:lower:]')
      case "$lower" in
        *"$PRIMARY_EXT") role="primary" ;;
        *.blockmap)      role="blockmap" ;;
        latest*.yml)     role="metadata" ;;
        *) continue ;;
      esac
      size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
      sha=$(sha256sum "$f" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$f" | awk '{print $1}')
      [ "$first" = true ] && first=false || files_json="$files_json,"
      files_json="$files_json{\"filename\":\"$f\",\"size\":$size,\"sha256\":\"$sha\",\"role\":\"$role\"}"
    done
    files_json="$files_json]"
    echo "files=$files_json" >> "$GITHUB_OUTPUT"
    echo "Generated files metadata: $files_json"

# 2) 推送到 COS
- name: Upload artifacts to Tencent COS
  uses: TencentCloud/cos-action@v1
  with:
    secret_id: ${{ secrets.TENCENT_COS_SECRET_ID }}
    secret_key: ${{ secrets.TENCENT_COS_SECRET_KEY }}
    cos_bucket: ${{ secrets.TENCENT_COS_BUCKET }}
    cos_region: ${{ secrets.TENCENT_COS_REGION }}
    local_path: ./dist/
    remote_path: /build-artifacts/${{ inputs.build_id }}/
    accelerate: true
    clean: false
```

### 4.3 改 callback step 的 body

**旧版**类似：

```yaml
- name: Callback to backend
  if: always()
  shell: bash
  run: |
    curl -X POST "${{ inputs.callback_url }}" \
      -H "Authorization: Bearer ${{ inputs.callback_token }}" \
      -H "Content-Type: application/json" \
      -d '{
        "build_id": "${{ inputs.build_id }}",
        "run_id": ${{ github.run_id }},
        "status": "success",
        "artifact_name": "build-output-${{ inputs.build_id }}"
      }'
```

**改成**（注意 success 分支带 cos 字段，failure 分支保持简单）：

```yaml
- name: Callback to backend (success)
  if: success()
  shell: bash
  run: |
    curl -X POST "${{ inputs.callback_url }}" \
      -H "Authorization: Bearer ${{ inputs.callback_token }}" \
      -H "Content-Type: application/json" \
      -d "$(cat <<EOF
{
  "build_id": "${{ inputs.build_id }}",
  "run_id": ${{ github.run_id }},
  "status": "success",
  "artifact_storage": "cos",
  "cos_object_prefix": "build-artifacts/${{ inputs.build_id }}/",
  "files": ${{ steps.files.outputs.files }}
}
EOF
)"

- name: Callback to backend (failure)
  if: failure() || cancelled()
  shell: bash
  run: |
    curl -X POST "${{ inputs.callback_url }}" \
      -H "Authorization: Bearer ${{ inputs.callback_token }}" \
      -H "Content-Type: application/json" \
      -d '{
        "build_id": "${{ inputs.build_id }}",
        "run_id": ${{ github.run_id }},
        "status": "failed",
        "error": "workflow_failed_or_cancelled"
      }'
```

### 4.4 commit + push 到 main 分支

```bash
# 在 local-agent-build 仓库
git add .github/workflows/build-win.yml .github/workflows/build-mac.yml
git commit -m "feat(build): switch artifact storage from GitHub artifacts to Tencent COS direct upload (agent-build 0.4.0)"
git push origin main
```

### 4.5 注意事项

- `TencentCloud/cos-action@v1` 是腾讯云官方 action（被 GitHub Marketplace 收录），首次用会有一个 install confirm
- `accelerate: true` 让 runner 走 COS 全球加速接入点，跨境推 100MB 大约 30-90 秒。如果你 bucket 没启用全球加速，去 COS 控制台 → 该 bucket → 域名与传输 → 默认源站域名旁开「全球加速」（不收额外费用，仅按流量计）
- `clean: false` 保证不会误删 bucket 里其他文件（默认值就是 false，显式写出来更安全）
- `path: ./dist/` 假设 electron-builder 输出目录是 `dist`。若你的 build 命令产出在 `release/` 或别处，改这两处 `working-directory` 和 `local_path`

---

## 5. 端到端验证

1. 在云控端管理后台或客户端发起一次新打包（例如 win 平台测试任务）
2. 在 GitHub Actions 看 workflow run 的 step 列表，应该有：
   - Compute artifact files metadata
   - **Upload artifacts to Tencent COS**（这一步是新增的关键）
   - Callback to backend (success)
3. 在 agent-build 服务器看 laravel.log：

   ```bash
   tail -f /www/wwwroot/your-build-domain.example.com/storage/logs/laravel.log | grep BuildCallback
   ```

   预期出现：

   ```
   [BuildCallback] cos success {"build_id":"...","cos_prefix":"build-artifacts/.../","files_count":3,"primary":"app-1.0.0-setup.exe"}
   ```

4. 在 COS 控制台 → bucket 文件列表，应该能看到 `build-artifacts/{build_id}/` 路径下的 .exe / .blockmap / latest.yml
5. 客户端发起下载，全程秒级完成（不再 80 分钟）。在客户端浏览器开发者工具 Network 面板能看到 `/dl/{token}` → 302 → `cos3.xiaoyinet.cn/build-artifacts/.../app.exe?q-sign-algorithm=...`
6. 1 天后回头看 COS bucket，那个 build_id 的对象应该已被 lifecycle 自动删（如未删，检查 lifecycle 规则状态）

---

## 6. 排错速查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| callback 返 422 `cos_prefix_mismatch` | workflow 里 cos_object_prefix 和 build_id 不匹配 | 检查 workflow yml 里 `cos_object_prefix` 表达式是否严格 `build-artifacts/${{ inputs.build_id }}/`（带尾斜杠） |
| callback 返 422 `cos_object_missing` | COS upload step 失败 / object 没传上去 | 看 GitHub Actions 上 Upload to Tencent COS step 的日志，可能是 region/bucket 错或 CAM policy 缺权限 |
| callback 返 422 `cos_not_configured` | agent-build 这边后台还没填 COS 凭证 | 走 §2.3 |
| `/dl/{token}` 302 跳到 COS 后 403 | 预签 URL 过期（>30min）或 CAM secret 失效 | 让客户端重新调 `/api/build/download/{buildId}` 拿新 token |
| GitHub Actions 报 `accelerate not enabled` | bucket 没开全球加速 | COS 控制台开启即可，开了之后等 1-2 分钟 DNS 生效 |
| Settings 页面「测试连通性」按钮灰着 | 还没保存配置 | 先填表保存，再测试 |

---

## 7. 安全注意事项

- 部署完成后**立即在 CAM 里禁用刚才贴在对话/会话里泄露过的 SecretKey 并新建一对**：
  1. CAM → 用户 → `agent-build-cos` → API 密钥管理 → 禁用旧 SecretKey
  2. 同页面新建一对 → 复制 SecretId / SecretKey
  3. 在 agent-build 后台「系统设置」更新 SecretKey 字段（其余 4 项不变）→ 保存 → 测试
  4. 在 GitHub Secrets 更新 `TENCENT_COS_SECRET_ID` + `TENCENT_COS_SECRET_KEY` 两个值
  5. 触发一次新打包验证两端凭证已生效

- COS lifecycle 1 天兜底**不能替代** workflow 失败时的清理：偶发上传一半就失败的 partial object 由 `AbortIncompleteMultipartUpload` 1 天清

- agent-build 后台「系统设置」页面**不显示 SecretKey 明文**，只显示前 4 + ***** + 后 4 mask。若需要调试，从 CAM 控制台重看一次（CAM 显示的是它原始保存的，不是从 agent-build DB 读）

- `Crypt::encryptString` 用的是 `APP_KEY`（`.env` 里的 `APP_KEY=base64:...`）。**千万不要在升级时 regenerate APP_KEY**，否则 `system_settings.is_encrypted=1` 的所有行解密失败 → CosService 读不到凭证 → 所有 COS 操作 fail。如果 APP_KEY 真的要换，必须先把 settings 解密成 plain text → 改 APP_KEY → 重新 setGroup 让它用新 key 重新加密
