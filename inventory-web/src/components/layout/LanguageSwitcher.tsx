import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Languages } from "lucide-react"
import { useLanguage, type AdminLanguage } from "../../i18n/LanguageProvider"

const languages: Array<{ id: AdminLanguage; label: string; short: string }> = [
  { id: "ar", label: "العربية", short: "ع" },
  { id: "en", label: "English", short: "EN" },
  { id: "fa", label: "فارسی", short: "فا" },
]

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage()
  const [open, setOpen] = useState(false)
  const current = languages.find((item) => item.id === language) ?? languages[0]

  return (
    <div className="relative" data-i18n-ignore>
      <motion.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        className="flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-1.5 transition"
        style={{ color: "var(--theme-textSecondary)" }}
        aria-label="Language"
        title="Language"
      >
        <Languages className="h-4 w-4" />
        <span className="text-[10px] font-bold">{current.short}</span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            className="absolute end-0 top-full z-50 mt-2 w-36 rounded-lg border p-1 shadow-xl"
            style={{ background: "var(--theme-cardBg)", borderColor: "var(--theme-cardBorder)" }}
          >
            {languages.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setLanguage(item.id)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition hover:bg-[var(--theme-accentSoft)]"
                style={{ color: item.id === language ? "var(--theme-accent)" : "var(--theme-textPrimary)" }}
              >
                <span>{item.label}</span>
                {item.id === language && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
