/**
 * The visit map: OpenStreetMap tiles through Leaflet. No API key, no paid
 * service, no account.
 *
 * Loaded lazily by `VisitsScreen` so a rep who never opens the map never
 * downloads the library. Leaflet's CSS is imported here for the same reason.
 *
 * Only the pins handed to it are drawn, and the caller only ever has this rep's
 * own customers — the map has no way to ask for anybody else's.
 */
import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

export type MapPin = {
  id: string
  name: string
  latitude: number
  longitude: number
  /** Coloured differently once a visit has been filed today. */
  visited: boolean
  /** On today's plan — a stop the rep is meant to make. */
  planned?: boolean
  distanceKm: number | null
}

/** Baghdad, used only when no pin has coordinates yet. */
const FALLBACK_CENTER: [number, number] = [33.3152, 44.3661]

/**
 * Three states, three colours: visited today (green), still on today's plan
 * (amber), and not planned (grey). A div marker instead of Leaflet's default
 * PNG, whose icon URLs break under a bundler.
 */
function pinIcon(pin: MapPin) {
  const colour = pin.visited ? "#059669" : pin.planned ? "#d97706" : "#64748b"
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);background:${colour}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

export default function VisitMap({
  pins,
  onPick,
}: {
  pins: MapPin[]
  onPick: (customerId: string) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  // The freshest callback, read at click time: re-creating every marker
  // whenever the parent re-renders would fight the map's own pan/zoom state.
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
  }, [onPick])

  useEffect(() => {
    if (!host.current || map.current) return
    const instance = L.map(host.current, {
      center: FALLBACK_CENTER,
      zoom: 12,
      // Touch first: a rep pans with a thumb, and scroll-wheel zoom on a
      // trackpad inside a scrolling page hijacks the page scroll.
      scrollWheelZoom: false,
      attributionControl: true,
    })
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(instance)
    layer.current = L.layerGroup().addTo(instance)
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
      layer.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    const group = layer.current
    if (!instance || !group) return
    group.clearLayers()
    const points: [number, number][] = []
    for (const p of pins) {
      const point: [number, number] = [p.latitude, p.longitude]
      points.push(point)
      const state = p.visited ? "تمت الزيارة" : p.planned ? "بخطة اليوم" : "خارج الخطة"
      L.marker(point, { icon: pinIcon(p), title: p.name, keyboard: true })
        .addTo(group)
        .bindTooltip(
          [p.name, state, p.distanceKm != null ? `${p.distanceKm} كم` : null].filter(Boolean).join(" · "),
          { direction: "top" },
        )
        .on("click", () => pick.current(p.id))
    }
    if (points.length === 1) instance.setView(points[0], 15)
    else if (points.length > 1) instance.fitBounds(L.latLngBounds(points), { padding: [32, 32] })
  }, [pins])

  return (
    <div
      ref={host}
      // Tall enough to be usable on a phone, capped so the list under it stays
      // reachable without scrolling past a full screen of map.
      className="h-[46dvh] w-full overflow-hidden rounded-xl border sm:h-[52dvh]"
      style={{ borderColor: "var(--theme-cardBorder)" }}
      role="application"
      aria-label="خريطة زبائني"
    />
  )
}
