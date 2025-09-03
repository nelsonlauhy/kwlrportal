// Events Admin (Firestore v8) - List view only
// Manage: create / update / delete events
// detailDescription: user pastes plain TEXT; convert to safe HTML (auto-link + <br>)
// Live Preview; conflict prevention (same branch+room overlap);
// Inline error near Save; COLOR TAG support (preset + custom).
(function() {
  // --- DOM
  const containerList   = document.getElementById("eventsContainer");
  const branchFilter    = document.getElementById("branchFilter");
  const resourceFilter  = document.getElementById("resourceFilter");
  const searchInput     = document.getElementById("searchInput");
  const listLabel       = document.getElementById("listLabel");
  const btnNew          = document.getElementById("btnNew");

  // Edit modal fields
  const editModal       = new bootstrap.Modal(document.getElementById("editModal"));
  const editTitleEl     = document.getElementById("editTitle");
  const editForm        = document.getElementById("editForm");
  const editErr         = document.getElementById("editErr");
  const editErrInline   = document.getElementById("editErrInline");
  const editOk          = document.getElementById("editOk");
  const editBusy        = document.getElementById("editBusy");
  const btnSave         = document.getElementById("btnSave");

  const f_title             = document.getElementById("f_title");
  const f_status            = document.getElementById("f_status");
  const f_branch            = document.getElementById("f_branch");
  const f_resourceId        = document.getElementById("f_resourceId");
  const f_resourceName      = document.getElementById("f_resourceName");
  const f_start             = document.getElementById("f_start");
  const f_end               = document.getElementById("f_end");
  const f_description       = document.getElementById("f_description");
  const f_detailDescription = document.getElementById("f_detailDescription");
  const f_detailPreview     = document.getElementById("f_detailPreview");
  const f_allowRegistration = document.getElementById("f_allowRegistration");
  const f_capacity          = document.getElementById("f_capacity");
  const f_remaining         = document.getElementById("f_remaining");
  const f_regOpensAt        = document.getElementById("f_regOpensAt");
  const f_regClosesAt       = document.getElementById("f_regClosesAt");
  const f_visibility        = document.getElementById("f_visibility");
  // NEW: color fields
  const f_colorPreset       = document.getElementById("f_colorPreset");
  const f_color             = document.getElementById("f_color");

  // Delete modal
  const delModal  = new bootstrap.Modal(document.getElementById("delModal"));
  const delMsg    = document.getElementById("delMsg");
  const delErr    = document.getElementById("delErr");
  const delBusy   = document.getElementById("delBusy");
  const btnDoDelete = document.getElementById("btnDoDelete");

  // --- State
  let resources = [];
  let allEvents = [];
  let filtered  = [];
  let editingId = null;
  let deletingId = null;

  // --- Helpers (defensive DOM)
  const hide = (el)=> { if (el && el.classList) el.classList.add("d-none"); };
  const show = (el)=> { if (el && el.classList) el.classList.remove("d-none"); };
  const setText = (el, txt)=> { if (el) el.textContent = txt; };

  // --- Utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));

  // plain text -> safe HTML with links + <br>
  function textToHtml(text) {
    if (!text) return "";
    let safe = esc(text);
    safe = safe.replace(
      /(https?:\/\/[^\s<>"')\]]+)/g,
      (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`
    );
    safe = safe.replace(/\r\n|\r|\n/g, "<br>");
    return safe;
  }

  // simple HTML -> plain text for editing
  function htmlToPlain(html) {
    if (!html) return "";
    let s = html;
    s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>.*?<\/a>/gi, "$1");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
    const tmp = document.createElement("div");
    tmp.innerHTML = s;
    return (tmp.textContent || tmp.innerText || "").replace(/\u00A0/g, " ").trim();
  }

  function updateDetailPreviewFromTextarea() {
    if (f_detailPreview) f_detailPreview.innerHTML = textToHtml(f_detailDescription.value || "");
  }

  function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtDateTime(d) {
    if (!d) return "";
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function toLocalInputValue(d) {
    if (!d) return "";
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInputValue(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }
  function stripHtmlToText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").trim();
  }
  function normalizeHex(c) {
    if (!c) return "#3b82f6";
    let x = c.trim();
    if (!x.startsWith("#")) x = "#" + x;
    if (x.length === 4) { // #abc -> #aabbcc
      x = "#" + x[1]+x[1]+x[2]+x[2]+x[3]+x[3];
    }
    return x.toLowerCase();
  }

  // ----------------------------------------------------
  // Conflict detection (same branch + resource, overlapping time)
  async function findTimeConflict({ branch, resourceId, startTS, endTS, excludeId }) {
    const col = window.db.collection("events");
    let snap;
    try {
      // Needs composite index: branch asc, resourceId asc, start asc
      snap = await col
        .where("branch", "==", branch)
        .where("resourceId", "==", resourceId)
        .where("start", "<", endTS)
        .orderBy("start", "asc")
        .get();
    } catch (err) {
      console.warn("conflict query missing index; fallback:", err);
      snap = await col
        .where("branch", "==", branch)
        .where("resourceId", "==", resourceId)
        .get();
    }

    const newStart = startTS.toDate();
    const newEnd   = endTS.toDate();

    for (const doc of snap.docs) {
      const ev = { _id: doc.id, ...doc.data() };
      if (excludeId && ev._id === excludeId) continue;

      const s = ev.start?.toDate ? ev.start.toDate() : (ev.start ? new Date(ev.start) : null);
      const e = ev.end?.toDate   ? ev.end.toDate()   : (ev.end   ? new Date(ev.end)   : null);
      if (!s || !e) continue;

      if (s < newEnd && e > newStart) return ev; // overlap
    }
    return null;
  }

  // ----------------------------------------------------
  // Load resources
  async function loadResources() {
    const col = window.db.collection("resources");
    try {
      const snap = await col.orderBy("branch","asc").orderBy("name","asc").get();
      resources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn("resources order index missing; fallback:", err);
      const snap = await col.get();
      resources = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    }

    const opts = [`<option value="">--</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}" data-name="${esc(r.name||"")}" data-cap="${Number(r.capacity||0)}">${esc(r.name || r.id)}</option>`));
    if (f_resourceId) f_resourceId.innerHTML = opts.join("");

    const fopts = [`<option value="ALL">All Resources</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`));
    if (resourceFilter) resourceFilter.innerHTML = fopts.join("");
  }

  function wireResourceAutoFill() {
    if (!f_resourceId) return;
    f_resourceId.addEventListener("change", () => {
      const opt = f_resourceId.options[f_resourceId.selectedIndex];
      if (!opt) { if (f_resourceName) f_resourceName.value = ""; return; }
      if (f_resourceName) f_resourceName.value = opt.getAttribute("data-name") || "";
      if (!f_capacity.value || Number(f_capacity.value) === 0) {
        const cap = Number(opt.getAttribute("data-cap") || 0);
        if (cap) f_capacity.value = String(cap);
        if (!f_remaining.value || Number(f_remaining.value) === 0) {
          f_remaining.value = cap ? String(cap) : "";
        }
      }
    });
  }

  // ----------------------------------------------------
  // Color preset ↔ input sync
  function syncColorUIFromValue(hex) {
    const val = normalizeHex(hex || "#3b82f6");
    if (f_color) f_color.value = val;
    if (f_colorPreset) {
      // if val matches one of preset options, select it; else choose custom
      const found = Array.from(f_colorPreset.options).find(o => o.value.toLowerCase() === val);
      f_colorPreset.value = found ? found.value : "__custom";
    }
  }
  function wireColorControls() {
    if (f_colorPreset) {
      f_colorPreset.addEventListener("change", () => {
        if (f_colorPreset.value === "__custom") return; // keep current custom input
        if (f_color) f_color.value = f_colorPreset.value;
      });
    }
    if (f_color) {
      f_color.addEventListener("input", () => {
        // if user picks a custom color not in presets, set preset to custom
        const hex = normalizeHex(f_color.value);
        const found = Array.from(f_colorPreset.options || []).find(o => o.value.toLowerCase() === hex);
        if (f_colorPreset) f_colorPreset.value = found ? found.value : "__custom";
      });
    }
  }

  // ----------------------------------------------------
  // Listen events (future only)
  function attachEventsListener() {
    const now = new Date();
    window.db.collection("events")
      .where("start", ">=", now).orderBy("start","asc")
      .onSnapshot(snap => {
        allEvents = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        applyFilter();
      }, err => {
        console.error("listen events failed:", err);
        if (containerList) containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
      });
  }

  // ----------------------------------------------------
  // Filter/Search
  function applyFilter() {
    const q = (searchInput?.value || "").toLowerCase().trim();
    const brSel = (branchFilter?.value || "ALL").toUpperCase();
    const resSel = (resourceFilter?.value || "ALL");

    filtered = allEvents.filter(ev => {
      const br = (ev.branch || "").toUpperCase();
      if (brSel !== "ALL" && br !== brSel) return false;
      if (resSel !== "ALL" && ev.resourceId !== resSel) return false;
      if (!q) return true;

      const detailTxt = stripHtmlToText(ev.detailDescription || "");
      const hay = [ev.title, ev.description, ev.resourceName, ev.branch, detailTxt]
        .map(v => (v || "").toString().toLowerCase());
      return hay.some(v => v.includes(q));
    });

    renderList();
  }

  // ----------------------------------------------------
  // Render list (show color dot)
  function renderList() {
    if (!filtered.length) {
      if (listLabel) listLabel.textContent = "Upcoming";
      if (containerList) containerList.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-calendar-x me-2"></i>No upcoming events match your filters.
        </div>`;
      return;
    }
    if (listLabel) listLabel.textContent = "Upcoming";

    const groups = {};
    for (const e of filtered) {
      const d = toDate(e.start);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const label = d.toLocaleString(undefined, { month:"long", year:"numeric" });
      (groups[key] ||= { label, events: [] }).events.push(e);
    }
    const parts = [];
    Object.keys(groups).sort().forEach(k => {
      const g = groups[k];
      parts.push(`<div class="month-header">${esc(g.label)}</div>`);
      g.events.forEach(e => parts.push(renderRow(e)));
    });

    if (containerList) containerList.innerHTML = parts.join("");
  }

  function renderRow(e) {
    const s = toDate(e.start), ed = toDate(e.end);
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(ed)}`;
    const remainTxt = (typeof e.remaining === "number" && typeof e.capacity === "number")
      ? `${e.remaining}/${e.capacity} left` : (typeof e.remaining === "number" ? `${e.remaining} left` : "");
    const previewSrc = e.description || stripHtmlToText(e.detailDescription || "");
    const preview = previewSrc ? esc(previewSrc).slice(0,180) + (previewSrc.length>180 ? "…" : "") : "";
    const color = normalizeHex(e.color || "#3b82f6");

    return `
      <div class="event-card" data-id="${esc(e._id)}">
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-3">
            <div class="d-flex align-items-center gap-2">
              <span style="display:inline-block;width:.85rem;height:.85rem;border-radius:50%;background:${esc(color)};"></span>
              <div class="event-title">${esc(e.title || "Untitled Event")}</div>
            </div>
            <div class="event-meta mt-1">
              <span class="me-2"><i class="bi bi-clock"></i> ${esc(dateLine)}</span>
              ${e.resourceName ? `<span class="badge badge-room me-2"><i class="bi bi-building me-1"></i>${esc(e.resourceName)}</span>` : ""}
              ${e.branch ? `<span class="badge badge-branch me-2">${esc(e.branch)}</span>` : ""}
              ${e.status ? `<span class="badge text-bg-light border">${esc(e.status)}</span>` : ""}
              ${e.visibility ? `<span class="badge text-bg-light border">${esc(e.visibility)}</span>` : ""}
            </div>
            ${preview ? `<div class="mt-2 text-secondary">${preview}</div>` : ""}
          </div>
          <div class="text-end">
            ${remainTxt ? `<div class="small text-muted mb-2">${esc(remainTxt)}</div>` : ""}
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary btn-edit" data-id="${esc(e._id)}"><i class="bi bi-pencil-square me-1"></i>Edit</button>
              <button class="btn btn-outline-danger btn-del" data-id="${esc(e._id)}"><i class="bi bi-trash me-1"></i>Delete</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ----------------------------------------------------
  // Edit & Save
  if (containerList) {
    containerList.addEventListener("click", (ev) => {
      const editBtn = ev.target.closest(".btn-edit");
      const delBtn  = ev.target.closest(".btn-del");
      if (editBtn) {
        const id = editBtn.getAttribute("data-id");
        const row = allEvents.find(x => x._id === id);
        if (row) openEdit(row);
      } else if (delBtn) {
        const id = delBtn.getAttribute("data-id");
        const row = allEvents.find(x => x._id === id);
        if (row) openDelete(row);
      }
    });
  }

  if (btnNew) btnNew.addEventListener("click", () => openEdit(null));

  function clearEditErrors() {
    hide(editErr); setText(editErr, "");
    hide(editErrInline); setText(editErrInline, "");
    hide(editOk);
  }

  function openEdit(row) {
    editingId = row?._id || null;
    clearEditErrors();

    setText(editTitleEl, editingId ? "Edit Event" : "New Event");
    if (f_title) f_title.value = row?.title || "";
    if (f_status) f_status.value = row?.status || "draft";
    if (f_branch) f_branch.value = row?.branch || "";
    if (f_resourceId) f_resourceId.value = row?.resourceId || "";
    if (f_resourceName) f_resourceName.value = row?.resourceName || "";
    if (f_start) f_start.value = toLocalInputValue(toDate(row?.start));
    if (f_end) f_end.value   = toLocalInputValue(toDate(row?.end));
    if (f_description) f_description.value = row?.description || "";

    const storedHtml = row?.detailDescription || "";
    if (f_detailDescription) f_detailDescription.value = htmlToPlain(storedHtml);
    updateDetailPreviewFromTextarea();

    if (f_allowRegistration) f_allowRegistration.value = String(row?.allowRegistration !== false);
    if (f_capacity)   f_capacity.value = (row?.capacity ?? "");
    if (f_remaining)  f_remaining.value = (row?.remaining ?? "");
    if (f_regOpensAt) f_regOpensAt.value = toLocalInputValue(toDate(row?.regOpensAt));
    if (f_regClosesAt)f_regClosesAt.value = toLocalInputValue(toDate(row?.regClosesAt));
    if (f_visibility) f_visibility.value = row?.visibility || "public";

    // Color
    const color = normalizeHex(row?.color || "#3b82f6");
    syncColorUIFromValue(color);

    editModal.show();
  }

  // live preview & color sync
  if (f_detailDescription) f_detailDescription.addEventListener("input", updateDetailPreviewFromTextarea);
  wireColorControls();

  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearEditErrors();
      if (btnSave) btnSave.disabled = true;
      show(editBusy);

      try {
        const title = (f_title?.value || "").trim();
        if (!title) throw new Error("Title is required.");

        const start = fromLocalInputValue(f_start?.value);
        const end   = fromLocalInputValue(f_end?.value);
        if (!start || !end || end <= start) throw new Error("Invalid start/end time.");

        if (!f_branch?.value) throw new Error("Branch is required.");
        if (!f_resourceId?.value) throw new Error("Resource is required.");

        const startTS = firebase.firestore.Timestamp.fromDate(start);
        const endTS   = firebase.firestore.Timestamp.fromDate(end);

        // Conflict check
        const conflict = await findTimeConflict({
          branch: f_branch.value,
          resourceId: f_resourceId.value,
          startTS,
          endTS,
          excludeId: editingId || null
        });
        if (conflict) {
          const titleC = conflict.title || "(untitled)";
          const sC = conflict.start?.toDate?.() || new Date(conflict.start);
          const eC = conflict.end?.toDate?.() || new Date(conflict.end);
          const pad = (n)=> String(n).padStart(2,"0");
          const fmt = (d)=> `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          throw new Error(`Time conflict in this room/branch with "${titleC}" (${fmt(sC)} – ${fmt(eC)}).`);
        }

        const detailHtml = textToHtml(f_detailDescription?.value || "");
        // Color to save
        const color = normalizeHex(f_color?.value || "#3b82f6");

        const data = {
          title,
          status: f_status?.value || "draft",
          branch: f_branch?.value || "",
          resourceId: f_resourceId?.value || null,
          resourceName: f_resourceName?.value || null,
          start: startTS,
          end: endTS,
          description: f_description?.value || "",
          detailDescription: detailHtml,
          allowRegistration: (f_allowRegistration?.value === "true"),
          capacity: f_capacity?.value ? Number(f_capacity.value) : null,
          remaining: f_remaining?.value ? Number(f_remaining.value) : null,
          regOpensAt: f_regOpensAt?.value ? firebase.firestore.Timestamp.fromDate(fromLocalInputValue(f_regOpensAt.value)) : null,
          regClosesAt: f_regClosesAt?.value ? firebase.firestore.Timestamp.fromDate(fromLocalInputValue(f_regClosesAt.value)) : null,
          visibility: f_visibility?.value || "public",
          color, // <-- NEW
          updatedAt: new Date()
        };

        const col = window.db.collection("events");
        if (editingId) {
          await col.doc(editingId).update(data);
        } else {
          data.createdAt = new Date();
          if (data.remaining == null && typeof data.capacity === "number") {
            data.remaining = data.capacity;
          }
          const doc = await col.add(data);
          await col.doc(doc.id).update({ id: doc.id });
        }

        updateDetailPreviewFromTextarea();
        show(editOk);
        setTimeout(()=> editModal.hide(), 800);

      } catch (err) {
        console.error("save error:", err);
        const msg = err?.message || "Save failed.";
        setText(editErr, msg); show(editErr);
        setText(editErrInline, msg); show(editErrInline);
      } finally {
        if (btnSave) btnSave.disabled = false;
        hide(editBusy);
      }
    });
  }

  // ----------------------------------------------------
  // Delete
  function openDelete(row) {
    deletingId = row?._id || null;
    if (delErr) { hide(delErr); setText(delErr, ""); }
    if (delMsg) delMsg.innerHTML = `Delete <strong>${esc(row?.title || "")}</strong>?`;
    delModal.show();
  }

  if (btnDoDelete) {
    btnDoDelete.addEventListener("click", async () => {
      if (!deletingId) return;
      btnDoDelete.disabled = true; show(delBusy);
      try {
        await window.db.collection("events").doc(deletingId).delete();
        delModal.hide();
      } catch (err) {
        console.error("delete error:", err);
        setText(delErr, err?.message || "Delete failed."); show(delErr);
      } finally {
        btnDoDelete.disabled = false; hide(delBusy);
      }
    });
  }

  // ----------------------------------------------------
  // Filters
  branchFilter?.addEventListener("change", applyFilter);
  resourceFilter?.addEventListener("change", applyFilter);
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(applyFilter, 120);
  });

  // ----------------------------------------------------
  // Init
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      if (containerList) containerList.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      return;
    }
    await loadResources();
    wireResourceAutoFill();
    attachEventsListener();
    if (btnNew) btnNew.disabled = false;
  });
})();
