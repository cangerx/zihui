import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 与 agent-admin 同样的同源部署模式：
// 前端构建产物落到 backend/public/admin/，访问路径 https://your-build-domain.example.com/admin/
// 静态资源由 web 服务器（Apache .htaccess）直接送，未命中文件交给 Laravel catch-all 回 admin/index.html
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/admin/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // 自助付费公开接口走 /api（非 /admin/api），dev 下同样转发到后端
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../backend/public/admin',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
