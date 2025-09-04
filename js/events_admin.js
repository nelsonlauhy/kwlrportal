// Events Admin (Firestore v8) — List-only with Edit/Create modal
// Approach A (materialize on save) for recurrence
// - detailDescription: auto-link + <br> (Option A) with live preview
// - Color tag
// - Conflict detection (branch + resource overlap)
// - Registration windows per occurrence via offsets (mins)

(function() {
  // ---------- DOM ----------
  const containerList = document.getElementById("eventsContainer");
  const branchFilter  = document.getElementById("branchFilter");
  const resourceFilter= document.getElementById("resourceFilter");
  const searchInput   = document.getElementById("searchInput");
  const listLabel     = document.getElementById("listLabel");

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
  const f_regOpensOffsetMins = document.getElementById("f_regOpensOffsetMins");
  const f_regClosesOffsetMins = document.getElementById("f_regClosesOffsetMins");
  const f_visibility = document.getElementById("f_visibility");
  const f_colorPreset = document.getElementById("f_colorPreset");
  const f_color = document.getElementById("f_color");

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
  let editingId = null; // _id when editing a single event (non-recurrence edit)
  let pendingDeleteId = null;

  let unsubscribeEvents = null;

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
  function fmtDate(d) {
    if (!d) return "";
    return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric", year:"numeric" });
  }
  function dtLocalFromInput(value) {
    return value ? new Date(value) : null; // local time
  }
  function applyOffsetMins(date, mins) {
    if (!date || typeof mins !== "number" || isNaN(mins)) return null;
    return new Date(date.getTime() + mins * 60000);
  }
  function deriveRegWindow(startDate, opensOffsetMins, closesOffsetMins) {
    const opens = applyOffsetMins(startDate, Number(opensOffsetMins));
    const closes = applyOffsetMins(startDate, Number(closesOffsetMins));
    if (opens && closes && opens >= closes) {
      return { regOpensAt: opens, regClosesAt: new Date(opens.getTime() + 30 * 60000) };
    }
    return { regOpensAt: opens, regClosesAt: closes };
  }

  // Convert plain text → HTML (auto-link + preserve newlines)
  function plainToHtml(text) {
    const escText = esc(text || "");
    const urlRegex = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
    const linked = escText.replace(urlRegex, (m) => {
      const href = m.startsWith("www.") ? `https://${m}` : m;
      return `<a href="${href}" target="_blank" rel="noopener">${m}</a>`;
    });
    return linked.replace(/\n/g, "<br>");
  }

  function clearEditErrors() {
    [editErr, editErrInline, editOk].forEach(el => { el.classList.add("d-none"); el.textContent=""; });
  }

  function showInlineError(msg) {
    editErrInline.textContent = msg;
    editErrInline.classList.remove("d-none");
  }

  // ---------- Filters / Search ----------
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const brSel = (branchFilter.value || "ALL").toUpperCase();
    const resSel = (resourceFilter.value || "ALL");

    filtered = allEvents.filter(ev => {
      const br = (ev.branch || "").toUpperCase();
      if (brSel !== "ALL" && br !== brSel) return false;
      if (resSel !== "ALL" && ev.resourceId !== resSel) return false;
      if (!q) return true;
      const hay = [ev.title, ev.description, ev.resourceName, ev.branch]
        .map(v => (v || "").toString().toLowerCase());
      return hay.some(v => v.includes(q));
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

    // Bind edit/delete
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

    return `
      <div class="event-card">
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-3">
            <div class="event-title">${esc(e.title || "Untitled Event")}</div>
            <div class="event-meta mt-1">
              <span class="me-2"><i class="bi bi-clock"></i> ${esc(dateLine)}</span>
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
    const opts = [`<option value="">-- select --</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)} (${esc(r.branch||"-")})</option>`));
    f_resourceId.innerHTML = opts.join("");

    // top filter dropdown
    const fopts = [`<option value="ALL">All Resources</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`));
    resourceFilter.innerHTML = fopts.join("");
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

    f_allowRegistration.value = "true";
    f_capacity.value = "";
    f_remaining.value = "";
    f_regOpensOffsetMins.value = "-10080";
    f_regClosesOffsetMins.value = "-60";

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
    f_detailDescription.value = textFromHtml(ev.detailDescription || "");
    f_detailPreview.innerHTML = ev.detailDescription || "";

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

    // Recurrence stays "none" when editing a single event
    editModal.show();
  }

  function inputValueFromDate(d) {
    if (!d) return "";
    const pad = (n)=> String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    // seconds omitted to match input format
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

  // ---------- Detail preview ----------
  f_detailDescription.addEventListener("input", () => {
    f_detailPreview.innerHTML = plainToHtml(f_detailDescription.value);
  });

  // ---------- New ----------
  btnNew.addEventListener("click", () => openEdit(null));

  // ---------- Save (Create/Update + Materialize Recurrence) ----------
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

      // Registration & visibility
      const allowRegistration = (f_allowRegistration.value === "true");
      const capacity = f_capacity.value ? Number(f_capacity.value) : null;
      const remaining = f_remaining.value ? Number(f_remaining.value) : null;
      const opensOffset = f_regOpensOffsetMins.value ? Number(f_regOpensOffsetMins.value) : null;
      const closesOffset = f_regClosesOffsetMins.value ? Number(f_regClosesOffsetMins.value) : null;
      const visibility = f_visibility.value;

      // Color
      const color = normalizeHex(f_color.value || "#3b82f6");

      // Descriptions
      const description = f_description.value.trim();
      const detailDescriptionHtml = plainToHtml(f_detailDescription.value);

      // Recurrence
      const repeat = f_repeat.value;           // none/daily/weekly/monthly
      const interval = Math.max(1, Number(f_interval.value || 1));
      const endType = f_repeatEndType.value;   // count/until
      const count = Math.max(1, Number(f_repeatCount.value || 1));
      const until = f_repeatUntil.value ? new Date(f_repeatUntil.value + "T23:59:59") : null;
      const weekdays = Array.from(weeklyDaysWrap.querySelectorAll("input[type='checkbox']:checked"))
        .map(cb => Number(cb.value)); // 0..6

      // If editing single event (no recurrence re-materialization)
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

        // derive per-event reg window only if offsets provided
        if (allowRegistration) {
          const { regOpensAt, regClosesAt } = deriveRegWindow(start, opensOffset, closesOffset);
          if (regOpensAt) payload.regOpensAt = regOpensAt;
          if (regClosesAt) payload.regClosesAt = regClosesAt;
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

      // New event: handle recurrence materialization
      const occurrences = buildOccurrences({ repeat, interval, start, end, endType, count, until, weekdays });

      if (!occurrences.length) {
        throw new Error("No occurrences generated. Check your repeat settings.");
      }

      // Batch create with conflict check per occurrence
      const batch = window.db.batch();
      const evCol = window.db.collection("events");

      // Save stats for message
      let made = 0;
      let skipped = 0;
      let firstConflictMsg = null;

      for (const occ of occurrences) {
        const occStart = occ.start;
        const occEnd = occ.end;

        // Conflict check
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
          const { regOpensAt, regClosesAt } = deriveRegWindow(occStart, opensOffset, closesOffset);
          if (regOpensAt) payload.regOpensAt = regOpensAt;
          if (regClosesAt) payload.regClosesAt = regClosesAt;
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
        // already shown inline conflict
      } else {
        editErr.textContent = err.message || "Save failed.";
        editErr.classList.remove("d-none");
      }
    } finally {
      editBusy.classList.add("d-none");
      btnSave.disabled = false;
    }
  });

  // Build occurrences for Approach A
  function buildOccurrences({ repeat, interval, start, end, endType, count, until, weekdays }) {
    const out = [];
    const durMs = end - start;

    // Helper to push an occurrence copy
    const pushOcc = (s) => out.push({ start: new Date(s), end: new Date(s.getTime() + durMs) });

    if (repeat === "none") {
      pushOcc(start);
      return out;
    }

    // Stop conditions
    const limitCount = (endType === "count") ? Math.max(1, count) : Number.POSITIVE_INFINITY;
    const limitUntil = (endType === "until" && until) ? until : null;

    let made = 0;
    let cursor = new Date(start);

    if (repeat === "daily") {
      while (made < limitCount) {
        if (!limitUntil || cursor <= limitUntil) pushOcc(cursor);
        else break;
        made++;
        cursor = new Date(cursor.getTime() + interval*24*60*60*1000);
      }
    } else if (repeat === "weekly") {
      // For weekly, move through weeks by interval; within each week, add selected weekdays
      const startDow = start.getDay(); // 0..6
      // base week (week of start)
      let weekStart = new Date(start);
      weekStart.setHours(0,0,0,0);
      weekStart.setDate(weekStart.getDate() - startDow); // back to Sunday

      while (made < limitCount) {
        // days in this week
        for (const dow of weekdays.length ? weekdays : [startDow]) {
          const occStart = new Date(weekStart);
          occStart.setDate(weekStart.getDate() + dow);
          occStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
          if (occStart < start) continue; // don't include before the very first start
          if (limitUntil && occStart > limitUntil) { made = limitCount; break; }
          pushOcc(occStart);
          made++;
          if (made >= limitCount) break;
        }
        // jump weeks
        weekStart = new Date(weekStart.getTime() + interval*7*24*60*60*1000);
      }
    } else if (repeat === "monthly") {
      const startDay = start.getDate();
      while (made < limitCount) {
        if (!limitUntil || cursor <= limitUntil) pushOcc(cursor);
        else break;
        made++;
        // advance by N months preserving day where possible
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
    // Firestore supports only one range field — we use start < end, then filter by doc.end > start in client
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
        .filter(ev => (!ignoreId || ev._id !== ignoreId) && ev.id !== ignoreId) // support both shapes
        .some(ev => {
          const s = toDate(ev.start), e = toDate(ev.end);
          if (!s || !e) return false;
          return s < end && e > start; // overlap
        });

      return overlap ? "Time conflict: same branch & resource already occupied in that time range." : null;
    } catch (err) {
      console.warn("conflict check failed; allowing save:", err);
      return null; // fail-open to avoid blocking saves if query fails
    }
  }

  // ---------- Resource auto-fill ----------
  f_resourceId.addEventListener("change", () => {
    const r = resources.find(x => x.id === f_resourceId.value);
    f_resourceName.value = r ? (r.name || "") : "";
    if (r && !f_capacity.value && typeof r.capacity === "number") {
      f_capacity.value = r.capacity;
      if (!f_remaining.value) f_remaining.value = r.capacity;
    }
  });

  // ---------- Top filters/search ----------
  branchFilter.addEventListener("change", applyFilter);
  resourceFilter.addEventListener("change", applyFilter);
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
