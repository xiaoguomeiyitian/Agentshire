import { initLocale } from './i18n'
initLocale()

import './app/app.css'
import { createRoot } from 'react-dom/client'
import { ClawSettingsView } from './app/ClawSettingsView'

function ClawApp() {
  return (
    <div className="flex flex-col w-full h-dvh bg-bg-base text-text-primary overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <ClawSettingsView visible={true} />
      </div>
    </div>
  )
}

const appRoot = document.getElementById('app-root')
if (!appRoot) throw new Error('#app-root not found')

createRoot(appRoot).render(<ClawApp />)
