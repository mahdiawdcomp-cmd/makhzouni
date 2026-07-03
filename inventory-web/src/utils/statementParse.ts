// Client-side parser for the OLD accounting-system account statement.
//
// IMPORTANT: the uploaded PDF/Excel file is read ENTIRELY in the browser here
// and is never uploaded to the server, never written to the repo, never
// committed. Only the extracted rows (name + balance) leave this module, and
// only after the user reviews them.

export interface ParsedRow {
  name: string
  phone?: string
  amount: number
  /** Old-system customer code, if the file has one. */
  oldCode?: string
  /** Free-text notes from the old statement, if any. */
  notes?: string
  /** The original text line / cell values — shown so the user can verify. */
  raw: string
}

export interface ParseResult {
  rows: ParsedRow[]
  /** Total candidate lines seen (for the "read N lines" report). */
  totalLines: number
  source: "pdf" | "excel"
}

// Normalize Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII 0-9.
function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

// Pull the balance number out of a text line. Accounting statements usually
// place the running balance as the LAST numeric column, so we take the last
// number token by default. Handles thousands separators and a trailing/leading
// minus. Returns null when there is no number at all.
function extractAmount(line: string): number | null {
  const norm = normalizeDigits(line)
  const matches = norm.match(/-?\d[\d,]*(?:\.\d+)?-?/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  let cleaned = last.replace(/,/g, "")
  // Trailing minus (accounting "credit" notation) → negative.
  if (/-$/.test(cleaned)) cleaned = "-" + cleaned.replace(/-/g, "")
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// Best-effort customer name: the line with all number tokens and common
// separators stripped away.
function extractName(line: string): string {
  return normalizeDigits(line)
    .replace(/-?\d[\d,]*(?:\.\d+)?-?/g, " ")
    .replace(/[|\t؛;:]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

async function parsePdf(file: File): Promise<ParseResult> {
  const pdfjs = await import("pdfjs-dist")
  // Vite resolves the worker URL at build time.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise

  const rawLines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // Group text items into visual lines by their Y position.
    const byY = new Map<number, { x: number; str: string }[]>()
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      if (!item.str) continue
      const y = Math.round(item.transform[5])
      const x = item.transform[4]
      const bucket = byY.get(y) ?? []
      bucket.push({ x, str: item.str })
      byY.set(y, bucket)
    }
    const ys = [...byY.keys()].sort((a, b) => b - a) // top-to-bottom
    for (const y of ys) {
      const parts = byY.get(y)!.sort((a, b) => a.x - b.x) // left-to-right
      const line = parts.map((p) => p.str).join(" ").replace(/\s{2,}/g, " ").trim()
      if (line) rawLines.push(line)
    }
  }

  const rows: ParsedRow[] = []
  for (const line of rawLines) {
    const amount = extractAmount(line)
    const name = extractName(line)
    if (amount === null || !name) continue
    rows.push({ name, amount, raw: line })
  }
  return { rows, totalLines: rawLines.length, source: "pdf" }
}

async function parseExcel(file: File): Promise<ParseResult> {
  const XLSX = await import("xlsx")
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" })

  // Try to find a header row that names the columns.
  let nameIdx = -1
  let amountIdx = -1
  let phoneIdx = -1
  let codeIdx = -1
  let notesIdx = -1
  let headerRow = -1
  const isName = (s: string) => /old_name|الاسم|اسم|name|الزبون|العميل|account|الحساب/i.test(s)
  const isAmount = (s: string) => /debit|الرصيد|رصيد|balance|المبلغ|مبلغ|debt|دين|مدين/i.test(s)
  const isPhone = (s: string) => /هاتف|جوال|موبايل|phone|mobile|tel/i.test(s)
  const isCode = (s: string) => /old_code|الكود|كود|code|رقم قديم|رقم الحساب/i.test(s)
  const isNotes = (s: string) => /notes|ملاحظات|ملاحظة|بيان/i.test(s)

  for (let r = 0; r < Math.min(aoa.length, 10); r++) {
    const cells = (aoa[r] ?? []).map((c) => String(c ?? "").trim())
    const nI = cells.findIndex(isName)
    const aI = cells.findIndex(isAmount)
    if (nI !== -1 && aI !== -1) {
      nameIdx = nI
      amountIdx = aI
      phoneIdx = cells.findIndex(isPhone)
      codeIdx = cells.findIndex(isCode)
      notesIdx = cells.findIndex(isNotes)
      headerRow = r
      break
    }
  }

  const rows: ParsedRow[] = []
  let totalLines = 0
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const cells = (aoa[r] ?? []).map((c) => String(c ?? "").trim())
    if (cells.every((c) => !c)) continue
    totalLines++
    const raw = cells.filter(Boolean).join(" | ")

    let name = ""
    let amount: number | null = null
    let phone: string | undefined
    let oldCode: string | undefined
    let notes: string | undefined

    if (nameIdx !== -1 && amountIdx !== -1) {
      name = cells[nameIdx] ?? ""
      amount = extractAmount(cells[amountIdx] ?? "")
      if (phoneIdx !== -1 && cells[phoneIdx]) phone = cells[phoneIdx]
      if (codeIdx !== -1 && cells[codeIdx]) oldCode = cells[codeIdx]
      if (notesIdx !== -1 && cells[notesIdx]) notes = cells[notesIdx]
    } else {
      // No headers: first text cell = name, last numeric cell = amount.
      name = cells.find((c) => c && extractAmount(c) === null) ?? ""
      for (const c of cells) {
        const a = extractAmount(c)
        if (a !== null) amount = a
      }
    }

    if (!name || amount === null) continue
    rows.push({ name, amount, phone, oldCode, notes, raw })
  }
  return { rows, totalLines, source: "excel" }
}

export async function parseStatementFile(file: File): Promise<ParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "pdf" || file.type === "application/pdf") return parsePdf(file)
  if (["xlsx", "xls", "csv"].includes(ext)) return parseExcel(file)
  // Fallback by mime.
  if (file.type.includes("sheet") || file.type.includes("csv")) return parseExcel(file)
  throw new Error("صيغة غير مدعومة. ارفع PDF أو Excel/CSV")
}
