import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MessageSquarePlus } from "lucide-react"
import { getSettings, updateSettings } from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { toast } from "./ui/use-toast"

/** Mirrors the backend defaults so the shop sees what is actually in effect. */
const DEFAULT_INVITE_KEYWORDS = ["حسابي", "اريد حسابي", "أريد حسابي", "نعم اريد حسابي", "اريد حساب"]

const DEFAULT_INVITE_MESSAGE =
  "مرحباً {{customerName}} 👋\n" +
  "هذا متجر {{storeName}} الإلكتروني — تكدر تتصفح كل المنتجات والأسعار منه.\n\n" +
  "حتى نفتحلك حسابك، رد على هذي الرسالة بكلمة:\n" +
  "حسابي\n\n" +
  "ونرسللك اسم الدخول والرمز فوراً."

/**
 * «دعوة الحساب» — the text of the cold invite, and the words that count as a
 * reply to it.
 *
 * Meta approves no template carrying a login code, so credentials cannot be
 * pushed to a number that has not messaged us. The invite asks for a reply,
 * and the reply is what opens the 24-hour window the credentials travel in.
 */
export function StorefrontInviteCard() {
  const qc = useQueryClient()
  const [messageDraft, setMessageDraft] = useState<string | null>(null)
  const [wordsDraft, setWordsDraft] = useState<string | null>(null)

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const savedMessage = settingsQuery.data?.storefrontInviteMessage ?? ""
  const savedWords = settingsQuery.data?.storefrontInviteKeywords ?? []

  const message = messageDraft ?? (savedMessage || DEFAULT_INVITE_MESSAGE)
  const words = wordsDraft ?? (savedWords.length ? savedWords : DEFAULT_INVITE_KEYWORDS).join("، ")
  const dirty = messageDraft !== null || wordsDraft !== null

  const saveMut = useMutation({
    mutationFn: () => updateSettings({
      storefrontInviteMessage: message.trim(),
      storefrontInviteKeywords: words
        .split(/[،,\n]+/)
        .map((w) => w.trim())
        .filter(Boolean),
    }),
    onSuccess: () => {
      toast({ title: "تم حفظ نص الدعوة" })
      setMessageDraft(null)
      setWordsDraft(null)
      void qc.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquarePlus className="h-5 w-5 text-emerald-600" />
          نص دعوة الحساب
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          هذي الرسالة تنرسل للزبون الي ما راسلك من قبل. لمن يرد بوحدة من الكلمات تحت، يوصله
          اسم الدخول والرمز فوراً. استخدم
          {" "}<code className="font-mono">{"{{customerName}}"}</code> و
          {" "}<code className="font-mono">{"{{storeName}}"}</code> داخل النص.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600">نص الدعوة</label>
          <textarea
            value={message}
            onChange={(e) => setMessageDraft(e.target.value)}
            rows={8}
            className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600">كلمات الرد (مفصولة بفاصلة)</label>
          <textarea
            value={words}
            onChange={(e) => setWordsDraft(e.target.value)}
            rows={2}
            dir="rtl"
            className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-emerald-500"
          />
          <p className="text-[11px] text-slate-500">
            المطابقة تامة، مو جزئية — الزبون الي يكتب الكلمة داخل جملة ما ينحسب، حتى ما ينولّد
            له رمز جديد بالغلط. إذا حطيت أزرار رد سريع على القالب بميتا، ضيف نص الزر هنا حرفياً.
          </p>
        </div>

        <Button
          size="sm"
          className="w-full"
          disabled={!dirty || saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? "جاري الحفظ..." : "حفظ"}
        </Button>
      </CardContent>
    </Card>
  )
}
