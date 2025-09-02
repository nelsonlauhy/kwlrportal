// Events Admin (Firestore v8) - List view only
// Manage: create / update / delete events with Markdown in detailDescription
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
  let resources = [];
  let allEvents = [];
  let filtered  = [];
  let editingId = null;
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

  // ----------------------------------------------------
  // Load resources
  async function loadResources() {
    const col = window.db.collection("resources");
    try {
      const snap = await col.orderBy("branch","asc").orderBy("name","asc").get();
      resources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      const snap = await col.get();
      resources = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    }

    const opts = [`<option value="">--</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}" data-name="${esc(r.name||"")}" data-cap="${Number(r.capacity||0)}">${esc(r.name || r.id)}</option>`));
    f_resourceId.innerHTML = opts.join("");

    const fopts = [`<option value="ALL">All Resources</option>`]
      .concat(resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`));
    resourceFilter.innerHTML = fopts.join("");
  }

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
  // Listen events
  function attachEventsListener() {
    const now = new Date();
    window.db.collection("events")
      .where("start", ">=", now).orderBy("start","asc")
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
      const detailTxt = stripHtmlToText(marked.parse(ev.detailDescription || ""));
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
      ? `${e.remaining}/${e.capacity} left` : "";

    // Use markdown for preview (strip HTML to text)
    const md = e.detailDescription || "";
    const previewSrc = e.description || stripHtmlToText(marked.parse(md));
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
            </div>
            ${preview ? `<div class="mt-2 text-secondary">${preview}</div>` : ""}
          </div>
          <div class="text-end">
            ${remainTxt ? `<div class="small text-muted mb-2">${esc(remainTxt)}</div>` : ""}
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary btn-edit" data-id="${esc(e._id)}">Edit</button>
              <button class="btn btn-outline-danger btn-del" data-id="${esc(e._id)}">Delete</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ----------------------------------------------------
  // Edit & Save
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

  btnNew.addEventListener("click", () => openEdit(null));

  function openEdit(row) {
    editingId = row?._id || null;
    editTitleEl.textContent = editingId ? "Edit Event" : "New Event";
    f_title.value = row?.title || "";
    f_status.value = row?.status || "draft";
    f_branch.value = row?.branch || "";
    f_resourceId.value = row?.resourceId || "";
    f_resourceName.value = row?.resourceName || "";
    f_start.value = toLocalInputValue(toDate(row?.start));
    f_end.value   = toLocalInputValue(toDate(row?.end));
    f_description.value = row?.description || "";
    f_detailDescription.value = row?.detailDescription || ""; // keep raw Markdown
    f_allowRegistration.value = String(row?.allowRegistration !== false);
    f_capacity.value = (row?.capacity ?? "");
    f_remaining.value = (row?.remaining ?? "");
    f_regOpensAt.value = toLocalInputValue(toDate(row?.regOpensAt));
    f_regClosesAt.value = toLocalInputValue(toDate(row?.regClosesAt));
    f_visibility.value = row?.visibility || "public";
    editModal.show();
  }

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    editErr.classList.add("d-none"); editOk.classList.add("d-none");
    btnSave.disabled = true; editBusy.classList.remove("d-none");

    try {
      const start = fromLocalInputValue(f_start.value);
      const end   = fromLocalInputValue(f_end.value);
      const data = {
        title: f_title.value.trim(),
        status: f_status.value,
        branch: f_branch.value,
        resourceId: f_resourceId.value || null,
        resourceName: f_resourceName.value || null,
        start: firebase.firestore.Timestamp.fromDate(start),
        end: firebase.firestore.Timestamp.fromDate(end),
        description: f_description.value || "",
        detailDescription: f_detailDescription.value || "", // raw Markdown
        allowRegistration: (f_allowRegistration.value === "true"),
        capacity: f_capacity.value ? Number(f_capacity.value) : null,
        remaining: f_remaining.value ? Number(f_remaining.value) : null,
        regOpensAt: f_regOpensAt.value ? firebase.firestore.Timestamp.fromDate(fromLocalInputValue(f_regOpensAt.value)) : null,
        regClosesAt: f_regClosesAt.value ? firebase.firestore.Timestamp.fromDate(fromLocalInputValue(f_regClosesAt.value)) : null,
        visibility: f_visibility.value || "public",
        updatedAt: new Date()
      };

      const col = window.db.collection("events");
      if (editingId) {
        await col.doc(editingId).update(data);
      } else {
        data.createdAt = new Date();
        const doc = await col.add(data);
        await col.doc(doc.id).update({ id: doc.id });
      }
      editOk.classList.remove("d-none");
      setTimeout(()=> editModal.hide(), 800);

    } catch (err) {
      editErr.textContent = err.message || "Save failed.";
      editErr.classList.remove("d-none");
    } finally {
      btnSave.disabled = false; editBusy.classList.add("d-none");
    }
  });

  // ----------------------------------------------------
  // Delete
  function openDelete(row) {
    deletingId = row._id;
    delMsg.innerHTML = `Delete <strong>${esc(row.title || "")}</strong>?`;
    delModal.show();
  }

  btnDoDelete.addEventListener("click", async () => {
    if (!deletingId) return;
    btnDoDelete.disabled = true; delBusy.classList.remove("d-none");
    try {
      await window.db.collection("events").doc(deletingId).delete();
      delModal.hide();
    } catch (err) {
      delErr.textContent = err.message || "Delete failed.";
      delErr.classList.remove("d-none");
    } finally {
      btnDoDelete.disabled = false; delBusy.classList.add("d-none");
    }
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
    attachEventsListener();
  });
})();
