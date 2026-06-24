import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes("dynamically imported module") ||
    msg.includes("failed to fetch") ||
    msg.includes("loading chunk") ||
    msg.includes("chunkloaderror") ||
    error.name === "ChunkLoadError"
  )
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: "" }
  }

  static getDerivedStateFromError(error: unknown): State {
    // Chunk load errors (stale JS after SW update) → auto reload immediately
    if (isChunkLoadError(error)) {
      window.location.reload()
      return { hasError: false, message: "" }
    }
    const message =
      error instanceof Error
        ? error.message
        : String(error ?? "خطأ غير معروف")
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    if (isChunkLoadError(error)) return
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div
          className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
          dir="rtl"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-3xl">
            ⚠️
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              حدث خطأ في تحميل هذه الصفحة
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {this.state.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, message: "" })
              window.location.reload()
            }}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
