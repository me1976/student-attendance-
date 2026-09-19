# Verification — 2026-09-19

Verified against the existing Supabase project, not a simulated data source.

- Frontend JavaScript and Edge Function TypeScript syntax checks passed on Node 24.
- Transactional SQL regression passed: save, repeat save, correction, invalid roster, stale baseline, same-day transfer, old-class save, removal, historical class preservation, RPC role permissions. Fixtures rolled back.
- 30 real API requests passed: all 16 rosters and counts, stored dates, report filters, legacy report compatibility, leaderboard order/current class/counts, student history and malformed-input rejection.
- Browser workflow passed: opening the app and class, loading the roster, adding a temporary student, renaming, marking absent, switching to management and back with the unsaved selection intact, saving, reloading the saved absence, transferring only to a sibling section, checking both rosters, saving the old class without erasing history, removing the student and retrieving retained history.
- Report date/class changes update automatically. Search suggestions include current class and removed students. Empty history message verified. Select-all and clear-all preserve locked historical absences from another section.
- Mobile testing at 390px: classes, roster, management, reports and analytics have no horizontal document overflow; Arabic RTL layout visually inspected.
- Browser error/warning log was empty during the tested workflow.
- RLS remains enabled on both existing tables; no new public table policies or direct browser credentials were added.
- Temporary browser-test student and its two attendance rows were removed after verification; original school records were retained.

The public, no-login API is an explicit owner-approved deployment choice. The SQL function is executable only by the server role.
