import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RTLProvider } from "./components/RTLProvider"
import { ThemeProvider } from "./theme/ThemeProvider"
import App from "./App"
import "./index.css"
import "virtual:pwa-register"

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RTLProvider>
          <App />
        </RTLProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
