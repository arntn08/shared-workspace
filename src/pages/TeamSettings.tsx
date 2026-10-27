import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Department = {
  id: string
  code: string
  name: string
  active: boolean
}

type Team = {
  id: string
  department_id: string
  code: string
  name: string
  active: boolean
}

const colors = {
  gold: '#93691f',
  goldLight: '#f4ead6',
  border: 'var(--border)',
  muted: 'var(--muted)',
  surface: 'var(--surface)',
  text: 'var(--text)'
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: `1px solid ${colors.border}`,
  borderRadius: '20px',
  padding: 'clamp(1rem, 2vw, 1.5rem)',
  marginBottom: '1rem',
  boxShadow: '0 8px 28px rgba(64, 48, 24, 0.035)'
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.45rem',
  minWidth: 0,
  fontWeight: 600,
  fontSize: '0.9rem'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '46px',
  boxSizing: 'border-box',
  borderRadius: '12px',
  border: `1px solid ${colors.border}`,
  padding: '0.75rem 0.9rem',
  background: 'var(--background, transparent)',
  color: 'var(--text)',
  font: 'inherit'
}

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid #93691f',
  borderRadius: '12px',
  padding: '0.75rem 1.1rem',
  background: '#93691f',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: '44px'
}

const secondaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: '10px',
  padding: '0.55rem 0.85rem',
  background: 'transparent',
  color: 'var(--text)',
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: '38px'
}

export default function TeamSettings() {
  const { profile } = useAuth()

  const canManage =
    profile?.active === true &&
    (profile.role === 'owner' || profile.role === 'editor')

  const [departments, setDepartments] = useState<Department[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [viewDepartmentId, setViewDepartmentId] = useState('all')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [departmentResult, teamResult] = await Promise.all([
      supabase
        .from('installation_departments')
        .select('id,code,name,active')
        .order('code'),
      supabase
        .from('installation_teams')
        .select('id,department_id,code,name,active')
        .order('code')
    ])

    if (departmentResult.error || teamResult.error) {
      setError(
        departmentResult.error?.message ||
        teamResult.error?.message ||
        'Unable to load departments and teams.'
      )
    } else {
      const nextDepartments = (departmentResult.data ?? []) as Department[]
      const nextTeams = (teamResult.data ?? []) as Team[]

      setDepartments(nextDepartments)
      setTeams(nextTeams)

      setDepartmentId(current => {
        if (current && nextDepartments.some(d => d.id === current && d.active)) {
          return current
        }

        return (
          nextDepartments.find(d => d.active && d.code === 'SLI')?.id ||
          nextDepartments.find(d => d.active)?.id ||
          nextDepartments[0]?.id ||
          ''
        )
      })

      setViewDepartmentId(current => {
        if (
          current !== 'all' &&
          !nextDepartments.some(d => d.id === current)
        ) {
          return 'all'
        }

        return current
      })
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setEditId(null)
    setCode('')
    setName('')
    setMessage('')
  }

  function startEdit(team: Team) {
    setEditId(team.id)
    setDepartmentId(team.department_id)
    setCode(team.code)
    setName(team.name)
    setError('')
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveTeam() {
    if (!canManage || saving) return

    const cleanCode = code.trim().toUpperCase()
    const cleanName = name.trim()
    const wasEditing = Boolean(editId)

    if (!departmentId || !cleanCode || !cleanName) {
      setError('Choose a department and enter both a team code and team name.')
      return
    }

    if (!/^[A-Z0-9_-]+$/.test(cleanCode)) {
      setError('Team codes can contain uppercase letters, numbers, hyphens, and underscores only.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    const payload = {
      department_id: departmentId,
      code: cleanCode,
      name: cleanName
    }

    const result = editId
      ? await supabase
          .from('installation_teams')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editId)
      : await supabase
          .from('installation_teams')
          .insert({ ...payload, active: true })

    setSaving(false)

    if (result.error) {
      setError(
        result.error.code === '23505'
          ? 'That team code already exists. Please use a unique code.'
          : result.error.message
      )
      return
    }

    resetForm()
    setMessage(wasEditing ? 'Team details saved successfully.' : 'New team added successfully.')
    await load()
  }

  async function toggleActive(team: Team) {
    if (!canManage || busyTeamId) return

    const nextActive = !team.active
    const action = nextActive ? 'activate' : 'deactivate'

    const confirmed = window.confirm(
      nextActive
        ? `Activate ${team.code}? It will appear in active team lists.`
        : `Deactivate ${team.code}? The team and its historical records will be preserved.`
    )

    if (!confirmed) return

    setBusyTeamId(team.id)
    setError('')
    setMessage('')

    const { error: updateError } = await supabase
      .from('installation_teams')
      .update({
        active: nextActive,
        updated_at: new Date().toISOString()
      })
      .eq('id', team.id)

    setBusyTeamId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setMessage(`${team.code} has been ${nextActive ? 'activated' : 'deactivated'}.`)
    await load()
  }

  const visibleDepartments = useMemo(() => {
    return departments.filter(department => {
      const matchesDepartment =
        viewDepartmentId === 'all' || department.id === viewDepartmentId
      const matchesStatus = showInactive || department.active

      return matchesDepartment && matchesStatus
    })
  }, [departments, viewDepartmentId, showInactive])

  const activeTeamCount = teams.filter(team => {
    const department = departments.find(d => d.id === team.department_id)

    return (
      team.active &&
      department?.active &&
      (viewDepartmentId === 'all' || team.department_id === viewDepartmentId)
    )
  }).length

  const inactiveTeamCount = teams.filter(team => {
    const department = departments.find(d => d.id === team.department_id)

    return (
      !team.active &&
      (viewDepartmentId === 'all' || team.department_id === viewDepartmentId)
    )
  }).length

  const activeDepartmentCount = departments.filter(d => d.active).length

  const selectedDepartment = departments.find(d => d.id === viewDepartmentId)

  return (
    <section style={{ maxWidth: '1500px', margin: '0 auto', paddingBottom: '2rem' }}>
      <div
        className="page-head"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '1.5rem'
        }}
      >
        <div>
          <div
            style={{
              color: colors.gold,
              fontSize: '0.76rem',
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: '0.55rem'
            }}
          >
            Operations / Management
          </div>
          <h1 style={{ margin: '0 0 0.45rem', fontSize: 'clamp(2rem, 3vw, 2.7rem)', lineHeight: 1.12 }}>
            Team Settings
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: '1rem' }}>
            Manage departments, maintain team codes, and control which teams are active.
          </p>
        </div>

        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: '14px',
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            background: 'var(--surface)'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '9px',
              height: '9px',
              background: '#38a169',
              borderRadius: '50%',
              boxShadow: '0 0 0 4px rgba(56,161,105,.12)'
            }}
          />
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
            Team registry
          </span>
        </div>
      </div>

      {error && (
        <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {message && (
        <div className="notice" role="status" style={{ marginBottom: '1rem' }}>
          {message}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
          gap: '1rem',
          marginBottom: '1.25rem'
        }}
      >
        {[
          {
            label: 'Active teams',
            value: activeTeamCount,
            detail: selectedDepartment ? selectedDepartment.code : 'Across active departments',
            symbol: '✓'
          },
          {
            label: 'Departments',
            value: activeDepartmentCount,
            detail: 'Active departments',
            symbol: '▦'
          },
          {
            label: 'Inactive teams',
            value: inactiveTeamCount,
            detail: 'Preserved, not deleted',
            symbol: 'Ⅱ'
          }
        ].map(item => (
          <div
            key={item.label}
            style={{
              ...cardStyle,
              marginBottom: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              minHeight: '105px'
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: '48px',
                height: '48px',
                flexShrink: 0,
                borderRadius: '15px',
                display: 'grid',
                placeItems: 'center',
                background: colors.goldLight,
                color: colors.gold,
                fontSize: '1.35rem',
                fontWeight: 800
              }}
            >
              {item.symbol}
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.88rem', marginBottom: '0.2rem' }}>
                {item.label}
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.2 }}>
                {item.value}
              </div>
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>
                {item.detail}
              </div>
            </div>
          </div>
        ))}
      </div>

      {canManage && (
        <div style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.25rem'
            }}
          >
            <div>
              <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.2rem' }}>
                {editId ? 'Edit team' : 'Add a team'}
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                {editId
                  ? 'Update the selected team’s details.'
                  : 'Register a new team under an existing department.'}
              </p>
            </div>

            {editId && (
              <span
                style={{
                  borderRadius: '999px',
                  background: colors.goldLight,
                  color: colors.gold,
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 800
                }}
              >
                EDIT MODE
              </span>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: '1rem'
            }}
          >
            <label style={fieldStyle}>
              Department
              <select
                style={inputStyle}
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                disabled={saving}
              >
                {departments.filter(d => d.active).map(department => (
                  <option key={department.id} value={department.id}>
                    {department.code} — {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={fieldStyle}>
              Team code
              <input
                style={inputStyle}
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="e.g. AHBA_SLI021"
                maxLength={50}
                autoComplete="off"
                disabled={saving}
              />
            </label>

            <label style={fieldStyle}>
              Team name
              <input
                style={inputStyle}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. SLI Team 21"
                maxLength={100}
                autoComplete="off"
                disabled={saving}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => void saveTeam()}
              disabled={saving || departments.filter(d => d.active).length === 0}
            >
              {saving ? 'Saving…' : editId ? 'Save changes' : '+ Add team'}
            </button>

            {editId && (
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={resetForm}
                disabled={saving}
              >
                Cancel edit
              </button>
            )}
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.15rem' }}>
            Browse teams
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Select a department to show only its teams.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
            gap: '1rem',
            alignItems: 'end'
          }}
        >
          <label style={fieldStyle}>
            Department
            <select
              style={inputStyle}
              value={viewDepartmentId}
              onChange={e => setViewDepartmentId(e.target.value)}
            >
              <option value="all">All departments</option>
              {departments
                .filter(department => showInactive || department.active)
                .map(department => (
                  <option key={department.id} value={department.id}>
                    {department.code} — {department.name}
                  </option>
                ))}
            </select>
          </label>

          <label style={fieldStyle}>
            Search teams
            <input
              style={inputStyle}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by team code or name…"
            />
          </label>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            marginTop: '1rem',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            style={{ width: '18px', height: '18px', accentColor: colors.gold }}
          />
          Show inactive departments and teams
        </label>
      </div>

      {loading ? (
        <div style={cardStyle}>
          <p className="muted" style={{ margin: 0 }}>Loading department and team records…</p>
        </div>
      ) : visibleDepartments.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '2.5rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⌕</div>
          <h2 style={{ margin: '0 0 0.5rem' }}>No departments found</h2>
          <p className="muted" style={{ margin: 0 }}>
            Try selecting another department or enabling inactive departments.
          </p>
        </div>
      ) : (
        visibleDepartments.map(department => {
          const departmentTeams = teams
            .filter(team => {
              const matchesDepartment = team.department_id === department.id
              const matchesStatus = showInactive || team.active
              const searchTerm = search.trim().toLowerCase()
              const matchesSearch =
                !searchTerm ||
                team.code.toLowerCase().includes(searchTerm) ||
                team.name.toLowerCase().includes(searchTerm)

              return matchesDepartment && matchesStatus && matchesSearch
            })
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))

          const activeCount = departmentTeams.filter(team => team.active).length

          return (
            <div key={department.id} style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  marginBottom: '1.1rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <div
                    aria-hidden="true"
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: '48px',
                      height: '48px',
                      borderRadius: '15px',
                      background: colors.goldLight,
                      color: colors.gold,
                      fontSize: '1rem',
                      fontWeight: 900
                    }}
                  >
                    {department.code.slice(0, 3)}
                  </div>
                  <div>
                    <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem' }}>
                      {department.name}
                    </h2>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      Department code: {department.code}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      borderRadius: '999px',
                      padding: '0.45rem 0.75rem',
                      background: 'rgba(56,161,105,.12)',
                      color: '#27784b',
                      fontSize: '0.8rem',
                      fontWeight: 800
                    }}
                  >
                    {activeCount} active
                  </span>
                  <span
                    style={{
                      borderRadius: '999px',
                      padding: '0.45rem 0.75rem',
                      background: 'var(--background, rgba(0,0,0,.035))',
                      border: `1px solid ${colors.border}`,
                      fontSize: '0.8rem',
                      fontWeight: 700
                    }}
                  >
                    {departmentTeams.length} shown
                  </span>
                </div>
              </div>

              {!department.active && (
                <p className="muted" style={{ marginTop: 0 }}>
                  This department is inactive.
                </p>
              )}

              {departmentTeams.length === 0 ? (
                <div
                  style={{
                    border: `1px dashed ${colors.border}`,
                    borderRadius: '14px',
                    padding: '1.5rem 1rem',
                    textAlign: 'center'
                  }}
                >
                  <p style={{ margin: '0 0 0.35rem', fontWeight: 700 }}>
                    {search.trim() ? 'No matching teams' : 'No teams to display'}
                  </p>
                  <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                    {search.trim()
                      ? 'Try another search term.'
                      : 'Add a team above or enable inactive teams to see archived records.'}
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: `1px solid ${colors.border}`, borderRadius: '14px' }}>
                  <table
                    style={{
                      width: '100%',
                      minWidth: canManage ? '690px' : '480px',
                      borderCollapse: 'separate',
                      borderSpacing: 0
                    }}
                  >
                    <thead>
                      <tr style={{ background: colors.goldLight, color: '#654613' }}>
                        {['Team code', 'Team name', 'Status', ...(canManage ? ['Actions'] : [])].map(label => (
                          <th
                            key={label}
                            style={{
                              padding: '0.9rem 1rem',
                              textAlign: label === 'Actions' ? 'right' : 'left',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              whiteSpace: 'nowrap',
                              borderBottom: `1px solid ${colors.border}`
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {departmentTeams.map((team, index) => (
                        <tr
                          key={team.id}
                          style={{
                            background: index % 2 === 0 ? 'transparent' : 'rgba(147,105,31,.035)'
                          }}
                        >
                          <td
                            style={{
                              padding: '0.9rem 1rem',
                              borderBottom: `1px solid ${colors.border}`,
                              fontWeight: 800,
                              color: colors.gold,
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {team.code}
                          </td>
                          <td style={{ padding: '0.9rem 1rem', borderBottom: `1px solid ${colors.border}` }}>
                            {team.name}
                          </td>
                          <td style={{ padding: '0.9rem 1rem', borderBottom: `1px solid ${colors.border}` }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                borderRadius: '999px',
                                padding: '0.35rem 0.6rem',
                                background: team.active ? 'rgba(56,161,105,.12)' : 'rgba(120,120,120,.12)',
                                color: team.active ? '#27784b' : 'var(--muted)',
                                fontSize: '0.78rem',
                                fontWeight: 800
                              }}
                            >
                              <span
                                style={{
                                  width: '6px',
                                  height: '6px',
                                  borderRadius: '50%',
                                  background: team.active ? '#38a169' : '#888'
                                }}
                              />
                              {team.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          {canManage && (
                            <td
                              style={{
                                padding: '0.7rem 1rem',
                                borderBottom: `1px solid ${colors.border}`,
                                textAlign: 'right'
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'flex-end',
                                  gap: '0.5rem',
                                  flexWrap: 'wrap'
                                }}
                              >
                                <button
                                  type="button"
                                  style={secondaryButtonStyle}
                                  onClick={() => startEdit(team)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    ...secondaryButtonStyle,
                                    color: team.active ? '#a23a32' : '#27784b'
                                  }}
                                  disabled={busyTeamId === team.id}
                                  onClick={() => void toggleActive(team)}
                                >
                                  {busyTeamId === team.id
                                    ? 'Updating…'
                                    : team.active
                                      ? 'Deactivate'
                                      : 'Activate'}
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })
      )}

      <p className="muted" style={{ fontSize: '0.82rem', lineHeight: 1.6, marginTop: '1.25rem' }}>
        Note: Deactivating a team hides it from active lists but does not delete the record.
        Historical installation tally data remains in the database.
      </p>
    </section>
  )
}
