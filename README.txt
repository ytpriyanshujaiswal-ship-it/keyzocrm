KEYZO CRM — DEPLOYMENT AND TESTING GUIDE
=======================================

This project preserves the existing lead desk and adds persistent property inventory plus task/follow-up/site-visit management. Backend storage supports PostgreSQL for hosting and JSON file storage for local development.

IMPORTANT
---------
- Do not commit .env files, database URLs, JWT secrets, or passwords to GitHub.
- Rotate any demo/default password before using real customer data.
- For online hosting, configure a permanent PostgreSQL database. Do not enable ephemeral file storage in production.
- The ZIP is source code; it cannot deploy itself. You must upload/commit it to GitHub and configure the hosting services below.

1) BACKEND — RENDER
-------------------
Create a Web Service from this repository.
  Root Directory: server
  Build Command: npm install
  Start Command: npm start
  Runtime: Node 22 (or latest supported Node >=18)

Set environment variables in Render:
  NODE_ENV=production
  DATABASE_URL=<Neon PostgreSQL connection string>
  JWT_SECRET=<random secret of 32+ characters>
  ALLOWED_ORIGINS=https://YOUR-SITE.netlify.app

If the database is empty, also set:
  INITIAL_ADMIN_USERNAME=<new admin username>
  INITIAL_ADMIN_PASSWORD=<unique password of at least 12 characters>
These are used only to create the first user. If your existing database already has users, existing accounts are retained.

After deployment, open:
  https://YOUR-BACKEND.onrender.com/api/health
Expected JSON includes {"ok":true,"name":"Keyzo","storage":"postgres"}.
If storage says file on hosted service, stop and configure DATABASE_URL before adding customer data.

2) FRONTEND — NETLIFY
---------------------
Import the same GitHub repository as a Netlify site.
  Base directory: (leave blank / repository root)
  Build command: npm run build
  Publish directory: dist
  Node version: 22

Set environment variable:
  VITE_API_BASE_URL=https://YOUR-BACKEND.onrender.com/api

Set ALLOWED_ORIGINS on Render to the exact Netlify site origin (no trailing slash), then redeploy the backend. If using a custom domain, include that origin too, comma-separated.

3) EXISTING LOGIN AND SECURITY
------------------------------
Existing user records in the connected database are not deleted by this upgrade. Backend users can create/manage Backend team and Frontend/Sales team accounts. Passwords are hashed and are never returned by the user-list API.

For an existing account, log in with your current credentials. Change demo credentials immediately after confirming you can sign in. Never add credentials to a GitHub README or issue.

4) NEW FEATURES
---------------
- Property Inventory: create projects with developer, location, configuration, area, price/BSP, description, and availability status.
- Follow-ups & Site Visits: schedule tasks with date/time, type, customer/project notes, assign tasks from Backend, and mark tasks complete.
- Assistants: optional AI lead insights and server-side WhatsApp Business messaging. These stay disabled until the corresponding server-side credentials are configured.
- Persistent PostgreSQL tables for properties and tasks; these are included in backup/restore exports.
- API security headers, configurable CORS, active-account checks on authenticated requests, 7-day JWT expiry, and lead patch validation.
- Responsive global layout and updated CRM palette.
- Smart lead imports support .xlsx/.xls/.csv/.txt, common header mapping, preview, invalid-row handling, and duplicate-phone skipping.
- Mobile navigation is available from a top-right hamburger on every screen, including Inventory, Tasks & Visits, Assistants and Reports.
- Reports & analytics shows lead pipeline, conversion rate, sources, projects, follow-up/site-visit task counts, and CSV export.

5) POST-DEPLOYMENT SMOKE TEST
-----------------------------
1. Visit /api/health and confirm storage is postgres.
2. Sign in with an existing Backend account.
3. Open Team; verify no passwords are displayed; create one temporary Frontend/Sales account.
4. Add a test lead, assign it, sign in as that sales user, and confirm only assigned leads are visible.
5. Open Reports; confirm pipeline/source/project metrics and export a test CSV.
6. On a phone-sized viewport, open the top-right hamburger from every panel and verify that all modules and logout are accessible.
7. Import a small .xlsx test sheet with Name, Mobile, Project, Location, Source, Email and Budget columns; confirm preview, import, and duplicate skips.
8. Open Tasks & Visits; create a site visit, mark it complete, refresh, and confirm it persists.
9. Restart/redeploy the backend and confirm the test project/task/lead remain.
10. Delete test records if needed and rotate temporary account credentials.

6) OPTIONAL INTEGRATIONS
------------------------
AI lead insights:
  OPENAI_API_KEY=<server-side secret>
  OPENAI_MODEL=gpt-4.1-mini
The assistant sends only selected lead summary fields plus recent notes/history to the configured provider. Tell your team before enabling it and follow your customer-data policy.

WhatsApp Business Platform:
  WHATSAPP_ACCESS_TOKEN=<Meta token>
  WHATSAPP_PHONE_NUMBER_ID=<Meta phone number ID>
  WHATSAPP_API_VERSION=v23.0
Use a valid Meta Business setup, opt-in recipients, and approved message templates where required. Tokens must only exist in backend environment variables, never in frontend code. If these variables are absent, the integrations page clearly shows setup is required.

7) BACKUPS
-----------
Run from the server directory with DATABASE_URL configured:
  npm install
  node backup-tool.js status
  node backup-tool.js export backup.json
Restore only when you have verified the backup file and understand that --force replaces existing data:
  node backup-tool.js import backup.json --force
Keep encrypted copies of backups in a private location; never upload customer data backups to public GitHub.

8) MOBILE APP (LATER PHASE)
---------------------------
The UI is responsive, but this is still a web application. Once the hosted web version passes the smoke tests, evaluate PWA installation first; Capacitor can package the same web app for Android/iOS if native distribution is needed. This ZIP does not claim to be an already-published mobile app.


Final validation note: Smart Lead Import uses the package name `xlsx` resolved to the security-maintained @keep-lts/xlsx npm fork via npm alias. Run `npm install`, `npm test`, and `npm run build` in CI/Netlify before production use. In this environment, import-unit tests and syntax checks passed; the full production build could not be run because npm registry access failed (EAI_AGAIN).
