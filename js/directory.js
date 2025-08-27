// directory.js — render Company Directory from Firestore (collection: companydirectory)

(function () {
  const tbody = document.getElementById("dirBody");
  const searchInput = document.getElementById("searchInput");
  const rowCount = document.getElementById("rowCount");

  let allRows = [];   // raw data array for client-side search
  let filtered = [];  // current filtered view

  function htmlEscape(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No records.</td></tr>`;
      rowCount.textContent = "0 records";
      return;
    }

    const html = rows.map(r => `
      <tr>
        <td>${htmlEscape(r.DisplayName)}</td>
        <td>${htmlEscape(r.OfficeName)}</td>
        <td>${htmlEscape(r.Title)}</td>
        <td>${htmlEscape(r.Ext)}</td>
        <td>${htmlEscape(r.PersonalTel)}</td>
        <td>${htmlEscape(r.DirectTel)}</td>
        <td><a href="mailto:${htmlEscape(r.Email)}">${htmlEscape(r.Email)}</a></td>
      </tr>
    `).join("");

    tbody.innerHTML = html;
    rowCount.textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  }

  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    if (!q) {
      filtered = allRows.slice();
    } else {
      filtered = allRows.filter(r => {
        return [
          r.DisplayName, r.OfficeName, r.Title, r.Ext,
          r.PersonalTel, r.DirectTel, r.Email
        ].some(v => (v || "").toString().toLowerCase().includes(q));
      });
    }
    renderRows(filtered);
  }

  // Load data from Firestore (order by DisplayName for readability)
  function loadDirectory() {
    if (!window.db) {
      console.error("Firestore not initialized: check firebaseConfig.js load order.");
      tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">Firestore not initialized.</td></tr>`;
      return;
    }

    // Real-time updates; change to .get() if you only need one-time load
    window.db.collection("companydirectory")
      .orderBy("DisplayName")
      .onSnapshot((snap) => {
        allRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        applyFilter();
      }, (err) => {
        console.error("Firestore error:", err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">Failed to load data.</td></tr>`;
      });
  }

  // Wire up search
  searchInput.addEventListener("input", () => {
    // small debounce
    window.clearTimeout(searchInput._t);
    searchInput._t = window.setTimeout(applyFilter, 120);
  });

  // Start after DOM ready
  document.addEventListener("DOMContentLoaded", loadDirectory);
})();
