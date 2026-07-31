import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { RTLProvider } from "./components/RTLProvider"
import { ThemeProvider } from "./theme/ThemeProvider"
import { RealtimeSyncBridge } from "./components/RealtimeSyncBridge"
import { Toaster } from "./components/ui/toaster"
import { ErrorBoundary } from "./components/ErrorBoundary"
import App from "./App"
import "./index.css"
import "virtual:pwa-register"
import { configureTenantApi } from "./api/client"
import { LanguageProvider } from "./i18n/LanguageProvider"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Transient failures (backend restart mid-deploy, flaky network, gateway
      // hiccup) auto-heal with 3 backoff retries instead of leaving an empty
      // page the user has to refresh manually. 4xx errors are permanent — skip.
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status
        if (status && status >= 400 && status < 500) return false
        return failureCount < 3
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      // SSE realtime bridge handles cross-tab invalidation — window focus refetch is redundant
      refetchOnWindowFocus: false,
      // NO global refetchInterval. It is not gated by staleTime, so it applied
      // to every query including useProducts (limit 5000, ~4.75 MB) — each open
      // tab re-downloaded the entire catalogue every two minutes, per user,
      // silently defeating the caching the hook was written to provide. The SSE
      // bridge already delivers instant updates; the few queries that genuinely
      // need polling set their own interval.
      // Show cached data instantly for 5 minutes — avoids loading spinners on every page switch
      staleTime: 300_000,
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
      <QueryClientProvider client={queryClient}>
        <RealtimeSyncBridge />
        <ThemeProvider>
          <LanguageProvider>
            <RTLProvider>
              {/* Outermost boundary. AppLayout has one, but it only covers the
                  sidebar+header shell — a throw in LoginPage, PosPage, the
                  public catalog, the client portal or in AppLayout itself
                  white-screened the app with no recovery. It also carries the
                  stale-chunk auto-reload, so a mid-deploy chunk failure on the
                  cashier station now self-heals instead of hard-breaking. */}
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
              <Toaster />
            </RTLProvider>
          </LanguageProvider>
        </ThemeProvider>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />}
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
