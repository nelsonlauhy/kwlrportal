// Public Events list + Registration (Firestore v8)
// Collections:
//  - events (published, visibility=public, upcoming)
//  - resources (for filter menu)
//  - eventRegistrations (composite id: `${eventId}_${emailLower}`)

(function() {
  // --- DOM
  const container = document.getElementById("eventsContainer");
  const branchFilter = document.getElementById("branchFilter");
  const resourceFilter = document.getElementById("resourceFilter");
  const searchInput = document.getElementById("searchInput");

  // Registration modal
  const regModalEl = document.getElementById("regModal");
  const regModal = new bootstrap.Modal(regModalEl);
  const regForm = document.getElementById("regForm");
  const regEventSummary = document.getElementById("regEventSummary");
  const attendeeName = document.getElementById("attendeeName");
  const attendeeEmail = document.getElementById("attendeeEmail");
  const regWarn = document.getElementById("regWarn");
  const regErr = document.getElementById("regErr");
  const regOk = document.getElementById("regOk");
  const regBusy = document.getElementById("regBusy");
  const btnSubmitReg = document.getElementById("btnSubmitReg");

  // --- State
  let allEvents = [];   // raw from firestore
  let filtered = [];    // after applying filters/search
  let resources = [];   // [{id,name,branch,type}]
  let regTarget = null; // event object being registered

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
    // YYYY-MM-DD HH:mm (local)
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function monthLabel(d) {
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  function clearAlerts() {
    [regWarn, regErr, regOk].forEach(el => { el.classList.add("d-none"); el.textContent=""; });
  }

  // --- Render
  function render() {
    if (!filtered.length) {
      container.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-calendar-x me-2"></i>No upcoming events match your filters.
        </div>`;
      return;
    }

    // Group by month of start
    const groups = {};
    for (const e of filtered) {
      const d = toDate(e.start);
      if (!d) continue;
      const key = monthKey(d);
      (groups[key] ||= { label: monthLabel(d), events: [] }).events.push(e);
    }

    const parts = [];
    Object.keys(groups).sort().forEach(key => {
      const g = groups[key];
      parts.push(`<div class="month-header">${esc(g.label)}</div>`);
      for (const e of g.events) parts.push(renderEventCard(e));
    });

    container.innerHTML = parts.join("");
    wireRegisterButtons();
  }

  function renderEventCard(e) {
    const start = toDate(e.start);
    const end   = toDate(e.end);
    const dateLine = `${fmtDateTime(start)} – ${fmtDateTime(end)}`;

    const remaining = (typeof e.remaining === "number") ? e.remaining : null;
    const capacity  = (typeof e.capacity === "number") ? e.capacity : null;
    const remainTxt = (remaining != null && capacity != null)
      ? `${remaining}/${capacity} seats left`
      : (remaining != null ? `${remaining} seats left` : "");

    const disableReg = !canRegister(e);
    const btnClass = disableReg ? "btn-secondary" : "btn-primary";
    const btnTitle = disableReg ? "Registration closed or full" : "Register";

    return `
      <div class="event-card">
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-3">
            <div class="event-title">${esc(e.title || "Untitled Event")}</div>
            <div class="event-meta mt-1">
              <span class="me-2"><i class="bi bi-clock"></i> ${esc(dateLine)}</span>
              ${e.resourceName ? `<span class="badge badge-room me-2"><i class="bi bi-building me-1"></i>${esc(e.resourceName)}</span>` : ""}
              ${e.branch ? `<span class="badge badge-branch me-2">${esc(e.branch)}</span>` : ""}
            </div>
            ${e.description ? `<div class="mt-2 text-secondary">${esc(e.description)}</div>` : ""}
          </div>

          <div class="text-end">
            ${remainTxt ? `<div class="small text-muted mb-2">${esc(remainTxt)}</div>` : ""}
            <button class="btn ${btnClass} btn-sm btn-register"
                    data-id="${esc(e._id)}" ${disableReg ? "disabled": ""} title="${esc(btnTitle)}">
              <i class="bi bi-pencil-square me-1"></i> Register
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function wireRegisterButtons() {
    document.querySelectorAll(".btn-register").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const ev = allEvents.find(x => x._id === id);
        if (!ev) return;
        regTarget = ev;

        // Summary
        const s = toDate(ev.start), e = toDate(ev.end);
        regEventSummary.innerHTML = `
          <div><strong>${esc(ev.title || "")}</strong></div>
          <div class="text-secondary small">${esc(ev.resourceName || "")} · ${esc(ev.branch || "")}</div>
          <div class="text-secondary small">${esc(fmtDateTime(s))} – ${esc(fmtDateTime(e))}</div>
        `;

        attendeeName.value = "";
        attendeeEmail.value = "";
        clearAlerts();
        btnSubmitReg.disabled = false;
        regBusy.classList.add("d-none");

        regModal.show();
      });
    });
  }

  // Can this event accept registrations now?
  function canRegister(ev) {
    const now = new Date();
    if (ev.status !== "published" || ev.visibility !== "public") return false;
    if (ev.allowRegistration === false) return false;
    const opens = toDate(ev.regOpensAt);
    const closes = toDate(ev.regClosesAt);
    if (opens && now < opens) return false;
    if (closes && now > closes) return false;
    if (typeof ev.remaining === "number" && ev.remaining <= 0) return false;
    // Prevent registering for past events
    const start = toDate(ev.start);
    if (start && now > start) return false;
    return true;
  }

  // --- Filters/Search
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const brSel = (branchFilter.value || "ALL").toUpperCase();
    const resSel = (resourceFilter.value || "ALL");

    filtered = allEvents.filter(ev => {
      // branch
      const br = (ev.branch || "").toUpperCase();
      if (brSel !== "ALL" && br !== brSel) return false;
      // resource
      if (resSel !== "ALL" && ev.resourceId !== resSel) return false;

      // text search
      if (!q) return true;
      const hay = [
        ev.title, ev.description, ev.resourceName, ev.branch
      ].map(v => (v || "").toString().toLowerCase());
      return hay.some(v => v.includes(q));
    });

    render();
  }

  // --- Data load
  function loadResources() {
    return window.db.collection("resources")
      .orderBy("branch", "asc").orderBy("name", "asc")
      .get()
      .then(snap => {
        resources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // fill dropdown
        const opts = [`<option value="ALL">All Resources</option>`]
          .concat(resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`));
        resourceFilter.innerHTML = opts.join("");
      })
      .catch(err => console.error("resources load error:", err));
  }

  function loadEvents() {
    const now = new Date();
    // upcoming, public, published
    // NOTE: requires composite index on visibility/status/start asc
    return window.db.collection("events")
      .where("visibility", "==", "public")
      .where("status", "==", "published")
      .where("start", ">=", now)
      .orderBy("start", "asc")
      .onSnapshot(snap => {
        allEvents = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        applyFilter();
      }, err => {
        console.error("events snapshot error:", err);
        container.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
      });
  }

  // --- Registration submit: transaction w/ dedupe and capacity check
  regForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlerts();
    btnSubmitReg.disabled = true;
    regBusy.classList.remove("d-none");

    try {
      if (!regTarget) throw new Error("No event selected.");
      const name = attendeeName.value.trim();
      const email = attendeeEmail.value.trim().toLowerCase();
      if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
        throw new Error("Please enter a valid name and email.");
      }

      const eventRef = window.db.collection("events").doc(regTarget._id);
      const regId = `${regTarget._id}_${email}`;
      const regRef = window.db.collection("eventRegistrations").doc(regId);

      await window.db.runTransaction(async (tx) => {
        const [evSnap, regSnap] = await Promise.all([tx.get(eventRef), tx.get(regRef)]);
        if (!evSnap.exists) throw new Error("Event not found.");
        const ev = evSnap.data();

        // Re-evaluate on server snapshot
        if (ev.status !== "published" || ev.visibility !== "public") {
          throw new Error("Registration is closed for this event.");
        }
        const now = new Date();
        const opens = ev.regOpensAt?.toDate ? ev.regOpensAt.toDate() : (ev.regOpensAt ? new Date(ev.regOpensAt) : null);
        const closes = ev.regClosesAt?.toDate ? ev.regClosesAt.toDate() : (ev.regClosesAt ? new Date(ev.regClosesAt) : null);
        if (ev.allowRegistration === false) throw new Error("Registration is not allowed for this event.");
        if (opens && now < opens) throw new Error("Registration has not opened yet.");
        if (closes && now > closes) throw new Error("Registration has closed.");
        const start = ev.start?.toDate ? ev.start.toDate() : (ev.start ? new Date(ev.start) : null);
        if (start && now > start) throw new Error("This event has already started.");

        if (regSnap.exists && regSnap.data().status === "registered") {
          throw new Error("You're already registered for this event.");
        }

        if (typeof ev.remaining === "number" && ev.remaining <= 0) {
          throw new Error("This event is full.");
        }

        // Create/overwrite registration
        tx.set(regRef, {
          eventId: eventRef.id,
          eventTitle: ev.title || "",
          start: ev.start || null,
          attendeeEmail: email,
          attendeeName: name,
          status: "registered",
          createdAt: new Date()
        });

        // Decrement remaining if tracked
        if (typeof ev.remaining === "number") {
          tx.update(eventRef, { remaining: ev.remaining - 1 });
        }
      });

      regOk.classList.remove("d-none");
      regOk.textContent = "Registration successful! Check your email.";
      regWarn.classList.add("d-none");
      regErr.classList.add("d-none");

      // Close after short delay
      setTimeout(() => regModal.hide(), 1200);

    } catch (err) {
      console.error("registration error:", err);
      regErr.textContent = err.message || "Registration failed. Please try again.";
      regErr.classList.remove("d-none");
    } finally {
      regBusy.classList.add("d-none");
      btnSubmitReg.disabled = false;
    }
  });

  // --- Init
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      container.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      return;
    }

    await loadResources();
    loadEvents(); // live updates

    // Wire filters/search
    branchFilter.addEventListener("change", applyFilter);
    resourceFilter.addEventListener("change", applyFilter);
    searchInput.addEventListener("input", () => {
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(applyFilter, 120);
    });
  });
})();
