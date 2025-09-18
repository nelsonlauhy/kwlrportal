// Events Admin (Firestore v8) — List-only with Edit/Create modal
// Approach A (materialize on save) for recurrence
// - detailDescription: auto-link + <br> (Option A) with live preview
// - Color tag
// - Conflict detection (branch + resource overlap)
// - Registration windows per occurrence via DAYS-before-start
// - Back-fill "Reg Opens/Closes (days)" when editing an existing event
// - Combined filter: Location (Branch — Resource ONLY) + Search
// - "Open registration now" checkbox -> auto-calc days from now; unchecks on manual change

(function() {
  // ---------- DOM ----------
  const containerList   = document.getElementById("eventsContainer");
  const locationFilter  = document.getElementById("locationFilter"); // Combined filter (resource only)
  const searchInput     = document.getElementById("searchInput");
  const listLabel       = document.getElementById("listLabel");

  const btnNew   = document.getElementById("btnNew");

  // Edit modal
  const editModalEl = document.getElementById("editModal");
  const editModal   = new bootstrap.Modal(editModalEl);
  const editForm    = document.getElementById("editForm");
  const editTitle   = document.getElementById("editTitle");
  const editErr     = document.getElementById("editErr");
  const editErrInline = document.getElementById("editErrInline");
  const editOk      = document.getElementById("editOk");
  const editBusy    = document.getElementById("editBusy");
  const btnSave     = document.getElementById("btnSave");

  // Fields
  const f_title = document.getElementById("f_title");
  const f_status = document.getElementById("f_status");
  const f_branch = document.getElementById("f_branch");
  const f_resourceId = document.getElementById("f_resourceId");
  const f_resourceName = document.getElementById("f_resourceName");
  const f_start = document.getElementById("f_start");
  const f_end = document.getElementById("f_end");
  const f_description = document.getElementById("f_description");
  const f_detailDescription = document.getElementById("f_detailDescription");
  const f_detailPreview = document.getElementById("f_detailPreview");
  const f_allowRegistration = document.getElementById("f_allowRegistration");
  const f_capacity = document.getElementById("f_capacity");
  const f_remaining = document.getElementById("f_remaining");
  const f_regOpensDays = document.getElementById("f_regOpensDays");
  const f_regClosesDays = document.getElementById("f_regClosesDays");
  const f_visibility = document.getElementById("f_visibility");
  const f_colorPreset = document.getElementById("f_colorPreset");
  const f_color = document.getElementById("f_color");
  const f_regOpenNow = document.getElementById("f_regOpenNow"); // NEW

  // Recurrence fields
  const f_repeat = document.getElementById("f_repeat");
  const f_interval = document.getElementById("f_interval");
  const weeklyDaysWrap = document.getElementById("weeklyDaysWrap");
  const f_repeatEndType = document.getElementById("f_repeatEndType");
  const repeatCountWrap = document.getElementById("repeatCountWrap");
  const f_repeatCount = document.getElementById("f_repeatCount");
  const repeatUntilWrap = document.getElementById("repeatUntilWrap");
  const f_repeatUntil = document.getElementById("f_repeatUntil");

  // Delete modal
  const delModalEl = document.getElementById("delModal");
  const delModal = new bootstrap.Modal(delModalEl);
  const delMsg = document.getElementById("delMsg");
  const delErr = document.getElementById("delErr");
  const delBusy = document.getElementById("delBusy");
  const btnDoDelete = document.getElementById("btnDoDelete");

  // ---------- State ----------
  let resources = []; // [{id,name,branch,capacity?}]
  let allEvents = [];
  let filtered = [];
  let editingId = null; // _id when editing a single event
  let pendingDeleteId = null;
  let unsubscribeEvents = null;
  let editDetailHTMLOriginal = "";
  let editDetailTouched = false;

  // ---------- Utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));

  function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtDateTime(d) {
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function inputValueFromDate(d) {
    if (!d) return "";
    const pad = (n)=> String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function dtLocalFromInput(value) {
    return value ? new Date(value) : null; // local time
  }

  // Compute reg windows using DAYS before start
  function deriveRegWindowDays(startDate, opensDays, closesDays) {
    const openMs = (Number(opensDays) || 0) * 24 * 60 * 60 * 1000;
    const closeMs = (Number(closesDays) || 0) * 24 * 60 * 60 * 1000;
    const regOpensAt = new Date(startDate.getTime() - openMs);
    let regClosesAt = new Date(startDate.getTime() - closeMs);
    if (regOpensAt >= regClosesAt) {
      // ensure closes is after opens by 30 minutes
      regClosesAt = new Date(regOpensAt.getTime() + 30 * 60000);
    }
    return { regOpensAt, regClosesAt };
  }

  // Convert plain text → HTML (auto-link + preserve newlines)
  function plainToHtml(text) {
    const escText = esc(text || "");
    // link http(s) and www.
    const urlRegex = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
    const linked = escText.replace(urlRegex, (m) => {
      const href = m.startsWith("www.") ? `https://${m}` : m;
      return `<a href="${href}" target="_blank" rel="noopener">${m}</a>`;
    });
    return linked.replace(/\n/g, "<br>");
  }

  // Turn stored HTML into plaintext for textarea display, preserving line breaks.
  function htmlToPlainForTextarea(html) {
    if (!html) return "";
    const tmp = document.createElement("div");
    const normalized = String(html)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n");
    tmp.innerHTML = normalized;
    const text = tmp.textContent || "";
    return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  }

  function clearEditErrors() {
    [editErr, editErrInline, editOk].forEach(el => { el.classList.add("d-none"); el.textContent=""; });
  }

  function showInlineError(msg) {
    editErrInline.textContent = msg;
    editErrInline.classList.remove("d-none");
  }

  // ---------- Combined Filter (Resource only) + Search ----------
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const locSel = (locationFilter?.value || "ALL"); // "ALL" | "RS:<resourceId>"

    filtered = allEvents.filter(ev => {
      // If a specific resource is selected, filter by resourceId
      if (locSel !== "ALL") {
        if (!locSel.startsWith("RS:")) return false;
        const rid = locSel.slice(3);
        if ((ev.resourceId || "") !== rid) return false;
      }

      // Search text
      if (q) {
        const hay = [ev.title, ev.description, ev.resourceName, ev.branch]
          .map(v => (v || "").toString().toLowerCase());
        if (!hay.some(v => v.includes(q))) return false;
      }

      return true;
    });

    renderList();
  }

  // ---------- Render List ----------
  function renderList() {
    if (!filtered.length) {
      containerList.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-calendar-x me-2"></i>No events match your filters.
        </div>`;
      return;
    }
    const groups = {};
    for (const e of filtered) {
      const d = toDate(e.start);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      (groups[key] ||= { label: d.toLocaleString(undefined,{ month: "long", year: "numeric" }), events: [] }).events.push(e);
    }
    const parts = [];
    Object.keys(groups).sort().forEach(key => {
      const g = groups[key];
      parts.push(`<div class="month-header">${esc(g.label)}</div>`);
      for (const e of g.events) parts.push(renderEventRow(e));
    });
    containerList.innerHTML = parts.join("");

    containerList.querySelectorAll("[data-action='edit']").forEach(btn=>{
      btn.addEventListener("click", ()=> openEdit(btn.getAttribute("data-id")));
    });
    containerList.querySelectorAll("[data-action='delete']").forEach(btn=>{
      btn.addEventListener("click", ()=> openDelete(btn.getAttribute("data-id")));
    });
  }

  function renderEventRow(e) {
    const s = toDate(e.start), ee = toDate(e.end);
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(ee)}`;
    const remaining = (typeof e.remaining === "number") ? e.remaining : null;
    const capacity  = (typeof e.capacity === "number") ? e.capacity : null;
    const remainTxt = (remaining != null && capacity != null)
      ? `${remaining}/${capacity} left`
      : (remaining != null ? `${remaining} left` : "");

    // Tag color swatch only (no hex code)
    const colorHex = e.color ? normalizeHex(e.color) : null;
    const colorBadge = colorHex
      ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;
                        background:${esc(colorHex)};border:1px solid #cbd5e1;
                        vertical-align:middle;margin-right:.4rem;"></span>`
      : "";

    return `
      <div class="event-card">
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-3">
            <div class="event-title">${esc(e.title || "Untitled Event")}</div>
            <div class="event-meta mt-1">
              <span class="me-2"><i class="bi bi-clock"></i> ${esc(dateLine)}</span>
              ${colorBadge}
              ${e.resourceName ? `<span class="badge badge-room me-2"><i class="bi bi-building me-1"></i>${esc(e.resourceName)}</span>` : ""}
              ${e.branch ? `<span class="badge badge-branch me-2">${esc(e.branch)}</span>` : ""}
              <span class="badge text-bg-light border">${esc(e.status || "")}</span>
              <span class="badge text-bg-light border">${esc(e.visibility || "")}</span>
            </div>
            ${e.description ? `<div class="mt-2 text-secondary">${esc(e.description)}</div>` : ""}
          </div>
          <div class="text-end">
            ${remainTxt ? `<div class="small text-muted mb-2">${esc(remainTxt)}</div>` : ""}
            <button class="btn btn-outline-secondary btn-sm me-1" data-action="edit" data-id="${esc(e._id)}">
              <i class="bi bi-pencil-square me-1"></i>Edit
            </button>
            <button class="btn btn-outline-danger btn-sm" data-action="delete" data-id="${esc(e._id)}">
              <i class="bi bi-trash me-1"></i>Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- Populate Location filter (Resource-only) ----------
  function populateLocationFilter(resources) {
    if (!locationFilter) return;

    const opts = [`<option value="ALL">All Locations</option>`];

    // Sort by branch then name
    const byBranchThenName = [...resources].sort((a,b) =>
      String(a.branch||"").localeCompare(String(b.branch||"")) ||
      String(a.name||"").localeCompare(String(b.name||""))
    );

    byBranchThenName.forEach(r => {
      const br = (r.branch || "").toUpperCase();
      const nm = r.name || r.id || "Resource";
      opts.push(`<option value="RS:${esc(r.id)}">${esc(br)} — ${esc(nm)}</option>`);
    });

    locationFilter.innerHTML = opts.join("");
  }

  // ---------- Resources & Events load ----------
  async function loadResources() {
    const col = window.db.collection("resources");
    try {
      const snap = await col.orderBy("branch","asc").orderBy("name","asc").get();
      resources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn("resources index missing; client-sort fallback:", err);
      const snap = await col.get();
      resources = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a,b) => (String(a.branch||"").localeCompare(String(b.branch||"")) ||
                        String(a.name||"").localeCompare(String(b.name||""))));
    }

    // Populate edit form resource dropdown
    const opts = [`<option value="">-- select --</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)} (${esc(r.branch||"-")})</option>`));
    f_resourceId.innerHTML = opts.join("");

    // Populate combined filter (resource-only)
    populateLocationFilter(resources);
  }

  function attachEventsListener() {
    if (typeof unsubscribeEvents === "function") { unsubscribeEvents(); unsubscribeEvents = null; }

    const now = new Date();
    const col = window.db.collection("events");
    try {
      unsubscribeEvents = col
        .where("start",">=", now)
        .orderBy("start","asc")
        .onSnapshot(snap => {
          allEvents = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
          applyFilter();
        }, err => {
          console.error("events listener error:", err);
          containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
        });
    } catch (err) {
      console.error("events listener threw:", err);
      containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
    }
  }

  // ---------- Open Edit ----------
  function openEdit(id) {
    clearEditErrors();
    editOk.classList.add("d-none");
    btnSave.disabled = false;
    editBusy.classList.add("d-none");

    editingId = id || null;
    editTitle.textContent = editingId ? "Edit Event" : "New Event";

    // Defaults
    f_title.value = "";
    f_status.value = "draft";
    f_branch.value = "";
    f_resourceId.value = "";
    f_resourceName.value = "";
    f_start.value = "";
    f_end.value = "";
    f_description.value = "";
    f_detailDescription.value = "";
    f_detailPreview.innerHTML = "";
    editDetailHTMLOriginal = "";
    editDetailTouched = false;

    f_allowRegistration.value = "true";
    f_capacity.value = "";
    f_remaining.value = "";
    f_regOpensDays.value = "7";
    f_regClosesDays.value = "1";
    if (f_regOpenNow) f_regOpenNow.checked = false; // NEW

    f_visibility.value = "public";
    f_colorPreset.value = "#3b82f6";
    f_color.value = "#3b82f6";

    // Recurrence defaults
    f_repeat.value = "none";
    f_interval.value = "1";
    weeklyDaysWrap.style.display = "none";
    f_repeatEndType.value = "count";
    repeatCountWrap.style.display = "";
    repeatUntilWrap.style.display = "none";
    f_repeatCount.value = "1";
    f_repeatUntil.value = "";

    if (!editingId) {
      f_detailPreview.innerHTML = "";
      editModal.show();
      return;
    }

    const ev = allEvents.find(x => x._id === editingId);
    if (!ev) { showInlineError("Event not found."); return; }

    // Fill form for single event edit
    f_title.value = ev.title || "";
    f_status.value = ev.status || "draft";
    f_branch.value = ev.branch || "";
    f_resourceId.value = ev.resourceId || "";
    f_resourceName.value = ev.resourceName || "";
    f_start.value = inputValueFromDate(toDate(ev.start));
    f_end.value = inputValueFromDate(toDate(ev.end));
    f_description.value = ev.description || "";

    // Preserve the original HTML and show a plaintext view in the textarea
    editDetailHTMLOriginal = ev.detailDescription || "";
    editDetailTouched = false;
    f_detailDescription.value = htmlToPlainForTextarea(editDetailHTMLOriginal);
    f_detailPreview.innerHTML = editDetailHTMLOriginal;

    f_allowRegistration.value = (ev.allowRegistration === false) ? "false" : "true";
    f_capacity.value = (ev.capacity ?? "");
    f_remaining.value = (ev.remaining ?? "");
    f_visibility.value = ev.visibility || "public";

    if (ev.color) {
      f_colorPreset.value = (isPreset(ev.color) ? ev.color : "__custom");
      f_color.value = normalizeHex(ev.color);
    } else {
      f_colorPreset.value = "#3b82f6";
      f_color.value = "#3b82f6";
    }

    (function backfillRegDays() {
      const startDate = toDate(ev.start);
      const opensAt = toDate(ev.regOpensAt);
      const closesAt = toDate(ev.regClosesAt);
      function daysBefore(start, other) {
        if (!start || !other) return null;
        const ms = start.getTime() - other.getTime();
        if (ms <= 0) return 0;
        return Math.round(ms / (24*60*60*1000));
      }
      const openDays = daysBefore(startDate, opensAt);
      const closeDays = daysBefore(startDate, closesAt);
      if (openDays !== null && !Number.isNaN(openDays)) f_regOpensDays.value = String(openDays);
      if (closeDays !== null && !Number.isNaN(closeDays)) f_regClosesDays.value = String(closeDays);

      // Reflect "open now" if registration already opened
      if (f_regOpenNow) {
        if (opensAt && opensAt <= new Date()) {
          f_regOpenNow.checked = true;
          recalcRegOpensDaysFromNow(); // keep days aligned to "now"
        } else {
          f_regOpenNow.checked = false;
        }
      }
    })();

    editModal.show();
  }

  function textFromHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return div.innerText || "";
  }

  function isPreset(hex) {
    const presets = ["#3b82f6","#22c55e","#ef4444","#eab308","#a855f7","#f97316","#14b8a6","#64748b"];
    return presets.includes(normalizeHex(hex));
  }
  function normalizeHex(c) {
    if (!c) return "#3b82f6";
    let x = String(c).trim();
    if (!x.startsWith("#")) x = "#" + x;
    if (x.length === 4) x = "#" + x[1]+x[1]+x[2]+x[2]+x[3]+x[3];
    return x.toLowerCase();
  }

  // ---------- Delete ----------
  function openDelete(id) {
    pendingDeleteId = id || null;
    delErr.classList.add("d-none");
    delBusy.classList.add("d-none");
    delMsg.textContent = "Are you sure to delete this event?";
    delModal.show();
  }

  btnDoDelete.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    delErr.classList.add("d-none");
    delBusy.classList.remove("d-none");

    try {
      await window.db.collection("events").doc(pendingDeleteId).delete();
      delModal.hide();
    } catch (err) {
      console.error("delete error:", err);
      delErr.textContent = err.message || "Delete failed.";
      delErr.classList.remove("d-none");
    } finally {
      delBusy.classList.add("d-none");
    }
  });

  // ---------- Color picker link ----------
  f_colorPreset.addEventListener("change", () => {
    if (f_colorPreset.value === "__custom") return;
    f_color.value = f_colorPreset.value;
  });
  f_color.addEventListener("input", () => {
    f_colorPreset.value = "__custom";
  });

  // ---------- Recurrence UI dynamics ----------
  f_repeat.addEventListener("change", () => {
    weeklyDaysWrap.style.display = (f_repeat.value === "weekly") ? "" : "none";
  });
  f_repeatEndType.addEventListener("change", () => {
    const isCount = f_repeatEndType.value === "count";
    repeatCountWrap.style.display = isCount ? "" : "none";
    repeatUntilWrap.style.display = isCount ? "none" : "";
  });

  // ---------- "Open registration now" helpers & bindings ----------
  function recalcRegOpensDaysFromNow() {
    const start = dtLocalFromInput(f_start.value);
    if (!start) return;
    const now = new Date();
    let days = Math.ceil((start.getTime() - now.getTime()) / (24*60*60*1000));
    if (days < 0) days = 0;
    f_regOpensDays.value = String(days);
  }

  if (f_regOpenNow) {
    f_regOpenNow.addEventListener("change", () => {
      if (f_regOpenNow.checked) recalcRegOpensDaysFromNow();
    });
    f_start.addEventListener("change", () => {
      if (f_regOpenNow.checked) recalcRegOpensDaysFromNow();
    });
    f_regOpensDays.addEventListener("input", () => {
      if (f_regOpenNow.checked) f_regOpenNow.checked = false;
    });
  }

  // ---------- Detail preview ----------
  f_detailDescription.addEventListener("input", () => {
    editDetailTouched = true;
    f_detailPreview.innerHTML = plainToHtml(f_detailDescription.value);
  });

  // ---------- Resource auto-fill ----------
  f_resourceId.addEventListener("change", () => {
    const r = resources.find(x => x.id === f_resourceId.value);
    f_resourceName.value = r ? (r.name || "") : "";
    if (r && !f_capacity.value && typeof r.capacity === "number") {
      f_capacity.value = r.capacity;
      if (!f_remaining.value) f_remaining.value = r.capacity;
    }
  });

  // ---------- New ----------
  btnNew.addEventListener("click", () => openEdit(null));

  // ---------- Save ----------
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearEditErrors();
    btnSave.disabled = true;
    editBusy.classList.remove("d-none");

    try {
      // Basic fields
      const title = f_title.value.trim();
      const status = f_status.value;
      const branch = f_branch.value;
      const resourceId = f_resourceId.value;
      const resourceName = f_resourceName.value.trim();
      const start = dtLocalFromInput(f_start.value);
      const end = dtLocalFromInput(f_end.value);
      if (!title || !branch || !resourceId || !start || !end || end <= start) {
        throw new Error("Please fill Title, Branch, Resource, Start/End (End must be after Start).");
      }

      // If "Open now" is checked, make sure days reflect now before reading values
      if (f_regOpenNow?.checked) {
        recalcRegOpensDaysFromNow();
      }

      // Registration & visibility
      const allowRegistration = (f_allowRegistration.value === "true");
      const capacity = f_capacity.value ? Number(f_capacity.value) : null;
      const remaining = f_remaining.value ? Number(f_remaining.value) : null;
      const opensDays = Number(f_regOpensDays.value || 0);
      const closesDays = Number(f_regClosesDays.value || 0);
      const visibility = f_visibility.value;

      // Color
      const color = normalizeHex(f_color.value || "#3b82f6");

      // Descriptions
      const description = f_description.value.trim();
      const detailDescriptionHtml = editingId
        ? (editDetailTouched ? plainToHtml(f_detailDescription.value) : editDetailHTMLOriginal)
        : plainToHtml(f_detailDescription.value);

      // Recurrence
      const repeat = f_repeat.value;           // none/daily/weekly/monthly
      const interval = Math.max(1, Number(f_interval.value || 1));
      const endType = f_repeatEndType.value;   // count/until
      const count = Math.max(1, Number(f_repeatCount.value || 1));
      const until = f_repeatUntil.value ? new Date(f_repeatUntil.value + "T23:59:59") : null;
      const weekdays = Array.from(weeklyDaysWrap.querySelectorAll("input[type='checkbox']:checked"))
        .map(cb => Number(cb.value)); // 0..6

      if (editingId) {
        // Conflict check (single)
        const conflictMsg = await hasConflict(branch, resourceId, start, end, editingId);
        if (conflictMsg) {
          showInlineError(conflictMsg);
          throw new Error(conflictMsg);
        }

        const payload = {
          title, description, detailDescription: detailDescriptionHtml,
          branch, resourceId, resourceName, color,
          visibility, status,
          start, end,
          allowRegistration,
          capacity: capacity ?? undefined,
          remaining: remaining ?? undefined
        };

        if (allowRegistration) {
          const { regOpensAt, regClosesAt } = deriveRegWindowDays(start, opensDays, closesDays);
          payload.regOpensAt = regOpensAt;
          payload.regClosesAt = regClosesAt;
        } else {
          payload.regOpensAt = undefined;
          payload.regClosesAt = undefined;
        }

        await window.db.collection("events").doc(editingId).update(payload);
        editOk.textContent = "Saved.";
        editOk.classList.remove("d-none");
        setTimeout(()=> editModal.hide(), 800);
        return;
      }

      // New event: recurrence materialization
      const occurrences = buildOccurrences({ repeat, interval, start, end, endType, count, until, weekdays });
      if (!occurrences.length) {
        throw new Error("No occurrences generated. Check your repeat settings.");
      }

      const batch = window.db.batch();
      const evCol = window.db.collection("events");

      let made = 0;
      let skipped = 0;
      let firstConflictMsg = null;

      for (const occ of occurrences) {
        const occStart = occ.start;
        const occEnd = occ.end;

        const conflictMsg = await hasConflict(branch, resourceId, occStart, occEnd, null);
        if (conflictMsg) {
          skipped++;
          if (!firstConflictMsg) firstConflictMsg = conflictMsg;
          continue;
        }

        const docRef = evCol.doc();

        const payload = {
          title, description, detailDescription: detailDescriptionHtml,
          branch, resourceId, resourceName, color,
          visibility, status,
          start: occStart,
          end: occEnd,
          allowRegistration,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        if (capacity != null) {
          payload.capacity = capacity;
          payload.remaining = (remaining != null ? remaining : capacity);
        }

        if (allowRegistration) {
          const { regOpensAt, regClosesAt } = deriveRegWindowDays(occStart, opensDays, closesDays);
          payload.regOpensAt = regOpensAt;
          payload.regClosesAt = regClosesAt;
        }

        batch.set(docRef, payload);
        made++;
      }

      if (made === 0) {
        if (firstConflictMsg) {
          showInlineError("All occurrences conflict with existing events.");
          throw new Error(firstConflictMsg);
        } else {
          throw new Error("No events created.");
        }
      }

      await batch.commit();

      const msg = skipped > 0
        ? `Created ${made} event(s). Skipped ${skipped} due to time conflicts.`
        : `Created ${made} event(s).`;
      editOk.textContent = msg;
      editOk.classList.remove("d-none");
      setTimeout(()=> editModal.hide(), 1000);

    } catch (err) {
      console.error("save error:", err);
      if (!editErrInline.classList.contains("d-none")) {
        // inline already shown
      } else {
        editErr.textContent = err.message || "Save failed.";
        editErr.classList.remove("d-none");
      }
    } finally {
      editBusy.classList.add("d-none");
      btnSave.disabled = false;
    }
  });

  // Build occurrences (Approach A)
  function buildOccurrences({ repeat, interval, start, end, endType, count, until, weekdays }) {
    const out = [];
    const durMs = end - start;

    const pushOcc = (s) => out.push({ start: new Date(s), end: new Date(s.getTime() + durMs) });

    if (repeat === "none") { pushOcc(start); return out; }

    const limitCount = (endType === "count") ? Math.max(1, count) : Number.POSITIVE_INFINITY;
    const limitUntil = (endType === "until" && until) ? until : null;

    let made = 0;
    let cursor = new Date(start);

    if (repeat === "daily") {
      while (made < limitCount) {
        if (!limitUntil || cursor <= limitUntil) pushOcc(cursor); else break;
        made++;
        cursor = new Date(cursor.getTime() + interval*24*60*60*1000);
      }
    } else if (repeat === "weekly") {
      const startDow = start.getDay();
      let weekStart = new Date(start);
      weekStart.setHours(0,0,0,0);
      weekStart.setDate(weekStart.getDate() - startDow); // to Sunday

      while (made < limitCount) {
        for (const dow of (weekdays.length ? weekdays : [startDow])) {
          const occStart = new Date(weekStart);
          occStart.setDate(weekStart.getDate() + dow);
          occStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
          if (occStart < start) continue;
          if (limitUntil && occStart > limitUntil) { made = limitCount; break; }
          pushOcc(occStart);
          made++;
          if (made >= limitCount) break;
        }
        weekStart = new Date(weekStart.getTime() + interval*7*24*60*60*1000);
      }
    } else if (repeat === "monthly") {
      const startDay = start.getDate();
      while (made < limitCount) {
        if (!limitUntil || cursor <= limitUntil) pushOcc(cursor); else break;
        made++;
        const m = cursor.getMonth();
        const y = cursor.getFullYear();
        const next = new Date(y, m + interval, startDay, start.getHours(), start.getMinutes(), 0, 0);
        cursor = next;
      }
    }

    return out;
  }

  // Time conflict check (resource + branch overlap)
  async function hasConflict(branch, resourceId, start, end, ignoreId) {
    if (!branch || !resourceId || !start || !end) return null;
    const col = window.db.collection("events");
    try {
      const snap = await col
        .where("branch","==",branch)
        .where("resourceId","==",resourceId)
        .where("start","<", end)
        .orderBy("start","asc")
        .limit(50)
        .get();

      const overlap = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(ev => ev.id !== ignoreId && ev._id !== ignoreId)
        .some(ev => {
          const s = toDate(ev.start), e = toDate(ev.end);
          if (!s || !e) return false;
          return s < end && e > start;
        });

      return overlap ? "Time conflict: same branch & resource already occupied in that time range." : null;
    } catch (err) {
      console.warn("conflict check failed; allowing save:", err);
      return null; // fail-open
    }
  }

  // ---------- Top filters/search ----------
  locationFilter?.addEventListener("change", applyFilter);
  searchInput.addEventListener("input", () => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(applyFilter, 120);
  });

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      containerList.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      return;
    }
    await loadResources();
    attachEventsListener();
  });
})();