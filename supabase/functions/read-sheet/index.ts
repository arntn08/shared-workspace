import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://aarontanofficial.github.io'
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function b64url(input: ArrayBuffer | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  )
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${b64url(sig)}`
    })
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Google token failed')
  return data.access_token as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Not signed in' }, 401)

    // This client acts as the signed-in user, so database rules (RLS) decide access.
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }
    })
    const { data: u } = await supa.auth.getUser()
    if (!u.user) return json({ error: 'Not signed in' }, 401)

    const { fileId, tab } = await req.json()
    const { data: file } = await supa
      .from('files')
      .select('id,kind,sheet_id,title')
      .eq('id', fileId)
      .maybeSingle()
    if (!file || file.kind !== 'gsheet' || !file.sheet_id) return json({ error: 'File not available' }, 404)

    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const token = await googleToken(sa)
    const headers = { Authorization: `Bearer ${token}` }

    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${file.sheet_id}?fields=sheets.properties.title`,
      { headers }
    )
    if (!metaRes.ok) return json({ error: 'Spreadsheet not shared with the service account' }, 502)
    const meta = await metaRes.json()
    const tabs: string[] = (meta.sheets ?? []).map((s: any) => s.properties.title)
    const chosen = tabs.includes(tab) ? tab : tabs[0]

    const range = encodeURIComponent(`'${chosen.replace(/'/g, "''")}'`)
    const valRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${file.sheet_id}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      { headers }
    )
    if (!valRes.ok) return json({ error: 'Could not read sheet' }, 502)
    const vals = await valRes.json()

    await supa.from('audit_logs').insert({
      user_id: u.user.id,
      action: 'view_file',
      file_id: file.id,
      detail: { title: file.title, tab: chosen }
    })

    return json({ tabs, tab: chosen, rows: vals.values ?? [] })
  } catch (_e) {
    return json({ error: 'Server error' }, 500)
  }
})
