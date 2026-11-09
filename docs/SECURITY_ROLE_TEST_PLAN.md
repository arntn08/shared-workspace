# AHBA Shared Workspace — role security test plan

Run this after applying `supabase/migrations/202611090001_security_hardening.sql`.

## A. Database configuration audit

1. Open Supabase Dashboard → SQL Editor.
2. Run `supabase/tests/security_hardening_audit.sql`.
3. Confirm it prints `SECURITY AUDIT PASSED`.
4. Review the returned `pg_policies` rows, especially policies for NTEs, leave requests, profiles, and Storage.

This script is read-only. It checks that the expected tables, RLS flags, triggers, policies, grants, and private buckets exist. It does not impersonate users or prove every runtime authorization path.

## B. Runtime role matrix

Use separate real test accounts. Do not change production users' roles to perform these tests. Use a non-production project if possible.

| Test | Owner | Editor | HR | Employee | AR Encoder |
|---|---:|---:|---:|---:|---:|
| Open own dashboard | Allow | Allow | Allow | Allow | Allow |
| Issue or edit NTE | Allow | Deny | Allow | Deny | Deny |
| Read an NTE assigned to another employee | Allow | Deny | Allow | Deny | Deny |
| Submit response to own NTE | Deny | Deny | Deny | Allow | Deny |
| Review/approve leave | Deny | Deny | Allow | Deny | Deny |
| Read all leave requests | Deny | Deny | Allow | Deny | Deny |
| Read own leave request | N/A | N/A | N/A | Allow | N/A |
| Assign workspace roles | Allow | Deny | Deny | Deny | Deny |
| Read private NTE/leave attachments | Only where explicitly granted | Deny | HR NTE/leave scope | Own records only | Deny |

Notes:
- Leave approval is HR-exclusive by business rule. Owner access to leave review is intentionally not granted by this hardening migration.
- The application has other role-specific features; test those separately against the current permissions matrix.
- Test with direct Supabase requests as well as the UI. Hiding a button is not a security test.
- Verify inactive accounts cannot read or write HR records or private attachments.
- Never use a service-role key in browser code or expose it in GitHub Pages.

## C. Record results

For each role, record the test account, date, expected result, actual result, and any unexpected access. Stop and investigate any unexpected success on a denied action.
