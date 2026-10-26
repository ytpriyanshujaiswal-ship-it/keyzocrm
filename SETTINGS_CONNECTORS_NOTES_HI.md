# Keyzo CRM — Settings & Lead Connectors

## What changed
- Added **Settings** as the last navigation item for Backend and Calling/Sales roles. On mobile it appears at the bottom of the hamburger navigation.
- Added 8 settings sections: Lead Sources & Connectors, Profile & Security, Notifications, Lead Preferences, WhatsApp Templates, Import & Export, Activity & Audit, and System Status.
- Added a connector workspace showing webhook URL, auth header format, source sample JSON, copy controls, backend environment setup guidance, and a reachability check.
- Added an audit view using the lead history currently available to the logged-in role and a copy-visible-leads JSON export.

## Important connector status
The existing backend webhook is `POST /api/integrations/leads/webhook`. It authenticates with `x-keyzo-lead-token` (or `integrationToken` in the body) and reads `LEAD_SOURCE_TOKENS` from the backend environment. The setting page does **not** store provider secrets in the browser.

This is a generic normalized webhook bridge. 99acres, Meta/Facebook Lead Ads, MagicBricks and Housing.com are **not automatically live** just because they are listed in the UI. Each provider still needs its approved webhook/API setup, field mapping, and end-to-end test. The “Check webhook reachability” button checks whether the endpoint can be reached/configured; it does not create a test lead or validate provider credentials.

## Configure webhook
1. Open Render and select the Keyzo API service.
2. In Environment, set `LEAD_SOURCE_TOKENS` to a JSON object mapping a long random private token to the target organization ID. For example, for the default organization only: `{"YOUR_LONG_RANDOM_TOKEN":"default"}`.
3. Save and redeploy the backend.
4. Give the private token only to the trusted source system. Do not put it into frontend code, screenshots, or public repositories.
5. Configure the source to POST 1–100 normalized leads to the displayed webhook URL with header `x-keyzo-lead-token: YOUR_LONG_RANDOM_TOKEN`. Each lead requires `name` and `phone`; supported fields include `email`, `project`/`property`, `sector`/`location`, `estimate`/`budget`, and `source`/`lead_source`.

## Verification
- `npm test`: 5 tests pass.
- Frontend production build was not verified in this environment because npm dependency installation timed out / package cache was unavailable. Run `npm install` and `npm run build` in CI or the deployment environment before publishing.
