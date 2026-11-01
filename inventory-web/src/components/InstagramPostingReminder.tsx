import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { X } from "lucide-react"
import { getWholesaleInstagramPostingReminder } from "../api/endpoints"
import { Instagram } from "./instagram/InstagramIcon"

/**
 * Big pink strip for every employee: no wholesale Instagram post for 4+ days.
 * Hidden only until the next page load (sessionStorage), so it keeps
 * reminding until something is actually published.
 */
export function InstagramPostingReminder() {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("ig-posting-reminder-dismissed") === "1",
  )
  const query = useQuery({
    queryKey: ["wig-posting-reminder"],
    queryFn: getWholesaleInstagramPostingReminder,
    enabled: !dismissed,
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: 1,
  })

  const data = query.data
  if (dismissed || !data?.show) return null

  return (
    <div className="flex items-center gap-3 border-b-2 border-pink-300 bg-pink-50 px-4 py-3 text-pink-800 dark:border-pink-800 dark:bg-pink-950/50 dark:text-pink-100">
      <Instagram className="h-8 w-8 shrink-0 text-pink-600" />
      <div className="min-w-0">
        <p className="text-lg font-bold">
          {data.lastPublishedAt
            ? `صار لنا ${data.daysSince} يوم ما نشرنا بانستغرام الجملة`
            : "ما نشرنا ولا منشور بانستغرام الجملة"}
        </p>
        <p className="text-sm">
          انشروا منشور اليوم.{" "}
          <Link to="/wholesale-instagram" className="font-semibold underline">افتح إنستغرام الجملة واختار من الاقتراحات</Link>
        </p>
      </div>
      <button
        type="button"
        className="mr-auto rounded p-1 hover:bg-pink-100 dark:hover:bg-pink-900"
        aria-label="إخفاء التذكير"
        onClick={() => {
          sessionStorage.setItem("ig-posting-reminder-dismissed", "1")
          setDismissed(true)
        }}
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}
