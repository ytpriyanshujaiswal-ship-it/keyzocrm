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


## Latest update (2026-10-20)
- Lead import modal now accepts Excel `.xlsx` / `.xls`, CSV and pasted rows, with automatic header mapping and a preview.
- Supported header aliases include Name/Full Name, Mobile/Phone, Project/Property, Sector/Location/City, Source/Lead Source and Email.
- Replaced the Vite-purple favicon with a Keyzo yellow diamond on navy.
- Added a mobile hamburger menu to both Backend Admin and Calling/Sales panels, including navigation and logout.
- Assistant panel now shows loading/empty/error states and a retry action rather than leaving the user with a blank-looking screen after a failed request.
- Updated default frontend API URL to `https://keyzo-crm-api.onrender.com/api`.
- Added Excel workbook parsing via the `xlsx` module name, mapped to the `@keep-lts/xlsx` npm fork version `^0.18.6` to avoid using the older unpatched npm `xlsx@0.18.5` baseline when importing user-supplied files.

Before production use, deploy the frontend and test imports with a small non-sensitive sample workbook first. Confirm that the latest Netlify deploy succeeds. A local production build could not be verified in this environment because package installation timed out.


## Recheck / repair pass (2026-10-20)
- Fixed invalid JSX in AssistantsPanel that made the prior source fail to compile. It now has explicit loading, no-leads, configuration, error, and refresh states.
- Mobile hamburger is shown on every Backend and Calling/Sales screen (including Inventory, Tasks & Visits and Assistants); it exposes all modules, current account and logout-to-login. Removed the cramped/scrollable bottom module strip from mobile layouts.
- Added a real Reports & analytics page for both roles: stage pipeline, conversion rate, lead-source/project totals, follow-up/site-visit task counts, and CSV export.
- Reworked width/flex/min-height/overflow rules so desktop content fills the viewport without forced side margins and mobile content uses a fixed viewport with only the main area scrolling.
- Improved CSV parsing/Excel header aliases, import preview, invalid-row/duplicate handling, and server-side existing-phone deduplication (up to 5,000 rows per import). Email and estimate/budget fields are stored for regular and bulk leads.
- Build verification: JSX was statically transpiled with the installed TypeScript compiler and backend JS passed `node --check`. A full Vite production build could not be run in this environment because npm dependency installation timed out; the host's fresh build must be checked before calling it verified.


## Final recheck status
- Re-ran the import utility test suite: all 4 tests pass.
- Parsed/transpiled all JSX files with the installed TypeScript compiler without syntax diagnostics.
- Ran `node --check` on backend JavaScript files successfully.
- `npm install` / `vite build` could not be completed in this runtime because npm registry DNS requests failed (`EAI_AGAIN`); Netlify must still confirm a successful clean production build.

## Platform / AI billing additions
- Added platform Super Admin bootstrap via `SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD`.
- Added organization creation with its own backend admin and organization-scoped leads, users, inventory, tasks, settings and AI balance. Legacy records without an organization ID stay in `default`.
- Added 100 non-expiring free credits per organization, 3 credits per successful AI insight, credit balance/ledger and Razorpay order/signature verification. Failed AI requests refund the reserved credits.
- Added mobile bottom navigation, quick-add lead for calling members, tab-aware browser Back, and employee drill-down performance metrics.
- Configure Razorpay and Super Admin credentials on the backend host before enabling live operations. Package pricing is a starting configuration and should be reconciled with actual OpenAI token usage.
