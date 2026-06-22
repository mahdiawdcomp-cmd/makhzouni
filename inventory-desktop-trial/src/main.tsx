import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { RTLProvider } from "./components/RTLProvider"
import { ThemeProvider } from "./theme/ThemeProvider"
import { RealtimeSyncBridge } from "./components/RealtimeSyncBridge"
import App from "./App"
import "./index.css"
import { configureTenantApi } from "./api/client"
import { LanguageProvider } from "./i18n/LanguageProvider"
import { DesktopTrialGate } from "./DesktopTrialGate"
import "./desktop-trial.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Re-fetch when the user switches back to the tab (catches updates from other open tabs)
      refetchOnWindowFocus: true,
      // Auto-refresh every 30 seconds in the background
      refetchInterval: 30_000,
      // Keep data for 15 seconds before considering it stale
      staleTime: 15_000,
    },
  },
})

// Multi-tenant routing: configureTenantApi resolves each subdomain to its own backend.
async function bootstrap() {
  try {
    await configureTenantApi()
  } catch {
    document.getElementById("root")!.innerHTML = `
      <main dir="rtl" style="min-height:100vh;display:grid;place-items:center;background:#f8fafc;font-family:system-ui">
        <section style="max-width:440px;padding:28px;text-align:center;background:white;border:1px solid #e2e8f0;border-radius:8px">
          <h1 style="font-size:20px;margin:0 0 8px">تعذر فتح رابط المحل</h1>
          <p style="color:#64748b;margin:0">الرابط غير مسجل أو خدمة الإدارة غير متاحة حالياً. تحقق من الرابط وحاول مرة أخرى.</p>
        </section>
      </main>`
    return
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
          {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />}
        </QueryClientProvider>
      </DesktopTrialGate>
    </StrictMode>,
  )
}

void bootstrap()
