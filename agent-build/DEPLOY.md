# agent-build 部署教程

云打包授权管理端，通过可视化安装向导（install.php）一键部署。预计耗时 5-10 分钟（不含 GitHub PAT 申请）。

> agent-build 与 agent-admin **完全独立**：独立域名、独立数据库、独立账号体系。不要把两个后台装在同一个数据库里。

---

## 一、服务器要求

| 项 | 要求 |
|---|---|
| 操作系统 | Linux（推荐 CentOS 7+ / Ubuntu 20.04+） |
| 面板 | 宝塔面板（推荐，本教程基于宝塔） |
| PHP | **8.0.2+**，必须启用扩展：`fileinfo` `openssl` `pdo_mysql` `mbstring` `tokenizer` `xml` `ctype` `json` `bcmath` `curl` |
| PHP 函数 | `exec` `popen` `proc_open` `putenv` 不能在 disable_functions 里 |
| MySQL | **5.7.7+ 或 8.0+ / MariaDB 10.2+** |
| Nginx | 任意版本，需配 PHP-FPM |
| 磁盘 | 500 MB 起步（含 vendor + 中转产物缓冲区，大任务期间可能瞬时占用 ≥ 300 MB） |
| 域名 | 已解析到服务器 + 备案（中国大陆）+ 支持 HTTPS |

---

## 二、准备数据库

宝塔 → 数据库 → 添加数据库：

- 数据库名：**必须与 agent-admin 分开**，建议 `agent_build`
- 字符集：**utf8mb4**
- 排序规则：**utf8mb4_unicode_ci**
- 用户名 / 密码：自定，**记下来**安装时要填

---

## 三、准备 GitHub fine-grained PAT（可以晚一步做）

> **已过时。** 打包执行在云控直连 GitHub，授权端不再保存 PAT、不再调度 Actions。开通与填仓步骤见 `docs/云控端打包授权与GitHub配置说明.md`。下面步骤不要再在授权端执行。

agent-build 靠 PAT 触发 `local-agent-build` 仓库的 Actions 打包。

1. 登录 GitHub → 右上角头像 → **Settings** → 左下 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. 关键字段：
   - **Token name**：`agent-build-prod`
   - **Expiration**：建议 90 天，到期前轮换
   - **Resource owner**：选 `your-org`（或你自己 fork 后的 owner）
   - **Repository access** → **Only select repositories** → 勾 `local-agent-build`
   - **Repository permissions** → **Actions** → **Read and write**（会自动带上 Metadata: Read）
3. **Generate token** → 复制形如 `github_pat_xxxxxxxxxx` 的字符串备用

> 这个 Token 可以在向导第 4 步填，也可以先留空，安装后去 `.env` 补上 `GITHUB_BUILD_TOKEN=` 再 `php artisan config:clear` 生效。

---

## 四、上传代码

1. 下载 agent-build 发布包（或直接从源码仓库打 zip）
2. 宝塔 → 文件 → 创建目录 `/www/wwwroot/your-build-domain.example.com/`
3. 上传 zip → 右键解压，结构应该是：

```
/www/wwwroot/your-build-domain.example.com/
├── backend/        ← Laravel 主体
│   ├── public/     ← 站点运行目录（含已构建好的 admin/ SPA）
│   │   └── install.php
│   ├── app/  config/  routes/  ...
│   ├── .env.example
│   └── composer.json
└── frontend/       ← 源码（运维不用动，前端产物已在 backend/public/admin/）
```

如果下载的包没带 `vendor/`，进到 `backend/` 跑一次：

```bash
cd /www/wwwroot/your-build-domain.example.com/backend
composer install --no-dev --optimize-autoloader
```

---

## 五、宝塔配置站点

### 5.1 添加站点

宝塔 → 网站 → 添加站点：

- 域名：`your-build-domain.example.com`
- 根目录：`/www/wwwroot/your-build-domain.example.com/backend`
- PHP 版本：选 **8.0+**
- 数据库：选「不创建」（已在第二步建好）

### 5.2 改运行目录

站点设置 → 网站目录 → 运行目录改为 **`/public`** → 保存。

### 5.3 配伪静态

站点设置 → 伪静态 → 选 **`laravel5`** → 保存。

### 5.4 申请 SSL（**必须**）

站点设置 → SSL → Let's Encrypt → 申请。开启「强制 HTTPS」。

> electron-updater 在生产模式下校验 HTTPS；签名下载 URL 也走 HTTPS。HTTP 部署会无法完整打通链路。

---

## 六、设置目录权限

宝塔 → 终端：

```bash
cd /www/wwwroot/your-build-domain.example.com/backend
chown -R www:www .
chmod -R 755 .
chmod -R 775 storage bootstrap/cache
```

---

## 七、运行安装向导

浏览器打开 `https://your-build-domain.example.com/install.php`，4 步走完：

| 步骤 | 内容 |
|---|---|
| **1. 环境检测** | PHP 版本、扩展、函数自动检测，全绿才能继续 |
| **2. 文件权限** | 检查目录可写 + vendor 是否就绪，第五步做对 + composer install 过这步就全绿 |
| **3. 数据库** | 填第二步建好的数据库信息，点「测试连接」 |
| **4. 管理员** | 管理员账号密码 + GitHub 仓库 + GitHub PAT（可选） |

点「立即安装」，向导会自动：

- 写 `.env`（含随机生成的 `APP_KEY` / `BUILD_SIGN_SECRET` / `BUILD_NOTIFY_SECRET`）
- 跑数据库迁移建表（`authorized_clients` / `build_requests` / `build_quotas` / `template_versions` / `admin_users` 等）
- 创建管理员账户（写入 `admin_users` 表）
- 建 `storage/app/build-artifacts/` artifact 中转目录
- 写 `storage/installed.lock`（防重装）

完成后显示 **cron 命令**（必做，见下一步）+ 进入管理后台入口。

---

## 八、配置 cron（**必做，否则系统不工作**）

agent-build 必须跑 Laravel scheduler，否则：

- `BuildWorker`（拉 GitHub artifact + 通知云控端）不运行 → 打包任务卡在 success 状态
- `BuildAckTimeout`（24h 未 ACK 的任务清理）不运行 → 磁盘会被残留产物占满
- `BuildStuckDetector`（卡死任务检测）不运行 → 故障任务永远挂着

宝塔 → 计划任务 → 添加任务：

| 字段 | 值 |
|---|---|
| 任务类型 | **Shell 脚本** |
| 任务名称 | `agent-build-scheduler` |
| 执行周期 | **每 1 分钟** |
| 脚本内容 | 用向导完成页显示的那一行，格式如下 |

```bash
cd /www/wwwroot/your-build-domain.example.com/backend && /usr/bin/php artisan schedule:run >> /dev/null 2>&1
```

> Laravel 内部会按 `app/Console/Kernel.php` 里的频率调度：`build:worker` 每分钟跑、`build:stuck-detector` 每 5 分钟跑、`build:ack-timeout` 每小时跑。

添加完 1 分钟后 `tail -f storage/logs/laravel.log`，应看到 `BuildWorker started` 之类日志。

---

## 九、安全收尾

安装完成后 `install.php` 自动失效（再访问返回 404），但仍建议物理删除：

```bash
rm /www/wwwroot/your-build-domain.example.com/backend/public/install.php
```

---

## 十、创建第一个授权客户端

> 0.2.0 起授权机制简化为**仅域名校验**：云控端访问本平台时携带的 `Origin` Header 与下表 `domain` 完全相等即放行。**不再有 client_id / client_secret / HMAC 签名**。

后台 → **客户端管理** → 新建：

| 字段 | 是否必填 | 说明 |
|---|---|---|
| 授权域名 (domain) | 必填 | 云控端的完整域名，**必须带 https://**，如 `https://admin.client-a.com`。是唯一授权依据 |
| 通知回调 URL (notify_url) | 必填 | 云控端接收打包通知的完整 URL，如 `https://admin.client-a.com/api/build/receive-notify` |
| 客户姓名 (owner_name) | 必填 | 仅作管理后台显示用 |
| 手机号 (owner_phone) | 可空 | 仅作管理后台显示与搜索用 |
| 日配额 / 月配额 | 默认 3 / 30 | 单客户端打包总次数（不分平台） |
| 过期时间 (expires_at) | 可空 | 留空则不限期 |

创建成功后**不再返回任何密钥**——云控端只需要在自己的 `.env` 配置：

```ini
AGENT_BUILD_BASE_URL=https://your-build-domain.example.com
AGENT_BUILD_ORIGIN=https://admin.client-a.com
BUILD_NOTIFY_SECRET=<从 agent-build .env 里复制 BUILD_NOTIFY_SECRET 的值>
```

> `BUILD_NOTIFY_SECRET` 在两边必须**完全一致**，否则云控端校验通知签名会失败（这是仍保留的唯一共享密钥，仅用于 `agent-build → 云控端` 的打包完成通知签名，不再用于鉴权入站请求）。
>
> `AGENT_BUILD_ORIGIN` 多数情况不用配，新版 SDK 会自动用云控端当前 HTTP 请求的 Host 作为 Origin；只有当反向代理剥掉 Host 头时才需要显式配置。

---

## 十一、日常维护

| 操作 | 入口 |
|---|---|
| 改管理员密码 | 后台 → 用户管理 → 编辑 |
| 加 / 删 / 停用客户端 | 后台 → 客户端管理（0.2.0 起无密钥概念，禁用直接改 status=suspended 即可） |
| 撤销云控端授权 | 后台 → 客户端管理 → 编辑 → 状态改为「停用」（瞬间生效，下一次请求即被 403） |
| 强制取消 / 重试 / 清理任务 | 后台 → 打包请求列表 → 行操作 |
| 新增模板版本 | 后台 → 模板版本管理 |
| 暂停 / 恢复全局打包队列 | 后台 → 队列管理 |
| 轮换 GitHub PAT | 改 `.env` 的 `GITHUB_BUILD_TOKEN` → `php artisan config:clear` |

---

## 十二、常见问题

### 1. install.php 打开是空白 / 直接 404

伪静态没选 laravel5，或运行目录没改成 `/public`。回第 5.2 / 5.3 步检查。

### 2. Step 1 环境检测某项不通过

- **PHP 扩展缺失**：宝塔 → 软件商店 → PHP 8.0 → 设置 → 安装扩展
- **函数被禁用**：同上 → 设置 → 禁用函数 → 删掉对应函数 → 重启 PHP

### 3. Step 2 `vendor/autoload.php` 不存在

```bash
cd /www/wwwroot/your-build-domain.example.com/backend
composer install --no-dev --optimize-autoloader
```

### 4. Step 3 数据库版本不兼容

MySQL 5.7.6 及以下不行。宝塔 → 软件商店 → MySQL → 切换到 5.7.7+ 或 8.0（数据自动保留）→ 重启 MySQL → 重新进入向导。

### 5. 安装完成后打包任务卡在 success 不下发

99% 是 cron 没跑或没配。

```bash
# 确认 scheduler 在跑
tail -f /www/wwwroot/your-build-domain.example.com/backend/storage/logs/laravel.log

# 手动拉一次看错在哪
cd /www/wwwroot/your-build-domain.example.com/backend
php artisan build:worker --once
```

### 6. 打包请求返回 403

0.2.0 起入站不再有 401（HMAC 已下线），只有 403 一种拒绝场景，分四个错误码：

- **`origin_required`** = 云控端反向代理剥掉了 Host 头。修复：让代理透传 `Host` / `Origin`
- **`domain_not_authorized`** = 云控端的 `Origin` 不在白名单。修复：后台 → 客户端管理 → 检查域名是否完全匹配（含 `https://` 前缀，结尾不要带 `/`）
- **`client_inactive`** = 客户端被停用。修复：后台编辑 → 状态改回「正常」
- **`client_expired`** = 过期时间已到。修复：后台编辑 → 清空过期时间或往后延

### 7. 云控端收不到通知 / 通知签名校验失败

两边 `BUILD_NOTIFY_SECRET` 必须一模一样。agent-build 的这个值在向导安装时随机生成，改完 `.env` 记得 `php artisan config:clear`。

### 8. 已发出的签名下载 URL 全失效

你改过 `BUILD_SIGN_SECRET`，正常现象。让云控端重新调 `GET /api/build/download/{buildId}` 重签一个即可。

### 9. 想重装（清空重来）

```bash
rm /www/wwwroot/your-build-domain.example.com/backend/storage/installed.lock
# 重新访问 install.php，建议同时清空数据库后再装（否则 admin_users 同 username 冲突）
```

### 10. 升级失败 / 站点 500

`tail -50 storage/logs/laravel.log` 看错误。常见原因：缓存残留 → `rm -f bootstrap/cache/*.php` 然后刷新页面。

---

## 十三、磁盘与清理

- artifact 中转目录：`storage/app/build-artifacts/{build_id}/`
- **正常流程**：云控端拉完 → ACK → agent-build 立即双删（本地 + GitHub artifact）
- **兜底流程**：24h 未 ACK → `BuildAckTimeout` 命令自动 purge
- 当磁盘异常占满时，安全清理命令：

```bash
cd /www/wwwroot/your-build-domain.example.com/backend
php artisan build:ack-timeout
# 也可手动针对某个 build：后台 → 打包请求 → 行操作 → 强制清理
```

不要直接 `rm -rf storage/app/build-artifacts/*`，会让数据库状态和磁盘不一致。

---

## 十四、卸载

```bash
# 1. 停 cron（宝塔 → 计划任务 → 删除 agent-build-scheduler）

# 2. 备份数据（如需）
mysqldump -u agent_build -p agent_build > agent-build-backup.sql

# 3. 删除站点（宝塔 → 网站 → 删除）

# 4. 删除数据库（宝塔 → 数据库 → 删除）
```

---

**就这些。装完登录 `/admin/`，用向导创建的账号进去，先去「客户端管理」给第一个云控端发授权。**
