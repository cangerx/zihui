# 云控端打包授权与 GitHub 配置说明

面向授权端运营：给某个云控站点开通打包能力，并指导该云控填好 GitHub。  
**授权端不保存、也不填写 GitHub Token。** Token 只存在对应云控后台。

旧文档 `DEPLOY.md` 第三节仍写「安装授权端时申请 PAT、写入授权端 `.env`」。那是退休前的链路，不要再按那个做。`/api/build/*` 已默认 410，打包执行在云控直连 GitHub。

---

## 1. 谁做什么

| 角色 | 负责 | 不负责 |
|---|---|---|
| 授权端 | 登记云控域名；打开或关闭两档打包许可；可选定价与自助购买 | 不存构建仓、不存 PAT、不调度 Actions、不存安装包 |
| 云控端 | 在「系统设置 → 云打包 GitHub」填写 `owner/name` 与 Token；提交 Windows / Mac 打包 | 未获许可时不能保存 GitHub 配置，也不能 dispatch |
| GitHub 构建仓 | 跑 `build-win.yml` / `build-mac.yml` | 不替代授权端白名单 |

许可探测接口：云控调用授权端 `GET /api/license/site`（走域名绑定，**不**走已退休的 `/api/build/auth-check`）。

云控列表上的「已授权」只表示这个域名在白名单且站点有效，**不等于**可以云打包。

---

## 2. 两档开关

在授权端 **云控站点** 列表，每一行有两列：

| 列名 | 字段 | 打开之后 |
|---|---|---|
| 云控端打包 | `can_use_github_packaging` | 该云控可以保存 GitHub 配置，并提交 **Windows** 打包 |
| Mac 打包 | `can_use_mac_packaging` | 该云控可以提交 **macOS** 打包 |

规则：

- 新站点、老站点默认都是关。
- 只开 Mac、不开「云控端打包」：仍不能打 Mac。打 Mac 必须两档都开。
- 只开「云控端打包」：可以配 GitHub、打 Windows，不能打 Mac。
- 关掉后，云控侧许可有短缓存：刚打开若仍提示未授权，等约 2 分钟再试；关掉后最长约 10 分钟仍可能打出一枪。

批量操作：云控站点页上方「批量设置打包授权」。

---

## 3. 开通步骤（手工）

### 3.1 授权端：先有站点，再开许可

1. 打开授权后台 → **云控站点**。
2. 确认该云控域名已登记，状态有效、未过期。没有记录就先添加（域名要和云控对外 Origin 一致，含协议习惯以登记值为准）。
3. 打开该行 **云控端打包**。需要打 Mac 时，再打开 **Mac 打包**。
4. 不要在授权端任何设置页寻找「GitHub Token」——这里没有这一项。

可选：

- **系统 → 打包授权定价**：上架单价，供公开自助购买页使用。
- **收款 → 打包授权订单**：查看自助开通记录。
- 自助购买：访问者输入云控域名，勾选未开通档后扫码；服务端只开通未开通的档。打 Mac 时会强制带上 Windows 档。

### 3.2 云控端：填构建仓和 Token

1. 登录**该云控**后台（不是授权端）。
2. 打开 **系统设置 → 云打包 GitHub**。
3. 若黄条写「尚未获得云控端打包授权」，回到 3.1 检查开关和域名，不要硬填。
4. **构建仓**填 `owner/name`，例如 `your-org/your-cloudbuild`。不要填仓库 URL，不要填 `.git`。
5. **GitHub Token** 填 Fine-grained PAT。保存后回显只显示「已保存」，不再出明文。留空保存表示不改已有 Token。
6. 设置页非空值优先；仓名和 Token 都空时，才回退该云控服务器 `.env` 的 `GITHUB_BUILD_REPO` / `GITHUB_BUILD_TOKEN`。
7. 不要在此页填 workflow 名或回调地址。Windows 固定 `build-win.yml`，Mac 固定 `build-mac.yml`，分支默认 `main`。

### 3.3 GitHub：准备构建仓和 PAT

在 GitHub 为**该云控自己的构建仓**建 Fine-grained token（Settings → Developer settings → Personal access tokens → Fine-grained tokens）：

1. Resource owner 选仓所属账号或组织。
2. Repository access 只勾这一个构建仓，不要勾业务仓。
3. Repository permissions 至少：
   - **Contents**：Read and write（推桌面源码 / 读产物）
   - **Actions**：Read and write（`workflow_dispatch`、读 run、取消）
   - **Workflows**：Read and write（**第一次**往空仓写入 `.github/workflows/*.yml` 时必须有；只 dispatch 已有 workflow 时也建议保留）
4. Metadata 只读会随上述权限带上。
5. 复制 token，只贴进该云控「云打包 GitHub」，不要贴进授权端、不要写入仓库、不要发到聊天。
6. 仓内 `main` 根目录要有桌面端树（`package.json`、`.github/workflows/build-win.yml`、`build-mac.yml` 等）。空仓或没有这两个 workflow 时，dispatch 会报 `github_workflow_not_found`。
7. 在 GitHub 该仓 **Actions** 里确认两个 workflow 为 active。组织若限制 Actions，先打开。

构建仓内容来自 `agent-desktop/`，不是整个 monorepo 根。日常桌面发版仍按 `agent-desktop/docs/桌面端发布与push规范.md`。

---

## 4. 怎样算开通成功

按顺序检查：

1. 授权端该行 **云控端打包** 为开（打 Mac 则两档都开）。
2. 云控「云打包 GitHub」无黄条，仓名已保存，Token 显示已保存（或 `.env` 已有回退值）。
3. GitHub 该仓 Actions 能看到 `build-win.yml` / `build-mac.yml`。
4. 在云控提交一笔 Windows 打包后，GitHub 出现对应 run；失败应立刻显示可读错误，而不是一直「排队」。

绿色「已授权」或店铺商品图已开通，都不能代替第 1 步。

---

## 5. 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| 云控设置页黄条「尚未获得云控端打包授权」，保存 403 `packaging_not_licensed` | 授权端未开「云控端打包」，或域名未登记 / 停用 / 过期 | 先修白名单和开关；等缓存过期后再保存 |
| 能保存 GitHub，Windows 可打、Mac 被拒 `packaging_mac_not_licensed` | 只开了第一档 | 再开「Mac 打包」 |
| `github_dispatch_forbidden` / GitHub 提示 token 无权 | PAT 缺 Actions 写，或未勾这个仓 | 按 3.3 重开 token，只在云控更新，旧 token 在 GitHub 作废 |
| `github_workflow_not_found` 或 422 缺 input | 仓是空的，或没有对应 yml；或 dispatch 参数不完整 | 先把桌面树和两个 workflow 推上 `main`；不要在 GitHub 网页手建空 workflow |
| 第一次推 yml 被拒 `without workflow scope` | PAT 没有 Workflows 写 | 给该 PAT 打开 Workflows 读写后再推 |
| 授权端找不到填 Token 的地方 | 当前设计就是这样 | 去**云控**「系统设置 → 云打包 GitHub」 |

---

## 6. 不要做的事

- 不要在授权端 `.env` 再写 `GITHUB_BUILD_TOKEN` 指望它触发打包。
- 不要恢复 `/api/build/*` 当许可接口。
- 不要把 PAT 写入 git、票据、更新包或客户文档。
- 不要多个云控共用同一枚 PAT 还写进授权端「全局配置」——许可按域名发，凭据按云控存。
- 不要把「域名已授权」理解成「已开通云打包」。
