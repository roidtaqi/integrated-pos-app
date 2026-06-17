import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeDatabase } from './services/db.ts'
import { realtimeSyncService } from './services/realtimeSyncService.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void initializeDatabase().catch((error) => {
  console.error('Failed to initialize local POS database', error);
}).then(() => {
  void realtimeSyncService.autoStart();
});
