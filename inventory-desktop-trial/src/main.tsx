import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { RTLProvider } from "./components/RTLProvider"
import { ThemeProvider } from "./theme/ThemeProvider"
import { RealtimeSyncBridge } from "./components/RealtimeSyncBridge"
import App from "./App"
import "./index.css"
import { LanguageProvider } from "./i18n/LanguageProvider"
import { DesktopTrialGate } from "./DesktopTrialGate"
import "./desktop-trial.css"
import { api } from "./api/client"
import { idbPersister } from "./lib/offline-store"
import { UpdateChecker } from "./components/UpdateChecker"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchInterval: 120_000,
      // Keep data 5 min before stale — shows instantly from cache
      staleTime: 5 * 60 * 1000,
      // Keep cache 24h in IndexedDB
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
})

// Load saved server URL on startup
const savedServer = localStorage.getItem("makhzouni_server_url")
if (savedServer) {
  api.defaults.baseURL = savedServer
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopTrialGate>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: idbPersister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: "v1",
        }}
      >
        <RealtimeSyncBridge />
        <ThemeProvider>
          <LanguageProvider>
            <RTLProvider>
              <App />
              <UpdateChecker />
            </RTLProvider>
          </LanguageProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </DesktopTrialGate>
  </StrictMode>,
)
