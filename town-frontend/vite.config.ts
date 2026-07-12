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
    editorServePlugin(),
    (mode === 'https' || process.argv.includes('--https')) && basicSsl(),
  ].filter(Boolean),
  build: {
    outDir: 'dist',
    sourcemap: true,
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
