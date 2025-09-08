// events_admin_regs.js
// Admin: View registrations per event in a modal.
// - Adds a "Registrations" button to each event card (admin list)
// - Opens modal, loads from "eventRegistrations" (preferred) or "eventRegidtrations" (fallback)
// - Client-side sort/filter/search/pagination
// - Copy Emails & Export CSV
// Firestore: v8, Bootstrap 5

(function () {
  if (!window.db) {
    console.error("[events_admin_regs] Firestore not initialized (window.db missing).");
    return;
  }

  // ---- Where the admin event cards live ----
  const container = document.getElementById("eventsContainer");
  if (!container) return;

  // ---- Modal elements (optional, we can render toolbar dynamically) ----
  const modalEl = document.getElementById("regListModal");
  if (!modalEl) return;
  const modal = new bootstrap.Modal(modalEl);

  const regEventTitle = document.getElementById("regEventTitle"); // required
  const regEventMeta  = document.getElementById("regEventMeta");  // optional
  const regListBody   = document.getElementById("regListBody");   // required (tbody)
  const regListCounts = document.getElementById("regListCounts"); // optional
  const regListStatus = document.getElementById("regListStatus"); // optional
  const btnCopyEmails = document.getElementById("btnCopyEmails"); // optional

  // Optional toolbar hooks (if you already had them in HTML)
  let elSearch   = document.getElementById("regSearchInput")  || null;
  let elStatus   = document.getElementById("regStatusFilter") || null;
  let btnCSV     = document.getElementById("btnExportCSV")    || null;
  let elPager    = document.getElementById("regPager")        || null;
  let elPageInfo = document.getElementById("regPageInfo")     || null;

  // If controls are not present, inject a compact toolbar right above the table.
  (function ensureToolbar() {
    const needsToolbar = !(elSearch && elStatus && btnCSV && elPager && elPageInfo);
    if (!needsToolbar) return;

    const tableWrap = modalEl.querySelector(".table-responsive") || modalEl.querySelector(".modal-body");
    if (!tableWrap) return;

    const toolbar = document.createElement("div");
    toolbar.className = "d-flex flex-wrap align-items-end gap-2 mb-2";
    toolbar.innerHTML = `
      <div class="flex-grow-1"></div>
      <div>
        <label class="form-label mb-1 small">Status</label>
        <select id="regStatusFilter" class="form-select form-select-sm">
          <option value="ALL">All</option>
          <option value="registered">registered</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>
      <div>
        <label class="form-label mb-1 small">Search</label>
        <input id="regSearchInput" class="form-control form-control-sm" placeholder="Name or email…" />
      </div>
      <div class="d-flex gap-2">
        <button id="btnCopyEmailsAuto" class="btn btn-outline-secondary btn-sm" title="Copy all visible emails">
          <i class="bi bi-clipboard-check me-1"></i>Copy Emails
        </button>
        <button id="btnExportCSV" class="btn btn-outline-primary btn-sm" title="Export visible rows to CSV">
          <i class="bi bi-filetype-csv me-1"></i>CSV
        </button>
      </div>
      <div id="regPageInfo" class="ms-auto small text-muted"></div>
      <div id="regPager" class="btn-group btn-group-sm" role="group">
        <button class="btn btn-outline-secondary" data-page="prev"><i class="bi bi-chevron-left"></i></button>
        <button class="btn btn-outline-secondary" data-page="next"><i class="bi bi-chevron-right"></i></button>
      </div>
    `;
    tableWrap.parentElement.insertBefore(toolbar, tableWrap);

    // bind references
    elSearch   = toolbar.querySelector("#regSearchInput");
    elStatus   = toolbar.querySelector("#regStatusFilter");
    btnCSV     = toolbar.querySelector("#btnExportCSV");
    elPager    = toolbar.querySelector("#regPager");
    elPageInfo = toolbar.querySelector("#regPageInfo");

    // if no top-level "Copy" was provided, wire the injected one
    if (!btnCopyEmails) {
      // We'll delegate to same copy logic with current filtered slice
      const autoBtn = toolbar.querySelector("#btnCopyEmailsAuto");
      autoBtn.addEventListener("click", () => copyVisibleEmails());
    }
  })();

  // ---- State ----
  let currentEventId = null;
  let currentEventMetaText = "";
  let regsRaw = [];     // all rows for event
  let regsFiltered = []; // after search/status filter
  let page = 1;
  const PAGE_SIZE = 20;

  // ---- Card enhancement: add "Registrations" button ----
  const observer = new MutationObserver(() => enhanceCards());
  observer.observe(container, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", enhanceCards);

  function enhanceCards() {
    const cards = container.querySelectorAll(".event-card");
    cards.forEach(card => {
      const id = extractEventId(card);
      if (!id) return;

      const right = card.querySelector(".text-end");
      if (!right) return;

      if (right.querySelector(".btn-view-reg")) return; // already injected

      const btn = document.createElement("button");
      btn.className = "btn btn-outline-primary btn-sm me-1 btn-view-reg";
      btn.type = "button";
      btn.dataset.id = id;
      btn.innerHTML = `<i class="bi bi-people me-1"></i>Registrations`;
      btn.addEventListener("click", () => openRegistrations(card, id));

      const delBtn = right.querySelector("[data-action='delete']");
      if (delBtn && delBtn.parentElement === right) right.insertBefore(btn, delBtn);
      else right.appendChild(btn);
    });
  }

  function extractEventId(card) {
    return (card.querySelector("[data-action='edit']")?.getAttribute("data-id"))
        || (card.querySelector("[data-action='delete']")?.getAttribute("data-id"))
        || null;
  }

  // ---- Open modal & load data ----
  async function openRegistrations(card, eventId) {
    currentEventId = eventId;

    const title = (card.querySelector(".event-title")?.textContent || "").trim();
    const meta  = (card.querySelector(".event-meta")?.textContent || "").trim();
    currentEventMetaText = meta;

    if (regEventTitle) regEventTitle.textContent = title || eventId;
    if (regEventMeta)  regEventMeta.textContent  = meta;

    setLoading("Loading registrations…");
    modal.show();

    regsRaw = [];
    regsFiltered = [];
    page = 1;

    try {
      // try preferred collection first
      let list = await fetchRegs("eventRegistrations", eventId);
      if (!list.length) list = await fetchRegs("eventRegidtrations", eventId); // typo fallback

      // sort newest first (client-side)
      list.sort((a, b) => (toDate(b.createdAt) - toDate(a.createdAt)));

      regsRaw = list;
      applyFiltersAndRender();
    } catch (err) {
      console.error("registrations load error:", err);
      setError(err.message || "Failed to load registrations.");
    }
  }

  async function fetchRegs(collectionName, eventId) {
    try {
      const snap = await window.db
        .collection(collectionName)
        .where("eventId", "==", eventId)
        // no orderBy -> avoid composite index
        .get();

      if (snap.empty) return [];
      return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    } catch (err) {
      console.warn(`fetchRegs(${collectionName}) failed:`, err);
      return [];
    }
  }

  // ---- Filters / Search / Pagination ----
  function applyFiltersAndRender() {
    const q = (elSearch?.value || "").trim().toLowerCase();
    const st = (elStatus?.value || "ALL").toLowerCase();

    regsFiltered = regsRaw.filter(r => {
      const statusOK = (st === "all") ? true : (String(r.status || "").toLowerCase() === st);
      if (!statusOK) return false;

      if (!q) return true;
      const haystack = [
        r.attendeeName || "",
        r.attendeeEmail || ""
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });

    // pagination bounds
    const total = regsFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) page = totalPages;

    const startIdx = (page - 1) * PAGE_SIZE;
    const pageRows = regsFiltered.slice(startIdx, startIdx + PAGE_SIZE);

    renderTable(pageRows, total, totalPages);
  }

  function renderTable(rows, total, totalPages) {
    if (!rows.length) {
      regListBody.innerHTML = `
        <tr><td colspan="5" class="text-center text-muted py-4">No registrations found.</td></tr>`;
    } else {
      let idxStart = (page - 1) * PAGE_SIZE + 1;
      const html = rows.map((r, i) => {
        const name   = (r.attendeeName || "").toString();
        const email  = (r.attendeeEmail || "").toString();
        const status = (r.status || "").toString();
        const at     = toDate(r.createdAt);
        const atStr  = at ? fmtDateTime(at) : "";

        return `
          <tr>
            <td class="text-muted">${idxStart + i}</td>
            <td>${esc(name)}</td>
            <td><a href="mailto:${esc(email)}">${esc(email)}</a></td>
            <td>${esc(status)}</td>
            <td class="text-nowrap">${esc(atStr)}</td>
          </tr>`;
      }).join("");
      regListBody.innerHTML = html;
    }

    if (regListCounts) {
      const regCount = `${total} registration${total === 1 ? "" : "s"}`;
      regListCounts.textContent = regCount;
    }
    if (elPageInfo) {
      elPageInfo.textContent = `Page ${page} of ${totalPages}`;
    }
  }

  // ---- Toolbar wiring ----
  if (elSearch) {
    elSearch.addEventListener("input", () => {
      clearStatus();
      page = 1;
      // debounce a bit
      clearTimeout(elSearch._t);
      elSearch._t = setTimeout(applyFiltersAndRender, 150);
    });
  }
  if (elStatus) {
    elStatus.addEventListener("change", () => {
      clearStatus();
      page = 1;
      applyFiltersAndRender();
    });
  }
  if (elPager) {
    elPager.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-page]");
      if (!btn) return;
      const dir = btn.getAttribute("data-page");
      const totalPages = Math.max(1, Math.ceil(regsFiltered.length / PAGE_SIZE));
      if (dir === "prev" && page > 1) page--;
      if (dir === "next" && page < totalPages) page++;
      applyFiltersAndRender();
    });
  }
  if (btnCSV) {
    btnCSV.addEventListener("click", exportVisibleCSV);
  }
  if (btnCopyEmails) {
    btnCopyEmails.addEventListener("click", copyVisibleEmails);
  }

  // ---- Copy & CSV ----
  function copyVisibleEmails() {
    const startIdx = (page - 1) * PAGE_SIZE;
    const pageRows = regsFiltered.slice(startIdx, startIdx + PAGE_SIZE);
    const emails = pageRows.map(r => r.attendeeEmail).filter(Boolean);
    copyToClipboard(emails.join(", "));
  }

  function exportVisibleCSV() {
    const startIdx = (page - 1) * PAGE_SIZE;
    const pageRows = regsFiltered.slice(startIdx, startIdx + PAGE_SIZE);

    const headers = ["#", "Name", "Email", "Status", "RegisteredAt", "EventMeta"];
    let idxStart = (page - 1) * PAGE_SIZE + 1;

    const lines = [headers.join(",")];
    pageRows.forEach((r, i) => {
      const row = [
        String(idxStart + i),
        csvSafe(r.attendeeName || ""),
        csvSafe(r.attendeeEmail || ""),
        csvSafe(r.status || ""),
        csvSafe(fmtDateTime(toDate(r.createdAt))),
        csvSafe(currentEventMetaText || "")
      ];
      lines.push(row.join(","));
    });

    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dt = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const tag = `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}_${pad(dt.getHours())}${pad(dt.getMinutes())}`;
    a.download = `registrations_${currentEventId || "event"}_${tag}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV exported.");
  }

  // ---- Helpers ----
  function setLoading(msg) {
    if (regEventTitle && !regEventTitle.textContent) regEventTitle.textContent = "Registrations";
    if (regListCounts) regListCounts.textContent = "";
    if (regListStatus) regListStatus.textContent = "";
    regListBody.innerHTML = `
      <tr><td colspan="5" class="text-center text-muted py-4">
        <div class="spinner-border spinner-border-sm me-2"></div>${esc(msg || "Loading…")}
      </td></tr>`;
  }
  function setError(msg) {
    regListBody.innerHTML = `<tr><td colspan="5" class="text-danger py-4 text-center">${esc(msg || "Error")}</td></tr>`;
    toast("Failed to load.");
  }
  function clearStatus() {
    if (regListStatus) regListStatus.textContent = "";
  }
  function toast(msg) {
    if (!regListStatus) return;
    regListStatus.textContent = msg;
    setTimeout(() => { regListStatus.textContent = ""; }, 1800);
  }

  function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => toast("Emails copied."),
      () => {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); toast("Emails copied."); }
        catch { toast("Copy failed."); }
        finally { document.body.removeChild(ta); }
      }
    );
  }

  // small utils
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
    ));
  }
  function csvSafe(val) {
    const s = String(val ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtDateTime(d) {
    if (!d) return "";
    return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
  }
})();
