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
const { createStore, onHostedPlatform } = require("./store");

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "5mb" }));

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
    role: "backend",
    name: "Backend Admin",
    createdAt: Date.now(),
    active: true,
  });
  console.log(`Seeded initial backend account: ${initialUsername}`);
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
      req.user = { id: current.id, username: current.username, role: current.role, name: current.name };
      next();
    }).catch(next);
  } catch {
    res.status(401).json({ error: "Session expired, please log in again." });
  }
}
function requireBackend(req, res, next) {
  if (req.user.role !== "backend") return res.status(403).json({ error: "Backend access only" });
  next();
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
    res.json({ token, user: { id: u.id, username: u.username, role: u.role, name: u.name } });
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
    res.json(users.filter((u) => u.role === "calling" && u.active !== false).map((u) => ({ username: u.username, name: u.name })));
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
    res.json((await store.listUsers()).map(publicUser));
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
    res.json(await store.listLeads(req.user.role === "backend" ? undefined : req.user.username));
  })
);

app.post(
  "/api/leads",
  auth,
  requireBackend,
  ah(async (req, res) => {
    const lead = {
      id: "L-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
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
    await store.addLeads([lead]);
    res.json(lead);
  })
);

app.patch(
  "/api/leads/:id",
  auth,
  ah(async (req, res) => {
    const lead = await store.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Not found" });
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
      if (!assignee || assignee.role !== "calling" || assignee.active === false) return res.status(400).json({ error: "Choose an active Frontend/Sales team account." });
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
    const existing = await store.listLeads();
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
        if (!assignee || assignee.role !== "calling" || assignee.active === false) {
          return res.status(400).json({ error: `Choose an active Frontend/Sales team account before importing. Invalid account: ${assignedTo}` });
        }
      }
      const now = Date.now();
      created.push({
        id: "L-" + now + "-" + created.length + "-" + Math.random().toString(36).slice(2, 6),
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
  res.json(rows.filter((p) => req.user.role === "backend" || p.status !== "archived"));
}));
app.post("/api/properties", auth, requireBackend, ah(async (req, res) => {
  const b = req.body || {};
  const name = cleanText(b.name, 140);
  if (!name) return res.status(400).json({ error: "Property/project name is required." });
  const property = {
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
  const result = await store.patchProperty(req.params.id, { status: "archived", updatedAt: Date.now() });
  if (!result) return res.status(404).json({ error: "Property not found." });
  res.json({ ok: true });
}));

/* ---- Follow-up tasks and site visits ---- */
app.get("/api/tasks", auth, ah(async (req, res) => {
  const rows = await store.listTasks(req.user.role === "backend" ? undefined : req.user.username);
  res.json(rows);
}));
app.post("/api/tasks", auth, ah(async (req, res) => {
  const b = req.body || {};
  const title = cleanText(b.title, 180);
  const dueAt = Number(b.dueAt);
  if (!title || !Number.isFinite(dueAt) || dueAt <= 0) return res.status(400).json({ error: "Task title and due date/time are required." });
  const allowedType = ["call", "followup", "site_visit", "meeting", "revisit", "other"];
  const task = {
    id: "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), title,
    type: allowedType.includes(b.type) ? b.type : "followup", dueAt,
    leadId: cleanText(b.leadId, 100), leadName: cleanText(b.leadName, 140), project: cleanText(b.project, 140),
    notes: cleanText(b.notes, 1000), status: "open",
    assignedTo: req.user.role === "backend" && typeof b.assignedTo === "string" ? cleanText(b.assignedTo, 120) : req.user.username,
    createdBy: req.user.username, createdByName: req.user.name, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (req.user.role === "backend" && task.assignedTo && task.assignedTo !== req.user.username) {
    const assignee = await store.getUserByUsername(task.assignedTo);
    if (!assignee || assignee.role !== "calling" || assignee.active === false) return res.status(400).json({ error: "Choose an active Frontend/Sales team account." });
  }
  await store.addTask(task); res.status(201).json(task);
}));
app.patch("/api/tasks/:id", auth, ah(async (req, res) => {
  const task = await store.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (req.user.role !== "backend" && task.assignedTo !== req.user.username) return res.status(403).json({ error: "This task is assigned to another user." });
  const patch = {};
  if (typeof req.body?.status === "string" && ["open", "done", "cancelled"].includes(req.body.status)) patch.status = req.body.status;
  if (typeof req.body?.notes === "string") patch.notes = cleanText(req.body.notes, 1000);
  if (req.user.role === "backend" && typeof req.body?.assignedTo === "string") {
    const target = cleanText(req.body.assignedTo, 120);
    if (target && target !== req.user.username) {
      const assignee = await store.getUserByUsername(target);
      if (!assignee || assignee.role !== "calling" || assignee.active === false) return res.status(400).json({ error: "Choose an active Frontend/Sales team account." });
    }
    patch.assignedTo = target;
  }
  patch.updatedAt = Date.now();
  res.json(await store.patchTask(req.params.id, patch));
}));
app.delete("/api/tasks/:id", auth, ah(async (req, res) => {
  const task = await store.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (req.user.role !== "backend" && task.assignedTo !== req.user.username) return res.status(403).json({ error: "This task is assigned to another user." });
  await store.deleteTask(req.params.id); res.json({ ok: true });
}));

/* ---- Optional AI and WhatsApp Business integrations ---- */
app.get("/api/integrations/status", auth, (req, res) => {
  res.json({ aiEnabled: Boolean(process.env.OPENAI_API_KEY), whatsappEnabled: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) });
});
app.post("/api/ai/lead-insights", auth, ah(async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "AI integration is not configured. Set OPENAI_API_KEY on the backend host." });
  const leadId = cleanText(req.body?.leadId, 100);
  const lead = await store.getLead(leadId);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  if (req.user.role !== "backend" && lead.assignedTo !== req.user.username) return res.status(403).json({ error: "This lead is not assigned to you." });
  const safeLead = {
    name: cleanText(lead.name, 120), project: cleanText(lead.project, 140), sector: cleanText(lead.sector, 100),
    status: cleanText(lead.status, 40), source: cleanText(lead.source, 80),
    notes: (Array.isArray(lead.notes) ? lead.notes : []).slice(-8).map((n) => cleanText(n.text || n.note || "", 500)).filter(Boolean),
    history: (Array.isArray(lead.history) ? lead.history : []).slice(-8).map((h) => cleanText(h.action || "", 240)).filter(Boolean),
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input: [
      { role: "system", content: "You are a real-estate sales coach. Give concise, ethical and practical lead insights. Never invent facts, avoid high-pressure tactics, and clearly label unknown information. Output: lead summary, suggested next action, 3 discovery questions, and a respectful follow-up message." },
      { role: "user", content: `Analyze this CRM lead data. Do not ask for or infer private data beyond what is provided.
${JSON.stringify(safeLead)}` },
    ] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("AI provider error:", response.status, data?.error?.code || "unknown");
    return res.status(502).json({ error: "AI provider request failed. Check the server-side API key, model and billing configuration." });
  }
  const output = data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("\n");
  if (!output) return res.status(502).json({ error: "AI provider returned no text." });
  res.json({ leadId, insights: output });
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
    res.json((await store.getSettings()) || { waTemplate: DEFAULT_WA_TEMPLATE });
  })
);
app.put(
  "/api/settings",
  auth,
  requireBackend,
  ah(async (req, res) => {
    res.json(await store.patchSettings(req.body || {}));
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
