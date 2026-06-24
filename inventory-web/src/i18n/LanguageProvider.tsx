import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
export type AdminLanguage = "ar" | "en" | "fa"
type TranslationDictionary = Record<string, string>

interface LanguageContextValue {
  language: AdminLanguage
  setLanguage: (language: AdminLanguage) => void
  direction: "rtl" | "ltr"
}

const LanguageContext = createContext<LanguageContextValue | null>(null)
const STORAGE_KEY = "inventory_admin_language"
const PUBLIC_PATHS = ["/catalog", "/shop", "/client/", "/stocktake/", "/display"]
const ARABIC_RUN = /[\u0600-\u06ff][\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\s،؛؟«»ـًٌٍَُِّْ\-–—:()/.+%0-9٠-٩]*/g
const HAS_ARABIC = /[\u0600-\u06ff]/
const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const

function storedLanguage(): AdminLanguage {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === "en" || value === "fa" ? value : "ar"
}

function isAdministrationPath() {
  const pathname = window.location.pathname
  return !PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path))
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function translateValue(value: string, dictionary: TranslationDictionary | null) {
  if (!dictionary || !HAS_ARABIC.test(value)) return value
  const exact = dictionary[normalized(value)]
  if (exact) {
    const leading = value.match(/^\s*/)?.[0] ?? ""
    const trailing = value.match(/\s*$/)?.[0] ?? ""
    return `${leading}${exact}${trailing}`
  }
  return value.replace(ARABIC_RUN, (segment) => {
    const key = normalized(segment)
    if (!key) return segment
    const translated = dictionary[key]
    if (!translated) return segment
    const leading = segment.match(/^\s*/)?.[0] ?? ""
    const trailing = segment.match(/\s*$/)?.[0] ?? ""
    return `${leading}${translated}${trailing}`
  })
}

function shouldIgnore(node: Node) {
  const parent = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return Boolean(parent?.closest(
    "script, style, code, pre, [data-i18n-ignore], [contenteditable='true'], .customer-document",
  ))
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AdminLanguage>(storedLanguage)
  const [dictionary, setDictionary] = useState<TranslationDictionary | null>(null)

  const setLanguage = useCallback((next: AdminLanguage) => {
    localStorage.setItem(STORAGE_KEY, next)
    setDictionary(null)
    setLanguageState(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (language === "ar") {
      setDictionary(null)
      return
    }
    void import("./generatedTranslations").then((module) => {
      if (cancelled) return
      setDictionary(language === "en" ? module.englishTranslations : module.persianTranslations)
    })
    return () => { cancelled = true }
  }, [language])

  useEffect(() => {
    // Arabic is the native language — no translation or DOM observer needed.
    if (language === "ar") return
    if (!dictionary) return
    const textSources = new WeakMap<Node, string>()
    const textLastApplied = new WeakMap<Node, string>()
    const attributeSources = new WeakMap<Element, Map<string, string>>()
    const attributeLastApplied = new WeakMap<Element, Map<string, string>>()

    const applyText = (node: Node, forceRestore = false) => {
      if (node.nodeType !== Node.TEXT_NODE || shouldIgnore(node)) return
      const current = node.nodeValue ?? ""
      if (!current.trim()) return
      const lastApplied = textLastApplied.get(node)
      if (current !== lastApplied && !textSources.has(node)) textSources.set(node, current)
      else if (current !== lastApplied && current !== textSources.get(node)) textSources.set(node, current)
      const source = textSources.get(node) ?? current
      const next = forceRestore || !isAdministrationPath() ? source : translateValue(source, dictionary)
      if (current !== next) {
        textLastApplied.set(node, next)
        node.nodeValue = next
      }
    }

    const applyAttributes = (element: Element, forceRestore = false) => {
      if (shouldIgnore(element)) return
      const sources = attributeSources.get(element) ?? new Map<string, string>()
      const applied = attributeLastApplied.get(element) ?? new Map<string, string>()
      for (const attribute of TRANSLATED_ATTRIBUTES) {
        const current = element.getAttribute(attribute)
        if (!current) continue
        if (current !== applied.get(attribute) && current !== sources.get(attribute)) sources.set(attribute, current)
        const source = sources.get(attribute) ?? current
        const next = forceRestore || !isAdministrationPath() ? source : translateValue(source, dictionary)
        if (current !== next) {
          applied.set(attribute, next)
          element.setAttribute(attribute, next)
        }
      }
      attributeSources.set(element, sources)
      attributeLastApplied.set(element, applied)
    }

    const walk = (root: Node, forceRestore = false) => {
      if (shouldIgnore(root)) return
      applyText(root, forceRestore)
      if (root.nodeType === Node.ELEMENT_NODE) applyAttributes(root as Element, forceRestore)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        applyText(node, forceRestore)
        if (node.nodeType === Node.ELEMENT_NODE) applyAttributes(node as Element, forceRestore)
        node = walker.nextNode()
      }
    }

    const applyDocumentLocale = (forceArabic = false) => {
      const activeLanguage = forceArabic || !isAdministrationPath() ? "ar" : language
      document.documentElement.lang = activeLanguage
      document.documentElement.dir = activeLanguage === "en" ? "ltr" : "rtl"
      document.documentElement.dataset.adminLanguage = language
    }

    applyDocumentLocale()
    walk(document.documentElement)

    const observer = new MutationObserver((mutations) => {
      applyDocumentLocale()
      for (const mutation of mutations) {
        if (mutation.type === "characterData") applyText(mutation.target)
        if (mutation.type === "attributes") applyAttributes(mutation.target as Element)
        for (const node of mutation.addedNodes) walk(node)
      }
    })
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATED_ATTRIBUTES],
    })

    const restoreForPrint = () => {
      applyDocumentLocale(true)
      walk(document.documentElement, true)
    }
    const reapplyAfterPrint = () => {
      applyDocumentLocale()
      walk(document.documentElement)
    }
    window.addEventListener("beforeprint", restoreForPrint)
    window.addEventListener("afterprint", reapplyAfterPrint)
    return () => {
      observer.disconnect()
      window.removeEventListener("beforeprint", restoreForPrint)
      window.removeEventListener("afterprint", reapplyAfterPrint)
      walk(document.documentElement, true)
    }
  }, [language, dictionary])

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    direction: language === "en" ? "ltr" : "rtl",
  }), [language, setLanguage])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider")
  return context
}
