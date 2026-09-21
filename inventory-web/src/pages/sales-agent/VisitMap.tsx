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
  picking,
  picked,
  onPickPoint,
  center,
}: {
  pins: MapPin[]
  onPick: (customerId: string) => void
  /** Turns the map into a point picker: a tap drops the shop marker. */
  picking?: boolean
  /** The point currently chosen, drawn in the accent colour. */
  picked?: { lat: number; lng: number } | null
  onPickPoint?: (point: { lat: number; lng: number }) => void
  /** Where to open when there is nothing to fit — the shop's own city. */
  center?: [number, number] | null
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

  // Same reason as `pick`: the tap handler is attached to the map ONCE, and
  // reads the current callback through a ref. Re-attaching it on every render
  // would stack listeners and fire a single tap several times.
  const pickPoint = useRef(onPickPoint)
  const pickingRef = useRef(picking)
  useEffect(() => {
    pickPoint.current = onPickPoint
    pickingRef.current = picking
  }, [onPickPoint, picking])
  const pickedMarker = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!host.current || map.current) return
    const instance = L.map(host.current, {
      center: center ?? FALLBACK_CENTER,
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
    // Attached unconditionally and gated by the ref: adding and removing the
    // listener as `picking` flips would drop a tap that lands mid-render.
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (!pickingRef.current) return
      pickPoint.current?.({ lat: event.latlng.lat, lng: event.latlng.lng })
    })
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
    // While picking, the rep is aiming at a spot — refitting the view under
    // their finger would move the map out from under the tap they are about
    // to make.
    if (pickingRef.current) return
    if (points.length === 1) instance.setView(points[0], 15)
    else if (points.length > 1) instance.fitBounds(L.latLngBounds(points), { padding: [32, 32] })
  }, [pins])

  // The chosen point lives on the map itself, not in the pin layer: the pin
  // layer is cleared and rebuilt whenever the customer list changes, which
  // would wipe the marker the rep just dropped.
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    pickedMarker.current?.remove()
    pickedMarker.current = null
    if (!picked) return
    pickedMarker.current = L.marker([picked.lat, picked.lng], {
      icon: L.divIcon({
        className: "",
        html: `<span style="display:block;width:22px;height:22px;border-radius:9999px;border:4px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);background:#4338ca"></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    })
      .addTo(instance)
      .bindTooltip("موقع المحل", { direction: "top" })
    instance.setView([picked.lat, picked.lng], Math.max(instance.getZoom(), 16))
  }, [picked])

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
