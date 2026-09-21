/**
 * Reading the rep's position at the moment they do something.
 *
 * WHAT THIS IS NOT: a tracker. There is no `watchPosition` anywhere in this
 * file and no timer. The browser is asked exactly once, when the rep sends an
 * order, writes a receipt, opens a visit or adds a customer, and then forgotten
 * until the next one. Nothing runs while the app sits in a pocket.
 *
 * Three rules this module exists to keep:
 *
 *  1. A reading NEVER blocks the sale. Every failure — refused, unavailable,
 *     too slow — resolves to a value that says why, and the caller carries on.
 *  2. The reason is carried, not swallowed. «رفض» and «ما وصل» mean different
 *     things about the rep, and the owner's report must be able to tell them
 *     apart.
 *  3. `capturedAt` travels with the reading. An offline cart is filled inside
 *     the shop and sent from wherever signal returns, sometimes an hour later.
 *     Reading the position at SEND time would put an honest rep at home.
 */

export type AgentLocationStatus = "OK" | "DENIED" | "UNAVAILABLE" | "TIMEOUT"

export type AgentLocation = {
  latitude?: number
  longitude?: number
  /** The browser's own error radius, metres. Absent when there is no fix. */
  accuracyM?: number
  status: AgentLocationStatus
  /** When the POSITION was read, ms epoch — not when it was sent. */
  capturedAt: number
}

/**
 * How long to hold the rep up waiting for a fix.
 *
 * Eight seconds is long enough for a phone that has been indoors to settle, and
 * short enough that a rep with the shopkeeper in front of them does not think
 * the app has frozen. Past it the action goes through with `TIMEOUT` recorded.
 */
const FIX_TIMEOUT_MS = 8_000

/**
 * A cached fix may stand in for a fresh one for this long.
 *
 * Two minutes: the rep has not left the shop in that time, and re-reading the
 * GPS for every line of a five-line order would drain the battery for no new
 * information.
 */
const MAX_CACHE_AGE_MS = 120_000

/** A refusal is permanent until the rep changes it in browser settings. */
function deniedNow(): AgentLocation {
  return { status: "DENIED", capturedAt: Date.now() }
}

/**
 * Read the position once.
 *
 * Always resolves — never rejects. A caller that has to handle an exception
 * here would eventually be written to abandon the action, which is exactly the
 * outcome this whole design refuses.
 */
export function readAgentLocation(timeoutMs = FIX_TIMEOUT_MS): Promise<AgentLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ status: "UNAVAILABLE", capturedAt: Date.now() })
  }

  return new Promise<AgentLocation>((resolve) => {
    // The browser can hang past its own timeout on some Android builds, so the
    // promise is settled from this side too. `settled` keeps whichever answer
    // arrives first and ignores the other.
    let settled = false
    const finish = (value: AgentLocation) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timer = setTimeout(
      () => finish({ status: "TIMEOUT", capturedAt: Date.now() }),
      timeoutMs + 500,
    )

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer)
        finish({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : undefined,
          status: "OK",
          // The device's own timestamp, which is when the FIX was taken. A
          // cached fix is a minute old and says so, rather than claiming now.
          capturedAt: position.timestamp || Date.now(),
        })
      },
      (error) => {
        clearTimeout(timer)
        if (error.code === error.PERMISSION_DENIED) return finish(deniedNow())
        if (error.code === error.TIMEOUT) {
          return finish({ status: "TIMEOUT", capturedAt: Date.now() })
        }
        finish({ status: "UNAVAILABLE", capturedAt: Date.now() })
      },
      {
        // High accuracy matters here: a 2 km network fix cannot tell «at the
        // shop» from «at home», which is the only question being asked.
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: MAX_CACHE_AGE_MS,
      },
    )
  })
}

/** Did this reading actually produce a position? */
export function hasFix(location: AgentLocation | null | undefined): boolean {
  return Boolean(
    location &&
      location.status === "OK" &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude),
  )
}

/**
 * Metres between two points. Haversine — the same formula the server uses, so
 * the number the rep is shown is the number the report will hold.
 */
export function distanceMetres(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))))
}

/** «150 م» / «2.4 كم» — a distance a rep reads at a glance. */
export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "—"
  if (metres < 1000) return `${Math.round(metres)} م`
  return `${(metres / 1000).toFixed(1)} كم`
}

/**
 * What to tell the rep about their own reading, before they act on it.
 *
 * Deliberately not an accusation. The rep is the first person to see this, and
 * a reading that is merely vague says so rather than implying they are lying:
 * `tone` is "bad" only when the position is genuinely far from the shop AND the
 * fix was precise enough for that to mean something.
 */
export function locationNote(
  location: AgentLocation | null | undefined,
  distanceM: number | null | undefined,
): { text: string; tone: "ok" | "wait" | "bad" } | null {
  if (!location) return null
  if (location.status === "DENIED") {
    return { text: "الموقع مرفوض — فعّله حتى يثبت إنك بالمحل", tone: "wait" }
  }
  if (location.status === "TIMEOUT" || location.status === "UNAVAILABLE") {
    return { text: "ما وصل الموقع — الطلب ينرسل عادي", tone: "wait" }
  }
  // A fix worse than 200 m cannot distinguish one shop from the next street, so
  // no distance claim is made from it at all.
  if (location.accuracyM != null && location.accuracyM > 200) {
    return { text: "الموقع تقريبي — الإشارة ضعيفة", tone: "wait" }
  }
  if (distanceM == null) return { text: "موقعك انسجل", tone: "ok" }
  if (distanceM <= 300) {
    return { text: `أنت على بعد ${formatDistance(distanceM)} من المحل`, tone: "ok" }
  }
  return { text: `أنت على بعد ${formatDistance(distanceM)} من المحل`, tone: "bad" }
}
