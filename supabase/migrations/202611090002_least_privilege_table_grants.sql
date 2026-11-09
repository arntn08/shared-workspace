-- AHBA Shared Workspace: least-privilege table grants (2026-11-09)
-- Apply in Supabase Dashboard -> SQL Editor after the prior security hardening migration.
-- RLS policies continue to control which rows authenticated users may access.

-- Remove all direct table privileges first, including TRUNCATE, TRIGGER,
-- REFERENCES, and any other privilege not required by the application.
revoke all privileges on table public.employee_ntes from authenticated;
revoke all privileges on table public.employee_leave_requests from authenticated;

-- NTEs: users need read/issue/update operations; row and trigger rules
-- restrict these operations to the assigned employee or active HR/Owner.
grant select, insert, update
on table public.employee_ntes
to authenticated;

-- Leave requests: employees submit/read/delete their own pending requests;
-- active HR can read all requests and approve/reject them.
grant select, insert, update, delete
on table public.employee_leave_requests
to authenticated;

-- Explicitly document that elevated service_role and postgres privileges
-- are intentional server/admin privileges, not browser-client grants.
