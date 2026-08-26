import { resolve } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'
import pkg from './package.json'

/** file:// 下带 crossorigin 的 CSS/模块脚本会被当成跨域，样式经常加载失败。 */
function stripHtmlCrossorigin(): Plugin {
  return {
    name: 'strip-html-crossorigin',
    closeBundle() {
      const htmlPath = resolve('out/renderer/index.html')
      if (!existsSync(htmlPath)) return
      const html = readFileSync(htmlPath, 'utf-8').replace(/\s+crossorigin(?:="[^"]*")?/g, '')
      writeFileSync(htmlPath, html)
    }
  }
}

function loadDevApiDomain(): string {
  const p = resolve('resources/config.json')
  if (existsSync(p)) {
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf-8')) as { apiDomain?: string }
      if (cfg.apiDomain) return cfg.apiDomain.replace(/\/$/, '')
    } catch { /* ignore */ }
  }
  return 'https://agent.haohuoban.com'
}

const DEV_API_DOMAIN = loadDevApiDomain()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue(), stripHtmlCrossorigin()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_API_DOMAIN__: JSON.stringify(DEV_API_DOMAIN)
    },
    css: {
      postcss: resolve('src/renderer/postcss.config.js')
    },
    server: {
      host: '127.0.0.1',
      strictPort: false,
      port: 6260
    }
  }
})
