// js/directory.js
// Company Directory viewer
// Requirements: firebase v8 已經在 html 載入，firebaseConfig.js 已經初始化並設定 window.db

(function () {
  const tbody = document.getElementById("dirBody");
  const searchInput = document.getElementById("searchInput");
  const rowCount = document.getElementById("rowCount");

  let allRows = [];   // Firestore 原始資料
  let filtered = [];  // 篩選後

  // ---------- 工具 ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    );

  const telLink = (v) => (v ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : "");
  const mailLink = (v) => (v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : "");

  // ---------- Render ----------
  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No records.</td></tr>`;
      rowCount.textContent = "0 records";
      return;
    }

    const html = rows
      .map(
        (r) => `
      <tr>
        <td class="col-name">${esc(r.DisplayName)}</td>
        <td>${r.OfficeName ? `<span class="badge badge-soft">${esc(r.OfficeName)}</span>` : ""}</td>
        <td>${esc(r.Title)}</td>
        <td>${esc(r.Ext)}</td>
        <td>${telLink(r.PersonalTel)}</td>
        <td>${telLink(r.DirectTel)}</td>
        <td>${mailLink(r.Email)}</td>
      </tr>`
      )
      .join("");

    tbody.innerHTML = html;
    rowCount.textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  }

  // ---------- Filter ----------
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    if (!q) {
      filtered = allRows.slice();
    } else {
      filtered = allRows.filter((r) =>
        [
          r.DisplayName,
          r.OfficeName,
          r.Title,
          r.Ext,
          r.PersonalTel,
          r.DirectTel,
          r.Email,
        ].some((v) => (v || "").toString().toLowerCase().includes(q))
      );
    }
    renderRows(filtered);
  }

  // ---------- Load ----------
  function loadDirectory() {
    if (!window.db) {
      console.error("Firestore not initialized: check firebaseConfig.js load order.");
      tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">Firestore not initialized.</td></tr>`;
      return;
    }

    // 以 DisplayOrder → DisplayName 排序
    // Firestore 如果要求 composite index，照 console link 去建立即可
    window.db
      .collection("companydirectory")
      .orderBy("DisplayOrder", "asc")
      .orderBy("DisplayName", "asc")
      .onSnapshot(
        (snap) => {
          allRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          applyFilter();
        },
        (err) => {
          console.error("Firestore error:", err);
          tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">Failed to load data.</td></tr>`;
        }
      );
  }

  // ---------- Events ----------
  searchInput.addEventListener("input", () => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(applyFilter, 150); // debounce
  });

  document.addEventListener("DOMContentLoaded", loadDirectory);
})();
