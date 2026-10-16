import { supabase } from './supabase'

export async function logAction(
  userId: string,
  action: string,
  fileId?: string | null,
  detail?: Record<string, unknown>
) {
  await supabase
    .from('audit_logs')
    .insert({ user_id: userId, action, file_id: fileId ?? null, detail: detail ?? {} })
}
