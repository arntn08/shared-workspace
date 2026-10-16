import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Activity() {
  const [rows, setRows] = useState<any[]>([])

  useEffect(() => {
    supabase
      .from('audit_logs')
      .select('id,action,detail,created_at,profiles(email)')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setRows(data ?? []))
  }, [])

  return (
    <>
      <h1>Activity</h1>
      <p className="muted">The latest 100 sign-ins, file views, and admin actions.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.profiles?.email ?? 'unknown'}</td>
                <td>{String(r.action).replace(/_/g, ' ')}</td>
                <td>{r.detail?.title ?? r.detail?.email ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
