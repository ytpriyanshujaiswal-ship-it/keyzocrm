# KEYZO Upgrade Notes

## Existing workflows preserved
- Existing login API and role values (`backend`, `calling`) remain compatible.
- Existing lead management, import/distribution, archive, WhatsApp template, performance and team flows remain in the original React application.
- Existing database users/leads are not deleted by startup migrations.

## New functionality
- Persistent `properties` inventory and `tasks` collections in both JSON and PostgreSQL storage adapters.
- Backend can create/update/archive properties. Frontend/Sales can view non-archived inventory.
- Follow-up/site visit task creation, assignment by Backend, completion/cancellation state, and role-based task visibility.
- Properties and tasks are included in full backup/restore payloads.
- Passwords are never sent by `GET /api/users`; production bootstrap credentials are environment-driven; JWT expiry is 7 days; authenticated requests verify the account remains active.
- Configurable CORS and common security response headers.

## Deployment note
Set `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS` on the backend host and `VITE_API_BASE_URL` on Netlify. Full instructions are in `README.txt`.

## Validation status
Backend JavaScript files can be checked with `node --check`. A complete frontend production build must be run by the deployment provider (Netlify build log) because dependency installation in this execution environment was unavailable/timed out. Do not describe deployment as verified until the host reports a successful build and the smoke test list passes.
