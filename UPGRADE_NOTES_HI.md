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


## 2026-10-21 integrated payment and AI pass
- Gemini is the preferred AI provider (`GEMINI_API_KEY`, optional `GEMINI_MODEL=gemini-2.5-flash`); OpenAI Responses API is used as fallback when Gemini fails or returns no text.
- AI credit charging remains 3 credits only after a successful text response; failed provider attempts refund the reserved credits.
- Razorpay checkout verification now checks the HMAC signature and independently fetches the payment from Razorpay, requiring `captured` status, matching order ID, expected INR amount, and a pending order belonging to the current organization before credits are granted.
- Added a signed `payment.captured` webhook endpoint at `/api/billing/razorpay-webhook`. Configure `RAZORPAY_WEBHOOK_SECRET` in backend environment and use that URL in Razorpay Webhooks. It ignores unrelated events and prevents duplicate payment credits.
- Existing dashboards, organization administration, reports/analytics, and agent Performance panels were preserved and included in the reviewed source. This pass did not replace their data with mock values.
- Validation in this runtime: backend syntax checks passed and all 5 existing Node tests passed. A clean Vite build could not be run because dependencies are not installed in the workspace.

## Keyzo CRM UI + integration update (23 Oct 2026)

This update preserves the existing application, authentication, PostgreSQL/file-store compatibility, lead import, team management, properties, tasks, AI credit billing and Razorpay test-mode verification. It adds/updates:

- **Home Dashboard:** dark professional sales header, KPI cards, stage-by-stage sales funnel, team conversion snapshot, today task count and recent lead activity.
- **Lead section:** Total Leads, Untouched Leads, Reminder Due and Today's Leads summary cards, plus Team Activity counts and clickable recent activity drill-down.
- **Performance:** expanded employee metrics for calls, messages, follow-ups, revisits, scheduled/completed site visits, overdue items and conversion. Employee detail includes an adjustable monthly call-target progress indicator; this view-only target is not persisted.
- **Reports:** start/end date filters and employee filter; filters affect summary metrics and lead CSV export. Added a separate activity-history CSV export.
- **AI stability/visibility:** assistant panel is wrapped in a render error boundary so a rendering exception does not blank the whole CRM. Provider status shows Gemini and OpenAI configuration separately. Backend continues to try Gemini first and OpenAI as fallback, and failed/empty responses return visible errors without net credit charge.
- **External lead-source framework:** optional `POST /api/integrations/leads/webhook` endpoint maps private integration tokens to organization IDs through backend-only `LEAD_SOURCE_TOKENS`. It accepts up to 100 normalized leads per request and leaves them unassigned. Each source provider still needs its own field mapping/configuration.
- **Existing features retained:** Super Admin organization creation, manual WhatsApp prefilled message, existing WhatsApp Business API option, Razorpay order/signature/captured-payment verification, Excel/CSV lead import, tasks, properties and team tools.

### Deployment notes

1. Keep the existing GitHub repository and take a backup before replacing files.
2. Deploy the updated frontend files to Netlify and backend files to Render from the same project version.
3. Keep API credentials only in Render environment variables. Configure `GEMINI_API_KEY` and/or `OPENAI_API_KEY`; optionally set `GEMINI_MODEL` and `OPENAI_MODEL`.
4. Keep existing Razorpay test credentials and database URL unchanged while testing. Never commit secrets to GitHub.
5. To enable inbound lead integrations, configure `LEAD_SOURCE_TOKENS` as a JSON map of long private tokens to organization IDs. Do not expose these tokens in frontend code.
6. Verify login, lead create/import/update, team assignment, dashboard, reports, AI response/credit balance, Razorpay test payment, and mobile navigation after deployment.

**Verification limitation:** backend syntax checks and the existing five Node tests pass in this workspace. JSX syntax was checked using the installed TypeScript parser. A full Vite production build could not be run because npm package registry access failed in this environment; live Render/Netlify regression testing has not been performed here.

## UI analytics and lead filters update (23 Oct 2026)
- Overview: added a 7-day lead creation line chart and lead-status donut chart using live CRM leads.
- Performance: added calling-team activity comparison bars and team conversion donut chart based on recorded lead history.
- Reports: added lead-status and source-mix donut charts plus a 7-day lead-creation chart; existing date/employee filters and CSV exports remain available.
- Leads: summary cards are interactive for Total, Untouched, Reminder Due, Today's Leads, and Overdue. Selecting a card filters the list. On mobile, the lead list stays hidden until a summary card is selected.
- Charts are calculated from current CRM records; no demo data is inserted.
