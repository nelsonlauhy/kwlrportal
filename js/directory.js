// directory.js — render Company Directory from Firestore (collection: companydirectory)

(function () {
  const tbody = document.getElementById("dirBody");
  const searchInput = document.getElementById("searchInput");
  const rowCount = document.getElementById("rowCount");

  let allRows = [];   // 原始資料
  let filtered = [];  // 篩選後

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const telLink = (v) => v ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : "";
  const mailLink = (v) => v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : "";

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No records.</td></tr>`;
      rowCount.textContent = "0 records";
      return;
    }

    const html = rows.map(r => `
      <tr>
        <td class="col-name">
          ${esc(r.DisplayName)}
          ${r.DisplayOrder !== undefined ? `<span class="badge badge-soft ms-2">#${esc(r.DisplayOrder)}</span>` : ""}
        </td>
        <td>${r.OfficeName ? `<span class="badge badge-soft">${esc(r.OfficeName)}</span>` : ""}</td>
        <td>${esc(r.Title)}</td>
        <td>${esc(r.Ext)}</td>
        <td>${telLink(r.PersonalTel)}</td>
        <td>${telLink(r.DirectTel)}</td>
        <td>${mailLink(r.Email)}</td>
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
      filtered = allRows.filter(r =>
        [
          r.DisplayName, r.OfficeName, r.Title, r.Ext,
          r.PersonalTel, r.DirectTel, r.Email
        ].some(v => (v || "").toString().toLowerCase().includes(q))
      );
    }
    renderRows(filtered);
  }

  function loadDirectory() {
    if (!window.db) {
      console.error("Firestore not initialized: check firebaseConfig.js load order.");
      tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">Firestore not initialized.</td></tr>`;
      return;
    }

    // << 用 DisplayOrder 由細到大排序；如想同名再以 DisplayName 次序，可加第二個 orderBy >>
    // 注意：加多個 orderBy 可能會要求建立 Composite Index（Firestore 會在 console 給你快速連結）
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

  // 搜尋框 debounce
  searchInput.addEventListener("input", () => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(applyFilter, 120);
  });

  document.addEventListener("DOMContentLoaded", loadDirectory);
})();
