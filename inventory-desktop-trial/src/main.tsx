import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RTLProvider } from "./components/RTLProvider"
import { ThemeProvider } from "./theme/ThemeProvider"
import { RealtimeSyncBridge } from "./components/RealtimeSyncBridge"
import App from "./App"
import "./index.css"
import { LanguageProvider } from "./i18n/LanguageProvider"
import { DesktopTrialGate } from "./DesktopTrialGate"
import "./desktop-trial.css"
import { api } from "./api/client"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchInterval: 120_000,
      staleTime: 300_000,
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
      <QueryClientProvider client={queryClient}>
        <RealtimeSyncBridge />
        <ThemeProvider>
          <LanguageProvider>
            <RTLProvider>
              <App />
            </RTLProvider>
          </LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </DesktopTrialGate>
  </StrictMode>,
)
