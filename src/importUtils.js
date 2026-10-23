const aliases = {
  name: ["name", "fullname", "leadname", "customername", "clientname", "prospectname", "contactname", "customer", "buyername", "lead"],
  phone: ["phone", "mobile", "mobileno", "mobilenumber", "phonenumber", "phoneno", "contact", "contactno", "contactnumber", "telephone", "telephonenumber", "whatsapp", "number", "primaryphone", "customerphone", "leadphone"],
  project: ["project", "projectname", "property", "propertyname", "interestedproject", "interestedin", "interestedproperty", "projectinterested"],
  sector: ["sector", "location", "area", "city", "locality", "region", "site", "address", "preferredlocation"],
  source: ["source", "leadsource", "platform", "channel", "campaign", "campaignname", "from", "origin"],
  email: ["email", "emailid", "mail", "emailaddress"],
  estimate: ["budget", "estimate", "price", "budgetrange", "customerbudget", "expectedbudget", "investmentrange"],
};

export function normalizeImportHeader(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_\-./()#]+/g, "");
}

export function normalizeImportPhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

// Small CSV/TSV parser with quoted-field and escaped-quote support; safe for pasted CRM data.
export function parseDelimitedText(rawValue) {
  const raw = String(rawValue ?? "").replace(/^\uFEFF/, "");
  if (!raw.trim()) return [];
  const rows = [];
  let row = [], cell = "", quoted = false;
  const firstLine = raw.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes("\t") && (!firstLine.includes(",") || firstLine.indexOf("\t") < firstLine.indexOf(",")) ? "\t" : ",";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"' && quoted && raw[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      row.push(cell); if (row.some(c => String(c).trim())) rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell); if (row.some(c => String(c).trim())) rows.push(row);
  return rows;
}

// Converts either header-based worksheets or positional rows to the CRM lead payload.
// Invalid rows and duplicate phones are reported separately; phone numbers are not re-formatted for display.
export function parseLeadRows(inputRows) {
  const rows = (Array.isArray(inputRows) ? inputRows : []).filter(row => Array.isArray(row) && row.some(cell => String(cell ?? "").trim() !== ""));
  if (!rows.length) return { leads: [], invalidCount: 0, duplicateCount: 0, error: "File ya pasted data empty hai." };
  const headers = rows[0].map(normalizeImportHeader);
  const recognized = Object.values(aliases).flat();
  const hasHeader = headers.some(h => recognized.includes(h));
  const map = {};
  if (hasHeader) {
    Object.entries(aliases).forEach(([field, names]) => {
      const index = headers.findIndex(h => names.includes(h));
      if (index >= 0) map[field] = index;
    });
    if (map.name === undefined || map.phone === undefined) {
      return { leads: [], invalidCount: Math.max(0, rows.length - 1), duplicateCount: 0, error: "Header pehchaan liya, lekin Name aur Phone/Mobile columns nahi mile. Column headings check karo." };
    }
  } else {
    Object.assign(map, { name: 0, phone: 1, project: 2, sector: 3, source: 4, email: 5, estimate: 6 });
  }
  const dataRows = hasHeader ? rows.slice(1) : rows;
  let invalidCount = 0, duplicateCount = 0;
  const seen = new Set();
  const leads = [];
  dataRows.forEach(row => {
    const read = key => map[key] === undefined ? "" : String(row[map[key]] ?? "").trim();
    const lead = {
      name: read("name"), phone: read("phone"), project: read("project"), sector: read("sector"),
      source: read("source") || "Other", email: read("email"), estimate: read("estimate"),
    };
    if (!lead.name && !lead.phone && !lead.project) return;
    const phoneKey = normalizeImportPhone(lead.phone);
    if (!lead.name || phoneKey.length < 7) { invalidCount += 1; return; }
    if (seen.has(phoneKey)) { duplicateCount += 1; return; }
    seen.add(phoneKey);
    leads.push(lead);
  });
  return { leads, invalidCount, duplicateCount, error: "" };
}
