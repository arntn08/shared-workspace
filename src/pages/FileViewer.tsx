import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { FileRow } from '../types'

type Kind = 'blank' | 'title' | 'section' | 'head' | 'data'
interface Line {
  kind: Kind
  cells: string[]
}

const isFilled = (c: string) => c.trim() !== ''
const lastFilled = (cells: string[]) => {
  for (let i = cells.length - 1; i >= 0; i--) if (isFilled(cells[i])) return i
  return 0
}

function classify(rows: string[][]): Line[] {
  const out: Line[] = []
  let seenFirst = false
  let prev: Kind = 'blank'
  for (const raw of rows) {
    const cells = (Array.isArray(raw) ? raw : []).map((c) => String(c ?? ''))
    const filled = cells.filter(isFilled)
    let kind: Kind
    if (filled.length === 0) {
      kind = 'blank'
    } else if (filled.length === 1 && !/^[\d.,\s]+$/.test(filled[0])) {
      kind = !seenFirst ? 'title' : 'section'
    } else if (prev === 'section') {
      kind = 'head'
    } else {
      kind = 'data'
    }
    if (kind !== 'blank') {
      seenFirst = true
      prev = kind
    }
    out.push({ kind, cells })
  }
  return out
}

export default function FileViewer() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [file, setFile] = useState<FileRow | null>(null)
  const [tabs, setTabs] = useState<string[]>([])
  const [tab, setTab] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)

  async function fetchSheet(t: string) {
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.functions.invoke('read-sheet', {
      body: { fileId: id, tab: t || undefined }
    })
    if (error || !data || data.error) {
      setErr('Could not load this spreadsheet.')
      setBusy(false)
      return
    }
    setTabs(data.tabs)
    setTab(data.tab)
    setRows(data.rows)
    setBusy(false)
  }

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('files').select('*').eq('id', id).maybeSingle()
      setFile(data as FileRow | null)
      if (data && data.kind === 'gsheet') await fetchSheet('')
      else setBusy(false)
    })()
  }, [id])

  const lines = useMemo(() => classify(rows), [rows])
  const titleLine = lines.find((l) => l.kind === 'title')
  const titleText = titleLine ? titleLine.cells.find(isFilled)?.trim() : ''

  const query = q.trim().toLowerCase()
  const shown = useMemo(() => {
    const body = lines.filter((l) => l.kind !== 'blank' && l.kind !== 'title')
    const filtered = query ? body.filter((l) => l.cells.join(' ').toLowerCase().includes(query)) : body
    return filtered.slice(0, 3000)
  }, [lines, query])
  const width = Math.max(1, ...shown.map((l) => lastFilled(l.cells) + 1))

  const back = profile?.role === 'employee' ? '/' :
