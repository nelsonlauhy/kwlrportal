// Events Admin (Firestore v8) - List view only
// Manage: create / update / delete events
(function() {
  // --- DOM
  const containerList = document.getElementById("eventsContainer");
  const branchFilter  = document.getElementById("branchFilter");
  const resourceFilter= document.getElementById("resourceFilter");
  const searchInput   = document.getElementById("searchInput");
  const listLabel     = document.getElementById("listLabel");
  const btnNew        = document.getElementById("btnNew");

  // Edit modal fields
  const editModal    = new bootstrap.Modal(document.getElementById("editModal"));
  const editTitleEl  = document.getElementById("editTitle");
  const editForm     = document.getElementById("editForm");
  const editErr      = document.getElementById("editErr");
  const editOk       = document.getElementById("editOk");
  const editBusy     = document.getElementById("editBusy");
  const btnSave      = document.getElementById("btnSave");

  const f_title = document.getElementById("f_title");
  const f_status = document.getElementById("f_status");
  const f_branch = document.getElementById("f_branch");
  const f_resourceId = document.getElementById("f_resourceId");
  const f_resourceName = document.getElementById("f_resourceName");
  const f_start = document.getElementById("f_start");
  const f_end   = document.getElementById("f_end");
  const f_description = document.getElementById("f_description");
  const f_detailDescription = document.getElementById("f_detailDescription");
  const f_allowRegistration = document.getElementById("f_allowRegistration");
  const f_capacity = document.getElementById("f_capacity");
  const f_remaining = document.getElementById("f_remaining");
  const f_regOpensAt = document.getElementById("f_regOpensAt");
  const f_regClosesAt = document.getElementById("f_regClosesAt");
  const f_visibility = document.getElementById("f_visibility");

  // Delete modal
  const delModal  = new bootstrap.Modal(document.getElementById("delModal"));
  const delMsg    = document.getElementById("delMsg");
  const delErr    = document.getElementById("delErr");
  const delBusy   = document.getElementById("delBusy");
  const btnDoDelete = document.getElementById("btnDoDelete");

  // --- State
  let resources = [];   // [{id, name, branch, capacity, ...}]
  let allEvents = [];   // raw events (we fetch future by default)
  let filtered  = [];   // after filter/search
  let editingId = null; // event doc id being edited
  let deletingId = null;

  // --- Utils
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
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function toLocalInputValue(d) {
    // date -> "YYYY-MM-DDThh:mm"
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
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
      resources = snap.docs.map(d=>({ id:d.id, ...d.data() }))
        .sort((a,b)=> (String(a.branch||"").localeCompare(String(b.branch||"")) ||
                       String(a.name||"").localeCompare(String(b.name||""))));
    }

    // dropdown
    const opts = [`<option value="">--</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}" data-name="${esc(r.name||"")}" data-cap="${Number(r.capacity||0)}">${esc(r.name || r.id)}</option>`));
    f_resourceId.innerHTML = opts.join("");

    // also fill filter resources
    const fopts = [`<option value="ALL">All Resources</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`));
    resourceFilter.innerHTML = fopts.join("");
  }

  // Attach change to auto-fill resourceName & capacity
  function wireResourceAutoFill() {
    f_resourceId.addEventListener("change", () => {
      const opt = f_resourceId.options[f_resourceId.selectedIndex];
      if (!opt) { f_resourceName.value = ""; return; }
      f_resourceName.value = opt.getAttribute("data-name") || "";
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
  // Listen events (future only, editable list)
  function attachEventsListener() {
    const now = new Date();
    const col = window.db.collection("events");
    col.where("start", ">=", now).orderBy("start","asc")
      .onSnapshot(snap => {
        allEvents = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        applyFilter();
      }, err => {
        console.error("listen events failed:", err);
        containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
      });
  }

  // ----------------------------------------------------
  // Filter/Search
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const brSel = (branchFilter.value || "ALL").toUpperCase();
    const resSel = (resourceFilter.value || "ALL");

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
  // Render list
  function renderList() {
    if (!filtered.length) {
      listLabel.textContent = "Upcoming";
      containerList.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-calendar-x me-2"></i>No upcoming events match your filters.
        </div>`;
      return;
    }
    listLabel.textContent = "Upcoming";

    // group by month
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

    containerList.innerHTML = parts.join("");
  }

  function renderRow(e) {
    const s = toDate(e.start), ed = toDate(e.end);
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(ed)}`;
    const remainTxt = (typeof e.remaining === "number" && typeof e.capacity === "number")
      ? `${e.remaining}/${e.capacity} left` : (typeof e.remaining === "number" ? `${e.remaining} left` : "");

    const previewSrc = e.description || stripHtmlToText(e.detailDescription || "");
    const preview = previewSrc ? esc(previewSrc).slice(0,180) + (previewSrc.length>180 ? "…" : "") : "";

    return `
      <div class="event-card" data-id="${esc(e._id)}">
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-3">
            <div class="event-title">${esc(e.title || "Untitled Event")}</div>
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

  // Delegate Edit/Delete buttons
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

  // ----------------------------------------------------
  // New / Edit
  btnNew.addEventListener("click", () => openEdit(null));

  function openEdit(row) {
    editingId = row?._id || null;
    clearEditAlerts();

    editTitleEl.textContent = editingId ? "Edit Event" : "New Event";
    f_title.value = row?.title || "";
    f_status.value = row?.status || "draft";
    f_branch.value = row?.branch || "";
    f_resourceId.value = row?.resourceId || "";
    // trigger autofill for resourceName/capacity
    const changeEvent = new Event("change");
    f_resourceId.dispatchEvent(changeEvent);

    f_resourceName.value = row?.resourceName || (getResourceName(row?.resourceId) || "");

    f_start.value = toLocalInputValue(toDate(row?.start));
    f_end.value   = toLocalInputValue(toDate(row?.end));
    f_description.value = row?.description || "";
    f_detailDescription.value = row?.detailDescription || "";
    f_allowRegistration.value = String(row?.allowRegistration !== false);
    f_capacity.value = (row?.capacity ?? "");
    f_remaining.value = (row?.remaining ?? "");
    f_regOpensAt.value = toLocalInputValue(toDate(row?.regOpensAt));
    f_regClosesAt.value = toLocalInputValue(toDate(row?.regClosesAt));
    f_visibility.value = row?.visibility || "public";

    editModal.show();
  }

  function getResourceName(id) {
    const r = resources.find(x => x.id === id);
    return r?.name || "";
  }

  function clearEditAlerts() {
    editErr.classList.add("d-none"); editErr.textContent = "";
    editOk.classList.add("d-none");
  }

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearEditAlerts();
    btnSave.disabled = true; editBusy.classList.remove("d-none");

    try {
      // basic validation
      const title = f_title.value.trim();
      if (!title) throw new Error("Title is required.");

      const start = fromLocalInputValue(f_start.value);
      const end   = fromLocalInputValue(f_end.value);
      if (!start || !end || end <= start) throw new Error("Invalid start/end time.");

      const resourceId = f_resourceId.value || "";
      const resourceName = f_resourceName.value || getResourceName(resourceId);
      const branch = f_branch.value || "";

      const capacity = Number(f_capacity.value || 0);
      let remaining  = (f_remaining.value === "" ? null : Number(f_remaining.value));
      if (remaining == null && capacity) remaining = capacity;

      const regOpensAt = fromLocalInputValue(f_regOpensAt.value);
      const regClosesAt = fromLocalInputValue(f_regClosesAt.value);

      const data = {
        title,
        status: f_status.value || "draft",
        branch,
        resourceId: resourceId || null,
        resourceName: resourceName || null,
        start: firebase.firestore.Timestamp.fromDate(start),
        end: firebase.firestore.Timestamp.fromDate(end),
        description: f_description.value || "",
        detailDescription: f_detailDescription.value || "",
        allowRegistration: (f_allowRegistration.value === "true"),
        capacity: isNaN(capacity) ? null : capacity,
        remaining: (remaining == null || isNaN(remaining)) ? null : remaining,
        regOpensAt: regOpensAt ? firebase.firestore.Timestamp.fromDate(regOpensAt) : null,
        regClosesAt: regClosesAt ? firebase.firestore.Timestamp.fromDate(regClosesAt) : null,
        visibility: f_visibility.value || "public",
        // optional audit fields - fill if you有登入資訊可用
        // createdBy: currentUserEmail,
        // createdByName: currentUserName,
        updatedAt: new Date()
      };

      // create/update
      const col = window.db.collection("events");
      if (editingId) {
        await col.doc(editingId).update(data);
      } else {
        // set default remaining if empty but capacity present
        if (data.remaining == null && typeof data.capacity === "number")
          data.remaining = data.capacity;
        data.status = data.status || "draft";
        data.visibility = data.visibility || "public";
        data.createdAt = new Date();
        const doc = await col.add(data);
        editingId = doc.id;
        // 可選：把 id 欄位寫回文件
        await col.doc(doc.id).update({ id: doc.id });
      }

      editOk.classList.remove("d-none");
      setTimeout(()=> editModal.hide(), 800);

    } catch (err) {
      console.error("save error:", err);
      editErr.textContent = err.message || "Save failed.";
      editErr.classList.remove("d-none");
    } finally {
      btnSave.disabled = false; editBusy.classList.add("d-none");
    }
  });

  // ----------------------------------------------------
  // Delete
  function openDelete(row) {
    deletingId = row?._id || null;
    delErr.classList.add("d-none"); delErr.textContent = "";
    delMsg.innerHTML = `Delete <strong>${esc(row?.title || "")}</strong>?`;
    delModal.show();
  }

  btnDoDelete.addEventListener("click", async () => {
    if (!deletingId) return;
    btnDoDelete.disabled = true; delBusy.classList.remove("d-none");
    try {
      await window.db.collection("events").doc(deletingId).delete();
      delModal.hide();
    } catch (err) {
      console.error("delete error:", err);
      delErr.textContent = err.message || "Delete failed.";
      delErr.classList.remove("d-none");
    } finally {
      btnDoDelete.disabled = false; delBusy.classList.add("d-none");
    }
  });

  // ----------------------------------------------------
  // Filters
  branchFilter.addEventListener("change", applyFilter);
  resourceFilter.addEventListener("change", applyFilter);
  searchInput.addEventListener("input", () => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(applyFilter, 120);
  });

  // ----------------------------------------------------
  // Init
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      containerList.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      return;
    }

    await loadResources();
    wireResourceAutoFill();
    attachEventsListener(); // live updates

    // New button ready
    btnNew.disabled = false;
  });
})();
