export function actionLabel(a: string) {
  const map: Record<string, string> = {
    sign_in: 'Signed in',
    view_file: 'Viewed a file',
    edit_cell: 'Edited a cell',
    add_file: 'Added a file',
    remove_file: 'Removed a file',
    assign_file: 'Assigned a file',
    unassign_file: 'Unassigned a file',
    revoke_access: 'Revoked access',
    restore_access: 'Restored access',
    update_dashboard_design: 'Updated dashboard design',
    create_user: 'Created an account',
    set_role: 'Changed a role',
    reset_password: 'Reset a password',
    rename_user: 'Renamed a person',
    change_password: 'Changed their password'
  }
  return map[a] ?? a.replace(/_/g, ' ')
}

export function actionKind(a: string): 'view' | 'edit' | 'admin' {
  if (a === 'sign_in' || a === 'view_file') return 'view'
  if (a === 'edit_cell') return 'edit'
  return 'admin'
}

export function detailText(d: any): string {
  if (!d) return ''
  if (d.old !== undefined && d.value !== undefined) return `${d.title ?? ''}: "${d.old}" → "${d.value}"`
  if (d.email) return d.role ? `${d.email} (${d.role})` : String(d.email)
  return String(d.title ?? '')
}
