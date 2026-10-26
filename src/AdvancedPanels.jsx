import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CalendarClock, Check, CircleAlert, ClipboardList, MapPin, Plus, RefreshCw, Search, Trash2, X, Pencil, MessageCircle } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://keyzo-crm-api.onrender.com/api").replace(/\/$/, "");
const styles = {
  panel: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: "clamp(14px, 2vw, 24px)", boxShadow: "0 5px 22px rgba(15,23,42,.035)" },
  input: { width: "100%", minWidth: 0, padding: "11px 12px", border: "1px solid #dfe3ea", borderRadius: 10, background: "#fbfcfe", color: "#182230", font: "inherit", fontSize: 13 },
  label: { display: "block", marginBottom: 6, color: "#596579", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" },
  button: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: 0, borderRadius: 10, padding: "10px 14px", background: "#12243a", color: "white", fontWeight: 700, fontSize: 12, cursor: "pointer", minHeight: 40 },
  secondary: { background: "#f2f5f9", color: "#253247", border: "1px solid #e1e6ee" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 12 },
  muted: { color: "#7b8798", fontSize: 12 },
  badge: { display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "5px 9px", background: "#edf7f0", color: "#217346", fontSize: 10, fontWeight: 800, textTransform: "capitalize" },
};

async function request(path, token, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}
function Field({ label, children }) { return <label style={{ display: "block", minWidth: 0 }}><span style={styles.label}>{label}</span>{children}</label>; }
function whatsappNumber(value) { let digits = String(value || "").replace(/\D/g, ""); if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1); if (digits.length === 10) digits = "91" + digits; return digits; }
function Notice({ message, onClose }) { if (!message) return null; return <div role="status" style={{ marginBottom: 14, padding: "11px 13px", borderRadius: 10, background: "#fff5e9", color: "#96530b", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}><CircleAlert size={16}/><span style={{ flex: 1 }}>{message}</span><button onClick={onClose} aria-label="Dismiss" style={{ border: 0, background: "transparent", cursor: "pointer" }}><X size={14}/></button></div>; }

export function PropertiesPanel({ token, role, notify, isMobile = false }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [query, setQuery] = useState(""); const [showForm, setShowForm] = useState(false); const [editingId, setEditingId] = useState(null); const [busy, setBusy] = useState(false);
  const emptyForm = { name: "", developer: "", location: "", type: "Apartment", bhk: "", area: "", price: "", status: "available", description: "" };
  const [form, setForm] = useState(emptyForm);
  const isAdmin = role === "backend";
  const load = useCallback(async () => { setLoading(true); try { setItems(await request("/properties", token)); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } }, [token]);
  useEffect(() => { load(); }, [load]);
  const filtered = useMemo(() => items.filter((p) => `${p.name} ${p.developer} ${p.location} ${p.bhk}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const item = await request(editingId ? `/properties/${editingId}` : "/properties", token, { method: editingId ? "PATCH" : "POST", body: form }); setItems((prev) => editingId ? prev.map((x) => x.id === item.id ? item : x) : [item, ...prev]); setForm(emptyForm); setEditingId(null); setShowForm(false); notify?.(editingId ? "Property updated" : "Property inventory saved"); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const startEdit = (p) => { setEditingId(p.id); setForm({ name: p.name || "", developer: p.developer || "", location: p.location || "", type: p.type || "Apartment", bhk: p.bhk || "", area: p.area || "", price: p.price || "", status: p.status || "available", description: p.description || "" }); setShowForm(true); };
  const changeStatus = async (p, status) => { try { const updated = await request(`/properties/${p.id}`, token, { method: "PATCH", body: { status } }); setItems((prev) => prev.map((x) => x.id === p.id ? updated : x)); } catch (e) { setError(e.message); } };
  return <section style={{ display: "grid", gap: 18 }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>{!isMobile && <div><div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 23, fontWeight: 800, color: "#172334" }}><Building2 size={23}/> Property inventory</div><p style={{ ...styles.muted, marginTop: 5 }}>Projects, configurations, pricing and availability in one place.</p></div>}<div style={{ display: "flex", gap: 8, marginLeft: isMobile ? "auto" : 0 }}><button style={{ ...styles.button, ...styles.secondary }} onClick={load}><RefreshCw size={14}/> Refresh</button>{isAdmin && <button style={styles.button} onClick={() => { if (showForm) { setShowForm(false); setEditingId(null); setForm(emptyForm); } else { setEditingId(null); setForm(emptyForm); setShowForm(true); } }}><Plus size={15}/> Add property</button>}</div></div>
    <Notice message={error} onClose={() => setError("")}/>
    {showForm && isAdmin && <form onSubmit={save} style={styles.panel}><div style={{ fontWeight: 800, marginBottom: 15 }}>{editingId ? "Edit project / inventory" : "Add project / inventory"}</div><div style={styles.grid}>
      <Field label="Project name *"><input required maxLength={140} style={styles.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ace Arte"/></Field>
      <Field label="Developer"><input style={styles.input} value={form.developer} onChange={e => setForm({ ...form, developer: e.target.value })} placeholder="Developer name"/></Field>
      <Field label="Location"><input style={styles.input} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Sector / city"/></Field>
      <Field label="Property type"><select style={styles.input} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{["Apartment","Villa","Plot","Commercial","Studio","Other"].map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Configuration"><input style={styles.input} value={form.bhk} onChange={e => setForm({ ...form, bhk: e.target.value })} placeholder="2 BHK / 3 BHK / Studio"/></Field>
      <Field label="Area"><input style={styles.input} value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} placeholder="e.g. 1250 sq ft"/></Field>
      <Field label="Price / BSP"><input style={styles.input} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="e.g. ₹16,990/sq ft"/></Field>
      <Field label="Availability"><select style={styles.input} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="available">Available</option><option value="limited">Limited inventory</option><option value="sold_out">Sold out</option></select></Field>
      <div style={{ gridColumn: "1 / -1" }}><Field label="Description"><textarea rows={3} style={{ ...styles.input, resize: "vertical" }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Amenities, payment plan, notes…"/></Field></div>
    </div><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}><button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}>Cancel</button><button disabled={busy} style={{ ...styles.button, opacity: busy ? .6 : 1 }} type="submit">{busy ? "Saving…" : editingId ? "Save changes" : "Save property"}</button></div></form>}
    <div style={{ ...styles.panel, padding: 12, display: "flex", gap: 9, alignItems: "center" }}><Search size={16} color="#8b96a6"/><input aria-label="Search inventory" style={{ ...styles.input, border: 0, background: "transparent", outline: 0 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search project, developer, location…"/></div>
    {loading ? <div style={styles.panel}>Loading inventory…</div> : filtered.length === 0 ? <div style={{ ...styles.panel, textAlign: "center", padding: 36 }}><Building2 size={28} color="#9aa4b2"/><div style={{ fontWeight: 800, marginTop: 9 }}>No properties yet</div><p style={styles.muted}>{isAdmin ? "Add your first project to start maintaining inventory." : "Your team has not added inventory yet."}</p></div> : <div style={styles.grid}>{filtered.map(p => <article key={p.id} style={{ ...styles.panel, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}><div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}><div style={{ minWidth: 0 }}><div style={{ color: "#182538", fontWeight: 800, fontSize: 16, overflowWrap: "anywhere" }}>{p.name}</div><div style={{ ...styles.muted, marginTop: 4 }}>{p.developer || "Developer not specified"}</div></div><span style={{ ...styles.badge, background: p.status === "sold_out" ? "#fceceb" : p.status === "limited" ? "#fff4df" : p.status === "archived" ? "#edf0f4" : "#edf7f0", color: p.status === "sold_out" ? "#b42318" : p.status === "limited" ? "#9a6700" : "#217346" }}>{p.status.replace("_", " ")}</span></div><div style={{ ...styles.muted, display: "flex", gap: 6, alignItems: "center" }}><MapPin size={14}/>{p.location || "Location not set"}</div><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{p.type && <span style={{ ...styles.badge, background: "#f1f4f8", color: "#48576b" }}>{p.type}</span>}{p.bhk && <span style={{ ...styles.badge, background: "#f1f4f8", color: "#48576b" }}>{p.bhk}</span>}{p.area && <span style={{ ...styles.badge, background: "#f1f4f8", color: "#48576b" }}>{p.area}</span>}</div>{p.price && <div style={{ color: "#172334", fontWeight: 800, fontSize: 18 }}>{p.price}</div>}{p.description && <div style={{ color: "#5b6778", fontSize: 12, lineHeight: 1.6 }}>{p.description}</div>}{isAdmin && <div style={{ display: "flex", gap: 7, marginTop: "auto" }}><button title="Edit property" style={{ ...styles.button, ...styles.secondary, padding: 10 }} onClick={() => startEdit(p)}><Pencil size={14}/></button><select aria-label={`Change ${p.name} availability`} style={{ ...styles.input, flex: 1 }} value={p.status} onChange={e => changeStatus(p, e.target.value)}><option value="available">Available</option><option value="limited">Limited</option><option value="sold_out">Sold out</option><option value="archived">Archived</option></select><button title="Archive project" style={{ ...styles.button, ...styles.secondary, padding: 10 }} onClick={() => changeStatus(p, "archived")}><Trash2 size={14}/></button></div>}</article>)}</div>}
  </section>;
}

export function TasksPanel({ token, me, role, notify, isMobile = false }) {
  const [items, setItems] = useState([]); const [agents, setAgents] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [showForm, setShowForm] = useState(false); const [filter, setFilter] = useState("open"); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", type: "followup", dueAt: "", leadName: "", project: "", notes: "", assignedTo: me.username });
  const isAdmin = role === "backend";
  const load = useCallback(async () => { setLoading(true); try { const result = await Promise.all([request("/tasks", token), isAdmin ? request("/agents", token) : Promise.resolve([])]); setItems(result[0]); setAgents(result[1]); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } }, [token, isAdmin]);
  useEffect(() => { load(); }, [load]);
  const visible = useMemo(() => items.filter(t => filter === "all" || t.status === filter).sort((a,b) => a.dueAt-b.dueAt), [items, filter]);
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const payload = { ...form, dueAt: new Date(form.dueAt).getTime(), assignedTo: isAdmin ? form.assignedTo : me.username }; const item = await request("/tasks", token, { method: "POST", body: payload }); setItems(prev => [item, ...prev]); setShowForm(false); setForm({ title: "", type: "followup", dueAt: "", leadName: "", project: "", notes: "", assignedTo: me.username }); notify?.("Task scheduled"); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const patch = async (item, status) => { try { const updated = await request(`/tasks/${item.id}`, token, { method: "PATCH", body: { status } }); setItems(prev => prev.map(t => t.id === item.id ? updated : t)); } catch (e) { setError(e.message); } };
  const remove = async (item) => { if (!window.confirm("Delete this task?")) return; try { await request(`/tasks/${item.id}`, token, { method: "DELETE" }); setItems(prev => prev.filter(t => t.id !== item.id)); } catch (e) { setError(e.message); } };
  return <section style={{ display: "grid", gap: 18 }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>{!isMobile && <div><div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 23, fontWeight: 800, color: "#172334" }}><CalendarClock size={23}/> Follow-ups & site visits</div><p style={{ ...styles.muted, marginTop: 5 }}>Schedule calls, meetings, site visits and track completion.</p></div>}<div style={{ display: "flex", gap: 8, marginLeft: isMobile ? "auto" : 0 }}><button style={{ ...styles.button, ...styles.secondary }} onClick={load}><RefreshCw size={14}/> Refresh</button><button style={styles.button} onClick={() => setShowForm(!showForm)}><Plus size={15}/> New task</button></div></div>
    <Notice message={error} onClose={() => setError("")}/>
    {showForm && <form onSubmit={save} style={styles.panel}><div style={{ fontWeight: 800, marginBottom: 15 }}>Schedule activity</div><div style={styles.grid}>
      <Field label="Task title *"><input required maxLength={180} style={styles.input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Call customer / site visit"/></Field>
      <Field label="Activity type"><select style={styles.input} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{[["call","Call"],["followup","Follow-up"],["site_visit","Site visit"],["meeting","Meeting"],["revisit","Revisit"],["other","Other"]].map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select></Field>
      <Field label="Date & time *"><input required type="datetime-local" style={styles.input} value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })}/></Field>
      <Field label="Customer name"><input style={styles.input} value={form.leadName} onChange={e => setForm({ ...form, leadName: e.target.value })} placeholder="Optional"/></Field>
      <Field label="Project"><input style={styles.input} value={form.project} onChange={e => setForm({ ...form, project: e.target.value })} placeholder="Project name"/></Field>
      {isAdmin && <Field label="Assign to"><select style={styles.input} value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })}><option value={me.username}>Myself ({me.name})</option>{agents.map(a => <option key={a.username} value={a.username}>{a.name}</option>)}</select></Field>}
      <div style={{ gridColumn: "1 / -1" }}><Field label="Notes"><textarea rows={2} style={{ ...styles.input, resize: "vertical" }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Address, customer requirements, reminders…"/></Field></div>
    </div><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}><button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={() => setShowForm(false)}>Cancel</button><button disabled={busy} style={{ ...styles.button, opacity: busy ? .6 : 1 }} type="submit">{busy ? "Saving…" : "Save task"}</button></div></form>}
    <div style={{ ...styles.panel, display: "flex", gap: 8, flexWrap: "wrap", padding: 12 }}>{[["open","Open"],["done","Completed"],["cancelled","Cancelled"],["all","All tasks"]].map(([v,l]) => <button key={v} style={{ ...styles.button, ...(filter === v ? {} : styles.secondary) }} onClick={() => setFilter(v)}>{l}{v === "open" ? ` (${items.filter(t => t.status === "open").length})` : ""}</button>)}</div>
    {loading ? <div style={styles.panel}>Loading tasks…</div> : visible.length === 0 ? <div style={{ ...styles.panel, textAlign: "center", padding: 36 }}><ClipboardList size={28} color="#9aa4b2"/><div style={{ fontWeight: 800, marginTop: 9 }}>Nothing scheduled here</div><p style={styles.muted}>Create a task or site visit to keep your pipeline moving.</p></div> : <div style={{ display: "grid", gap: 10 }}>{visible.map(t => { const overdue = t.status === "open" && t.dueAt < Date.now(); return <article key={t.id} style={{ ...styles.panel, display: "flex", alignItems: "flex-start", gap: 13, padding: 16 }}><div style={{ width: 38, height: 38, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 12, background: t.type === "site_visit" ? "#f2eaff" : "#eaf2ff", color: t.type === "site_visit" ? "#8052bf" : "#3d6fbd" }}>{t.type === "site_visit" ? <MapPin size={18}/> : <CalendarClock size={18}/>}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7 }}><strong style={{ color: "#182538", fontSize: 14 }}>{t.title}</strong><span style={{ ...styles.badge, background: overdue ? "#fceceb" : t.status === "done" ? "#edf7f0" : "#eef2f7", color: overdue ? "#b42318" : t.status === "done" ? "#217346" : "#4a586d" }}>{overdue ? "overdue" : t.status}</span></div><div style={{ ...styles.muted, marginTop: 5 }}>{new Date(t.dueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {t.type.replace("_", " ")}</div><div style={{ ...styles.muted, marginTop: 4 }}>{[t.leadName, t.project, isAdmin ? `Assigned: ${t.assignedTo}` : ""].filter(Boolean).join(" · ")}</div>{t.notes && <p style={{ marginTop: 7, fontSize: 12, lineHeight: 1.55, color: "#5b6778" }}>{t.notes}</p>}</div><div style={{ display: "flex", gap: 6, flexShrink: 0 }}>{t.status === "open" && <button title="Mark completed" style={{ ...styles.button, ...styles.secondary, padding: 10 }} onClick={() => patch(t,"done")}><Check size={15}/></button>}<button title="Delete task" style={{ ...styles.button, ...styles.secondary, padding: 10 }} onClick={() => remove(t)}><Trash2 size={15}/></button></div></article>; })}</div>}
  </section>;
}

export function AssistantsPanel({ token, role, notify, isMobile = false }) {
  const [leads, setLeads] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState({ aiEnabled: false, aiProviders: { gemini: false, openai: false }, whatsappEnabled: false });
  const [billing, setBilling] = useState({ balance: 0, packages: [], razorpayEnabled: false });
  const [packageId, setPackageId] = useState("starter");
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [insights, setInsights] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waBusy, setWaBusy] = useState(false);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const selected = leads.find(l => l.id === selectedId);
  const loadAssistantData = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [leadData, integrationStatus, settings, creditData] = await Promise.all([
        request("/leads", token), request("/integrations/status", token), request("/settings", token), request("/billing/credits", token),
      ]);
      const available = (Array.isArray(leadData) ? leadData : []).filter(lead => !lead.removed);
      setLeads(available);
      setStatus(integrationStatus || { aiEnabled: false, whatsappEnabled: false });
      setBilling(creditData || { balance: 0, packages: [], razorpayEnabled: false });
      if (creditData?.packages?.length) setPackageId(creditData.packages[0].id);
      const chosen = available[0];
      if (chosen) {
        setSelectedId(chosen.id); setPhone(chosen.phone || "");
        const tpl = settings?.waTemplate || "Hi {name}, following up on your interest in {project}.";
        setMessage(tpl.replaceAll("{name}", chosen.name || "").replaceAll("{project}", chosen.project || "").replaceAll("{sector}", chosen.sector || ""));
      } else { setSelectedId(""); setPhone(""); setMessage(""); }
    } catch (e) { setError(e.message || "Assistants data load nahi ho paya."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { loadAssistantData(); }, [loadAssistantData]);
  const chooseLead = (id) => {
    setSelectedId(id); setInsights("");
    const lead = leads.find(item => item.id === id);
    if (!lead) { setPhone(""); setMessage(""); return; }
    setPhone(lead.phone || "");
    setMessage(`Hi ${lead.name || "there"}, following up on your interest in ${lead.project || "our property options"}. Let me know a convenient time to connect.`);
  };
  const analyze = async () => {
    if (!selectedId || Number(billing.balance) < 3) return;
    setAiBusy(true); setError(""); setInsights("");
    try { const data = await request("/ai/lead-insights", token, { method: "POST", body: { leadId: selectedId } }); setInsights(data?.insights || "AI provider ne empty response diya. Retry karo."); const updated = await request("/billing/credits", token); setBilling(updated); }
    catch (e) { setError(e.message || "AI insight generate nahi ho paya."); }
    finally { setAiBusy(false); }
  };
  const purchase = async () => {
    if (!billing.razorpayEnabled) { setError("Payment setup pending hai. Admin ko Razorpay credentials backend host par configure karne honge."); return; }
    const selectedPack = (billing.packages || []).find(p => p.id === packageId);
    if (!selectedPack) return;
    setPurchaseBusy(true); setError("");
    try {
      const order = await request("/billing/create-order", token, { method: "POST", body: { packageId } });
      if (!window.Razorpay) await new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.onload = resolve; script.onerror = () => reject(new Error("Payment checkout load nahi ho paya.")); document.body.appendChild(script); });
      const checkout = new window.Razorpay({ key: order.keyId, amount: order.amount, currency: order.currency, name: "Keyzo CRM", description: `${order.package.credits} AI credits`, order_id: order.orderId, handler: async (response) => { try { await request("/billing/verify", token, { method: "POST", body: response }); const updated = await request("/billing/credits", token); setBilling(updated); notify?.("Payment verified; credits added"); } catch (e) { setError(e.message || "Payment verify nahi ho paya."); } finally { setPurchaseBusy(false); } }, modal: { ondismiss: () => setPurchaseBusy(false) }, theme: { color: "#14243A" } });
      checkout.on("payment.failed", (response) => { setError(response?.error?.description || "Payment failed; no credits were added."); setPurchaseBusy(false); });
      checkout.open();
    } catch (e) { setError(e.message || "Payment start nahi ho paya."); setPurchaseBusy(false); }
  };
  const send = async () => {
    if (!selectedId || !phone.trim() || !message.trim()) return;
    setWaBusy(true); setError("");
    try { await request("/whatsapp/send", token, { method: "POST", body: { to: phone, message } }); notify?.("WhatsApp message sent"); }
    catch (e) { setError(e.message || "WhatsApp message send nahi ho paya."); }
    finally { setWaBusy(false); }
  };
  return <section style={{ display: "grid", gap: 18, minWidth: 0 }}>
    {!isMobile && <div><div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 23, fontWeight: 800, color: "#172334" }}><ClipboardList size={23}/> Sales assistants & integrations</div><p style={{ ...styles.muted, marginTop: 5 }}>Optional AI lead coaching and server-side WhatsApp Business messaging.</p></div>}
    <Notice message={error} onClose={() => setError("")}/>
    {loading ? <div role="status" style={styles.panel}><RefreshCw className="k-spin" size={17} style={{ marginRight: 8, verticalAlign: "middle" }}/> Loading assistant tools and lead data…</div> : <>
      {leads.length === 0 ? <div style={{ ...styles.panel, textAlign: "center", padding: 28 }}><ClipboardList size={26} color="#9aa4b2"/><div style={{ fontWeight: 800, marginTop: 9 }}>No active leads yet</div><p style={styles.muted}>Import or add a lead first. You can still see the AI and WhatsApp setup requirements below.</p><button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={loadAssistantData}><RefreshCw size={14}/> Retry loading</button></div> : <div style={styles.panel}><Field label="Choose lead"><select style={styles.input} value={selectedId} onChange={e => chooseLead(e.target.value)}><option value="">Select a lead</option>{leads.map(l => <option key={l.id} value={l.id}>{l.name} · {l.project || l.phone}</option>)}</select></Field><p style={{ ...styles.muted, marginTop: 7 }}>{role === "backend" ? "Backend team can analyze all leads." : "Only leads assigned to your account are available here."}</p></div>}
      <div style={styles.grid}>
        <article style={{ ...styles.panel, display: "flex", flexDirection: "column", gap: 13 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}><div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800 }}><span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 10, background: "#f0eaff", color: "#7a4fbc" }}><span aria-hidden="true">✦</span></span> AI Lead Assistant</div><span style={{ ...styles.badge, background: status.aiEnabled ? "#edf7f0" : "#fff4df", color: status.aiEnabled ? "#217346" : "#9a6700" }}>{status.aiEnabled ? `Ready · ${status.aiPrimary || "AI provider"}` : "Needs API key"}</span></div><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><span style={{ ...styles.badge, background: status.aiProviders?.gemini ? "#edf7f0" : "#f1f4f8", color: status.aiProviders?.gemini ? "#217346" : "#657184" }}>Gemini {status.aiProviders?.gemini ? "configured" : "not configured"}</span><span style={{ ...styles.badge, background: status.aiProviders?.openai ? "#edf7f0" : "#f1f4f8", color: status.aiProviders?.openai ? "#217346" : "#657184" }}>OpenAI {status.aiProviders?.openai ? "configured" : "not configured"}</span></div><p style={{ ...styles.muted, lineHeight: 1.65 }}>Create a concise lead summary, recommended next action, discovery questions and a respectful follow-up draft. Gemini is tried first and OpenAI is used as fallback. If both providers fail or return empty text, the backend returns a visible error and reverses the provisional credit deduction.</p><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: 12, background: "#f7f8fc", borderRadius: 10 }}><div><div style={{ fontSize: 12, fontWeight: 800 }}>{Number(billing.balance || 0)} AI credits remaining</div><div style={styles.muted}>3 credits per successful AI response · credits do not expire</div></div><span style={{ ...styles.badge, background: Number(billing.balance) >= 3 ? "#edf7f0" : "#fceceb", color: Number(billing.balance) >= 3 ? "#217346" : "#b42318" }}>{Number(billing.balance) >= 3 ? "Available" : "Balance empty"}</span></div><button disabled={!selected || !status.aiEnabled || aiBusy || Number(billing.balance) < 3} style={{ ...styles.button, opacity: !selected || !status.aiEnabled || aiBusy || Number(billing.balance) < 3 ? .55 : 1 }} onClick={analyze}><span aria-hidden="true">✦</span>{aiBusy ? "Analyzing…" : Number(billing.balance) < 3 ? "Insufficient credits" : "Generate lead insights (3 credits)"}</button><div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}><select style={styles.input} value={packageId} onChange={e => setPackageId(e.target.value)}>{(billing.packages || []).map(p => <option key={p.id} value={p.id}>{p.name} — ₹{p.amount.toLocaleString("en-IN")} / {p.credits.toLocaleString("en-IN")} credits</option>)}</select><button disabled={purchaseBusy} style={{ ...styles.button, opacity: purchaseBusy ? .6 : 1 }} onClick={purchase}>{purchaseBusy ? "Opening…" : "Buy credits"}</button></div>{!billing.razorpayEnabled && <div style={{ fontSize: 11, color: "#8b6a2c", lineHeight: 1.6 }}>Payment gateway credentials abhi configure nahi hain. Purchase tabhi active hoga jab backend par Razorpay keys add karoge.</div>}{!status.aiEnabled && <div style={{ fontSize: 11, color: "#8b6a2c", lineHeight: 1.6 }}>Backend setup (Render → Environment): add GEMINI_API_KEY (optional GEMINI_MODEL, default gemini-2.5-flash) and/or OPENAI_API_KEY (optional OPENAI_MODEL, default gpt-4.1-mini), then redeploy the backend. Never put API keys in the frontend or GitHub.</div>}{insights && <div style={{ borderRadius: 12, background: "#f7f8fc", border: "1px solid #e8ebf2", padding: 14, fontSize: 12, lineHeight: 1.75, whiteSpace: "pre-wrap", color: "#39465a" }}>{insights}</div>}</article>
        <article style={{ ...styles.panel, display: "flex", flexDirection: "column", gap: 13 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}><div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800 }}><span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 10, background: "#e8f8ee", color: "#16794b" }}><MessageCircle size={18}/></span> WhatsApp Business</div><span style={{ ...styles.badge, background: status.whatsappEnabled ? "#edf7f0" : "#fff4df", color: status.whatsappEnabled ? "#217346" : "#9a6700" }}>{status.whatsappEnabled ? "Connected" : "Needs setup"}</span></div><Field label="Recipient phone"><input style={styles.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="91XXXXXXXXXX" inputMode="tel"/></Field><Field label="Message"><textarea rows={5} style={{ ...styles.input, resize: "vertical", lineHeight: 1.6 }} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a customer follow-up message…"/></Field><button disabled={!selected || !status.whatsappEnabled || waBusy || !phone.trim() || !message.trim()} style={{ ...styles.button, opacity: !selected || !status.whatsappEnabled || waBusy || !phone.trim() || !message.trim() ? .55 : 1 }} onClick={send}><MessageCircle size={14}/>{waBusy ? "Sending…" : "Send via WhatsApp Business API"}</button><a href={phone.trim() && message.trim() ? `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}` : undefined} target="_blank" rel="noreferrer" style={{ ...styles.button, ...styles.secondary, textDecoration: "none", opacity: phone.trim() && message.trim() ? 1 : .55, pointerEvents: phone.trim() && message.trim() ? "auto" : "none" }}><MessageCircle size={14}/>Open WhatsApp (manual send)</a><div style={styles.muted}>Manual mode opens WhatsApp with the message filled in; you still click Send yourself. It does not require WhatsApp API credentials.</div>{!status.whatsappEnabled && <div style={{ fontSize: 11, color: "#8b6a2c", lineHeight: 1.6 }}>Backend setup: add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID from Meta WhatsApp Business Platform. Use opted-in recipients and approved templates where required.</div>}</article>
      </div>
      <section style={styles.panel}><div style={{ fontWeight: 800, color: "#182538", marginBottom: 10 }}>Recent AI credit activity</div>{(billing.transactions || []).length === 0 ? <div style={styles.muted}>No credit transactions yet.</div> : <div style={{ display: "grid", gap: 0 }}>{billing.transactions.slice(0, 8).map(tx => <div key={tx.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #e8ebf2" }}><div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 700, color: "#253247" }}>{tx.note || tx.type || "Credit activity"}</div><div style={styles.muted}>{new Date(tx.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div></div><div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: 13, fontWeight: 800, color: Number(tx.delta) < 0 ? "#b42318" : "#217346" }}>{Number(tx.delta) > 0 ? "+" : ""}{tx.delta}</div><div style={styles.muted}>Balance: {tx.balanceAfter}</div></div></div>)}</div>}</section>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={loadAssistantData}><RefreshCw size={14}/> Refresh assistant data</button></div>
    </>}
  </section>;
}

