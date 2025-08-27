// js/agents.js — Agent List (Firestore collection: "agent list")
// Features: branch filter, search, striped table, pagination, Excel export
// Requires: firebase v8 + firebaseConfig.js (window.db), SheetJS, MSAL handled upstream

(function () {
  const tbody        = document.getElementById("agentBody");
  const searchInput  = document.getElementById("agentSearch");
  const branchFilter = document.getElementById("branchFilter");
  const btnExport    = document.getElementById("btnExport");
  const pagination   = document.getElementById("pagination");

  let allRows = [];   // raw data from Firestore
  let filtered = [];  // after filters/search
  let currentPage = 1;
  const pageSize = 25; // change if you want 50/100

  // ---------- utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])
  );

  // Format US/CA numbers: 10 digits -> (XXX) XXX-XXXX ; 11 with leading 1 -> +1 (...)
  function formatPhone(v) {
    const digits = (v || "").toString().replace(/\D+/g, "");
    if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits.startsWith("1"))
      return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
    return v || "";
  }

  // Accept Firestore Timestamp/Date/string -> return YYYY-MM-DD
  function formatDate(d) {
    try {
      if (!d) return "";
      let dt;
      if (typeof d?.toDate === "function") dt = d.toDate();
      else if (d instanceof Date) dt = d;
      else if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      else dt = new Date(d);
      if (isNaN(dt)) return String(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth()+1).padStart(2,"0");
      const day = String(dt.getDate()).padStart(2,"0");
      return `${y}-${m}-${day}`;
    } catch { return String(d || ""); }
  }

  // ---------- render ----------
  function renderRows() {
    const start = (currentPage - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    if (!pageRows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No records.</td></tr>`;
      renderPagination(); // still update bar
      return;
    }

    tbody.innerHTML = pageRows.map(r => `
      <tr>
        <td class="col-agent">${esc(r.Agent)}</td>
        <td>${esc(formatPhone(r.Mobile))}</td>
        <td>${r.Email ? `<a href="mailto:${esc(r.Email)}">${esc(r.Email)}</a>` : ""}</td>
        <td>${esc(formatDate(r.JoinDate))}</td>
        <td>${esc(r.Type)}</td>
        <td>${esc(r.Branch)}</td>
      </tr>
    `).join("");

    renderPagination();
  }

  function renderPagination() {
    const totalPages = Math.ceil(filtered.length / pageSize);
    if (totalPages <= 1) { pagination.innerHTML = ""; return; }

    let html = `
      <li class="page-item ${currentPage===1?"disabled":""}">
        <a class="page-link" href="#" data-page="${currentPage-1}">Previous</a>
      </li>
    `;
    // For very large pages, you might want to compress; here we show all for simplicity.
    for (let i = 1; i <= totalPages; i++) {
      html += `
        <li class="page-item ${i===currentPage?"active":""}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>`;
    }
    html += `
      <li class="page-item ${currentPage===totalPages?"disabled":""}">
        <a class="page-link" href="#" data-page="${currentPage+1}">Next</a>
      </li>
    `;

    pagination.innerHTML = html;

    // Bind clicks
    [...pagination.querySelectorAll("a.page-link")].forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        const page = parseInt(a.dataset.page, 10);
        if (!isNaN(page) && page >= 1 && page <= totalPages) {
          currentPage = page;
          renderRows();
        }
      });
    });
  }

  // ---------- filtering ----------
  function applyFilter() {
    const q = (searchInput?.value || "").toLowerCase().trim();
    const branchSel = (branchFilter?.value || "ALL").trim().toUpperCase();

    filtered = allRows.filter(r => {
      const br = (r.Branch || "").toString().trim().toUpperCase();
      const branchOk = branchSel === "ALL" || br === branchSel;
      if (!branchOk) return false;

      if (!q) return true;

      const haystack = [
        r.Agent, r.Mobile, r.Email, formatDate(r.JoinDate), r.Type, r.Branch
      ].map(v => (v || "").toString().toLowerCase());

      return haystack.some(v => v.includes(q));
    });

    currentPage = 1;  // reset to first page on new filter
    renderRows();
  }

  // ---------- load ----------
  function loadAgents() {
    if (!window.db) {
      console.error("Firestore not initialized: check firebaseConfig.js load order.");
      tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-4">Firestore not initialized.</td></tr>`;
      return;
    }

    // Server-side sort - by Agent (alpha). Add more orderBy if you prefer.
    window.db.collection("agent list")
      .orderBy("Agent","asc")
      .onSnapshot((snap) => {
        allRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        applyFilter();
      }, (err) => {
        console.error("Firestore error:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-4">Failed to load data.</td></tr>`;
      });
  }

  // ---------- export ----------
  function exportToExcel() {
    const rows = (filtered.length ? filtered : allRows);
    if (!rows.length) {
      alert("No data to export.");
      return;
    }

    const data = [
      ["Agent","Mobile","Email","JoinDate","Type","Branch"],
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
    XLSX.writeFile(wb, "AgentList.xlsx");
  }

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", () => {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(applyFilter, 120);
    });
    branchFilter.addEventListener("change", applyFilter);
    btnExport.addEventListener("click", exportToExcel);

    loadAgents();
  });
})();
