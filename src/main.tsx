import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/Recovery/ErrorBoundary.tsx'
import { AndroidLanServerBanner } from './components/AndroidLanServerBanner.tsx'
import { RemoteHostBanner } from './components/RemoteHostBanner.tsx'
import { installResizeObserverLoopErrorFilter } from './lib/resizeObserverLoopErrorFilter.ts'
import { initializeRemoteHostSession } from './lib/remoteHostClient.ts'
import { initializeEditLockSync } from './lib/editLockSync.ts'
import { initializeTeamReviewSync } from './lib/teamReviewSync.ts'
import { startAllRegisteredProjectChannels } from './lib/projectSyncClient.ts'
import { initializeBatonHandoffSnapshots } from './lib/batonHandoffSnapshot.ts'
import { installCrashReportCapture } from './lib/crashReportCapture.ts'
import { installCrashReportBroadcastListener } from './store/crashReportStore.ts'

installResizeObserverLoopErrorFilter()
installCrashReportCapture()
installCrashReportBroadcastListener()

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary className="min-h-screen" level="root" title="Sloom Studio">
        <App />
        <AndroidLanServerBanner />
        <RemoteHostBanner />
      </ErrorBoundary>
    </StrictMode>,
  )
}

// Resolve "am I a desktop browser served from a phone?" before first render so the storage layers
// branch correctly from the start (no-ops instantly for desktop/native; one fast probe on the web).
// Register the cross-device edit baton once the probe has settled (so its served-session branch is
// accurate): unlike the per-workspace channels it gates every workspace, so it can't wait for one to
// mount. Idempotent + side-effect-light on a non-served desktop (memory: cross-device-sync-baton-model).
void initializeRemoteHostSession()
  .finally(() => {
    initializeEditLockSync()
    initializeTeamReviewSync()
    startAllRegisteredProjectChannels()
    // Snapshot dirty Image and Paper documents into the shared library the moment this device
    // loses the baton, so the gaining device can continue editable .slimg/.slppr work.
    initializeBatonHandoffSnapshots()
  })
  .finally(renderApp)
