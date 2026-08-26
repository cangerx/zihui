// 实现已迁至 src/shared/api-base-normalize.ts，供 main + renderer 共享。
// 这里仅保留 re-export 以兼容 main 进程内已有的 `./api-base-normalize` 引用。
export { normalizeApiBase } from '@shared/api-base-normalize'
