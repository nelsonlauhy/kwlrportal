// Events Admin (Firestore v8) — O365 operator-enabled
// - Reads operator from window.KWLR.currentUser injected by events-admin.html guard
// - Stamps createdBy*/updatedBy* on create/update
// - List-only with Edit/Create modal
// - Banner Image (Firebase Storage v8) with preview, validation, upload, remove
// - detailDescription: auto-link + <br> with live preview (and safe round-trip on edit)
// - Color tag + tiny swatch in list
// - Conflict detection (branch + resource overlap)  [index recommended: branch, resourceId, start]
// - Registration windows (days-before-start) + "Open registration now" auto-calc
// - Combined filter: Location (Resource-only) + Search
// - Thumbnails resolved from Storage
// - Compact icon buttons (Edit/Delete/Copy) + "Event Detail Page" hyperlink (Open Public Page)

(function () {
  // ---------- Constants ----------
  const PUBLIC_EVENT_URL_BASE = "https://intranet.livingrealtykw.com/event_public.html?id=";

  // ---------- DOM ----------
  const containerList   = document.getElementById("eventsContainer");
  const locationFilter  = document.getElementById("locationFilter");
  const searchInput     = document.getElementById("searchInput");
  const listLabel       = document.getElementById("listLabel");
  const btnNew          = document.getElementById("btnNew");

  // Edit modal
  const editModalEl     = document.getElementById("editModal");
  const editModal       = new bootstrap.Modal(editModalEl);
  const editForm        = document.getElementById("editForm");
  const editTitle       = document.getElementById("editTitle");
  const editErr         = document.getElementById("editErr");
  const editErrInline   = document.getElementById("editErrInline");
  const editOk          = document.getElementById("editOk");
  const editBusy        = document.getElementById("editBusy");
  const btnSave         = document.getElementById("btnSave");

  // Fields
  const f_title               = document.getElementById("f_title");
  const f_status              = document.getElementById("f_status");
  const f_branch              = document.getElementById("f_branch");
  const f_resourceId          = document.getElementById("f_resourceId");
  const f_resourceName        = document.getElementById("f_resourceName");
  const f_start               = document.getElementById("f_start");
  const f_end                 = document.getElementById("f_end");
  const f_description         = document.getElementById("f_description");
  const f_detailDescription   = document.getElementById("f_detailDescription");
  const f_detailPreview       = document.getElementById("f_detailPreview");
  const f_allowRegistration   = document.getElementById("f_allowRegistration");
  const f_capacity            = document.getElementById("f_capacity");
  const f_remaining           = document.getElementById("f_remaining");
  const f_regOpensDays        = document.getElementById("f_regOpensDays");
  const f_regClosesDays       = document.getElementById("f_regClosesDays");
  const f_visibility          = document.getElementById("f_visibility");
  const f_colorPreset         = document.getElementById("f_colorPreset");
  const f_color               = document.getElementById("f_color");
  const f_regOpenNow          = document.getElementById("f_regOpenNow");

  // Recurrence
  const f_repeat              = document.getElementById("f_repeat");
  const f_interval            = document.getElementById("f_interval");
  const weeklyDaysWrap        = document.getElementById("weeklyDaysWrap");
  const f_repeatEndType       = document.getElementById("f_repeatEndType");
  const repeatCountWrap       = document.getElementById("repeatCountWrap");
  const f_repeatCount         = document.getElementById("f_repeatCount");
  const repeatUntilWrap       = document.getElementById("repeatUntilWrap");
  const f_repeatUntil         = document.getElementById("f_repeatUntil");

  // Delete modal
  const delModalEl            = document.getElementById("delModal");
  const delModal              = new bootstrap.Modal(delModalEl);
  const delMsg                = document.getElementById("delMsg");
  const delErr                = document.getElementById("delErr");
  const delBusy               = document.getElementById("delBusy");
  const btnDoDelete           = document.getElementById("btnDoDelete");

  // Banner elements
  const f_bannerPreview       = document.getElementById("f_bannerPreview");
  const f_bannerPlaceholder   = document.getElementById("f_bannerPlaceholder");
  const f_bannerFile          = document.getElementById("f_bannerFile");
  const bannerProgWrap        = document.getElementById("bannerProgWrap");
  const bannerProg            = document.getElementById("bannerProg");
  const f_bannerRemove        = document.getElementById("f_bannerRemove");
  const f_bannerMeta          = document.getElementById("f_bannerMeta");

  // Toast (optional) for copy feedback (only if you add an element with id="copyToast" in HTML)
  const copyToastEl           = document.getElementById("copyToast");
  const copyToast             = copyToastEl ? new bootstrap.Toast(copyToastEl, { delay: 2000 }) : null;

  // ---------- State ----------
  let resources = [];
  let allEvents = [];
  let filtered  = [];
  let editingId = null;
  let pendingDeleteId = null;
  let unsubscribeEvents = null;

  let editDetailHTMLOriginal = "";
  let editDetailTouched = false;

  // Banner state
  let pendingBannerFile = null;  // File selected (not yet uploaded)
  let pendingBannerMeta = null;  // {width,height,type,size}
  let existingBannerPath = null;
  let existingBannerUrl  = null;
  let flagRemoveBanner   = false;

  // ---------- Storage (force correct bucket) ----------
  const STORAGE_BUCKET_URL = "gs://kwlrintranet.firebasestorage.app";
  const storage =
    window.storage && typeof window.storage.ref === "function"
      ? window.storage
      : firebase.app().storage(STORAGE_BUCKET_URL);

  try { console.log("[Storage bucket]", storage.ref().toString()); } catch (_) {}

  // ---------- OPERATOR (O365 via MSAL guard) ----------
  function getOperator() {
    const msalUser = (window.KWLR && window.KWLR.currentUser) ? window.KWLR.currentUser : null;
    const fbUser   = (firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser : null;

    const email = (msalUser && msalUser.email) ||
                  (fbUser && fbUser.email) || null;

    const name  = (msalUser && msalUser.name) ||
                  (fbUser && (fbUser.displayName || fbUser.email)) || null;

    const oid   = (msalUser && (msalUser.oid || msalUser.objectId)) || null;

    return { email, name, oid, source: msalUser ? "msal" : (fbUser ? "firebase" : "none") };
  }

  // ---------- Utils ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtDateTime(d) {
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function inputValueFromDate(d) {
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function dtLocalFromInput(value) {
    return value ? new Date(value) : null;
  }

  function showCopyToast() {
    if (copyToast) copyToast.show();
  }
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.left = "-1000px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      showCopyToast();
    } catch (e) {
      console.warn("Copy failed:", e);
      alert("Copy failed. Please copy manually:\n" + text);
    }
  }
  function publicEventUrl(eventId) {
    return `${PUBLIC_EVENT_URL_BASE}${encodeURIComponent(eventId)}`;
  }

  // Registration windows
  function deriveRegWindowDays(startDate, opensDays, closesDays) {
    const openMs = (Number(opensDays) || 0) * 86400000;
    const closeMs = (Number(closesDays) || 0) * 86400000;
    const regOpensAt = new Date(startDate.getTime() - openMs);
    let regClosesAt  = new Date(startDate.getTime() - closeMs);
    if (regOpensAt >= regClosesAt) regClosesAt = new Date(regOpensAt.getTime() + 30 * 60000);
    return { regOpensAt, regClosesAt };
  }

  // Text <-> HTML
  function plainToHtml(text) {
    const escText = esc(text || "");
    const urlRegex = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
    const linked = escText.replace(urlRegex, (m) => {
      const href = m.startsWith("www.") ? `https://${m}` : m;
      return `<a href="${href}" target="_blank" rel="noopener">${m}</a>`;
    });
    return linked.replace(/\n/g, "<br>");
  }
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
    [editErr, editErrInline, editOk].forEach((el) => {
      el.classList.add("d-none");
      el.textContent = "";
    });
  }
  function showInlineError(msg) {
    editErrInline.textContent = msg;
    editErrInline.classList.remove("d-none");
  }

  // ---------- Banner URL resolver for list thumbnails ----------
  const _bannerUrlCache = new Map();
  function resolveBannerUrl(evt) {
    try {
      if (evt.bannerThumbUrl) return Promise.resolve(evt.bannerThumbUrl);
      const direct = evt.bannerUrl || (evt.banner && evt.banner.url);
      if (direct && typeof direct === "string") return Promise.resolve(direct);

      const path = evt.bannerPath || (evt.banner && evt.banner.path);
      if (path && typeof path === "string") {
        if (_bannerUrlCache.has(path)) return Promise.resolve(_bannerUrlCache.get(path));
        return storage
          .ref(path)
          .getDownloadURL()
          .then((url) => {
            _bannerUrlCache.set(path, url);
            return url;
          })
          .catch(() => null);
      }
    } catch (e) {
      console.warn("resolveBannerUrl error:", e);
    }
    return Promise.resolve(null);
  }

  // ---------- Combined Filter ----------
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const locSel = locationFilter?.value || "ALL";

    filtered = allEvents.filter((ev) => {
      if (locSel !== "ALL") {
        if (!locSel.startsWith("RS:")) return false;
        const rid = locSel.slice(3);
        if ((ev.resourceId || "") !== rid) return false;
      }
      if (q) {
        const hay = [ev.title, ev.description, ev.resourceName, ev.branch].map((v) =>
          (v || "").toString().toLowerCase()
        );
        if (!hay.some((v) => v.includes(q))) return false;
      }
      return true;
    });

    renderList();
  }

  // ---------- Render ----------
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
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      (groups[key] ||= { label: d.toLocaleString(undefined, { month: "long", year: "numeric" }), events: [] }).events.push(
        e
      );
    }
    const parts = [];
    Object.keys(groups)
      .sort()
      .forEach((key) => {
        const g = groups[key];
        parts.push(`<div class="month-header">${esc(g.label)}</div>`);
        for (const e of g.events) parts.push(renderEventRow(e));
      });
    containerList.innerHTML = parts.join("");

    // wire actions
    containerList.querySelectorAll("[data-action='edit']").forEach((btn) => {
      btn.addEventListener("click", () => openEdit(btn.getAttribute("data-id")));
    });
    containerList.querySelectorAll("[data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", () => openDelete(btn.getAttribute("data-id")));
    });
    containerList.querySelectorAll("[data-action='copy-link']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        copyToClipboard(publicEventUrl(id));
      });
    });

    // tooltips
    containerList.querySelectorAll("[data-bs-toggle='tooltip']").forEach((el) => new bootstrap.Tooltip(el));

    // thumbs
    filtered.forEach((e) => {
      resolveBannerUrl(e).then((url) => {
        const mount = document.getElementById(`thumb-${e._id}`);
        if (!mount) return;
        if (url) {
          const img = new Image();
          img.className = "event-thumb";
          img.alt = "Banner";
          img.loading = "lazy";
          img.src = url;
          mount.replaceWith(img);
          img.id = `thumb-${e._id}`;
        }
      });
    });
  }

  // Share block HTML (label + hyperlink + copy icon)
  function shareAreaHTML(eid) {
    const url = publicEventUrl(eid);
    return `
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <span class="small text-muted">Event Detail Page</span>
        <a href="${esc(url)}" target="_blank" rel="noopener" class="small link-primary text-decoration-underline">
          Open Public Page
        </a>
        <button type="button"
                class="btn btn-light btn-sm p-1"
                data-action="copy-link" data-id="${esc(eid)}"
                data-bs-toggle="tooltip" data-bs-title="Copy public link" aria-label="Copy link">
          <i class="bi bi-clipboard"></i>
        </button>
      </div>
    `;
  }

  function renderEventRow(e) {
    const s = toDate(e.start), ee = toDate(e.end);
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(ee)}`;
    const remaining = typeof e.remaining === "number" ? e.remaining : null;
    const capacity = typeof e.capacity === "number" ? e.capacity : null;
    const remainTxt =
      remaining != null && capacity != null ? `${remaining}/${capacity} left` : remaining != null ? `${remaining} left` : "";

    const colorHex = e.color ? normalizeHex(e.color) : null;
    const colorBadge = colorHex
      ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${esc(
          colorHex
        )};border:1px solid #cbd5e1;vertical-align:middle;margin-right:.4rem;"></span>`
      : "";

    const thumb = `
      <div class="event-thumb-placeholder" id="thumb-${esc(e._id)}" aria-label="No banner">
        <i class="bi bi-image"></i>
      </div>`;

    const actions = `
      <div class="mt-2 d-flex align-items-center gap-2 flex-wrap">
        ${remainTxt ? `<div class="small text-muted me-1">${esc(remainTxt)}</div>` : ""}
        <div class="d-flex align-items-center gap-1">
          <button class="btn btn-light btn-sm p-1"
                  data-action="edit" data-id="${esc(e._id)}"
                  data-bs-toggle="tooltip" data-bs-title="Edit" aria-label="Edit">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button class="btn btn-light btn-sm p-1 text-danger"
                  data-action="delete" data-id="${esc(e._id)}"
                  data-bs-toggle="tooltip" data-bs-title="Delete" aria-label="Delete">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>`;

    const share = `
      <div class="mt-2">
        ${shareAreaHTML(e._id)}
      </div>`;

    const body = `
      <div class="flex-grow-1">
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
        ${actions}
        ${share}
      </div>`;

    return `
      <div class="event-card">
        <div class="event-row">
          ${thumb}
          ${body}
        </div>
      </div>`;
  }

  // ---------- Filters ----------
  function populateLocationFilter(resources) {
    if (!locationFilter) return;
    const opts = [`<option value="ALL">All Locations</option>`];
    const byBranchThenName = [...resources].sort(
      (a, b) => String(a.branch || "").localeCompare(String(b.branch || "")) || String(a.name || "").localeCompare(String(b.name || ""))
    );
    byBranchThenName.forEach((r) => {
      const br = (r.branch || "").toUpperCase();
      const nm = r.name || r.id || "Resource";
      opts.push(`<option value="RS:${esc(r.id)}">${esc(br)} — ${esc(nm)}</option>`);
    });
    locationFilter.innerHTML = opts.join("");
  }

  // ---------- Load ----------
  async function loadResources() {
    const col = window.db.collection("resources");
    try {
      const snap = await col.orderBy("branch", "asc").orderBy("name", "asc").get();
      resources = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn("resources index missing; client-sort fallback:", err);
      const snap = await col.get();
      resources = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            String(a.branch || "").localeCompare(String(b.branch || "")) ||
            String(a.name || "").localeCompare(String(b.name || ""))
        );
    }
    const opts = [`<option value="">-- select --</option>`].concat(
      resources.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} (${esc(r.branch || "-")})</option>`)
    );
    f_resourceId.innerHTML = opts.join("");
    populateLocationFilter(resources);
  }

  function attachEventsListener() {
    if (typeof unsubscribeEvents === "function") {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }
    const now = new Date();
    const col = window.db.collection("events");
    try {
      unsubscribeEvents = col
        .where("start", ">=", now)
        .orderBy("start", "asc")
        .onSnapshot(
          (snap) => {
            allEvents = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
            applyFilter();
          },
          (err) => {
            console.error("events listener error:", err);
            containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
          }
        );
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

    // remove prior share box if injected
    const oldShare = editModalEl.querySelector("#editShareBox");
    if (oldShare && oldShare.parentElement) oldShare.parentElement.removeChild(oldShare);

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
    if (f_regOpenNow) f_regOpenNow.checked = false;

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

    // Banner UI/state reset
    resetBannerStateAndUI();

    if (!editingId) {
      editModal.show();
      return;
    }

    const ev = allEvents.find((x) => x._id === editingId);
    if (!ev) {
      showInlineError("Event not found.");
      return;
    }

    // Fill form
    f_title.value = ev.title || "";
    f_status.value = ev.status || "draft";
    f_branch.value = ev.branch || "";
    f_resourceId.value = ev.resourceId || "";
    f_resourceName.value = ev.resourceName || "";
    f_start.value = inputValueFromDate(toDate(ev.start));
    f_end.value = inputValueFromDate(toDate(ev.end));
    f_description.value = ev.description || "";

    editDetailHTMLOriginal = ev.detailDescription || "";
    editDetailTouched = false;
    f_detailDescription.value = htmlToPlainForTextarea(editDetailHTMLOriginal);
    f_detailPreview.innerHTML = editDetailHTMLOriginal;

    f_allowRegistration.value = ev.allowRegistration === false ? "false" : "true";
    f_capacity.value = ev.capacity ?? "";
    f_remaining.value = ev.remaining ?? "";
    f_visibility.value = ev.visibility || "public";

    if (ev.color) {
      f_colorPreset.value = isPreset(ev.color) ? ev.color : "__custom";
      f_color.value = normalizeHex(ev.color);
    } else {
      f_colorPreset.value = "#3b82f6";
      f_color.value = "#3b82f6";
    }

    backfillRegDays(ev);
    loadBannerFromEvent(ev);

    // Shareable link box: label + hyperlink + copy icon
    try {
      const modalBody = editModalEl.querySelector(".modal-body");
      if (modalBody) {
        const box = document.createElement("div");
        box.id = "editShareBox";
        box.className = "alert alert-light border d-flex align-items-center justify-content-between flex-wrap";
        const url = publicEventUrl(editingId);
        box.innerHTML = `
          <div class="me-2 mb-2 mb-sm-0">
            <div class="fw-semibold">Event Detail Page</div>
            <a href="${esc(url)}" target="_blank" rel="noopener" class="link-primary text-decoration-underline">
              Open Public Page
            </a>
          </div>
          <div class="d-flex align-items-center gap-1">
            <button type="button"
                    class="btn btn-light btn-sm p-1"
                    id="btnEditCopyLink"
                    data-bs-toggle="tooltip" data-bs-title="Copy public link" aria-label="Copy link">
              <i class="bi bi-clipboard"></i>
            </button>
          </div>
        `;
        modalBody.prepend(box);

        const btnEditCopyLink = box.querySelector("#btnEditCopyLink");
        if (btnEditCopyLink) btnEditCopyLink.addEventListener("click", () => copyToClipboard(url));

        box.querySelectorAll("[data-bs-toggle='tooltip']").forEach((el) => new bootstrap.Tooltip(el));
      }
    } catch (e) {
      console.warn("Failed to inject share box:", e);
    }

    editModal.show();
  }

  function backfillRegDays(ev) {
    const startDate = toDate(ev.start);
    const opensAt = toDate(ev.regOpensAt);
    const closesAt = toDate(ev.regClosesAt);
    function daysBefore(start, other) {
      if (!start || !other) return null;
      const ms = start.getTime() - other.getTime();
      if (ms <= 0) return 0;
      return Math.round(ms / 86400000);
    }
    const openDays = daysBefore(startDate, opensAt);
    const closeDays = daysBefore(startDate, closesAt);
    if (openDays !== null && !Number.isNaN(openDays)) f_regOpensDays.value = String(openDays);
    if (closeDays !== null && !Number.isNaN(closeDays)) f_regClosesDays.value = String(closeDays);

    if (f_regOpenNow) {
      if (opensAt && opensAt <= new Date()) {
        f_regOpenNow.checked = true;
        recalcRegOpensDaysFromNow();
      } else {
        f_regOpenNow.checked = false;
      }
    }
  }

  function isPreset(hex) {
    const presets = ["#3b82f6", "#22c55e", "#ef4444", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#64748b"];
    return presets.includes(normalizeHex(hex));
  }
  function normalizeHex(c) {
    if (!c) return "#3b82f6";
    let x = String(c).trim();
    if (!x.startsWith("#")) x = "#" + x;
    if (x.length === 4) x = "#" + x[1] + x[1] + x[2] + x[2] + x[3] + x[3];
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

  // ---------- Color + Recurrence UI ----------
  f_colorPreset.addEventListener("change", () => {
    if (f_colorPreset.value !== "__custom") f_color.value = f_colorPreset.value;
  });
  f_color.addEventListener("input", () => {
    f_colorPreset.value = "__custom";
  });

  f_repeat.addEventListener("change", () => {
    weeklyDaysWrap.style.display = f_repeat.value === "weekly" ? "" : "none";
  });
  f_repeatEndType.addEventListener("change", () => {
    const isCount = f_repeatEndType.value === "count";
    repeatCountWrap.style.display = isCount ? "" : "none";
    repeatUntilWrap.style.display = isCount ? "none" : "";
  });

  // ---------- "Open registration now" ----------
  function recalcRegOpensDaysFromNow() {
    const start = dtLocalFromInput(f_start.value);
    if (!start) return;
    const now = new Date();
    let days = Math.ceil((start.getTime() - now.getTime()) / 86400000);
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
    // Note: f_detailPreview is not content-editable; it mirrors parsed HTML.
  });

  // ---------- Resource auto-fill ----------
  f_resourceId.addEventListener("change", () => {
    const r = resources.find((x) => x.id === f_resourceId.value);
    f_resourceName.value = r ? r.name || "" : "";
    if (r && !f_capacity.value && typeof r.capacity === "number") {
      f_capacity.value = r.capacity;
      if (!f_remaining.value) f_remaining.value = r.capacity;
    }
  });

  // ---------- Banner helpers ----------
  function resetBannerStateAndUI() {
    pendingBannerFile = null;
    pendingBannerMeta = null;
    existingBannerPath = null;
    existingBannerUrl = null;
    flagRemoveBanner = false;

    f_bannerFile.value = "";
    f_bannerMeta.textContent = "";
    bannerProgWrap.classList.add("d-none");
    bannerProg.style.width = "0%";

    if (f_bannerPreview) {
      f_bannerPreview.src = "";
      f_bannerPreview.style.display = "none";
    }
    if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "";
    f_bannerRemove.classList.add("d-none");
  }

  function loadBannerFromEvent(ev) {
    existingBannerPath = ev.bannerPath || null;
    existingBannerUrl  = ev.bannerUrl || null;

    if (existingBannerUrl) {
      if (f_bannerPreview) {
        f_bannerPreview.src = existingBannerUrl;
        f_bannerPreview.style.display = "block";
      }
      if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "none";

      const metaParts = [];
      if (ev.bannerWidth && ev.bannerHeight) metaParts.push(`${ev.bannerWidth}×${ev.bannerHeight}`);
      if (ev.bannerType) metaParts.push(ev.bannerType);
      if (typeof ev.bannerSize === "number") metaParts.push(`${(ev.bannerSize / 1024 / 1024).toFixed(2)} MB`);
      f_bannerMeta.textContent = metaParts.join(" · ");

      f_bannerRemove.classList.remove("d-none");
    } else {
      resetBannerStateAndUI();
    }
  }

  function validateBannerFile(file) {
    if (!file) return "No file selected.";
    if (file.size > 10 * 1024 * 1024) return "File too large. Maximum is 10 MB.";
    const type = (file.type || "").toLowerCase();
    const ok = type === "image/jpeg" || type === "image/jpg" || type === "image/png";
    if (!ok) return "Unsupported file type. Please upload JPEG or PNG.";
    return null;
  }

  function getExtByType(type) {
    if (!type) return "bin";
    if (type.includes("png")) return "png";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    return "bin";
  }

  function readImageDimensions(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        URL.revokeObjectURL(url);
        resolve({ width: w, height: h });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: null, height: null });
      };
      img.src = url;
    });
  }

  async function previewBannerFile(file) {
    const dim = await readImageDimensions(file);
    pendingBannerMeta = {
      width: dim.width || null,
      height: dim.height || null,
      type: (file.type || "").toLowerCase(),
      size: file.size,
    };
    const softWarn = dim.width !== 2160 || dim.height !== 1080 ? " (tip: recommended 2160×1080)" : "";
    f_bannerMeta.textContent = `${dim.width || "?"}×${dim.height || "?"} · ${(file.size / 1024 / 1024).toFixed(
      2
    )} MB · ${(file.type || "").toUpperCase()}${softWarn}`;

    const reader = new FileReader();
    reader.onload = (e) => {
      f_bannerPreview.src = e.target.result;
      f_bannerPreview.style.display = "block";
      if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "none";
    };
    reader.readAsDataURL(file);

    f_bannerRemove.classList.remove("d-none");
  }

  // Upload under banners/events/<groupId>.<ext>
  async function uploadBannerToStorage(file, groupId) {
    const ext = getExtByType(file.type);
    const path = `banners/events/${groupId}.${ext}`;
    const ref = storage.ref().child(path);

    bannerProgWrap.classList.remove("d-none");
    bannerProg.style.width = "0%";

    try {
      const task = ref.put(file, { contentType: file.type });
      const res = await new Promise((resolve, reject) => {
        task.on(
          "state_changed",
          (snap) => {
            const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
            bannerProg.style.width = `${pct.toFixed(0)}%`;
          },
          (err) => reject(err),
          async () => {
            try {
              const url = await ref.getDownloadURL();
              resolve({ url, path });
            } catch (e) {
              reject(e);
            }
          }
        );
      });
      bannerProg.style.width = "100%";
      return res;
    } catch (err) {
      bannerProgWrap.classList.add("d-none");
      const msg =
        err && err.code === "storage/unauthorized"
          ? "Upload not authorized by Storage Rules."
          : String(err).toLowerCase().includes("cors") || String(err).toLowerCase().includes("preflight")
          ? "Upload blocked by CORS. Ensure CORS allows your domain."
          : err && err.message
          ? err.message
          : "Upload failed.";
      showInlineError(msg);
      throw err;
    } finally {
      setTimeout(() => bannerProgWrap.classList.add("d-none"), 400);
    }
  }

  async function deleteBannerAtPath(path) {
    if (!path) return;
    try {
      const ref = storage.ref().child(path);
      await ref.delete();
    } catch (err) {
      console.warn("delete banner failed:", err);
    }
  }

  // File change
  f_bannerFile.addEventListener("change", async () => {
    clearEditErrors();
    const file = f_bannerFile.files && f_bannerFile.files[0];
    const err = validateBannerFile(file);
    if (err) {
      pendingBannerFile = null;
      pendingBannerMeta = null;
      f_bannerMeta.textContent = err;
      if (f_bannerPreview) {
        f_bannerPreview.src = "";
        f_bannerPreview.style.display = "none";
      }
      if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "";
      f_bannerRemove.classList.add("d-none");
      return;
    }
    pendingBannerFile = file;
    flagRemoveBanner = false;
    await previewBannerFile(file);
  });

  // Remove click
  f_bannerRemove.addEventListener("click", () => {
    flagRemoveBanner = true;
    pendingBannerFile = null;
    pendingBannerMeta = null;
    f_bannerFile.value = "";
    f_bannerMeta.textContent = existingBannerUrl ? "Marked for removal on save." : "";
    if (f_bannerPreview) {
      f_bannerPreview.src = "";
      f_bannerPreview.style.display = "none";
    }
    if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "";
    f_bannerRemove.classList.add("d-none");
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

      if (f_regOpenNow?.checked) recalcRegOpensDaysFromNow();

      // Registration & visibility
      const allowRegistration = f_allowRegistration.value === "true";
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
        ? editDetailTouched
          ? plainToHtml(f_detailDescription.value)
          : editDetailHTMLOriginal
        : plainToHtml(f_detailDescription.value);

      // Recurrence
      const repeat = f_repeat.value;
      const interval = Math.max(1, Number(f_interval.value || 1));
      const endType = f_repeatEndType.value;
      const count = Math.max(1, Number(f_repeatCount.value || 1));
      const until = f_repeatUntil.value ? new Date(f_repeatUntil.value + "T23:59:59") : null;
      const weekdays = Array.from(weeklyDaysWrap.querySelectorAll("input[type='checkbox']:checked")).map((cb) =>
        Number(cb.value)
      );

      // Operator
      const operator = getOperator();

      // ----- EDIT -----
      if (editingId) {
        const conflictMsg = await hasConflict(branch, resourceId, start, end, editingId);
        if (conflictMsg) {
          showInlineError(conflictMsg);
          throw new Error(conflictMsg);
        }

        // Banner (upload/delete if needed)
        let bannerPayload = {};
        if (pendingBannerFile) {
          const groupId = editingId; // reuse event id
          const up = await uploadBannerToStorage(pendingBannerFile, groupId);
          bannerPayload = {
            bannerUrl: up.url,
            bannerPath: up.path,
            bannerWidth: (pendingBannerMeta && pendingBannerMeta.width) || null,
            bannerHeight: (pendingBannerMeta && pendingBannerMeta.height) || null,
            bannerType: (pendingBannerMeta && pendingBannerMeta.type) || (pendingBannerFile && pendingBannerFile.type) || null,
            bannerSize: (pendingBannerMeta && pendingBannerMeta.size) || (pendingBannerFile && pendingBannerFile.size) || null,
          };
          if (existingBannerPath && existingBannerPath !== up.path) {
            await deleteBannerAtPath(existingBannerPath);
          }
        } else if (flagRemoveBanner && existingBannerPath) {
          await deleteBannerAtPath(existingBannerPath);
          bannerPayload = {
            bannerUrl: firebase.firestore.FieldValue.delete(),
            bannerPath: firebase.firestore.FieldValue.delete(),
            bannerWidth: firebase.firestore.FieldValue.delete(),
            bannerHeight: firebase.firestore.FieldValue.delete(),
            bannerType: firebase.firestore.FieldValue.delete(),
            bannerSize: firebase.firestore.FieldValue.delete(),
          };
        }

        const payload = {
          title,
          description,
          detailDescription: detailDescriptionHtml,
          branch,
          resourceId,
          resourceName,
          color,
          visibility,
          status,
          start,
          end,
          allowRegistration,
          capacity: capacity != null ? capacity : firebase.firestore.FieldValue.delete(),
          remaining: remaining != null ? remaining : firebase.firestore.FieldValue.delete(),
          updatedAt: new Date(),
          updatedByEmail: operator.email || null,
          updatedByName: operator.name || null,
          updatedByOid: operator.oid || null,
          ...bannerPayload,
        };

        if (allowRegistration) {
          const { regOpensAt, regClosesAt } = deriveRegWindowDays(start, opensDays, closesDays);
          payload.regOpensAt = regOpensAt;
          payload.regClosesAt = regClosesAt;
        } else {
          payload.regOpensAt = firebase.firestore.FieldValue.delete();
          payload.regClosesAt = firebase.firestore.FieldValue.delete();
        }

        await window.db.collection("events").doc(editingId).update(payload);
        editOk.textContent = "Saved.";
        editOk.classList.remove("d-none");
        setTimeout(() => editModal.hide(), 800);
        return;
      }

      // ----- CREATE -----
      const occurrences = buildOccurrences({ repeat, interval, start, end, endType, count, until, weekdays });
      if (!occurrences.length) throw new Error("No occurrences generated. Check your repeat settings.");

      // Upload banner once for new series (reuse)
      let newBannerData = null;
      if (pendingBannerFile) {
        const groupId = window.db.collection("_").doc().id; // random id to name the banner file
        const up = await uploadBannerToStorage(pendingBannerFile, groupId);
        newBannerData = {
          bannerUrl: up.url,
          bannerPath: up.path,
          bannerWidth: (pendingBannerMeta && pendingBannerMeta.width) || null,
          bannerHeight: (pendingBannerMeta && pendingBannerMeta.height) || null,
          bannerType: (pendingBannerMeta && pendingBannerMeta.type) || (pendingBannerFile && pendingBannerFile.type) || null,
          bannerSize: (pendingBannerMeta && pendingBannerMeta.size) || (pendingBannerFile && pendingBannerFile.size) || null,
        };
      }

      const batch = window.db.batch();
      const evCol = window.db.collection("events");

      let made = 0;
      let skipped = 0;
      let firstConflictMsg = null;

      for (const occ of occurrences) {
        const occStart = occ.start;
        const occEnd   = occ.end;

        const conflictMsg = await hasConflict(branch, resourceId, occStart, occEnd, null);
        if (conflictMsg) {
          skipped++;
          if (!firstConflictMsg) firstConflictMsg = conflictMsg;
          continue;
        }

        const docRef = evCol.doc();

        const payload = {
          title,
          description,
          detailDescription: detailDescriptionHtml,
          branch,
          resourceId,
          resourceName,
          color,
          visibility,
          status,
          start: occStart,
          end: occEnd,
          allowRegistration,
          createdAt: new Date(),
          createdByEmail: operator.email || null,
          createdByName: operator.name || null,
          createdByOid: operator.oid || null,
          updatedAt: new Date(),
          updatedByEmail: operator.email || null,
          updatedByName: operator.name || null,
          updatedByOid: operator.oid || null,
          ...(capacity != null ? { capacity } : {}),
          ...(remaining != null ? { remaining } : capacity != null ? { remaining: capacity } : {}),
          ...(newBannerData || {}),
        };

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

      const msg = skipped > 0 ? `Created ${made} event(s). Skipped ${skipped} due to time conflicts.` : `Created ${made} event(s).`;
      editOk.textContent = msg;
      editOk.classList.remove("d-none");
      setTimeout(() => editModal.hide(), 1000);
    } catch (err) {
      console.error("save error:", err);
      if (!editErrInline.classList.contains("d-none")) {
        // inline shown already
      } else {
        editErr.textContent = err.message || "Save failed.";
        editErr.classList.remove("d-none");
      }
    } finally {
      editBusy.classList.add("d-none");
      btnSave.disabled = false;
    }
  });

  // ---------- Occurrence builder ----------
  function buildOccurrences({ repeat, interval, start, end, endType, count, until, weekdays }) {
    const out = [];
    const durMs = end - start;
    const pushOcc = (s) => out.push({ start: new Date(s), end: new Date(s.getTime() + durMs) });
    if (repeat === "none") {
      pushOcc(start);
      return out;
    }

    const limitCount = endType === "count" ? Math.max(1, count) : Number.POSITIVE_INFINITY;
    const limitUntil = endType === "until" && until ? until : null;

    let made = 0;
    let cursor = new Date(start);

    if (repeat === "daily") {
      while (made < limitCount) {
        if (!limitUntil || cursor <= limitUntil) pushOcc(cursor);
        else break;
        made++;
        cursor = new Date(cursor.getTime() + interval * 86400000);
      }
    } else if (repeat === "weekly") {
      const startDow = start.getDay();
      let weekStart = new Date(start);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - startDow); // to Sunday
      while (made < limitCount) {
        for (const dow of (weekdays.length ? weekdays : [startDow])) {
          const occStart = new Date(weekStart);
          occStart.setDate(weekStart.getDate() + dow);
          occStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
          if (occStart < start) continue;
          if (limitUntil && occStart > limitUntil) {
            made = limitCount;
            break;
          }
          pushOcc(occStart);
          made++;
          if (made >= limitCount) break;
        }
        weekStart = new Date(weekStart.getTime() + interval * 7 * 86400000);
      }
    } else if (repeat === "monthly") {
      const startDay = start.getDate();
      while (made < limitCount) {
        if (!limitUntil || cursor <= limitUntil) pushOcc(cursor);
        else break;
        made++;
        const m = cursor.getMonth();
        const y = cursor.getFullYear();
        const next = new Date(y, m + interval, startDay, start.getHours(), start.getMinutes(), 0, 0);
        cursor = next;
      }
    }
    return out;
  }

  // ---------- Conflict check ----------
  async function hasConflict(branch, resourceId, start, end, ignoreId) {
    if (!branch || !resourceId || !start || !end) return null;
    const col = window.db.collection("events");
    try {
      const snap = await col
        .where("branch", "==", branch)
        .where("resourceId", "==", resourceId)
        .where("start", "<", end)
        .orderBy("start", "asc")
        .limit(50)
        .get();

      const overlap = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((ev) => ev.id !== ignoreId && ev._id !== ignoreId)
        .some((ev) => {
          const s = toDate(ev.start), e = toDate(ev.end);
          if (!s || !e) return false;
          return s < end && e > start;
        });

      return overlap ? "Time conflict: same branch & resource already occupied in that time range." : null;
    } catch (err) {
      // If you see an "index required" error, create a composite index for:
      // collection: events, where: branch==, resourceId==, start<, orderBy: start asc
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
