import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'

const pluginDir = resolve(__dirname, '..')

function editorServePlugin() {
  let mod: any = null
  const modulePath = resolve(pluginDir, 'src/plugin/editor-serve.ts')

  return {
    name: 'editor-serve',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!mod) {
          try {
            mod = await server.ssrLoadModule(modulePath)
            mod.ensureEditorDirs(pluginDir)
          } catch (err: any) {
            console.warn('[editor-serve] Failed to load editor-serve module:', err.message)
            next()
            return
          }
        }
        const handled = await mod.handleEditorRequest(req, res, pluginDir)
        if (!handled) next()
      })
    },
  }
}

/**
 * 反代路径前缀适配插件
 *
 * 在 transformIndexHtml 钩子中向 <head> 最前面注入一段内联脚本，
 * 检测路径前缀（/<container>/<port>/）并动态设置 <base>，
 * 使相对路径资源和 fetch 自动带上前缀。
 */
function reverseProxyBasePlugin() {
  const injectScript = `<script>
    (function () {
      try {
        var m = location.pathname.match(/^\\/([a-zA-Z0-9_-]+)\\/(\\d+)(?:\\/|$)/);
        if (m) {
          var base = document.createElement('base');
          base.href = '/' + m[1] + '/' + m[2] + '/';
          document.head.insertBefore(base, document.head.firstChild);
        }
      } catch (e) {}
    })();
  </script>`

  return {
    name: 'reverse-proxy-base',
    enforce: 'pre',
    transformIndexHtml(html: string) {
      if (html.includes('<head>')) {
        return html.replace('<head>', '<head>' + injectScript)
      }
      return injectScript + html
    },
  }
}

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '../src/bridge/**/*.test.ts'],
  },
  base: './',
  server: {
    host: true,
    port: 55210,
    strictPort: false,
    https: mode === 'https' || process.argv.includes('--https'),
    watch: {
      ignored: ['**/assets/models/megapack/**', '**/Cartoon City Massive Megapack/**'],
    },
  },
  resolve: {
    alias: {
      'agentshire_bridge': resolve(__dirname, '../src/bridge'),
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    reverseProxyBasePlugin(),
    editorServePlugin(),
    (mode === 'https' || process.argv.includes('--https')) && basicSsl(),
  ].filter(Boolean),
  build: {
    outDir: 'dist',
    // sourcemap 默认关闭以降低构建内存占用；通过 SOURCEMAP=true 开启
    sourcemap: process.env.SOURCEMAP === 'true',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        town: resolve(__dirname, 'town.html'),
        editor: resolve(__dirname, 'editor.html'),
        preview: resolve(__dirname, 'preview.html'),
        citizenEditor: resolve(__dirname, 'citizen-editor.html'),
      },
    },
  },
}))
