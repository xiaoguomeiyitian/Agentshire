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
    editorServePlugin(),
    (mode === 'https' || process.argv.includes('--https')) && basicSsl(),
  ].filter(Boolean),
  build: {
    outDir: 'dist',
    // sourcemap 默认关闭以降低构建内存占用；通过 SOURCEMAP=true 开启
    sourcemap: process.env.SOURCEMAP === 'true',
    // vendor-three(664kB)/editor(539kB)/vendor-lucide(398kB)均超默认 500kB 阈值。
    // three 集中到共享 chunk 是预期行为,editor 是重型 3D 编辑器业务代码,
    // lucide 全量导入问题待 P1 按需化处理。此处调高阈值消除噪音警告。
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        town: resolve(__dirname, 'town.html'),
        editor: resolve(__dirname, 'editor.html'),
        preview: resolve(__dirname, 'preview.html'),
        citizenEditor: resolve(__dirname, 'citizen-editor.html'),
      },
      output: {
        // 抽离大型 vendor,供 town / editor / citizen-editor 三个入口共享。
        // Rolldown 推荐用 `codeSplitting`(advancedChunks 已 deprecated)。
        // 正则用 `[\\/]` 兼容 Windows 路径分隔符。
        codeSplitting: {
          // minShareCount 默认为 1:只要模块被任一入口引用且匹配 group,就抽离。
          // 设为 2 会导致 react 等被多入口共享的库因部分子模块仅单入口引用而无法整体抽离。
          minShareCount: 1,
          groups: [
            {
              // three 核心 + examples/jsm(GLTFLoader / OrbitControls / SkeletonUtils 等)
              name: 'vendor-three',
              test: /node_modules[\\/]three[\\/]/,
              priority: 20,
            },
            {
              // React 19 运行时
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              // Markdown 渲染栈(react-markdown / remark-gfm 及其传递依赖)
              name: 'vendor-markdown',
              test: /node_modules[\\/](react-markdown|remark-.*|micromark.*|mdast.*|hast.*|unist.*|character-.*|decode-named-character-reference|trim-lines|space-separated-tokens|property-information|estree-.*|vfile.*|trough|bail|is-plain-obj|comma-separated-tokens|html-url.*|trim|web-namespaces|zwitch|ccount|escape-string-regexp|markdown-table|longest-streak|highlight.*|lowlight|refractor|prismjs)[\\/]/,
              priority: 15,
            },
            {
              // lucide 图标库
              name: 'vendor-lucide',
              test: /node_modules[\\/](lucide|lucide-react)[\\/]/,
              priority: 15,
            },
          ],
        },
      },
    },
  },
}))
