const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const MDY = new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, 'i')
const DMY = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\.?(?:,?\\s+(20\\d{2}))?\\b`, 'i')

export interface ParsedDate {
  month: number
  day: number
  year: number | null
}

const monthIndex = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3).toLowerCase())) + 1
const daysIn = (month: number, year: number | null) => new Date(year ?? 2024, month, 0).getDate()

/** Finds "October 23", "Oct 23, 2026" or "23 October 2026". The year stays null when the text has none. */
export function parseDate(text: string): ParsedDate | null {
  let month = 0
  let day = 0
  let year: number | null = null
  const a = MDY.exec(text)
  if (a) {
    month = monthIndex(a[1])
    day = Number(a[2])
    year = a[3] ? Number(a[3]) : null
  } else {
    const b = DMY.exec(text)
    if (!b) return null
    day = Number(b[1])
    month = monthIndex(b[2])
    year = b[3] ? Number(b[3]) : null
  }
  if (!month || day < 1 || day > daysIn(month, year)) return null
  return { month, day, year }
}

export function toIso(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function prettyDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
