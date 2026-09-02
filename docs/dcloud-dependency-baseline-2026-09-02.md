# DCloud/uni-app 依赖安全基线（2026-09-02）

## 结论

本轮没有升级 DCloud/uni-app 依赖，也没有写入 `overrides`。当前锁文件继续使用 Vue 3 兼容的 DCloud 工具链，依赖版本由 `scripts/check-dcloud-dependency-baseline.mjs` 固化检查。该检查已接入根命令：

```bash
npm run check:dcloud-dependency-baseline
```

## 当前锁定版本

| 依赖范围 | 锁定版本 | 说明 |
| --- | --- | --- |
| DCloud 核心包（`@dcloudio/uni-*`、`@dcloudio/vite-plugin-uni`） | `3.0.0-5010520260709002` | 当前 Vue 3 工具链，必须保持同一发布线 |
| `agent-mobile` direct `vite` | `5.4.21` | 移动端直接构建器 |
| DCloud compiler root `vite` | `5.2.8` | `@dcloudio/uni-cli-shared` 当前传递解析结果 |
| `@intlify/core-base` / `@intlify/message-resolver` | `9.1.9` | DCloud/`vue-i18n` 传递依赖 |
| `adm-zip` | `0.5.16` | DCloud CLI 传递依赖 |
| `jpeg-js` | `0.3.7` | mp-weixin 图片工具链传递依赖 |
| `@dcloudio/uni-nvue-styler` nested `postcss` | `8.5.6` | DCloud 固定嵌套版本 |
| `postcss-selector-parser` | `6.1.2` | DCloud 编译链版本 |
| `ws` | `8.18.0` | DCloud mp-weixin 工具链版本 |
| DCloud nested `esbuild` | `0.20.2` | `@dcloudio/uni-cli-shared` 传递依赖 |
| root `postcss` | `8.5.26` | workspace root 解析版本 |

`package-lock.json` 同时包含其他工具的嵌套版本（例如 `vue-i18n` 自带的 Intlify、浏览器测试工具的 `ws`）。本基线只锁定上述 DCloud 生产/编译链路径，避免把无关路径误报为已修复或错误覆盖。

## Vue 3 候选验证

在隔离临时项目中验证了候选 DCloud 版本 `3.0.0-alpha-5020520260829001`。该候选仍解析到以下版本：

- `@intlify/core-base` / `@intlify/message-resolver` `9.1.9`
- `adm-zip` `0.5.16`
- `jpeg-js` `0.3.7`
- `@dcloudio/uni-nvue-styler` nested `postcss` `8.5.6`
- `postcss-selector-parser` `6.1.2`
- `ws` `8.18.0`
- DCloud compiler root `vite` `5.2.8`

因此候选没有提供可验证的安全依赖收敛，未替换当前锁文件。npm registry 的 `latest` 为 `2.0.2-5020420260813001`，属于 Vue 2/legacy 线，与当前 Vue 3 alpha 工具链不兼容；不能以“升级到 latest”作为修复方案。

## 审计与安全例外

在 Node `22.23.0` / npm `10.9.2` 上对当前锁文件执行 `npm audit --omit=dev` 的最新快照为 **11 high / 46 total**。其中 DCloud 固定传递依赖仍有 9 条独立 high GHSA，已在 `scripts/security-audit-policy.json` 逐条登记；这表示风险被追踪和门禁化，不表示风险已经修复。审计数据库会随公告变化，CI 以逐条 GHSA 匹配而不是固定总数作为门禁。

所有 DCloud 例外最晚到期日为 **2026-09-30**。不得通过延长期限、通配 `overrides` 或未经构建验证的传递替换来规避到期门禁。

## 下一步退出条件

1. 采用 DCloud 支持且能在干净 Node 22/npm 10 安装中解析到受影响包修复版本的 Vue 3 发布线。
2. 对每个受影响包记录新旧解析路径，更新安全例外为已消除，并保持无未登记 `overrides`。
3. 通过 `npm ci`、H5 构建、mp-weixin 构建、生产入口/资源扫描和移动端回归测试。
4. 在真实微信合法域名、对象存储 CORS 和目标设备完成联调后，再评估生产开关；依赖升级本身不能替代这些上线条件。
