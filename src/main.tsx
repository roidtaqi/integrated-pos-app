import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeDatabase } from './services/db.ts'
import { realtimeSyncService } from './services/realtimeSyncService.ts'

const root = createRoot(document.getElementById('root')!)

root.render(
  <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-600">
    Menyiapkan Kastur POS...
  </div>,
)

void initializeDatabase()
  .then(() => realtimeSyncService.autoStart())
  .catch((error) => {
    console.error('Failed to initialize POS cloud data', error)
  })
  .finally(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
