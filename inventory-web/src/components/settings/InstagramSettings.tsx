import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Link2, Loader2, RefreshCw, Unlink } from "lucide-react"
import { Instagram } from "../instagram/InstagramIcon"
import {
  checkInstagramAccount,
  connectInstagramManual,
  disconnectInstagramAccount,
  getInstagramAccounts,
  getInstagramAppConfig,
  getInstagramOauthUrl,
  saveInstagramAppConfig,
} from "../../api/endpoints"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { toast } from "../ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"

// ربط حسابات انستغرام (Phases 1–2). Mirrors the WhatsApp Cloud connection UX:
// per-tenant credentials in the DB, manual-token path always available (needed
// before Meta App Review approval), OAuth path once the Meta app is live.

export function InstagramSettings() {
  const qc = useQueryClient()
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ["ig-accounts"], queryFn: getInstagramAccounts })
  const { data: appConfig } = useQuery({ queryKey: ["ig-app-config"], queryFn: getInstagramAppConfig })

  const [appId, setAppId] = useState("")
  const [appSecret, setAppSecret] = useState("")
  const [manualToken, setManualToken] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { if (appConfig) setAppId(appConfig.appId) }, [appConfig])

  // Surface OAuth redirect result (?igconnect=ok|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get("igconnect")
    if (!result) return
    if (result === "ok") toast({ title: "✓ تم ربط حساب انستغرام بنجاح" })
    else toast({ title: "فشل ربط الحساب", description: decodeURIComponent(params.get("igerror") ?? ""), variant: "destructive" })
    params.delete("igconnect"); params.delete("igerror")
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`)
    void qc.invalidateQueries({ queryKey: ["ig-accounts"] })
  }, [qc])

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["ig-accounts"] })

  async function saveApp() {
    setBusy("app")
    try {
      await saveInstagramAppConfig({ appId, appSecret: appSecret || undefined })
      setAppSecret("")
      toast({ title: "✓ انحفظ إعداد تطبيق ميتا" })
      void qc.invalidateQueries({ queryKey: ["ig-app-config"] })
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  async function connectOauth() {
    setBusy("oauth")
    try {
      const url = await getInstagramOauthUrl(`${window.location.origin}/settings`)
      window.location.href = url
    } catch (error) {
      toast({ title: apiErrorMessage(error), variant: "destructive" })
      setBusy(null)
    }
  }

  async function connectManual() {
    if (!manualToken.trim()) { toast({ title: "أدخل التوكن أولاً", variant: "destructive" }); return }
    setBusy("manual")
    try {
      const connected = await connectInstagramManual(manualToken.trim())
      setManualToken("")
      toast({ title: `✓ انربط ${connected.length} حساب`, description: connected.map((a) => `@${a.username}`).join("، ") })
      invalidate()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Instagram className="h-5 w-5 text-pink-600" />
        <h3 className="font-semibold">ربط انستغرام — النشر التلقائي للكتلوك</h3>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        <p className="font-medium">⚠️ متطلبات ميتا قبل ما يشتغل النشر الفعلي:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
          <li>صفحة فيسبوك بزنس + حساب انستغرام احترافي (Business/Creator) مربوط بيها</li>
          <li>توثيق البزنس + موافقة مراجعة التطبيق (App Review) على صلاحيات النشر</li>
          <li>هاي خطوات يدوية من حسابك بميتا — الربط هنا جاهز ويشتغل فوراً لحظة اكتمالها</li>
        </ul>
      </div>

      {/* Meta app credentials */}
      <Card>
        <CardContent className="space-y-2 p-3">
          <p className="text-sm font-medium">تطبيق ميتا (App ID / App Secret)</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="App ID" value={appId} onChange={(e) => setAppId(e.target.value)} dir="ltr" />
            <Input placeholder={appConfig?.hasAppSecret ? "App Secret (محفوظ — اتركه فارغ)" : "App Secret"} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} type="password" dir="ltr" />
            <Button onClick={() => void saveApp()} disabled={busy === "app"}>
              {busy === "app" ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Connect */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void connectOauth()} disabled={busy === "oauth"} className="bg-pink-600 hover:bg-pink-700">
          {busy === "oauth" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Link2 className="ml-1 h-4 w-4" />}
          ربط انستغرام (عبر فيسبوك)
        </Button>
        <span className="text-xs text-slate-400">أو</span>
        <div className="flex min-w-64 flex-1 gap-2">
          <Input placeholder="لصق Access Token يدوياً (للاختبار قبل موافقة ميتا)" value={manualToken} onChange={(e) => setManualToken(e.target.value)} dir="ltr" />
          <Button variant="outline" onClick={() => void connectManual()} disabled={busy === "manual"}>
            {busy === "manual" ? <Loader2 className="h-4 w-4 animate-spin" /> : "ربط"}
          </Button>
        </div>
      </div>

      {/* Accounts list */}
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                {account.profilePictureUrl
                  ? <img src={account.profilePictureUrl} className="h-10 w-10 rounded-full" />
                  : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-900/40"><Instagram className="h-5 w-5 text-pink-600" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">@{account.username} {account.name && <span className="text-xs text-slate-400">({account.name})</span>}</p>
                  <p className="text-xs text-slate-500">صفحة: {account.pageName ?? "—"}</p>
                  {account.status === "connected" && account.tokenExpiringSoon && (
                    <p className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3 w-3" /> التوكن قرب ينتهي — سوّي إعادة ربط</p>
                  )}
                  {account.status === "error" && (
                    <p className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3 w-3" /> {account.lastError ?? "مشكلة بالصلاحيات"}</p>
                  )}
                </div>
                <span className={account.status === "connected"
                  ? "flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300"}>
                  {account.status === "connected" ? <><CheckCircle2 className="h-3 w-3" /> مربوط</> : account.status === "error" ? "خطأ" : "مفصول"}
                </span>
                <Button size="sm" variant="outline" onClick={async () => {
                  setBusy(`check-${account.id}`)
                  try { await checkInstagramAccount(account.id); invalidate() }
                  catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
                  finally { setBusy(null) }
                }}>
                  {busy === `check-${account.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RefreshCw className="ml-1 h-3.5 w-3.5" /> فحص</>}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void connectOauth()}>إعادة الربط</Button>
                <Button size="sm" variant="outline" className="text-red-600" onClick={async () => {
                  if (!window.confirm(`فصل الحساب @${account.username}؟ المنشورات السابقة تبقى بالسجل وتكدر تعيد ربطه بأي وقت.`)) return
                  try {
                    await disconnectInstagramAccount(account.id)
                    invalidate()
                  } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
                }}>
                  <Unlink className="ml-1 h-3.5 w-3.5" /> فصل الحساب
                </Button>
              </CardContent>
            </Card>
          ))}
          {accounts.length === 0 && <p className="text-sm text-slate-500">ماكو حسابات مربوطة بعد</p>}
        </div>
      )}
    </div>
  )
}
