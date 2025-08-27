// js/agents.js — Agent List (Firestore collection: "agent list")
// Requirements: firebase v8 + firebaseConfig.js (window.db), SheetJS loaded, MSAL handled upstream

(function () {
  const tbody = document.getElementById("agentBody");
  const searchInput = document.getElementById("agentSearch");
  const branchFilter = document.getElementById("branchFilter");
  const btnExport = document.getElementById("btnExport");

  let allRows = [];   // raw data from Firestore
  let filtered = [];  // after filters/search

  // ---------- utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));

  // Format US/CA 10-digit as (XXX) XXX-XXXX; otherwise return original
  function formatPhone(v) {
    const digits = (v || "").toString().replace(/\D+/g, "");
    if (digits.length === 10) {
      return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
    }
    return v || "";
  }

  // Accept Firestore Timestamp, Date, or string; return YYYY-MM-DD
  function formatDate(d) {
    try {
      if (!d) return "";
      let dt;
      if (typeof d.toDate === "function") dt = d.toDate(); // Firestore Timestamp
      else if (d instanceof Date) dt = d;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return String(d);
      else dt = new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch {
      return String(d || "");
    }
  }

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No records.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="col-agent">${esc(r.Agent)}</td>
        <td>${esc(formatPhone(r.Mobile))}</td>
        <td>${r.Email ? `<a href="mailto:${esc(r.Email)}">${esc(r.Email)}</a>` : ""}</td>
        <td>${esc(formatDate(r.JoinDate))}</td>
        <td>${esc(r.Type)}</td>
        <td>${esc(r.Branch)}</td>
      </tr>
    `).join("");
  }

  function applyFilter() {
    const q = (searchInput?.value || "").toLowerCase().trim();
    const branchSel = (branchFilter?.value || "ALL").trim().toUpperCase();

    filtered = allRows.filter(r => {
      // Branch filter
      const br = (r.Branch || "").toString().trim().toUpperCase();
      const branchOk = branchSel === "ALL" || br === branchSel;
      if (!branchOk) return false;

      if (!q) return true;

      const haystack = [
        r.Agent, r.Mobile, r.Email, formatDate(r.JoinDate), r.Type, r.Branch
      ].map(v => (v || "").toString().toLowerCase());

      return haystack.some(v => v.includes(q));
    });

    renderRows(filtered);
  }

  function loadAgents() {
    if (!window.db) {
      console.error("Firestore not initialized: check firebaseConfig.js load order.");
      tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-4">Firestore not initialized.</td></tr>`;
      return;
    }

    // Sort by Agent (alpha); adjust/add more orderBy if needed
    window.db.collection("agentlist")
      .orderBy("Agent", "asc")
      .onSnapshot((snap) => {
        allRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        applyFilter();
      }, (err) => {
        console.error("Firestore error:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-4">Failed to load data.</td></tr>`;
      });
  }

  // Export filtered rows to Excel using SheetJS
  function exportToExcel() {
    // Convert filtered objects into a simple 2D array with headers
    const rows = filtered.length ? filtered : allRows;
    if (!rows.length) {
      alert("No data to export.");
      return;
    }

    const data = [
      ["Agent", "Mobile", "Email", "JoinDate", "Type", "Branch"],
      ...rows.map(r => [
        r.Agent || "",
        formatPhone(r.Mobile) || "",
        r.Email || "",
        formatDate(r.JoinDate) || "",
        r.Type || "",
        r.Branch || ""
      ])
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Agents");

    // Generate and trigger download
    XLSX.writeFile(wb, "AgentList.xlsx");
  }

  // Events
  document.addEventListener("DOMContentLoaded", () => {
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(searchInput._t);
        searchInput._t = setTimeout(applyFilter, 120);
      });
    }
    if (branchFilter) {
      branchFilter.addEventListener("change", applyFilter);
    }
    if (btnExport) {
      btnExport.addEventListener("click", exportToExcel);
    }
    loadAgents();
  });
})();
