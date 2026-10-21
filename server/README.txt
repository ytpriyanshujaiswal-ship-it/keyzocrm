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
