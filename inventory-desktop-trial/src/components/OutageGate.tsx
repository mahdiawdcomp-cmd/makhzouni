import { useState, type ReactNode } from "react"
import { useBackendOutage } from "../hooks/useBackendOutage"
import { ServerOutageScreen } from "./ServerOutageScreen"

/**
 * Puts the rescue page above EVERYTHING, including the login screen.
 *
 * It has to sit here rather than inside App: when the server is down nobody
 * can sign in, so the desktop shows its login form and `App` never mounts at
 * all — which is precisely the person who most needs to be told what is
 * happening and what to do about it.
 */
export function OutageGate({ children }: { children: ReactNode }) {
  const outage = useBackendOutage()
  // Closing it is per-session on purpose: a wrong diagnosis must never be the
  // thing that stops the shop from using its own program.
  const [dismissed, setDismissed] = useState(false)

  if (outage.showRescue && !dismissed) {
    return (
      <ServerOutageScreen
        downForMs={outage.downForMs}
        offline={outage.offline}
        checking={outage.checking}
        onRetry={outage.recheck}
        onDismiss={() => setDismissed(true)}
      />
    )
  }

  return <>{children}</>
}
