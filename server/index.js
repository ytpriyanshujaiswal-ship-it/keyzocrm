/**
 * Keyzo backend — ek office ke liye chhota self-contained server.
 *
 * Data kahan save hota hai (store.js dekho):
 *   - DATABASE_URL set hai  -> Postgres database (online hosting ke liye, data kabhi nahi udta)
 *   - DATABASE_URL set nahi -> db.json file (sirf apne PC pe local chalane ke liye)
 *
 * Run:  npm install   phir   npm start
 */
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { createStore, onHostedPlatform } = require("./store");

const app = express();

// Normalize configured origins (for example, remove a trailing slash) before
// comparing them with the browser's Origin header. Keep the deployed Netlify
// frontend explicitly allowed so a stale/misformatted Render variable cannot
// break every API preflight request.
function normalizeOrigin(value) {
  try {
    return new URL(String(value).trim()).origin;
  } catch {
    return "";
  }
}
const defaultAllowedOrigins = ["https://keyzocrm.netlify.app"];
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins])];
app.use(cors({
  origin(origin, callback) {
    // Requests without Origin (health checks/server-to-server) are not browser CORS requests.
    if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "5mb", verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));

// Online deploy karte waqt JWT_SECRET env variable me apna lamba random secret daalo.
const isProduction = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? "" : "keyzo-local-office-secret-2026");
if (isProduction && JWT_SECRET.length < 32) {
  console.error("STOP: Production me JWT_SECRET environment variable kam se kam 32 characters ka hona chahiye.");
  process.exit(1);
}
const PORT = process.env.PORT || 4000;

const store = createStore({ dataDir: __dirname });

// async route me error aaye to Express ko pass karo (warna request latak jaati hai)
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const DEFAULT_WA_TEMPLATE =
  "Hi {name}, this is regarding your interest in {project} {sector}. Let us know a good time to talk. Thank you!";

async function seedAdmin() {
  const initialUsername = process.env.INITIAL_ADMIN_USERNAME || (isProduction ? "" : "login@proptech");
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || (isProduction ? "" : "Proptech1234");
  if (!initialUsername || !initialPassword) {
    if (isProduction && (await store.counts()).users === 0) {
      throw new Error("Empty production database: set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD to bootstrap the first admin.");
    }
    return;
  }
  if (await store.getUserByUsername(initialUsername)) return;
  if (isProduction && initialPassword.length < 12) throw new Error("INITIAL_ADMIN_PASSWORD must be at least 12 characters in production.");
  await store.addUser({
    id: "U-" + Date.now(),
    username: initialUsername,
    passwordHash: bcrypt.hashSync(initialPassword, 12),
    role: process.env.INITIAL_ADMIN_ROLE === "superadmin" ? "superadmin" : "backend",
    organizationId: "default",
    name: "Backend Admin",
    createdAt: Date.now(),
    active: true,
  });
  console.log(`Seeded initial backend account: ${initialUsername}`);
}

async function seedSuperAdmin() {
  const username = process.env.SUPER_ADMIN_USERNAME;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!username || !password) return;
  if (password.length < 12) throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters.");
  const existing = await store.getUserByUsername(username);
  if (existing) { if (existing.role !== "superadmin") throw new Error("SUPER_ADMIN_USERNAME already belongs to a non-Super-Admin account. Choose a unique username."); return; }
  await store.addUser({ id: "SA-" + Date.now(), username, passwordHash: bcrypt.hashSync(password, 12), role: "superadmin", name: "Super Admin", organizationId: "platform", createdAt: Date.now(), active: true });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    Promise.resolve(store.getUserByUsername(payload.username)).then((current) => {
      if (!current || current.active === false || current.id !== payload.id || (current.passwordChangedAt && payload.iat * 1000 < current.passwordChangedAt)) {
        return res.status(401).json({ error: "Account inactive or session expired. Please log in again." });
      }
      req.user = { id: current.id, username: current.username, role: current.role, name: current.name, organizationId: current.organizationId || "default", organizationName: current.organizationName || "Default Organization" };
      next();
    }).catch(next);
  } catch {
    res.status(401).json({ error: "Session expired, please log in again." });
  }
}
function requireBackend(req, res, next) {
  if (req.user.role !== "backend") return res.status(403).json({ error: "Organization backend access only" });
  next();
}
function requireSuperAdmin(req, res, next) {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "Super Admin access only" });
  next();
}
const orgOf = (record) => record?.organizationId || "default";
const sameOrg = (record, req) => orgOf(record) === (req.user.organizationId || "default");
const CREDIT_COST_PER_SUCCESS = 3;
const FREE_CREDITS = 100;
const CREDIT_PACKAGES = [
  { id: "starter", name: "Starter", amount: 499, credits: 500 },
  { id: "growth", name: "Growth", amount: 999, credits: 1100 },
  { id: "pro", name: "Pro", amount: 1999, credits: 2400 },
  { id: "business", name: "Business", amount: 4999, credits: 6500 },
  { id: "scale", name: "Scale", amount: 9999, credits: 14000 },
];
async function getOrgBilling(orgId) {
  const platform = await store.getPlatformData();
  const current = platform.billing?.[orgId] || { balance: FREE_CREDITS, transactions: [] };
  return { balance: Number(current.balance || 0), transactions: current.transactions || [] };
}
async function reserveAiCredits(orgId, amount) {
  let balanceAfter = 0;
  await store.updatePlatformData((platform) => {
    platform.billing = platform.billing || {};
    const current = platform.billing[orgId] || { balance: FREE_CREDITS, transactions: [] };
    const balance = Number(current.balance ?? FREE_CREDITS);
    if (balance < amount) { const err = new Error("AI credits khatam ho gaye. Pehle package purchase karein."); err.code = "INSUFFICIENT_CREDITS"; throw err; }
    balanceAfter = balance - amount;
    platform.billing[orgId] = { ...current, balance: balanceAfter, transactions: current.transactions || [] };
    return platform;
  });
  return balanceAfter;
}
async function finishAiCredits(orgId, amount, success, actor) {
  await store.updatePlatformData((platform) => {
    platform.billing = platform.billing || {};
    const current = platform.billing[orgId] || { balance: FREE_CREDITS, transactions: [] };
    const transactions = current.transactions || [];
    if (success) {
      transactions.unshift({ id: "CR-" + Date.now() + "-" + crypto.randomBytes(2).toString("hex"), at: Date.now(), delta: -amount, balanceAfter: Number(current.balance ?? 0), type: "ai_usage", status: "successful", note: "AI lead insight", actor });
      platform.billing[orgId] = { ...current, transactions: transactions.slice(0, 1000) };
    } else {
      platform.billing[orgId] = { ...current, balance: Number(current.balance ?? 0) + amount, transactions };
    }
    return platform;
  });
}

app.get("/api/health", (req, res) => res.json({ ok: true, name: "Keyzo", storage: store.mode }));

const loginAttempts = new Map();
app.post(
  "/api/login",
  ah(async (req, res) => {
    const { username, password } = req.body || {};
    const key = `${req.ip}:${String(username || "").trim().toLowerCase()}`;
    const now = Date.now();
    const previous = loginAttempts.get(key);
    if (previous && previous.lockedUntil > now) return res.status(429).json({ error: "Too many login attempts. Please wait 15 minutes and try again." });
    const u = await store.getUserByUsername(username);
    if (!u || !bcrypt.compareSync(String(password || ""), u.passwordHash)) {
      const attempts = previous && now - previous.firstAt < 15 * 60 * 1000 ? previous.count + 1 : 1;
      loginAttempts.set(key, { count: attempts, firstAt: previous && now - previous.firstAt < 15 * 60 * 1000 ? previous.firstAt : now, lockedUntil: attempts >= 8 ? now + 15 * 60 * 1000 : 0 });
      return res.status(attempts >= 8 ? 429 : 401).json({ error: attempts >= 8 ? "Too many login attempts. Please wait 15 minutes and try again." : "Username ya password galat hai." });
    }
    loginAttempts.delete(key);
    if (u.active === false) return res.status(403).json({ error: "Ye account deactivate hai." });
    const token = jwt.sign({ id: u.id, username: u.username, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: u.id, username: u.username, role: u.role, name: u.name, organizationId: u.organizationId || "default", organizationName: u.organizationName || "Default Organization" } });
  })
);

app.get("/api/me", auth, (req, res) => res.json(req.user));

// Lightweight agent directory (names/usernames only) so both backend and
// calling-team users can transfer a lead to a colleague.
app.get(
  "/api/agents",
  auth,
  ah(async (req, res) => {
    const users = await store.listUsers();
    res.json(users.filter((u) => (u.organizationId || "default") === (req.user.organizationId || "default") && u.role === "calling" && u.active !== false).map((u) => ({ username: u.username, name: u.name })));
  })
);

/* ---- Users (backend-only management) ---- */
// Never send passwords or password hashes to the browser.
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  role: u.role === "calling" ? "calling" : "backend",
  name: u.name,
  createdAt: u.createdAt,
  active: u.active !== false,
});

app.get(
  "/api/users",
  auth,
  requireBackend,
  ah(async (req, res) => {
    res.json((await store.listUsers()).filter((u) => (u.organizationId || "default") === (req.user.organizationId || "default")).map(publicUser));
  })
);

app.post(
  "/api/users",
  auth,
  requireBackend,
  ah(async (req, res) => {
    const { name, username, password } = req.body || {};
    const role = req.body?.role === "backend" ? "backend" : "calling";
    const cleanName = String(name || "").trim();
    const cleanUsername = String(username || "").trim();
    const cleanPassword = String(password || "");
    if (!cleanName || !cleanUsername || !cleanPassword || cleanPassword.length < 10) {
      return res.status(400).json({ error: "Name, username, aur kam se kam 10-character password chahiye." });
    }
    if (cleanUsername.length > 120 || cleanName.length > 120) {
      return res.status(400).json({ error: "Name ya username bahut lamba hai." });
    }
    const u = {
      id: "U-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      username: cleanUsername,
      passwordHash: bcrypt.hashSync(cleanPassword, 12),
      role,
      organizationId: req.user.organizationId || "default",
      organizationName: req.user.organizationName || "Default Organization",
      name: cleanName,
      createdAt: Date.now(),
      active: true,
    };
    try {
      await store.addUser(u);
    } catch (e) {
      if (e.code === "DUPLICATE_USERNAME") return res.status(409).json({ error: "Ye username pehle se hai." });
      throw e;
    }
    res.json(publicUser(u));
  })
);

app.patch(
  "/api/users/:id",
  auth,
  requireBackend,
  ah(async (req, res) => {
    const patch = {};
    if (req.params.id === req.user.id && req.body.active === false) {
      return res.status(400).json({ error: "Apna khud ka account deactivate nahi kar sakte." });
    }
    if (typeof req.body.active === "boolean") patch.active = req.body.active;
    if (req.body.password !== undefined) {
      const password = String(req.body.password || "");
      if (password.length < 10) return res.status(400).json({ error: "Password kam se kam 10 characters ka hona chahiye." });
      patch.password = null;
      patch.passwordHash = bcrypt.hashSync(password, 12);
      patch.passwordChangedAt = Date.now();
    }
    const existingUser = (await store.listUsers()).find((x) => x.id === req.params.id && (x.organizationId || "default") === (req.user.organizationId || "default"));
    if (!existingUser) return res.status(404).json({ error: "Not found" });
    const u = await store.patchUser(req.params.id, patch);
    if (!u) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  })
);

/* ---- Leads ---- */
app.get(
  "/api/leads",
  auth,
  ah(async (req, res) => {
    res.json((await store.listLeads(req.user.role === "backend" ? undefined : req.user.username)).filter((l) => sameOrg(l, req)));
  })
);

app.post(
  "/api/leads",
  auth,
  requireBackend,
  ah(async (req, res) => {
    const lead = {
      id: "L-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      organizationId: req.user.organizationId || "default",
      name: req.body.name || "",
      phone: req.body.phone || "",
      email: req.body.email || "",
      project: req.body.project || "",
      sector: req.body.sector || "",
      source: req.body.source || "Other",
      estimate: req.body.estimate || "",
      assignedTo: req.body.assignedTo || "",
      status: "new",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notes: [],
      history: [{ at: Date.now(), by: req.user.name, action: "Lead created" }],
      removed: false,
    };
    if (lead.assignedTo) {
      const assignee = await store.getUserByUsername(lead.assignedTo);
      if (!assignee || (assignee.organizationId || "default") !== (req.user.organizationId || "default") || assignee.role !== "calling" || assignee.active === false) return res.status(400).json({ error: "Choose an active calling-team account from your organization." });
    }
    await store.addLeads([lead]);
    res.json(lead);
  })
);

app.post("/api/leads/self", auth, ah(async (req, res) => {
  if (req.user.role !== "calling") return res.status(403).json({ error: "Only calling team members can use this quick-add endpoint." });
  const name = cleanText(req.body?.name, 120); const phone = cleanText(req.body?.phone, 40);
  if (!name || phone.replace(/\D/g, "").length < 7) return res.status(400).json({ error: "Name and a valid phone number are required." });
  const now = Date.now();
  const lead = { id: "L-" + now + "-" + crypto.randomBytes(3).toString("hex"), organizationId: req.user.organizationId || "default", name, phone, email: cleanText(req.body?.email, 180), project: cleanText(req.body?.project, 180), sector: cleanText(req.body?.sector, 180), source: cleanText(req.body?.source || "Other", 100), estimate: cleanText(req.body?.estimate, 100), assignedTo: req.user.username, status: "new", createdAt: now, updatedAt: now, notes: [], history: [{ at: now, by: req.user.name, action: "Lead added by calling team member" }], removed: false };
  await store.addLeads([lead]); res.status(201).json(lead);
}));

// Lead-source ingestion bridge. Configure LEAD_SOURCE_TOKENS as a JSON object
// mapping each private integration token to an organization ID, e.g. {"long-random-token":"ORG-..."}.
// External providers should send normalized lead objects to this endpoint; credentials stay server-side.
app.post("/api/integrations/leads/webhook", ah(async (req, res) => {
  const configured = process.env.LEAD_SOURCE_TOKENS;
  if (!configured) return res.status(503).json({ error: "Lead-source webhook is not configured. Set LEAD_SOURCE_TOKENS on the backend host." });
  let tokenMap;
  try { tokenMap = JSON.parse(configured); } catch { return res.status(503).json({ error: "LEAD_SOURCE_TOKENS must be a valid JSON object mapping tokens to organization IDs." }); }
  const supplied = String(req.get("x-keyzo-lead-token") || req.body?.integrationToken || "");
  const entry = Object.entries(tokenMap || {}).find(([candidate]) => {
    const a = Buffer.from(String(candidate)); const b = Buffer.from(supplied);
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  });
  if (!entry) return res.status(401).json({ error: "Invalid lead-source integration token." });
  const organizationId = String(entry[1] || "");
  if (!organizationId) return res.status(400).json({ error: "Integration token has no organization mapping." });
  if (organizationId !== "default") {
    const platform = await store.getPlatformData();
    const org = (platform.organizations || []).find(o => o.id === organizationId && o.active !== false);
    if (!org) return res.status(403).json({ error: "Mapped organization is missing or inactive." });
  }
  const input = Array.isArray(req.body?.leads) ? req.body.leads : [req.body?.lead || req.body];
  if (!input.length || input.length > 100) return res.status(400).json({ error: "Send between 1 and 100 leads per request." });
  const now = Date.now();
  const leadsToCreate = input.map((row, i) => {
    const name = cleanText(row?.name || row?.full_name || row?.customer_name, 120);
    const phone = cleanText(row?.phone || row?.mobile || row?.phone_number, 40);
    if (!name || phone.replace(/\D/g, "").length < 7) return null;
    return { id: "L-" + (now + i) + "-" + crypto.randomBytes(3).toString("hex"), organizationId, name, phone,
      email: cleanText(row?.email, 180), project: cleanText(row?.project || row?.property || row?.project_name, 180),
      sector: cleanText(row?.sector || row?.location || row?.city, 180), source: cleanText(row?.source || row?.lead_source || "External integration", 100),
      estimate: cleanText(row?.estimate || row?.budget, 100), assignedTo: "", status: "new", createdAt: now, updatedAt: now,
      notes: [], history: [{ at: now, by: "Lead-source integration", action: "Lead received via external integration" }], removed: false };
  });
  const valid = leadsToCreate.filter(Boolean);
  if (!valid.length) return res.status(400).json({ error: "No valid leads. Each lead needs a name and a valid phone number." });
  await store.addLeads(valid);
  res.status(201).json({ ok: true, received: valid.length, skipped: input.length - valid.length, leadIds: valid.map(l => l.id) });
}));

app.patch(
  "/api/leads/:id",
  auth,
  ah(async (req, res) => {
    const lead = await store.getLead(req.params.id);
    if (!lead || !sameOrg(lead, req)) return res.status(404).json({ error: "Not found" });
    if (req.user.role !== "backend" && lead.assignedTo !== req.user.username) {
      return res.status(403).json({ error: "Ye lead aapko assign nahi hai." });
    }
    const allowed = new Set(["name", "phone", "email", "project", "sector", "source", "status", "tags", "estimate", "nextActivity", "notes", "history", "removed", "removedBy", "removedByName", "removedAt", "removeReason", "lostReason", "assignedTo"]);
    const patch = {};
    for (const [key, value] of Object.entries(req.body || {})) if (allowed.has(key)) patch[key] = value;
    if (req.user.role !== "backend") {
      delete patch.assignedTo;
      delete patch.removedBy;
      delete patch.removedByName;
      delete patch.removedAt;
    }
    if (patch.name !== undefined && (typeof patch.name !== "string" || patch.name.trim().length > 120)) return res.status(400).json({ error: "Invalid lead name." });
    if (patch.phone !== undefined && (typeof patch.phone !== "string" || patch.phone.length > 40)) return res.status(400).json({ error: "Invalid phone number." });
    if (patch.status !== undefined && !["new", "contacted", "followup", "site_visit", "negotiation", "converted", "not_interested"].includes(patch.status)) return res.status(400).json({ error: "Invalid lead status." });
    if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.length > 30)) return res.status(400).json({ error: "Invalid tags." });
    if (patch.notes !== undefined && !Array.isArray(patch.notes)) return res.status(400).json({ error: "Invalid notes." });
    if (patch.history !== undefined && !Array.isArray(patch.history)) return res.status(400).json({ error: "Invalid activity history." });
    if (patch.assignedTo !== undefined && typeof patch.assignedTo !== "string") return res.status(400).json({ error: "Invalid assignee." });
    if (patch.assignedTo && req.user.role === "backend") {
      const assignee = await store.getUserByUsername(patch.assignedTo);
      if (!assignee || (assignee.organizationId || "default") !== (req.user.organizationId || "default") || assignee.role !== "calling" || assignee.active === false) return res.status(400).json({ error: "Choose an active Frontend/Sales team account." });
    }
    patch.updatedAt = Date.now();
    const updated = await store.patchLead(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  })
);

// Bulk import — validates rows, skips malformed records and deduplicates by normalized phone.
app.post(
  "/api/leads/bulk",
  auth,
  requireBackend,
  ah(async (req, res) => {
    const { leads, distributeAmong } = req.body || {};
    if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: "No leads provided" });
    if (leads.length > 5000) return res.status(413).json({ error: "Maximum 5,000 rows per import. Split the spreadsheet into smaller files." });
    const phoneKey = (value) => {
      let digits = String(value ?? "").replace(/\D/g, "");
      if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
      if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
      return digits;
    };
    const existing = (await store.listLeads()).filter((l) => sameOrg(l, req));
    const seen = new Set(existing.map(l => phoneKey(l.phone)).filter(p => p.length >= 7));
    const created = [];
    let skippedDuplicateCount = 0;
    let skippedInvalidCount = 0;
    for (const raw of leads) {
      const name = String(raw?.name || "").trim().slice(0, 120);
      const phone = String(raw?.phone || "").trim().slice(0, 40);
      const normalizedPhone = phoneKey(phone);
      if (!name || normalizedPhone.length < 7) { skippedInvalidCount += 1; continue; }
      if (seen.has(normalizedPhone)) { skippedDuplicateCount += 1; continue; }
      seen.add(normalizedPhone);
      const assignedTo = distributeAmong && distributeAmong.length ? distributeAmong[created.length % distributeAmong.length] : String(raw?.assignedTo || "");
      if (assignedTo) {
        const assignee = await store.getUserByUsername(assignedTo);
        if (!assignee || (assignee.organizationId || "default") !== (req.user.organizationId || "default") || assignee.role !== "calling" || assignee.active === false) {
          return res.status(400).json({ error: `Choose an active Frontend/Sales team account before importing. Invalid account: ${assignedTo}` });
        }
      }
      const now = Date.now();
      created.push({
        id: "L-" + now + "-" + created.length + "-" + Math.random().toString(36).slice(2, 6),
        organizationId: req.user.organizationId || "default",
        name,
        phone,
        email: String(raw?.email || "").trim().slice(0, 180),
        project: String(raw?.project || "").trim().slice(0, 180),
        sector: String(raw?.sector || "").trim().slice(0, 180),
        source: String(raw?.source || "Other").trim().slice(0, 100) || "Other",
        assignedTo,
        status: "new",
        tags: [],
        estimate: String(raw?.estimate || "").trim().slice(0, 100),
        nextActivity: null,
        createdAt: now,
        updatedAt: now,
        notes: [],
        history: [{ at: now, by: req.user.name, action: assignedTo ? `Imported & assigned to ${assignedTo}` : "Imported" }],
        removed: false,
      });
    }
    if (created.length) await store.addLeads(created);
    res.json({ count: created.length, leads: created, skippedDuplicateCount, skippedInvalidCount });
  })
);

/* ---- Property inventory ---- */
const cleanText = (value, max = 160) => String(value ?? "").trim().slice(0, max);
app.get("/api/properties", auth, ah(async (req, res) => {
  const rows = await store.listProperties();
  res.json(rows.filter((p) => sameOrg(p, req) && (req.user.role === "backend" || p.status !== "archived")));
}));
app.post("/api/properties", auth, requireBackend, ah(async (req, res) => {
  const b = req.body || {};
  const name = cleanText(b.name, 140);
  if (!name) return res.status(400).json({ error: "Property/project name is required." });
  const property = {
    organizationId: req.user.organizationId || "default",
    id: "P-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    name, developer: cleanText(b.developer, 140), location: cleanText(b.location, 180),
    type: ["Apartment", "Villa", "Plot", "Commercial", "Studio", "Other"].includes(b.type) ? b.type : "Apartment",
    bhk: cleanText(b.bhk, 40), area: cleanText(b.area, 60), price: cleanText(b.price, 60),
    status: ["available", "limited", "sold_out", "archived"].includes(b.status) ? b.status : "available",
    description: cleanText(b.description, 1000), createdAt: Date.now(), updatedAt: Date.now(), createdBy: req.user.username,
  };
  await store.addProperty(property); res.status(201).json(property);
}));
app.patch("/api/properties/:id", auth, requireBackend, ah(async (req, res) => {
  const existing = await store.getProperty(req.params.id);
  if (!existing || !sameOrg(existing, req)) return res.status(404).json({ error: "Property not found." });
  const allowed = ["name", "developer", "location", "type", "bhk", "area", "price", "status", "description"];
  const patch = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = cleanText(req.body[key], key === "description" ? 1000 : 180);
  if (patch.name !== undefined && !patch.name) return res.status(400).json({ error: "Project name cannot be empty." });
  if (patch.status && !["available", "limited", "sold_out", "archived"].includes(patch.status)) return res.status(400).json({ error: "Invalid inventory status." });
  if (patch.type && !["Apartment", "Villa", "Plot", "Commercial", "Studio", "Other"].includes(patch.type)) return res.status(400).json({ error: "Invalid property type." });
  patch.updatedAt = Date.now();
  const result = await store.patchProperty(req.params.id, patch);
  if (!result) return res.status(404).json({ error: "Property not found." });
  res.json(result);
}));
app.delete("/api/properties/:id", auth, requireBackend, ah(async (req, res) => {
  const existing = await store.getProperty(req.params.id);
  if (!existing || !sameOrg(existing, req)) return res.status(404).json({ error: "Property not found." });
  const result = await store.patchProperty(req.params.id, { status: "archived", updatedAt: Date.now() });
  if (!result) return res.status(404).json({ error: "Property not found." });
  res.json({ ok: true });
}));

/* ---- Follow-up tasks and site visits ---- */
app.get("/api/tasks", auth, ah(async (req, res) => {
  const rows = await store.listTasks(req.user.role === "backend" ? undefined : req.user.username);
  res.json(rows.filter((t) => sameOrg(t, req)));
}));
app.post("/api/tasks", auth, ah(async (req, res) => {
  const b = req.body || {};
  const title = cleanText(b.title, 180);
  const dueAt = Number(b.dueAt);
  if (!title || !Number.isFinite(dueAt) || dueAt <= 0) return res.status(400).json({ error: "Task title and due date/time are required." });
  const allowedType = ["call", "followup", "site_visit", "meeting", "revisit", "other"];
  const task = {
    id: "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), organizationId: req.user.organizationId || "default", title,
    type: allowedType.includes(b.type) ? b.type : "followup", dueAt,
    leadId: cleanText(b.leadId, 100), leadName: cleanText(b.leadName, 140), project: cleanText(b.project, 140),
    notes: cleanText(b.notes, 1000), status: "open",
    assignedTo: req.user.role === "backend" && typeof b.assignedTo === "string" ? cleanText(b.assignedTo, 120) : req.user.username,
    createdBy: req.user.username, createdByName: req.user.name, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (req.user.role === "backend" && task.assignedTo && task.assignedTo !== req.user.username) {
    const assignee = await store.getUserByUsername(task.assignedTo);
    if (!assignee || (assignee.organizationId || "default") !== (req.user.organizationId || "default") || assignee.role !== "calling" || assignee.active === false) return res.status(400).json({ error: "Choose an active Frontend/Sales team account." });
  }
  await store.addTask(task); res.status(201).json(task);
}));
app.patch("/api/tasks/:id", auth, ah(async (req, res) => {
  const task = await store.getTask(req.params.id);
  if (!task || !sameOrg(task, req)) return res.status(404).json({ error: "Task not found." });
  if (req.user.role !== "backend" && task.assignedTo !== req.user.username) return res.status(403).json({ error: "This task is assigned to another user." });
  const patch = {};
  if (typeof req.body?.status === "string" && ["open", "done", "cancelled"].includes(req.body.status)) patch.status = req.body.status;
  if (typeof req.body?.notes === "string") patch.notes = cleanText(req.body.notes, 1000);
  if (req.user.role === "backend" && typeof req.body?.assignedTo === "string") {
    const target = cleanText(req.body.assignedTo, 120);
    if (target && target !== req.user.username) {
      const assignee = await store.getUserByUsername(target);
      if (!assignee || (assignee.organizationId || "default") !== (req.user.organizationId || "default") || assignee.role !== "calling" || assignee.active === false) return res.status(400).json({ error: "Choose an active Frontend/Sales team account." });
    }
    patch.assignedTo = target;
  }
  patch.updatedAt = Date.now();
  res.json(await store.patchTask(req.params.id, patch));
}));
app.delete("/api/tasks/:id", auth, ah(async (req, res) => {
  const task = await store.getTask(req.params.id);
  if (!task || !sameOrg(task, req)) return res.status(404).json({ error: "Task not found." });
  if (req.user.role !== "backend" && task.assignedTo !== req.user.username) return res.status(403).json({ error: "This task is assigned to another user." });
  await store.deleteTask(req.params.id); res.json({ ok: true });
}));

/* ---- Super Admin: organizations and isolated organization billing ---- */
app.get("/api/super/organizations", auth, requireSuperAdmin, ah(async (req, res) => {
  const platform = await store.getPlatformData();
  const users = await store.listUsers();
  res.json((platform.organizations || []).map((o) => ({ ...o, userCount: users.filter((u) => (u.organizationId || "default") === o.id && u.role !== "superadmin").length, creditBalance: Number(platform.billing?.[o.id]?.balance ?? FREE_CREDITS) })));
}));
app.post("/api/super/organizations", auth, requireSuperAdmin, ah(async (req, res) => {
  const name = cleanText(req.body?.name, 120);
  const adminName = cleanText(req.body?.adminName, 120);
  const username = cleanText(req.body?.username, 120);
  const password = String(req.body?.password || "");
  if (!name || !adminName || !username || password.length < 10) return res.status(400).json({ error: "Organization name, admin name, username and 10+ character password are required." });
  const id = "ORG-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
  const org = { id, name, createdAt: Date.now(), active: true };
  await store.updatePlatformData((platform) => {
    platform.organizations = platform.organizations || [];
    platform.billing = platform.billing || {};
    platform.organizations.push(org);
    platform.billing[id] = { balance: FREE_CREDITS, transactions: [{ id: "CR-FREE-" + id, at: Date.now(), delta: FREE_CREDITS, balanceAfter: FREE_CREDITS, type: "free_grant", note: "Non-expiring free credits" }], pendingOrders: {} };
    return platform;
  });
  const user = { id: "U-" + Date.now() + "-" + crypto.randomBytes(2).toString("hex"), username, passwordHash: bcrypt.hashSync(password, 12), role: "backend", organizationId: id, organizationName: name, name: adminName, createdAt: Date.now(), active: true };
  try { await store.addUser(user); } catch (e) {
    await store.updatePlatformData((platform) => { platform.organizations = (platform.organizations || []).filter((o) => o.id !== id); delete platform.billing?.[id]; return platform; });
    if (e.code === "DUPLICATE_USERNAME") return res.status(409).json({ error: "This username is already in use; usernames must be unique across organizations." });
    throw e;
  }
  res.status(201).json({ ...org, admin: publicUser(user), creditBalance: FREE_CREDITS });
}));
app.get("/api/billing/credits", auth, ah(async (req, res) => {
  if (req.user.role === "superadmin") return res.status(403).json({ error: "Super Admin has no organization AI balance." });
  const billing = await getOrgBilling(req.user.organizationId || "default");
  res.json({ balance: billing.balance, transactions: billing.transactions.slice(0, 30), packages: CREDIT_PACKAGES, razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), razorpayKeyId: process.env.RAZORPAY_KEY_ID || "", aiEnabled: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY), aiPrimary: process.env.GEMINI_API_KEY ? "Gemini" : (process.env.OPENAI_API_KEY ? "OpenAI" : "Not configured") });
}));
app.post("/api/billing/create-order", auth, ah(async (req, res) => {
  if (req.user.role === "superadmin") return res.status(403).json({ error: "Organization account required." });
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ error: "Payment setup pending: configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the backend host." });
  const pack = CREDIT_PACKAGES.find((p) => p.id === req.body?.packageId);
  if (!pack) return res.status(400).json({ error: "Invalid credit package." });
  const response = await fetch("https://api.razorpay.com/v1/orders", { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64"), "Content-Type": "application/json" }, body: JSON.stringify({ amount: pack.amount * 100, currency: "INR", receipt: `keyzo_${(req.user.organizationId || "default").slice(-18)}_${Date.now()}`, notes: { organizationId: req.user.organizationId || "default", packageId: pack.id, credits: String(pack.credits) } }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) return res.status(502).json({ error: "Payment provider could not create an order. Please retry later." });
  await store.updatePlatformData((platform) => { platform.billing = platform.billing || {}; const b = platform.billing[req.user.organizationId || "default"] || { balance: FREE_CREDITS, transactions: [] }; b.pendingOrders = b.pendingOrders || {}; b.pendingOrders[data.id] = { packageId: pack.id, amount: pack.amount, credits: pack.credits, createdAt: Date.now(), organizationId: req.user.organizationId || "default" }; platform.billing[req.user.organizationId || "default"] = b; return platform; });
  res.json({ orderId: data.id, amount: data.amount, currency: data.currency, keyId: process.env.RAZORPAY_KEY_ID, package: pack });
}));
app.post("/api/billing/razorpay-webhook", ah(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Webhook secret is not configured." });
  const signature = String(req.get("x-razorpay-signature") || "");
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody || Buffer.alloc(0)).digest("hex");
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  if (!signature || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: "Invalid webhook signature." });
  const event = req.body?.event;
  if (event !== "payment.captured") return res.json({ ok: true, ignored: true });
  const payment = req.body?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id || payment.status !== "captured") return res.status(400).json({ error: "Captured payment payload is incomplete." });
  let outcome = { ok: true, alreadyCredited: false };
  await store.updatePlatformData((platform) => {
    platform.billing = platform.billing || {};
    const orgId = String(payment.notes?.organizationId || "");
    const billing = platform.billing[orgId];
    if (!orgId || !billing) { outcome = { error: "Organization billing record not found." }; return platform; }
    billing.transactions = billing.transactions || []; billing.pendingOrders = billing.pendingOrders || {};
    if (billing.transactions.some((t) => t.paymentId === payment.id)) { outcome = { ok: true, alreadyCredited: true }; return platform; }
    const pending = billing.pendingOrders[payment.order_id];
    if (!pending || pending.organizationId !== orgId || Number(payment.amount) !== Number(pending.amount) * 100 || payment.currency !== "INR") {
      outcome = { error: "Payment does not match a pending credit order." }; return platform;
    }
    const balance = Number(billing.balance ?? FREE_CREDITS) + Number(pending.credits);
    billing.balance = balance;
    billing.transactions.unshift({ id: "CR-" + Date.now(), at: Date.now(), delta: Number(pending.credits), balanceAfter: balance, type: "purchase", packageId: pending.packageId, amount: pending.amount, paymentId: payment.id, orderId: payment.order_id, note: "Verified Razorpay webhook" });
    delete billing.pendingOrders[payment.order_id];
    platform.billing[orgId] = billing;
    outcome = { ok: true, balance, alreadyCredited: false };
    return platform;
  });
  if (outcome.error) return res.status(400).json({ error: outcome.error });
  return res.json(outcome);
}));

app.post("/api/billing/verify", auth, ah(async (req, res) => {
  if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ error: "Payment verification is not configured." });
  const orderId = String(req.body?.razorpay_order_id || "");
  const paymentId = String(req.body?.razorpay_payment_id || "");
  const signature = String(req.body?.razorpay_signature || "");
  if (!orderId || !paymentId || !signature) return res.status(400).json({ error: "Payment verification fields are incomplete." });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: "Payment signature is invalid." });
  // A valid checkout signature alone does not prove that the payment was captured.
  // Confirm the payment directly with Razorpay before granting credits.
  const authHeader = "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const providerResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: authHeader } });
  const providerPayment = await providerResponse.json().catch(() => ({}));
  if (!providerResponse.ok || providerPayment.status !== "captured" || providerPayment.order_id !== orderId) {
    return res.status(400).json({ error: "Payment is not captured or does not match this order. Credits were not added." });
  }
  const orgId = req.user.organizationId || "default";
  let outcome;
  await store.updatePlatformData((platform) => {
    platform.billing = platform.billing || {};
    const billing = platform.billing[orgId] || { balance: FREE_CREDITS, transactions: [], pendingOrders: {} };
    billing.transactions = billing.transactions || []; billing.pendingOrders = billing.pendingOrders || {};
    const already = billing.transactions.find((t) => t.paymentId === paymentId);
    if (already) { outcome = { balance: billing.balance, alreadyCredited: true }; return platform; }
    const pending = billing.pendingOrders[orderId];
    if (!pending || pending.organizationId !== orgId) { outcome = { error: "This payment order does not belong to this organization." }; return platform; }
    if (Number(providerPayment.amount) !== Number(pending.amount) * 100 || providerPayment.currency !== "INR") { outcome = { error: "Captured payment amount does not match this credit package. Credits were not added." }; return platform; }
    const balance = Number(billing.balance ?? FREE_CREDITS) + Number(pending.credits);
    billing.balance = balance;
    billing.transactions.unshift({ id: "CR-" + Date.now(), at: Date.now(), delta: Number(pending.credits), balanceAfter: balance, type: "purchase", packageId: pending.packageId, amount: pending.amount, paymentId, orderId, note: "Verified Razorpay payment" });
    delete billing.pendingOrders[orderId];
    platform.billing[orgId] = billing; outcome = { balance, alreadyCredited: false }; return platform;
  });
  if (outcome?.error) return res.status(400).json({ error: outcome.error });
  res.json({ ok: true, ...outcome });
}));

/* ---- Optional AI and WhatsApp Business integrations ---- */
app.get("/api/integrations/status", auth, (req, res) => {
  res.json({ aiEnabled: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY), aiPrimary: process.env.GEMINI_API_KEY ? "Gemini" : (process.env.OPENAI_API_KEY ? "OpenAI" : "Not configured"), aiProviders: { gemini: Boolean(process.env.GEMINI_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY) }, whatsappEnabled: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) });
});
app.post("/api/ai/lead-insights", auth, ah(async (req, res) => {
  if (req.user.role === "superadmin") return res.status(403).json({ error: "Organization account required." });
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) return res.status(503).json({ error: "AI integration is not configured. Set GEMINI_API_KEY and/or OPENAI_API_KEY on the backend host." });
  const leadId = cleanText(req.body?.leadId, 100);
  const lead = await store.getLead(leadId);
  if (!lead || !sameOrg(lead, req)) return res.status(404).json({ error: "Lead not found." });
  if (req.user.role !== "backend" && lead.assignedTo !== req.user.username) return res.status(403).json({ error: "This lead is not assigned to you." });
  const safeLead = {
    name: cleanText(lead.name, 120), project: cleanText(lead.project, 140), sector: cleanText(lead.sector, 100),
    status: cleanText(lead.status, 40), source: cleanText(lead.source, 80),
    notes: (Array.isArray(lead.notes) ? lead.notes : []).slice(-8).map((n) => cleanText(n.text || n.note || "", 500)).filter(Boolean),
    history: (Array.isArray(lead.history) ? lead.history : []).slice(-8).map((h) => cleanText(h.action || "", 240)).filter(Boolean),
  };
  const orgId = req.user.organizationId || "default";
  try { await reserveAiCredits(orgId, CREDIT_COST_PER_SUCCESS); }
  catch (e) { if (e.code === "INSUFFICIENT_CREDITS") return res.status(402).json({ error: e.message }); throw e; }

  const systemPrompt = "You are a real-estate sales coach. Give concise, ethical and practical lead insights. Never invent facts, avoid high-pressure tactics, and clearly label unknown information. Output: lead summary, suggested next action, 3 discovery questions, and a respectful follow-up message.";
  const userPrompt = `Analyze this CRM lead data. Do not ask for or infer private data beyond what is provided.\\n${JSON.stringify(safeLead)}`;
  let output = "";
  let providerUsed = "";
  const failures = [];

  // Gemini is the preferred provider; OpenAI is a fallback when Gemini fails.
  if (process.env.GEMINI_API_KEY) {
    try {
      const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: userPrompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 900 } })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        output = (data.candidates || []).flatMap((c) => c.content?.parts || []).map((part) => part.text || "").join("\\n").trim();
        if (output) providerUsed = "Gemini";
      } else {
        console.error("Gemini provider error:", response.status, data?.error?.status || "unknown");
        failures.push("Gemini");
      }
    } catch (e) { failures.push("Gemini"); }
  }
  if (!output && process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ] })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        output = data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("\\n").trim();
        if (output) providerUsed = "OpenAI";
      } else {
        console.error("OpenAI provider error:", response.status, data?.error?.code || "unknown");
        failures.push("OpenAI");
      }
    } catch (e) { failures.push("OpenAI"); }
  }
  if (!output) {
    await finishAiCredits(orgId, CREDIT_COST_PER_SUCCESS, false, req.user.username);
    return res.status(502).json({ error: failures.length ? `AI providers failed (${failures.join(" and ")}). No net credits were charged; try again.` : "AI provider returned no text. No net credits were charged." });
  }
  await finishAiCredits(orgId, CREDIT_COST_PER_SUCCESS, true, req.user.username);
  res.json({ leadId, insights: output, provider: providerUsed, creditsCharged: CREDIT_COST_PER_SUCCESS });
}));
app.post("/api/whatsapp/send", auth, ah(async (req, res) => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return res.status(503).json({ error: "WhatsApp Business API is not configured on the backend host." });
  const to = String(req.body?.to || "").replace(/\D/g, "");
  const message = cleanText(req.body?.message, 4000);
  if (to.length < 10 || to.length > 15 || !message) return res.status(400).json({ error: "A valid international phone number and message are required." });
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: message } })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("WhatsApp provider error:", response.status, data?.error?.code || "unknown");
    return res.status(502).json({ error: "WhatsApp send failed. Check Meta setup, recipient opt-in and template/policy requirements." });
  }
  res.json({ ok: true, messageId: data.messages?.[0]?.id || null });
}));

/* ---- Shared settings (e.g. WhatsApp message template) ---- */
app.get(
  "/api/settings",
  auth,
  ah(async (req, res) => {
    const all = (await store.getSettings()) || {};
    res.json(all.orgSettings?.[req.user.organizationId || "default"] || ( (req.user.organizationId || "default") === "default" ? { waTemplate: all.waTemplate || DEFAULT_WA_TEMPLATE } : { waTemplate: DEFAULT_WA_TEMPLATE } ));
  })
);
app.put(
  "/api/settings",
  auth,
  requireBackend,
  ah(async (req, res) => {
    const all = (await store.getSettings()) || {};
    const orgSettings = { ...(all.orgSettings || {}), [req.user.organizationId || "default"]: { ...(all.orgSettings?.[req.user.organizationId || "default"] || { waTemplate: ((req.user.organizationId || "default") === "default" ? all.waTemplate : null) || DEFAULT_WA_TEMPLATE }), ...(req.body || {}) } };
    await store.patchSettings({ orgSettings });
    res.json(orgSettings[req.user.organizationId || "default"]);
  })
);

// error handler: server crash/latak jaane ke bajaye saaf JSON error
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: err.expose ? err.message : "Server me dikkat aayi, thodi der baad dobara try karo." });
});

/* ---- start ---- */
async function main() {
  // Online hosting (Render etc.) pe file-storage ka matlab hai ki data har restart pe ud jaata hai.
  // Isliye bina database ke start hi nahi hone dete — chupchaap data khone se behtar hai ki saaf error aaye.
  if (store.mode === "file" && onHostedPlatform() && !process.env.DATA_DIR && process.env.ALLOW_EPHEMERAL_STORAGE !== "1") {
    console.error(
      [
        "",
        "============================================================",
        " STOP: Is hosting pe DATABASE_URL set nahi hai.",
        " Bina database ke data HAR RESTART PE UD JAYEGA.",
        "",
        " Fix: ek free Postgres (jaise Neon) banao aur uska connection",
        " string yahan Environment Variable DATABASE_URL me daalo.",
        " Steps README.txt me likhe hain.",
        "============================================================",
        "",
      ].join("\n")
    );
    process.exit(1);
  }

  await store.init();
  // Migrate legacy plaintext password fields out of persisted user records.
  for (const user of await store.listUsers()) {
    if (user.password) await store.patchUser(user.id, { password: null });
  }
  await seedAdmin();
  await seedSuperAdmin();
  await store.updatePlatformData((platform) => {
    platform.organizations = platform.organizations || [];
    platform.billing = platform.billing || {};
    if (!platform.organizations.some((o) => o.id === "default")) platform.organizations.unshift({ id: "default", name: "Default Organization", createdAt: Date.now(), active: true });
    if (!platform.billing.default) platform.billing.default = { balance: FREE_CREDITS, transactions: [{ id: "CR-FREE-DEFAULT", at: Date.now(), delta: FREE_CREDITS, balanceAfter: FREE_CREDITS, type: "free_grant", note: "Non-expiring free credits" }] };
    return platform;
  });
  const counts = await store.counts();

  const server = app.listen(PORT, () => {
    console.log(`Keyzo backend running → http://localhost:${PORT}`);
    console.log(`Storage: ${store.mode} (${store.where}) — ${counts.users} users, ${counts.leads} leads loaded`);
  });

  const shutdown = async (sig) => {
    console.log(`${sig} mila, band kar rahe hain...`);
    server.close();
    try { await store.close(); } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("Startup fail:", e);
  process.exit(1);
});
