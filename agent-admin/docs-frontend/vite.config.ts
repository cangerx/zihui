import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * docs-frontend：面向终端用户的文档站点。
 *
 * 部署形态（与 admin frontend 对齐）：
 * - dev：vite 5174 端口（admin 是 3000），代理 /api → 线上 admin 域
 * - prod：tsc + vite build → ../backend/public/docs/，由 Laravel 路由 SPA fallback 提供入口
 *
 * base=/docs/ 让构建产物的资源路径都带 /docs/ 前缀，与 web.php 里的 SPA 路由配合。
 */
export default defineConfig({
  plugins: [react()],
  base: '/docs/',
  build: {
    outDir: '../backend/public/docs',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'https://your-admin-domain.example.com',
        changeOrigin: true,
      },
    },
  },
});
