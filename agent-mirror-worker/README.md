# agent-mirror-worker

美国（或任何到 GitHub 快的）节点：把云打包 GitHub Release 拉下来，再回传到北京云控的产物目录。

云控、授权端都不搬家。这台机器只做跨境下载。

## 它做什么

```text
GitHub Actions 打完包
  → 本机按 pending 领取（或手动 push 一条）
  → 用 GitHub token 下 Release（只接受 octet-stream，可续传）
  → sha256 校验
  → rsync 到北京 storage/app/cloud-build-artifacts/{build_id}/
  → 在北京写入 storage_path；poll 模式再 ack
```

北京若配置了 `CLOUDBUILD_MIRROR_WORKER_TOKEN`，云控会停止自己去 GitHub 拉，改由本进程领取。未配置时北京仍会自己慢拉，此时只用 `push` 处理单条，不要开 `poll`。

## 本机要求

- Python 3.10+（只用标准库）
- `curl`、`rsync`、`ssh`
- 到北京 root 的 SSH 密钥登录

## 配置

```bash
cp .env.example .env
# 只在机器上的 .env 填 token，不要提交
```

## 命令

在项目根目录：

```bash
python3 src/worker.py doctor          # 检查 GitHub / SSH / 目录
python3 src/worker.py push <build_id> # 拉一条并回传，不依赖 worker token
python3 src/worker.py poll            # 轮询 /api/cloud-build/mirror/pending
```

systemd 示例见 `systemd/agent-mirror-worker.service`。只在北京已经写入同一份 `WORKER_TOKEN` 后再 `enable --now`。

## 不要做的事

- 不要把 `.env`、PAT、worker token 提交进仓库。
- 北京还有 `.part` 正在续传时，不要对同一 `build_id` 抢写，也不要先开 poll。
