// Events Admin (Firestore v8) — O365 operator-enabled
// Version A (NO schema migration):
// - Remove Branch from event creation/edit flow (do not write branch on save)
// - Wording: Resources => Locations (still stored in resources collection)
// - Allow user to type New Location + details; save into resources collection
// - Conflict detection: resource-only overlap (index recommended: resourceId + start)
// - Backward compatible: old events/resources may still have branch field; we just don't use it.

(function () {
  // ---------- Constants ----------
  const PUBLIC_EVENT_URL_BASE = "https://intranet.livingrealtykw.com/event_public.html?id=";
  const DEFAULT_OWNERS = "training@livingrealtykw.com";

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
  // Branch removed in Version A (keep null-safe)
  const f_branch              = document.getElementById("f_branch"); // may be null after HTML change

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

  // New Location fields (Version A)
  const f_newLocationName     = document.getElementById("f_newLocationName");
  const newLocationDetailsWrap= document.getElementById("newLocationDetailsWrap");
  const f_newLocationAddress  = document.getElementById("f_newLocationAddress");
  const f_newLocationOwners   = document.getElementById("f_newLocationOwners");

  // NOTE: these two were removed from latest HTML, so they will be null:
  const f_newLocationMapsUrl  = document.getElementById("f_newLocationMapsUrl");
  const f_newLocationMapsEmbedUrl = document.getElementById("f_newLocationMapsEmbedUrl");

  // New Map Preview (added in latest HTML)
  const newLocationMapPreviewWrap = document.getElementById("newLocationMapPreviewWrap");
  const newLocationMapPreview = document.getElementById("newLocationMapPreview");

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

  // Toast (optional) for copy feedback
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
  let pendingBannerFile = null;
  let pendingBannerMeta = null;
  let existingBannerPath = null;
  let existingBannerUrl  = null;
  let flagRemoveBanner   = false;

  // New Location derived maps
  let derivedMapsUrl = "";
  let derivedMapsEmbedUrl = "";

  // ---------- Storage (force correct bucket) ----------
  const STORAGE_BUCKET_URL = "gs://kwlrintranet.firebasestorage.app";
  const storage =
    window.storage && typeof window.storage.ref === "function"
      ? window.storage
      : firebase.app().storage(STORAGE_BUCKET_URL);

  try { console.log("[Storage bucket]", storage.ref().toString()); } catch (_) {}

  // ---------- OPERATOR ----------
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
      if (!el) return;
      el.classList.add("d-none");
      el.textContent = "";
    });
  }
  function showInlineError(msg) {
    if (!editErrInline) return;
    editErrInline.textContent = msg;
    editErrInline.classList.remove("d-none");
  }

  // ---------- New Location: auto-generate maps + preview ----------
  function buildMapsUrlsFromAddress(address) {
    const a = (address || "").trim();
    if (!a) return { mapsUrl: "", mapsEmbedUrl: "" };
    const q = encodeURIComponent(a);
    return {
      mapsUrl: `https://www.google.com/maps?q=${q}`,
      mapsEmbedUrl: `https://www.google.com/maps?q=${q}&output=embed`
    };
  }

  function updateNewLocationMapPreview(address) {
    const { mapsUrl, mapsEmbedUrl } = buildMapsUrlsFromAddress(address);
    derivedMapsUrl = mapsUrl;
    derivedMapsEmbedUrl = mapsEmbedUrl;

    if (newLocationMapPreviewWrap && newLocationMapPreview) {
      if (mapsEmbedUrl) {
        newLocationMapPreview.src = mapsEmbedUrl;
        newLocationMapPreviewWrap.classList.remove("d-none");
      } else {
        newLocationMapPreview.src = "";
        newLocationMapPreviewWrap.classList.add("d-none");
      }
    }
  }

  function debounce(fn, ms = 250) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  const debouncedMapUpdate = debounce(() => {
    updateNewLocationMapPreview(f_newLocationAddress ? f_newLocationAddress.value : "");
  }, 250);

  // ---------- New Location UI toggle ----------
  function toggleNewLocationDetails() {
    if (!newLocationDetailsWrap || !f_newLocationName) return;
    const typed = (f_newLocationName.value || "").trim();
    if (typed) {
      newLocationDetailsWrap.classList.remove("d-none");
      // show preview if address already present
      if (f_newLocationAddress) updateNewLocationMapPreview(f_newLocationAddress.value);
    } else {
      newLocationDetailsWrap.classList.add("d-none");
      if (newLocationMapPreviewWrap) newLocationMapPreviewWrap.classList.add("d-none");
      if (newLocationMapPreview) newLocationMapPreview.src = "";
      derivedMapsUrl = "";
      derivedMapsEmbedUrl = "";
    }
  }

  if (f_newLocationName && newLocationDetailsWrap) {
    f_newLocationName.addEventListener("input", toggleNewLocationDetails);
    toggleNewLocationDetails();
  }

  if (f_newLocationAddress) {
    f_newLocationAddress.addEventListener("input", () => {
      debouncedMapUpdate();
    });
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
    const q = (searchInput?.value || "").toLowerCase().trim();
    const locSel = locationFilter?.value || "ALL";

    filtered = allEvents.filter((ev) => {
      // Filter by resourceId (Location)
      if (locSel !== "ALL") {
        if (!locSel.startsWith("RS:")) return false;
        const rid = locSel.slice(3);
        if ((ev.resourceId || "") !== rid) return false;
      }

      // Search (no branch)
      if (q) {
        const hay = [ev.title, ev.description, ev.resourceName, ev.status, ev.visibility].map((v) =>
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
    if (!containerList) return;

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
      (groups[key] ||= { label: d.toLocaleString(undefined, { month: "long", year: "numeric" }), events: [] }).events.push(e);
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

    // registrations icon -> click hidden proxy trigger
    containerList.querySelectorAll("[data-action='registrations']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const proxyId = btn.getAttribute("data-proxy");
        if (!proxyId) return;
        const proxyBtn = document.getElementById(proxyId);
        if (proxyBtn) proxyBtn.click();
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

  // Share block HTML
  function shareAreaHTML(eid) {
    const url = publicEventUrl(eid);
    return `
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <span class="small text-muted">Event Detail Page</span>
        <a href="${esc(url)}" target="_blank" rel="noopener" class="small link-primary text-decoration-underline">
          ${esc(url)}
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

  // Row renderer (branch removed from badges; keep proxy data-branch blank for compatibility)
  function renderEventRow(e) {
    const s = toDate(e.start), ee = toDate(e.end);
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(ee)}`;
    const remaining = typeof e.remaining === "number" ? e.remaining : null;
    const capacity = typeof e.capacity === "number" ? e.capacity : null;
    const remainTxt =
      remaining != null && capacity != null ? `${remaining}/${capacity} left` : remaining != null ? `${remaining} left` : "";

    const colorHex = e.color ? normalizeHex(e.color) : null;
    const colorBadge = colorHex
      ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${esc(colorHex)};border:1px solid #cbd5e1;vertical-align:middle;margin-right:.4rem;"></span>`
      : "";

    const thumb = `
      <div class="event-thumb-placeholder" id="thumb-${esc(e._id)}" aria-label="No banner">
        <i class="bi bi-image"></i>
      </div>`;

    const proxyId = `regbtn-${esc(e._id)}`;

    const actions = `
      <div class="mt-2 d-flex align-items-center gap-2 flex-wrap">
        ${remainTxt ? `<div class="small text-muted me-1">${esc(remainTxt)}</div>` : ""}
        <div class="d-flex align-items-center gap-1">
          <!-- hidden proxy trigger -->
          <button id="${proxyId}"
                  type="button"
                  class="d-none"
                  data-bs-toggle="modal" data-bs-target="#regListModal"
                  data-id="${esc(e._id)}" data-eid="${esc(e._id)}"
                  data-title="${esc(e.title || "")}"
                  data-start="${esc(s ? s.toISOString() : "")}"
                  data-end="${esc(ee ? ee.toISOString() : "")}"
                  data-branch=""
                  data-resource="${esc(e.resourceName || "")}"></button>

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
          ${e.resourceName ? `<span class="badge badge-room me-2"><i class="bi bi-geo-alt me-1"></i>${esc(e.resourceName)}</span>` : ""}
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

    const byName = [...resources].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    byName.forEach((r) => {
      const nm = r.name || r.id || "Location";
      opts.push(`<option value="RS:${esc(r.id)}">${esc(nm)}</option>`);
    });

    locationFilter.innerHTML = opts.join("");
  }

  // ---------- Load ----------
  async function loadResources() {
    const col = window.db.collection("resources");
    let snap;

    try {
      // safest: order by name only
      snap = await col.orderBy("name", "asc").get();
      resources = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn("resources orderBy(name) failed; client-sort fallback:", err);
      snap = await col.get();
      resources = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    // Modal dropdown
    if (f_resourceId) {
      const opts = [`<option value="">-- select --</option>`].concat(
        resources
          .filter((r) => (r.name || "").trim())
          .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
      );
      f_resourceId.innerHTML = opts.join("");
    }

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
            if (containerList) containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
          }
        );
    } catch (err) {
      console.error("events listener threw:", err);
      if (containerList) containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
    }
  }

  // ---------- Create/Reuse resource if New Location typed ----------
  async function ensureResourceSelectedOrCreateNew() {
    const typed = (f_newLocationName && f_newLocationName.value || "").trim();

    // New location flow
    if (typed) {
      // exact-match duplicate guard
      const q = await window.db.collection("resources").where("name", "==", typed).limit(1).get();
      if (!q.empty) {
        const doc = q.docs[0];
        if (f_resourceId) f_resourceId.value = doc.id;
        if (f_resourceName) f_resourceName.value = typed;
        return { resourceId: doc.id, resourceName: typed, created: false };
      }

      const operator = getOperator();
      const address = (f_newLocationAddress && f_newLocationAddress.value || "").trim();

      // auto-generate maps from address (since fields removed from UI)
      const auto = buildMapsUrlsFromAddress(address);
      const mapsUrl = auto.mapsUrl || derivedMapsUrl || "";
      const mapsEmbedUrl = auto.mapsEmbedUrl || derivedMapsEmbedUrl || "";

      const payload = {
        name: typed,
        address,
        mapsUrl,
        mapsEmbedUrl,
        owners: ((f_newLocationOwners && f_newLocationOwners.value) || DEFAULT_OWNERS).trim(),

        capacity: (f_capacity && f_capacity.value !== "" && !isNaN(Number(f_capacity.value))) ? Number(f_capacity.value) : null,

        // keep compatibility with your existing resource schema
        requiresApproval: false,
        type: "room",
        branch: "",

        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdByEmail: operator.email || null,
        createdByName: operator.name || null,
        createdByOid: operator.oid || null,
      };

      const ref = await window.db.collection("resources").add(payload);

      // reload dropdown/filter then select new
      await loadResources();
      if (f_resourceId) f_resourceId.value = ref.id;
      if (f_resourceName) f_resourceName.value = typed;

      return { resourceId: ref.id, resourceName: typed, created: true };
    }

    // Existing selection flow
    const resourceId = (f_resourceId && f_resourceId.value) || "";
    const resourceName = (f_resourceName && f_resourceName.value || "").trim();

    return { resourceId, resourceName, created: false };
  }

  // ---------- Open Edit ----------
  function openEdit(id) {
    clearEditErrors();
    if (editOk) editOk.classList.add("d-none");
    if (btnSave) btnSave.disabled = false;
    if (editBusy) editBusy.classList.add("d-none");

    editingId = id || null;
    if (editTitle) editTitle.textContent = editingId ? "Edit Event" : "New Event";

    // remove prior share box if injected
    const oldShare = editModalEl?.querySelector("#editShareBox");
    if (oldShare && oldShare.parentElement) oldShare.parentElement.removeChild(oldShare);

    // Defaults
    if (f_title) f_title.value = "";
    if (f_status) f_status.value = "draft";
    if (f_branch) f_branch.value = ""; // ignored if exists
    if (f_resourceId) f_resourceId.value = "";
    if (f_resourceName) f_resourceName.value = "";
    if (f_start) f_start.value = "";
    if (f_end) f_end.value = "";
    if (f_description) f_description.value = "";
    if (f_detailDescription) f_detailDescription.value = "";
    if (f_detailPreview) f_detailPreview.innerHTML = "";
    editDetailHTMLOriginal = "";
    editDetailTouched = false;

    if (f_allowRegistration) f_allowRegistration.value = "true";
    if (f_capacity) f_capacity.value = "";
    if (f_remaining) f_remaining.value = "";
    if (f_regOpensDays) f_regOpensDays.value = "7";
    if (f_regClosesDays) f_regClosesDays.value = "1";
    if (f_regOpenNow) f_regOpenNow.checked = false;

    if (f_visibility) f_visibility.value = "public";
    if (f_colorPreset) f_colorPreset.value = "#3b82f6";
    if (f_color) f_color.value = "#3b82f6";

    // New location defaults
    derivedMapsUrl = "";
    derivedMapsEmbedUrl = "";
    if (f_newLocationName) f_newLocationName.value = "";
    if (f_newLocationAddress) f_newLocationAddress.value = "";
    if (f_newLocationOwners) f_newLocationOwners.value = DEFAULT_OWNERS;
    if (f_newLocationMapsUrl) f_newLocationMapsUrl.value = ""; // likely null
    if (f_newLocationMapsEmbedUrl) f_newLocationMapsEmbedUrl.value = ""; // likely null

    if (newLocationMapPreviewWrap) newLocationMapPreviewWrap.classList.add("d-none");
    if (newLocationMapPreview) newLocationMapPreview.src = "";

    toggleNewLocationDetails();

    // Recurrence defaults
    if (f_repeat) f_repeat.value = "none";
    if (f_interval) f_interval.value = "1";
    if (weeklyDaysWrap) weeklyDaysWrap.style.display = "none";
    if (f_repeatEndType) f_repeatEndType.value = "count";
    if (repeatCountWrap) repeatCountWrap.style.display = "";
    if (repeatUntilWrap) repeatUntilWrap.style.display = "none";
    if (f_repeatCount) f_repeatCount.value = "1";
    if (f_repeatUntil) f_repeatUntil.value = "";

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
    if (f_title) f_title.value = ev.title || "";
    if (f_status) f_status.value = ev.status || "draft";
    if (f_branch) f_branch.value = ev.branch || ""; // legacy only
    if (f_resourceId) f_resourceId.value = ev.resourceId || "";
    if (f_resourceName) f_resourceName.value = ev.resourceName || "";
    if (f_start) f_start.value = inputValueFromDate(toDate(ev.start));
    if (f_end) f_end.value = inputValueFromDate(toDate(ev.end));
    if (f_description) f_description.value = ev.description || "";

    editDetailHTMLOriginal = ev.detailDescription || "";
    editDetailTouched = false;
    if (f_detailDescription) f_detailDescription.value = htmlToPlainForTextarea(editDetailHTMLOriginal);
    if (f_detailPreview) f_detailPreview.innerHTML = editDetailHTMLOriginal;

    if (f_allowRegistration) f_allowRegistration.value = ev.allowRegistration === false ? "false" : "true";
    if (f_capacity) f_capacity.value = ev.capacity ?? "";
    if (f_remaining) f_remaining.value = ev.remaining ?? "";
    if (f_visibility) f_visibility.value = ev.visibility || "public";

    if (ev.color) {
      if (f_colorPreset) f_colorPreset.value = isPreset(ev.color) ? ev.color : "__custom";
      if (f_color) f_color.value = normalizeHex(ev.color);
    } else {
      if (f_colorPreset) f_colorPreset.value = "#3b82f6";
      if (f_color) f_color.value = "#3b82f6";
    }

    backfillRegDays(ev);
    loadBannerFromEvent(ev);

    // Shareable link box
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
              ${esc(url)}
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
    if (openDays !== null && !Number.isNaN(openDays) && f_regOpensDays) f_regOpensDays.value = String(openDays);
    if (closeDays !== null && !Number.isNaN(closeDays) && f_regClosesDays) f_regClosesDays.value = String(closeDays);

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
    if (delErr) delErr.classList.add("d-none");
    if (delBusy) delBusy.classList.add("d-none");
    if (delMsg) delMsg.textContent = "Are you sure to delete this event?";
    delModal.show();
  }

  if (btnDoDelete) {
    btnDoDelete.addEventListener("click", async () => {
      if (!pendingDeleteId) return;
      if (delErr) delErr.classList.add("d-none");
      if (delBusy) delBusy.classList.remove("d-none");
      try {
        await window.db.collection("events").doc(pendingDeleteId).delete();
        delModal.hide();
      } catch (err) {
        console.error("delete error:", err);
        if (delErr) {
          delErr.textContent = err.message || "Delete failed.";
          delErr.classList.remove("d-none");
        }
      } finally {
        if (delBusy) delBusy.classList.add("d-none");
      }
    });
  }

  // ---------- Color + Recurrence UI ----------
  if (f_colorPreset && f_color) {
    f_colorPreset.addEventListener("change", () => {
      if (f_colorPreset.value !== "__custom") f_color.value = f_colorPreset.value;
    });
    f_color.addEventListener("input", () => {
      f_colorPreset.value = "__custom";
    });
  }

  if (f_repeat && weeklyDaysWrap) {
    f_repeat.addEventListener("change", () => {
      weeklyDaysWrap.style.display = f_repeat.value === "weekly" ? "" : "none";
    });
  }
  if (f_repeatEndType && repeatCountWrap && repeatUntilWrap) {
    f_repeatEndType.addEventListener("change", () => {
      const isCount = f_repeatEndType.value === "count";
      repeatCountWrap.style.display = isCount ? "" : "none";
      repeatUntilWrap.style.display = isCount ? "none" : "";
    });
  }

  // ---------- "Open registration now" ----------
  function recalcRegOpensDaysFromNow() {
    const start = dtLocalFromInput(f_start?.value);
    if (!start || !f_regOpensDays) return;
    const now = new Date();
    let days = Math.ceil((start.getTime() - now.getTime()) / 86400000);
    if (days < 0) days = 0;
    f_regOpensDays.value = String(days);
  }
  if (f_regOpenNow && f_start && f_regOpensDays) {
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
  if (f_detailDescription && f_detailPreview) {
    f_detailDescription.addEventListener("input", () => {
      editDetailTouched = true;
      f_detailPreview.innerHTML = plainToHtml(f_detailDescription.value);
    });
  }

  // ---------- Resource auto-fill ----------
  if (f_resourceId) {
    f_resourceId.addEventListener("change", () => {
      const r = resources.find((x) => x.id === f_resourceId.value);
      if (f_resourceName) f_resourceName.value = r ? (r.name || "") : "";
      if (r && f_capacity && !f_capacity.value && typeof r.capacity === "number") {
        f_capacity.value = r.capacity;
        if (f_remaining && !f_remaining.value) f_remaining.value = r.capacity;
      }
    });
  }

  // ---------- Banner helpers ----------
  function resetBannerStateAndUI() {
    pendingBannerFile = null;
    pendingBannerMeta = null;
    existingBannerPath = null;
    existingBannerUrl = null;
    flagRemoveBanner = false;

    if (f_bannerFile) f_bannerFile.value = "";
    if (f_bannerMeta) f_bannerMeta.textContent = "";
    if (bannerProgWrap) bannerProgWrap.classList.add("d-none");
    if (bannerProg) bannerProg.style.width = "0%";

    if (f_bannerPreview) {
      f_bannerPreview.src = "";
      f_bannerPreview.style.display = "none";
    }
    if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "";
    if (f_bannerRemove) f_bannerRemove.classList.add("d-none");
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
      if (f_bannerMeta) f_bannerMeta.textContent = metaParts.join(" · ");

      if (f_bannerRemove) f_bannerRemove.classList.remove("d-none");
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
    if (f_bannerMeta) {
      f_bannerMeta.textContent = `${dim.width || "?"}×${dim.height || "?"} · ${(file.size / 1024 / 1024).toFixed(2)} MB · ${(file.type || "").toUpperCase()}${softWarn}`;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (f_bannerPreview) {
        f_bannerPreview.src = e.target.result;
        f_bannerPreview.style.display = "block";
      }
      if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "none";
    };
    reader.readAsDataURL(file);

    if (f_bannerRemove) f_bannerRemove.classList.remove("d-none");
  }

  // Upload under banners/events/<groupId>.<ext>
  async function uploadBannerToStorage(file, groupId) {
    const ext = getExtByType(file.type);
    const path = `banners/events/${groupId}.${ext}`;
    const ref = storage.ref().child(path);

    if (bannerProgWrap) bannerProgWrap.classList.remove("d-none");
    if (bannerProg) bannerProg.style.width = "0%";

    try {
      const task = ref.put(file, { contentType: file.type });
      const res = await new Promise((resolve, reject) => {
        task.on(
          "state_changed",
          (snap) => {
            const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
            if (bannerProg) bannerProg.style.width = `${pct.toFixed(0)}%`;
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
      if (bannerProg) bannerProg.style.width = "100%";
      return res;
    } catch (err) {
      if (bannerProgWrap) bannerProgWrap.classList.add("d-none");
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
      setTimeout(() => bannerProgWrap && bannerProgWrap.classList.add("d-none"), 400);
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
  if (f_bannerFile) {
    f_bannerFile.addEventListener("change", async () => {
      clearEditErrors();
      const file = f_bannerFile.files && f_bannerFile.files[0];
      const err = validateBannerFile(file);
      if (err) {
        pendingBannerFile = null;
        pendingBannerMeta = null;
        if (f_bannerMeta) f_bannerMeta.textContent = err;
        if (f_bannerPreview) {
          f_bannerPreview.src = "";
          f_bannerPreview.style.display = "none";
        }
        if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "";
        if (f_bannerRemove) f_bannerRemove.classList.add("d-none");
        return;
      }
      pendingBannerFile = file;
      flagRemoveBanner = false;
      await previewBannerFile(file);
    });
  }

  // Remove click
  if (f_bannerRemove) {
    f_bannerRemove.addEventListener("click", () => {
      flagRemoveBanner = true;
      pendingBannerFile = null;
      pendingBannerMeta = null;
      if (f_bannerFile) f_bannerFile.value = "";
      if (f_bannerMeta) f_bannerMeta.textContent = existingBannerUrl ? "Marked for removal on save." : "";
      if (f_bannerPreview) {
        f_bannerPreview.src = "";
        f_bannerPreview.style.display = "none";
      }
      if (f_bannerPlaceholder) f_bannerPlaceholder.style.display = "";
      f_bannerRemove.classList.add("d-none");
    });
  }

  // ---------- New ----------
  if (btnNew) btnNew.addEventListener("click", () => openEdit(null));

  // ---------- Save ----------
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearEditErrors();
      if (btnSave) btnSave.disabled = true;
      if (editBusy) editBusy.classList.remove("d-none");

      try {
        // Basic fields
        const title = (f_title?.value || "").trim();
        const status = f_status?.value || "draft";
        const start = dtLocalFromInput(f_start?.value);
        const end = dtLocalFromInput(f_end?.value);

        if (!title || !start || !end || end <= start) {
          throw new Error("Please fill Title, Start/End (End must be after Start).");
        }

        if (f_regOpenNow?.checked) recalcRegOpensDaysFromNow();

        // Ensure resource selection OR create new resource if typed
        const rr = await ensureResourceSelectedOrCreateNew();
        const resourceId = rr.resourceId;
        const resourceName = (rr.resourceName || "").trim();

        if (!resourceId || !resourceName) {
          throw new Error("Please select a Location, or type a New Location name.");
        }

        // Registration & visibility
        const allowRegistration = (f_allowRegistration?.value || "true") === "true";
        const capacity = f_capacity?.value ? Number(f_capacity.value) : null;
        const remaining = f_remaining?.value ? Number(f_remaining.value) : null;
        const opensDays = Number(f_regOpensDays?.value || 0);
        const closesDays = Number(f_regClosesDays?.value || 0);
        const visibility = f_visibility?.value || "public";

        // Color
        const color = normalizeHex((f_color?.value || "#3b82f6"));

        // Descriptions
        const description = (f_description?.value || "").trim();
        const detailDescriptionHtml = editingId
          ? (editDetailTouched ? plainToHtml(f_detailDescription?.value || "") : editDetailHTMLOriginal)
          : plainToHtml(f_detailDescription?.value || "");

        // Recurrence
        const repeat = f_repeat?.value || "none";
        const interval = Math.max(1, Number(f_interval?.value || 1));
        const endType = f_repeatEndType?.value || "count";
        const count = Math.max(1, Number(f_repeatCount?.value || 1));
        const until = f_repeatUntil?.value ? new Date(f_repeatUntil.value + "T23:59:59") : null;
        const weekdays = weeklyDaysWrap
          ? Array.from(weeklyDaysWrap.querySelectorAll("input[type='checkbox']:checked")).map((cb) => Number(cb.value))
          : [];

        // Operator
        const operator = getOperator();

        // ----- EDIT -----
        if (editingId) {
          const conflictMsg = await hasConflict(resourceId, start, end, editingId);
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

            // Branch removed from Version A
            branch: firebase.firestore.FieldValue.delete(),

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
          if (editOk) {
            editOk.textContent = "Saved.";
            editOk.classList.remove("d-none");
          }
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

          const conflictMsg = await hasConflict(resourceId, occStart, occEnd, null);
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
        if (editOk) {
          editOk.textContent = msg;
          editOk.classList.remove("d-none");
        }
        setTimeout(() => editModal.hide(), 1000);
      } catch (err) {
        console.error("save error:", err);
        if (editErrInline && !editErrInline.classList.contains("d-none")) {
          // inline already shown
        } else if (editErr) {
          editErr.textContent = err.message || "Save failed.";
          editErr.classList.remove("d-none");
        }
      } finally {
        if (editBusy) editBusy.classList.add("d-none");
        if (btnSave) btnSave.disabled = false;
      }
    });
  }

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

  // ---------- Conflict check (resource-only) ----------
  async function hasConflict(resourceId, start, end, ignoreId) {
    if (!resourceId || !start || !end) return null;
    const col = window.db.collection("events");
    try {
      // resourceId ==, start < end, orderBy start
      const snap = await col
        .where("resourceId", "==", resourceId)
        .where("start", "<", end)
        .orderBy("start", "asc")
        .limit(80)
        .get();

      const overlap = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((ev) => ev.id !== ignoreId && ev._id !== ignoreId)
        .some((ev) => {
          const s = toDate(ev.start), e = toDate(ev.end);
          if (!s || !e) return false;
          return s < end && e > start;
        });

      return overlap ? "Time conflict: this location is already occupied in that time range." : null;
    } catch (err) {
      // Create composite index if needed:
      // events: resourceId == , start < , orderBy start asc
      console.warn("conflict check failed; allowing save:", err);
      return null; // fail-open
    }
  }

  // ---------- Top filters/search ----------
  locationFilter?.addEventListener("change", applyFilter);
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(applyFilter, 120);
  });

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      if (containerList) containerList.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      return;
    }
    await loadResources();
    attachEventsListener();
  });
})();
