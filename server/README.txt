KEYZO BACKEND QUICK REFERENCE
============================

See the repository-root README.txt for the full Render + Netlify deployment guide.

Production requirements:
- DATABASE_URL must point to persistent PostgreSQL (Neon/Supabase/etc.).
- JWT_SECRET must be 32+ random characters.
- ALLOWED_ORIGINS should contain the exact deployed frontend origin(s).
- INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD are used only when the database has no matching user; use a unique password at least 12 characters long.

Commands from this directory:
  npm install
  npm start
  node backup-tool.js status
  node backup-tool.js export backup.json
  node backup-tool.js import backup.json
  node backup-tool.js import backup.json --force

Never commit .env files, secrets, or customer backups to a public repository. The backend refuses to start on hosted platforms without DATABASE_URL unless ephemeral storage is explicitly enabled; do not enable ephemeral storage for real CRM data.

Super Admin and billing setup:
- Configure SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD as separate backend environment variables. Use a unique username and a password of 12+ characters.
- Set GEMINI_API_KEY (preferred) and optionally GEMINI_MODEL to enable Gemini-first AI lead insights. Set GEMINI_API_KEY (preferred) and optionally GEMINI_MODEL, plus OPENAI_API_KEY and optionally OPENAI_MODEL as fallback as fallback. Credits are organization-scoped, 100 free/non-expiring per organization, and 3 credits per successful AI response.
- Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable credit purchases. Never put the secret in frontend environment variables or GitHub.


EXTERNAL LEAD-SOURCE FRAMEWORK
------------------------------
Optional environment variable: LEAD_SOURCE_TOKENS
Set it to a JSON object mapping a long private token to an organization ID. Example for the legacy/default workspace:
  LEAD_SOURCE_TOKENS={"replace-with-a-long-random-token":"default"}
For a Super Admin organization, map the token to that organization's exact ORG-... ID. Keep tokens private and rotate them if exposed.
POST /api/integrations/leads/webhook with header x-keyzo-lead-token: <token> and JSON {"leads":[{"name":"Example","phone":"9876543210","project":"Project","source":"99acres"}]}
Accepts up to 100 records per request; name and phone are required. Common provider aliases include full_name/customer_name, mobile/phone_number, property/project_name, location/city, and lead_source. Imported leads are created as unassigned and visible only within the mapped organization. This is a normalized ingestion bridge; each provider still needs its own webhook/export mapping and authorization setup.
