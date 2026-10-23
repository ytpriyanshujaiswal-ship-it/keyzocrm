/**
 * Keyzo storage layer.
 *
 * Do interchangeable backends, same API:
 *
 *  1. Postgres  -> jab DATABASE_URL set ho (Render / online hosting).
 *                  Data ek alag database me rehta hai, isliye server restart,
 *                  sleep ya redeploy hone par bhi kabhi nahi udta.
 *
 *  2. JSON file -> jab DATABASE_URL set na ho (apne PC pe local chalane ke liye).
 *                  db.json me save hota hai: atomic write (aadhi file kabhi nahi
 *                  likhi jaati) + rolling backups (backups/ folder).
 *
 * Har function async hai, taaki index.js ko pata na chale ki neeche kaunsa
 * backend chal raha hai.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

/* ------------------------------------------------------------------ */
/*  JSON FILE BACKEND                                                  */
/* ------------------------------------------------------------------ */
function createFileStore(dataDir) {
  const DB_PATH = path.join(dataDir, "db.json");
  const BACKUP_DIR = path.join(dataDir, "backups");
  const BACKUP_EVERY_MS = 10 * 60 * 1000; // max ek backup har 10 min me
  const KEEP_BACKUPS = 40;

  let db = null;
  let lastBackupAt = 0;
  let queue = Promise.resolve(); // writes ek ke baad ek chalte hain

  const normalize = (d) => ({
    users: Array.isArray(d && d.users) ? d.users : [],
    leads: Array.isArray(d && d.leads) ? d.leads : [],
    properties: Array.isArray(d && d.properties) ? d.properties : [],
    tasks: Array.isArray(d && d.tasks) ? d.tasks : [],
    settings: (d && d.settings) || null,
    platformData: (d && d.platformData) || { organizations: [], billing: {} },
  });

  async function listBackups() {
    try {
      const names = (await fsp.readdir(BACKUP_DIR)).filter((n) => n.startsWith("db-") && n.endsWith(".json")).sort();
      return names.map((n) => path.join(BACKUP_DIR, n));
    } catch {
      return [];
    }
  }

  async function load() {
    let raw;
    try {
      raw = await fsp.readFile(DB_PATH, "utf-8");
    } catch (e) {
      if (e.code === "ENOENT") return normalize({});
      throw e;
    }
    try {
      return normalize(JSON.parse(raw));
    } catch (err) {
      // File kharab hai. Usko kabhi khaali karke overwrite nahi karte:
      // pehle uski copy rakho, phir sabse naye achhe backup se wapas lo.
      const aside = path.join(dataDir, `db.corrupt-${Date.now()}.json`);
      await fsp.copyFile(DB_PATH, aside);
      console.error(`db.json kharab mili (${err.message}). Copy rakhi: ${path.basename(aside)}`);
      for (const b of (await listBackups()).reverse()) {
        try {
          const d = normalize(JSON.parse(await fsp.readFile(b, "utf-8")));
          console.error(`Backup se restore kiya: ${path.basename(b)}`);
          return d;
        } catch {}
      }
      throw new Error("db.json kharab hai aur koi chalne layak backup nahi mila. Original file safe hai: " + path.basename(aside));
    }
  }

  async function persist() {
    await fsp.mkdir(dataDir, { recursive: true });
    const now = Date.now();
    if (now - lastBackupAt > BACKUP_EVERY_MS && fs.existsSync(DB_PATH)) {
      await fsp.mkdir(BACKUP_DIR, { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      await fsp.copyFile(DB_PATH, path.join(BACKUP_DIR, `db-${stamp}.json`));
      lastBackupAt = now;
      const all = await listBackups();
      for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await fsp.unlink(old).catch(() => {});
    }
    // atomic write: pehle temp file, disk pe sync, phir rename
    const tmp = DB_PATH + ".tmp";
    const fh = await fsp.open(tmp, "w");
    try {
      await fh.writeFile(JSON.stringify(db, null, 2));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, DB_PATH);
  }

  function mutate(fn) {
    const run = queue.then(async () => {
      const result = fn(db);
      try {
        await persist();
      } catch (e) {
        try { db = await load(); } catch {} // memory ko disk ki sachchai se match karo
        throw e;
      }
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    mode: "file",
    where: DB_PATH,

    async init() {
      db = await load();
    },
    async close() {
      await queue;
    },

    /* users */
    async getUserByUsername(username) {
      const k = String(username || "").trim().toLowerCase();
      return db.users.find((u) => String(u.username).toLowerCase() === k) || null;
    },
    async listUsers() {
      return db.users;
    },
    addUser(user) {
      return mutate((d) => {
        if (d.users.some((u) => String(u.username).toLowerCase() === String(user.username).toLowerCase())) {
          const err = new Error("duplicate username");
          err.code = "DUPLICATE_USERNAME";
          throw err;
        }
        d.users.push(user);
        return user;
      });
    },
    patchUser(id, patch) {
      return mutate((d) => {
        const u = d.users.find((x) => x.id === id);
        if (!u) return null;
        Object.assign(u, patch);
        return u;
      });
    },

    /* leads (naye lead hamesha upar) */
    async listLeads(assignedTo) {
      return assignedTo === undefined ? db.leads : db.leads.filter((l) => l.assignedTo === assignedTo);
    },
    async getLead(id) {
      return db.leads.find((l) => l.id === id) || null;
    },
    addLeads(leads) {
      return mutate((d) => {
        d.leads = [...leads, ...d.leads];
        return leads;
      });
    },
    patchLead(id, patch) {
      return mutate((d) => {
        const l = d.leads.find((x) => x.id === id);
        if (!l) return null;
        Object.assign(l, patch);
        return l;
      });
    },

    /* property inventory */
    async listProperties() { return db.properties || []; },
    async getProperty(id) { return (db.properties || []).find((x) => x.id === id) || null; },
    addProperty(property) {
      return mutate((d) => { d.properties = d.properties || []; d.properties.unshift(property); return property; });
    },
    patchProperty(id, patch) {
      return mutate((d) => { const x = (d.properties || []).find((p) => p.id === id); if (!x) return null; Object.assign(x, patch); return x; });
    },
    deleteProperty(id) {
      return mutate((d) => { const i = (d.properties || []).findIndex((p) => p.id === id); if (i < 0) return false; d.properties.splice(i, 1); return true; });
    },

    /* follow-up tasks and site visits */
    async listTasks(assignedTo) { return (db.tasks || []).filter((t) => assignedTo === undefined || t.assignedTo === assignedTo); },
    async getTask(id) { return (db.tasks || []).find((x) => x.id === id) || null; },
    addTask(task) { return mutate((d) => { d.tasks = d.tasks || []; d.tasks.unshift(task); return task; }); },
    patchTask(id, patch) { return mutate((d) => { const x = (d.tasks || []).find((t) => t.id === id); if (!x) return null; Object.assign(x, patch); return x; }); },
    deleteTask(id) { return mutate((d) => { const i = (d.tasks || []).findIndex((t) => t.id === id); if (i < 0) return false; d.tasks.splice(i, 1); return true; }); },

    /* settings */
    async getSettings() {
      return db.settings;
    },
    patchSettings(patch) {
      return mutate((d) => {
        d.settings = { ...(d.settings || {}), ...patch };
        return d.settings;
      });
    },
    async getPlatformData() { return db.platformData || { organizations: [], billing: {} }; },
    updatePlatformData(updater) {
      return mutate((d) => {
        d.platformData = d.platformData || { organizations: [], billing: {} };
        const next = updater(JSON.parse(JSON.stringify(d.platformData)));
        if (next) d.platformData = next;
        return d.platformData;
      });
    },

    /* backup / restore */
    async counts() {
      return { users: db.users.length, leads: db.leads.length, properties: (db.properties || []).length, tasks: (db.tasks || []).length };
    },
    async exportAll() {
      return { users: db.users, leads: db.leads, properties: db.properties || [], tasks: db.tasks || [], settings: db.settings, platformData: db.platformData };
    },
    replaceAll(doc) {
      return mutate((d) => {
        const n = normalize(doc);
        d.users = n.users;
        d.leads = n.leads;
        d.properties = Array.isArray(doc.properties) ? doc.properties : [];
        d.tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
        d.settings = n.settings;
        d.platformData = doc.platformData || d.platformData || { organizations: [], billing: {} };
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/*  POSTGRES BACKEND                                                   */
/* ------------------------------------------------------------------ */
function createPgStore(connectionString) {
  const { Pool } = require("pg");

  // Local Postgres ke alawa har jagah SSL chahiye (Neon, Supabase, Render...).
  let ssl;
  try {
    const u = new URL(connectionString);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
    if (!isLocal && !u.searchParams.has("sslmode")) ssl = { rejectUnauthorized: false };
  } catch {}

  const pool = new Pool({
    connectionString,
    ssl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000, // Neon sota ho to jaagne me thoda time lagta hai
  });
  // Idle connection toot jaye (Neon autosuspend) to server crash na ho
  pool.on("error", (e) => console.error("[db] idle connection error:", e.message));

  const isTransient = (e) =>
    /Connection terminated|ECONNRESET|EPIPE|server closed the connection|timeout exceeded when trying to connect/i.test(String((e && e.message) || "")) ||
    ["57P01", "57P02", "57P03", "08006", "08003", "08000"].includes(e && e.code);

  async function q(text, params) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      if (isTransient(e)) return pool.query(text, params); // ek baar dobara koshish
      throw e;
    }
  }

  async function tx(fn) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(7438)"); // multi-row writes ek ke baad ek
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function insertLeadsOn(c, leads) {
    const { rows } = await c.query("SELECT COALESCE(MAX(pos), 0) AS m FROM leads");
    const base = Number(rows[0].m);
    const n = leads.length;
    // leads[0] sabse upar dikhna chahiye -> sabse badi pos
    for (let i = 0; i < n; i += 500) {
      const chunk = leads.slice(i, i + 500);
      await c.query(
        "INSERT INTO leads (id, pos, data) SELECT * FROM unnest($1::text[], $2::bigint[], $3::jsonb[])",
        [chunk.map((l) => l.id), chunk.map((_, k) => base + (n - (i + k))), chunk.map((l) => JSON.stringify(l))]
      );
    }
  }
  async function insertUsersOn(c, users) {
    for (const u of users) {
      await c.query("INSERT INTO users (id, username_lower, data) VALUES ($1, $2, $3::jsonb)", [
        u.id,
        String(u.username).toLowerCase(),
        JSON.stringify(u),
      ]);
    }
  }

  return {
    mode: "postgres",
    where: (() => { try { return new URL(connectionString).hostname; } catch { return "postgres"; } })(),

    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users (
        seq bigserial,
        id text PRIMARY KEY,
        username_lower text UNIQUE NOT NULL,
        data jsonb NOT NULL
      )`);
      await q(`CREATE TABLE IF NOT EXISTS leads (
        id text PRIMARY KEY,
        pos bigint NOT NULL,
        data jsonb NOT NULL
      )`);
      await q("CREATE INDEX IF NOT EXISTS leads_pos_idx ON leads (pos DESC)");
      await q("CREATE INDEX IF NOT EXISTS leads_assigned_idx ON leads ((data->>'assignedTo'))");
      await q(`CREATE TABLE IF NOT EXISTS properties (
        id text PRIMARY KEY,
        pos bigserial,
        data jsonb NOT NULL
      )`);
      await q("CREATE INDEX IF NOT EXISTS properties_pos_idx ON properties (pos DESC)");
      await q(`CREATE TABLE IF NOT EXISTS tasks (
        id text PRIMARY KEY,
        pos bigserial,
        data jsonb NOT NULL
      )`);
      await q("CREATE INDEX IF NOT EXISTS tasks_pos_idx ON tasks (pos DESC)");
      await q("CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON tasks ((data->>'assignedTo'))");
      await q(`CREATE TABLE IF NOT EXISTS settings (
        key text PRIMARY KEY,
        data jsonb NOT NULL
      )`);
      await q(`CREATE TABLE IF NOT EXISTS platform_data (
        key text PRIMARY KEY,
        data jsonb NOT NULL
      )`);
      await q(`INSERT INTO platform_data (key, data) VALUES ('main', '{"organizations":[],"billing":{}}'::jsonb) ON CONFLICT (key) DO NOTHING`);
    },
    async close() {
      await pool.end();
    },

    /* users */
    async getUserByUsername(username) {
      const k = String(username || "").trim().toLowerCase();
      const { rows } = await q("SELECT data FROM users WHERE username_lower = $1", [k]);
      return rows[0] ? rows[0].data : null;
    },
    async listUsers() {
      const { rows } = await q("SELECT data FROM users ORDER BY seq");
      return rows.map((r) => r.data);
    },
    async addUser(user) {
      try {
        await q("INSERT INTO users (id, username_lower, data) VALUES ($1, $2, $3::jsonb)", [
          user.id,
          String(user.username).toLowerCase(),
          JSON.stringify(user),
        ]);
        return user;
      } catch (e) {
        if (e.code === "23505") {
          const err = new Error("duplicate username");
          err.code = "DUPLICATE_USERNAME";
          throw err;
        }
        throw e;
      }
    },
    async patchUser(id, patch) {
      const { rows } = await q("UPDATE users SET data = data || $2::jsonb WHERE id = $1 RETURNING data", [id, JSON.stringify(patch)]);
      return rows[0] ? rows[0].data : null;
    },

    /* leads */
    async listLeads(assignedTo) {
      const { rows } =
        assignedTo === undefined
          ? await q("SELECT data FROM leads ORDER BY pos DESC")
          : await q("SELECT data FROM leads WHERE data->>'assignedTo' = $1 ORDER BY pos DESC", [assignedTo]);
      return rows.map((r) => r.data);
    },
    async getLead(id) {
      const { rows } = await q("SELECT data FROM leads WHERE id = $1", [id]);
      return rows[0] ? rows[0].data : null;
    },
    async addLeads(leads) {
      if (!leads.length) return leads;
      await tx((c) => insertLeadsOn(c, leads));
      return leads;
    },
    async patchLead(id, patch) {
      const { rows } = await q("UPDATE leads SET data = data || $2::jsonb WHERE id = $1 RETURNING data", [id, JSON.stringify(patch)]);
      return rows[0] ? rows[0].data : null;
    },

    /* property inventory */
    async listProperties() { const { rows } = await q("SELECT data FROM properties ORDER BY pos DESC"); return rows.map((r) => r.data); },
    async getProperty(id) { const { rows } = await q("SELECT data FROM properties WHERE id = $1", [id]); return rows[0] ? rows[0].data : null; },
    async addProperty(property) { await q("INSERT INTO properties (id, data) VALUES ($1, $2::jsonb)", [property.id, JSON.stringify(property)]); return property; },
    async patchProperty(id, patch) { const { rows } = await q("UPDATE properties SET data = data || $2::jsonb WHERE id = $1 RETURNING data", [id, JSON.stringify(patch)]); return rows[0] ? rows[0].data : null; },
    async deleteProperty(id) { const { rowCount } = await q("DELETE FROM properties WHERE id = $1", [id]); return rowCount > 0; },

    /* follow-up tasks and site visits */
    async listTasks(assignedTo) { const { rows } = assignedTo === undefined ? await q("SELECT data FROM tasks ORDER BY pos DESC") : await q("SELECT data FROM tasks WHERE data->>'assignedTo' = $1 ORDER BY pos DESC", [assignedTo]); return rows.map((r) => r.data); },
    async getTask(id) { const { rows } = await q("SELECT data FROM tasks WHERE id = $1", [id]); return rows[0] ? rows[0].data : null; },
    async addTask(task) { await q("INSERT INTO tasks (id, data) VALUES ($1, $2::jsonb)", [task.id, JSON.stringify(task)]); return task; },
    async patchTask(id, patch) { const { rows } = await q("UPDATE tasks SET data = data || $2::jsonb WHERE id = $1 RETURNING data", [id, JSON.stringify(patch)]); return rows[0] ? rows[0].data : null; },
    async deleteTask(id) { const { rowCount } = await q("DELETE FROM tasks WHERE id = $1", [id]); return rowCount > 0; },

    /* settings */
    async getSettings() {
      const { rows } = await q("SELECT data FROM settings WHERE key = 'main'");
      return rows[0] ? rows[0].data : null;
    },
    async patchSettings(patch) {
      const { rows } = await q(
        `INSERT INTO settings (key, data) VALUES ('main', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET data = settings.data || EXCLUDED.data
         RETURNING data`, [JSON.stringify(patch)]
      );
      return rows[0].data;
    },
    async getPlatformData() {
      const { rows } = await q("SELECT data FROM platform_data WHERE key='main'");
      return rows[0]?.data || { organizations: [], billing: {} };
    },
    async updatePlatformData(updater) {
      return tx(async (c) => {
        const { rows } = await c.query("SELECT data FROM platform_data WHERE key='main' FOR UPDATE");
        const current = rows[0]?.data || { organizations: [], billing: {} };
        const next = updater(current) || current;
        await c.query("INSERT INTO platform_data (key, data) VALUES ('main', $1::jsonb) ON CONFLICT (key) DO UPDATE SET data=EXCLUDED.data", [JSON.stringify(next)]);
        return next;
      });
    },

    /* backup / restore */
    async counts() {
      const { rows } = await q("SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM properties)::int AS properties, (SELECT count(*) FROM tasks)::int AS tasks");
      return rows[0];
    },
    async exportAll() {
      return {
        users: await this.listUsers(),
        leads: await this.listLeads(),
        properties: await this.listProperties(),
        tasks: await this.listTasks(),
        settings: await this.getSettings(),
        platformData: await this.getPlatformData(),
      };
    },
    async replaceAll(doc) {
      const users = Array.isArray(doc.users) ? doc.users : [];
      const leads = Array.isArray(doc.leads) ? doc.leads : [];
      await tx(async (c) => {
        await c.query("DELETE FROM leads");
        await c.query("DELETE FROM properties");
        await c.query("DELETE FROM tasks");
        await c.query("DELETE FROM users");
        await c.query("DELETE FROM settings");
        await c.query("DELETE FROM platform_data");
        await insertUsersOn(c, users);
        if (leads.length) await insertLeadsOn(c, leads);
        for (const property of (Array.isArray(doc.properties) ? doc.properties : [])) await c.query("INSERT INTO properties (id, data) VALUES ($1, $2::jsonb)", [property.id, JSON.stringify(property)]);
        for (const task of (Array.isArray(doc.tasks) ? doc.tasks : [])) await c.query("INSERT INTO tasks (id, data) VALUES ($1, $2::jsonb)", [task.id, JSON.stringify(task)]);
        if (doc.settings) await c.query("INSERT INTO settings (key, data) VALUES ('main', $1::jsonb)", [JSON.stringify(doc.settings)]);
        await c.query("INSERT INTO platform_data (key, data) VALUES ('main', $1::jsonb)", [JSON.stringify(doc.platformData || { organizations: [], billing: {} })]);
      });
    },
  };
}

/* ------------------------------------------------------------------ */
function onHostedPlatform() {
  const e = process.env;
  return !!(e.RENDER || e.DYNO || e.FLY_APP_NAME || e.RAILWAY_ENVIRONMENT || e.K_SERVICE || e.VERCEL);
}

function createStore({ dataDir } = {}) {
  const url = process.env.DATABASE_URL;
  if (url) return createPgStore(url);
  return createFileStore(process.env.DATA_DIR || dataDir || __dirname);
}

module.exports = { createStore, onHostedPlatform };
