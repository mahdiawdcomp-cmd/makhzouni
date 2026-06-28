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
import { useAuthStore } from "./store/authStore"

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

// The desktop is a thin client to the real backend (the same one the website
// proxies to). Migrate any stale saved server URL — old local-server sessions
// (localhost:5050) AND the wrong api.mazbwoni.com host — so requests don't hang.
const CLOUD_API = "https://inventory-backend-production-7e85.up.railway.app/api"
const savedServer = localStorage.getItem("makhzouni_server_url")
const isStaleServer =
  !savedServer ||
  savedServer.includes("localhost") ||
  savedServer.includes("127.0.0.1") ||
  savedServer.includes("api.mazbwoni.com")
if (isStaleServer) {
  // Reset to the correct backend and drop any stale token so the user logs in
  // fresh instead of getting stuck on dead/cross-server requests.
  localStorage.setItem("makhzouni_server_url", CLOUD_API)
  localStorage.removeItem("inventory_token")
  localStorage.removeItem("inventory_user")
  localStorage.removeItem("inventory_remember")
  useAuthStore.setState({ token: null, user: null })
  api.defaults.baseURL = CLOUD_API
} else {
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
