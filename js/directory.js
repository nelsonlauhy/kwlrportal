// js/directory.js — Company Directory with Office dropdown filter + search
// Requirements: firebase v8 loaded, firebaseConfig.js sets window.db, MSAL handled upstream

(function () {
  // DOM refs
  const tbody        = document.getElementById("dirBody");
  const searchInput  = document.getElementById("searchInput");
  const officeFilter = document.getElementById("officeFilter");
  const rowCount     = document.getElementById("rowCount");

  // state
  let allRows = [];
  let filtered = [];

  // ---------- utils ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, m => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
    ));
  const telLink  = (v) => v ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : "";
  const mailLink = (v) => v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : "";

  // ---------- rendering ----------
  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No records.</td></tr>`;
      rowCount.textContent = "0 records";
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="col-name">${esc(r.DisplayName)}</td>
        <td>${r.OfficeName ? `<span class="badge badge-soft">${esc(r.OfficeName)}</span>` : ""}</td>
        <td>${esc(r.Title)}</td>
        <td>${esc(r.Ext)}</td>
        <td>${esc(r.PersonalTel)}</td>
        <td>${esc(r.DirectTel)}</td>
        <td>${mailLink(r.Email)}</td>
      </tr>
    `).join("");

    rowCount.textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  }

  // ---------- filtering ----------
  function applyFilter() {
    const q = (searchInput?.value || "").toLowerCase().trim();

    // Normalize selection
    const officeSelRaw = (officeFilter?.value || "ALL").trim();
    const officeSel = officeSelRaw.toUpperCase();

    filtered = allRows.filter(r => {
      // Office filter: exact or prefix match (to tolerate labels like "LRI HO – Front Desk")
      const officeName  = (r.OfficeName || "").toString().trim();
      const officeUpper = officeName.toUpperCase();

      const officeOk = (officeSel === "ALL")
        ? true
        : (officeUpper === officeSel || officeUpper.startsWith(officeSel + " "));

      if (!officeOk) return false;

      // Text search across common fields
      if (!q) return true;

      const haystack = [
        r.DisplayName, r.OfficeName, r.Title, r.Ext,
        r.PersonalTel, r.DirectTel, r.Email
      ].map(v => (v || "").toString().toLowerCase());

      return haystack.some(v => v.includes(q));
    });

    renderRows(filtered);
  }

  // ---------- data load ----------
  function loadDirectory() {
    if (!window.db) {
      console.error("Firestore not initialized: check firebaseConfig.js load order.");
      tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">Firestore not initialized.</td></tr>`;
      return;
    }

    // Server-side sort (composite index: DisplayOrder asc, DisplayName asc)
    window.db.collection("companydirectory")
      .orderBy("DisplayOrder", "asc")
      .orderBy("DisplayName", "asc")
      .onSnapshot((snap) => {
        allRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        applyFilter();
      }, (err) => {
        console.error("Firestore error:", err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">Failed to load data.</td></tr>`;
      });
  }

  // ---------- events ----------
  document.addEventListener("DOMContentLoaded", () => {
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(searchInput._t);
        searchInput._t = setTimeout(applyFilter, 120); // debounce
      });
    }
    if (officeFilter) {
      officeFilter.addEventListener("change", applyFilter);
    }
    loadDirectory();
  });
})();
