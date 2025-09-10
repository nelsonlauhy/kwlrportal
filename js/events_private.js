// Private Events (Firestore v8)
// Views: Month / Week / Day / List
// - Shows events where visibility == "private"
// - Address shown under time; Google Maps link + optional inline embed (no API key)
// - Branch filter populated from resources
(function() {
  // ---------- DOM ----------
  const containerList = document.getElementById("eventsContainer");
  const containerCal  = document.getElementById("calendarContainer");
  const branchFilter  = document.getElementById("branchFilter");
  const searchInput   = document.getElementById("searchInput");

  // View controls
  const btnMonth = document.getElementById("btnMonth");
  const btnWeek  = document.getElementById("btnWeek");
  const btnDay   = document.getElementById("btnDay");
  const btnList  = document.getElementById("btnList");
  const btnPrev  = document.getElementById("btnPrev");
  const btnNext  = document.getElementById("btnNext");
  const btnToday = document.getElementById("btnToday");
  const calLabel = document.getElementById("calLabel");

  // Registration modal
  const regModalEl = document.getElementById("regModal");
  const regModal   = new bootstrap.Modal(regModalEl);
  const regForm    = document.getElementById("regForm");
  const regEventSummary = document.getElementById("regEventSummary");
  const attendeeName  = document.getElementById("attendeeName");
  const attendeeEmail = document.getElementById("attendeeEmail");
  const regWarn = document.getElementById("regWarn");
  const regErr  = document.getElementById("regErr");
  const regOk   = document.getElementById("regOk");
  const regBusy = document.getElementById("regBusy");
  const btnSubmitReg = document.getElementById("btnSubmitReg");

  // Event Details modal
  const eventModalEl = document.getElementById("eventModal");
  const eventModal   = new bootstrap.Modal(eventModalEl);
  const evTitleEl    = document.getElementById("evTitle");
  const evMetaEl     = document.getElementById("evMeta");
  const evDateLineEl = document.getElementById("evDateLine");

  // Address + map controls
  const evAddressRow = document.getElementById("evAddressRow");
  const evAddressText = document.getElementById("evAddressText");
  const evMapLink   = document.getElementById("evMapLink");
  const evMapToggle = document.getElementById("evMapToggle");
  const evMapEmbed  = document.getElementById("evMapEmbed");
  const evMapIframe = document.getElementById("evMapIframe");

  const evShortDescEl= document.getElementById("evShortDesc");
  const evDetailDescEl = document.getElementById("evDetailDesc");
  const evCapacityEl = document.getElementById("evCapacity");
  const btnOpenRegister = document.getElementById("btnOpenRegister");

  // ---------- State ----------
  let allEvents = [];
  let filtered  = [];
  let regTarget = null;
  let unsubscribeEvents = null;

  // Cache resource docs (for address lookup)
  const resourceCache = Object.create(null);

  // calendar state
  let currentView = "list";
  let cursorDate  = truncateToDay(new Date());

  // ---------- Utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));
  function stripHtmlToText(html) {
    const tmp = document.createElement("div"); tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").trim();
  }
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
  function truncateToDay(d) { const x=new Date(d); x.setHours(0,0,0,0); return x; }
  function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function monthLabel(d) { return d.toLocaleString(undefined, { month: "long", year: "numeric" }); }
  function normalizeHex(c) {
    if (!c) return "#3b82f6";
    let x = String(c).trim();
    if (!x.startsWith("#")) x = "#" + x;
    if (x.length === 4) x = "#" + x[1]+x[1]+x[2]+x[2]+x[3]+x[3];
    return x.toLowerCase();
  }
  function idealTextColor(bgHex) {
    const h = normalizeHex(bgHex).slice(1);
    const r = parseInt(h.substring(0,2), 16);
    const g = parseInt(h.substring(2,4), 16);
    const b = parseInt(h.substring(4,6), 16);
    const yiq = (r*299 + g*587 + b*114) / 1000;
    return yiq >= 150 ? "#000000" : "#ffffff";
  }
  function clearRegAlerts() {
    [regWarn, regErr, regOk].forEach(el => { el.classList.add("d-none"); el.textContent=""; });
  }

  // ---------- Filters/Search ----------
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const brSel = (branchFilter.value || "ALL").toUpperCase();

    filtered = allEvents.filter(ev => {
      const br = (ev.branch || "").toUpperCase();
      if (brSel !== "ALL" && br !== brSel) return false;

      if (!q) return true;
      const detailTxt = stripHtmlToText(ev.detailDescription || "");
      const hay = [ev.title, ev.description, ev.resourceName, ev.branch, detailTxt]
        .map(v => (v || "").toString().toLowerCase());
      return hay.some(v => v.includes(q));
    });

    render();
  }

  // ---------- RENDER DISPATCH ----------
  function render() {
    [btnMonth,btnWeek,btnDay,btnList].forEach(b=>b.classList.remove("active"));
    if (currentView==="month") btnMonth.classList.add("active");
    else if (currentView==="week") btnWeek.classList.add("active");
    else if (currentView==="day") btnDay.classList.add("active");
    else btnList.classList.add("active");

    if (currentView === "list") {
      renderList();
      calLabel.textContent = "Upcoming";
      containerCal.innerHTML = "";
      return;
    }

    containerList.innerHTML = "";
    if (currentView === "month") renderMonth();
    else if (currentView === "week") renderWeek();
    else renderDay();
  }

  // ---------- LIST VIEW ----------
  function renderList() {
    if (!filtered.length) {
      containerList.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-calendar-x me-2"></i>No upcoming events match your filters.
        </div>`;
      return;
    }
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
    containerList.innerHTML = parts.join("");
  }

  function renderEventCard(e) {
    const start = toDate(e.start);
    const end   = toDate(e.end);
    const dateLine = `${fmtDateTime(start)} – ${fmtDateTime(end)}`;
    const remaining = (typeof e.remaining === "number") ? e.remaining : null;
    theCapacity  = (typeof e.capacity === "number") ? e.capacity : null;
    const remainTxt = (remaining != null && theCapacity != null)
      ? `${remaining}/${theCapacity} seats left`
      : (remaining != null ? `${remaining} seats left` : "");
    const color = normalizeHex(e.color || "#3b82f6");

    return `
      <div class="event-card" data-id="${esc(e._id)}" role="button">
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-3">
            <div class="event-title">
              <span style="display:inline-block;width:.7rem;height:.7rem;border-radius:50%;background:${esc(color)};margin-right:.35rem;"></span>
              ${esc(e.title || "Untitled Event")}
            </div>
            <div class="event-meta mt-1">
              <span class="me-2"><i class="bi bi-clock"></i> ${esc(dateLine)}</span>
              ${e.resourceName ? `<span class="badge badge-room me-2"><i class="bi bi-building me-1"></i>${esc(e.resourceName)}</span>` : ""}
              ${e.branch ? `<span class="badge badge-branch me-2">${esc(e.branch)}</span>` : ""}
            </div>
            ${e.description ? `<div class="mt-2 text-secondary">${esc(e.description)}</div>` : ""}
          </div>
          <div class="text-end">
            ${remainTxt ? `<div class="small text-muted mb-2">${esc(remainTxt)}</div>` : ""}
            <div class="small text-primary">Details &raquo;</div>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- CALENDAR SHARED ----------
  function canRegister(ev) {
    const now = new Date();
    if (ev.status !== "published" || ev.visibility !== "private") return false;
    if (ev.allowRegistration === false) return false;
    const opens = toDate(ev.regOpensAt);
    const closes = toDate(ev.regClosesAt);
    if (opens && now < opens) return false;
    if (closes && now > closes) return false;
    if (typeof ev.remaining === "number" && ev.remaining <= 0) return false;
    const start = toDate(ev.start);
    if (start && now > start) return false;
    return true;
  }
  function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && aEnd > bStart; }
  function eventsInRange(rangeStart, rangeEnd) {
    return filtered.filter(ev => {
      const s = toDate(ev.start); const e = toDate(ev.end);
      if (!s || !e) return false;
      return overlaps(s, e, rangeStart, rangeEnd);
    });
  }

  // ---------- MONTH / WEEK / DAY ----------
  function renderMonth() {
    const year = cursorDate.getFullYear();
    const month = cursorDate.getMonth();

    calLabel.textContent = cursorDate.toLocaleString(undefined,{month:"long", year:"numeric"});

    const firstOfMonth = new Date(year, month, 1);
    const startDow = firstOfMonth.getDay();
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startDow);
    const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);

    const evs = eventsInRange(gridStart, gridEnd);

    const dayMap = {};
    for (const ev of evs) {
      const d = truncateToDay(toDate(ev.start));
      const key = d.toISOString();
      (dayMap[key] ||= []).push(ev);
    }

    const weekdays = [];
    for (let i=0;i<7;i++) {
      const d = new Date(gridStart); d.setDate(gridStart.getDate()+i);
      weekdays.push(`<div class="month-head">${d.toLocaleDateString(undefined,{weekday:"short"})}</div>`);
    }

    const cells = [];
    let iter = new Date(gridStart);
    for (let i=0;i<42;i++) {
      const isOtherMonth = iter.getMonth() !== month;
      const key = truncateToDay(iter).toISOString();
      const items = (dayMap[key] || []).sort((a,b)=> toDate(a.start)-toDate(b.start));
      const dayNum = iter.getDate();

      const evHtml = items.map(e=>{
        const color = normalizeHex(e.color || "#3b82f6");
        const txt = idealTextColor(color);
        const disable = !canRegister(e) ? "full" : "";
        return `<button class="month-evt ${disable}" data-id="${esc(e._id)}"
                        title="${esc(e.title || "")}"
                        style="background:${esc(color)};border-color:${esc(color)};color:${esc(txt)};">
                  ${esc(e.title || "Event")}
                </button>`;
      }).join("");

      cells.push(`
        <div class="month-cell ${isOtherMonth?'other':''}">
          <div class="month-day">${dayNum}</div>
          ${evHtml}
        </div>
      `);
      iter.setDate(iter.getDate()+1);
    }

    containerCal.innerHTML = `
      <div class="month-grid">
        ${weekdays.join("")}
        ${cells.join("")}
      </div>
    `;
  }

  function renderWeek() {
    const start = new Date(cursorDate);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(start.getDate()+7);

    calLabel.textContent =
      `${start.toLocaleDateString(undefined,{month:"short",day:"numeric"})} – ${new Date(end-1).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}`;

    const evs = eventsInRange(start, end);
    const hours = Array.from({length:13}, (_,i)=> i+7); // 07:00 - 19:00

    const cols = [];
    for (let d=0; d<7; d++) {
      const dayDate = new Date(start); dayDate.setDate(start.getDate()+d);
      const dayStart = new Date(dayDate);
      const dayEnd = new Date(dayDate); dayEnd.setDate(dayEnd.getDate()+1);

      const dayEvents = evs.filter(e => {
        const s = toDate(e.start), ee = toDate(e.end);
        return overlaps(s, ee, dayStart, dayEnd);
      }).sort((a,b)=> toDate(a.start)-toDate(b.start));

      const slots = hours.map(()=>`<div class="time-slot"></div>`).join("");

      const pills = dayEvents.map(e=>{
        const s = toDate(e.start), ee = toDate(e.end);
        const startHour = Math.max(0, (s.getHours() - hours[0]) + s.getMinutes()/60);
        const durHours = Math.max(0.7, ((ee - s) / (1000*60*60)));
        const top = Math.min(hours.length-0.7, startHour) * 44;
        const height = Math.min(hours.length*44 - top - 4, Math.max(20, durHours*44 - 6));
        const full = !canRegister(e) ? "full" : "";
        const color = normalizeHex(e.color || "#3b82f6");
        const txt = idealTextColor(color);
        return `<button class="evt-pill ${full}" data-id="${esc(e._id)}"
                       style="top:${top+2}px;height:${height}px;background:${esc(color)};border-color:${esc(color)};color:${esc(txt)}"
                       title="${esc(e.title || "")}">
                  ${esc(e.title || "Event")}
                </button>`;
      }).join("");

      cols.push(`
        <div class="time-col position-relative">
          ${slots}
          ${pills}
        </div>
      `);
    }

    const heads = ['','Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((name,idx)=>{
      if (idx===0) return `<div class="time-head"></div>`;
      const d = new Date(start); d.setDate(start.getDate()+idx-1);
      return `<div class="time-head">${name}<br><span class="muted">${d.getMonth()+1}/${d.getDate()}</span></div>`;
    }).join("");

    const labels = hours.map(h=>`<div class="slot-label">${String(h).padStart(2,"0")}:00</div>`).join("");

    containerCal.innerHTML = `
      <div class="time-grid">
        ${heads}
        <div class="time-col">
          ${labels}
        </div>
        ${cols.join("")}
      </div>
    `;
  }

  function renderDay() {
    const start = truncateToDay(cursorDate);
    const end = new Date(start); end.setDate(start.getDate()+1);

    calLabel.textContent = fmtDate(start);

    const evs = eventsInRange(start, end).sort((a,b)=> toDate(a.start)-toDate(b.start));
    const hours = Array.from({length:13}, (_,i)=> i+7);

    const slots = hours.map(()=>`<div class="time-slot"></div>`).join("");
    const pills = evs.map(e=>{
      const s = toDate(e.start), ee = toDate(e.end);
      const startHour = Math.max(0, (s.getHours() - hours[0]) + s.getMinutes()/60);
      const durHours = Math.max(0.7, ((ee - s) / (1000*60*60)));
      const top = Math.min(hours.length-0.7, startHour) * 44;
      const height = Math.min(hours.length*44 - top - 4, Math.max(20, durHours*44 - 6));
      const full = !canRegister(e) ? "full" : "";
      const color = normalizeHex(e.color || "#3b82f6");
      const txt = idealTextColor(color);
      return `<button class="evt-pill ${full}" data-id="${esc(e._id)}"
                     style="top:${top+2}px;height:${height}px;background:${esc(color)};border-color:${esc(color)};color:${esc(txt)}"
                     title="${esc(e.title || "")}">
                ${esc(e.title || "Event")}
              </button>`;
    }).join("");

    const head = `
      <div class="time-head"></div>
      <div class="time-head" style="grid-column: span 7; text-align:left;">
        ${fmtDate(start)}
      </div>`;

    const labels = hours.map(h=>`<div class="slot-label">${String(h).padStart(2,"0")}:00</div>`).join("");

    containerCal.innerHTML = `
      <div class="time-grid">
        ${head}
        <div class="time-col">
          ${labels}
        </div>
        <div class="time-col position-relative" style="grid-column: span 7;">
          ${slots}
          ${pills}
        </div>
      </div>
    `;
  }

  // ---------- Resource fetch (robust) ----------
  async function fetchResourceDataByAny(ev) {
    const rid = ev.resourceId || ev.resourceID || ev.resource || null;
    const rname = ev.resourceName || null;
    const rbranch = ev.branch || null;

    if (rid && resourceCache[`id:${rid}`]) return resourceCache[`id:${rid}`];
    if (rname && resourceCache[`name:${rname}|${rbranch||""}`]) return resourceCache[`name:${rname}|${rbranch||""}`];

    const col = window.db.collection("resources");

    if (rid) {
      try {
        const snap = await col.doc(rid).get();
        if (snap.exists) {
          const data = snap.data();
          resourceCache[`id:${rid}`] = data;
          return data;
        }
      } catch (_) {}
    }

    if (rid) {
      try {
        const q = await col.where("id","==",rid).limit(1).get();
        if (!q.empty) {
          const data = q.docs[0].data();
          resourceCache[`id:${rid}`] = data;
          return data;
        }
      } catch (_) {}
    }

    if (rname) {
      try {
        const q2 = await col.where("name","==",rname).get();
        if (!q2.empty) {
          const all = q2.docs.map(d => d.data());
          let best = all[0];
          if (rbranch) {
            const exact = all.find(x => (x.branch||"") === rbranch);
            if (exact) best = exact;
          }
          resourceCache[`name:${rname}|${rbranch||""}`] = best;
          return best;
        }
      } catch (_) {}
    }

    return null;
  }

  // ---------- Address & Map UI ----------
  function setMapUIForAddress(addr) {
    if (!evAddressRow) return;

    if (addr) {
      evAddressRow.classList.remove("d-none");
      evAddressText.textContent = addr;

      const q = encodeURIComponent(addr);
      if (evMapLink) {
        evMapLink.href = `https://www.google.com/maps?q=${q}`;
      }

      if (evMapToggle) {
        evMapToggle.textContent = "Show map";
        evMapEmbed.classList.add("d-none");
        if (evMapIframe) evMapIframe.removeAttribute("src");

        evMapToggle.onclick = () => {
          const hidden = evMapEmbed.classList.contains("d-none");
          if (hidden) {
            if (!evMapIframe.getAttribute("src")) {
              evMapIframe.src = `https://www.google.com/maps?q=${q}&output=embed`;
            }
            evMapEmbed.classList.remove("d-none");
            evMapToggle.textContent = "Hide map";
          } else {
            evMapEmbed.classList.add("d-none");
            evMapToggle.textContent = "Show map";
          }
        };
      }
    } else {
      evAddressRow.classList.add("d-none");
      evAddressText.textContent = "";
      if (evMapIframe) evMapIframe.removeAttribute("src");
    }
  }

  // ---------- Event Details Modal ----------
  function openEventDetails(ev) {
    const s = toDate(ev.start), e = toDate(ev.end);
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(e)}`;
    const remainTxt = (typeof ev.remaining === "number" && typeof ev.capacity === "number")
      ? `${ev.remaining}/${ev.capacity} seats left`
      : (typeof ev.remaining === "number" ? `${ev.remaining} seats left` : "");
    const canReg = canRegister(ev);
    const color = normalizeHex(ev.color || "#3b82f6");

    if (evTitleEl) {
      evTitleEl.innerHTML = `
        <span class="me-2" style="display:inline-block;width:.9rem;height:.9rem;border-radius:50%;background:${esc(color)};vertical-align:baseline;"></span>
        ${esc(ev.title || "Event Details")}
      `;
    }

    if (evMetaEl) {
      evMetaEl.innerHTML = `
        ${ev.resourceName ? `<span class="badge badge-room"><i class="bi bi-building me-1"></i>${esc(ev.resourceName)}</span>` : ""}
        ${ev.branch ? `<span class="badge badge-branch">${esc(ev.branch)}</span>` : ""}
        ${ev.status ? `<span class="badge text-bg-light border">${esc(ev.status)}</span>` : ""}
        ${ev.visibility ? `<span class="badge text-bg-light border">${esc(ev.visibility)}</span>` : ""}
      `;
    }

    if (evDateLineEl) evDateLineEl.textContent = dateLine;

    // Address pipeline: event.address -> resource.address -> hide
    if (ev.address) {
      setMapUIForAddress(ev.address);
    } else {
      setMapUIForAddress(null);
      fetchResourceDataByAny(ev).then(data => {
        const addr = data?.address || null;
        setMapUIForAddress(addr);
      });
    }

    if (evShortDescEl) {
      if (ev.description) { evShortDescEl.textContent = ev.description; evShortDescEl.style.display = ""; }
      else { evShortDescEl.style.display = "none"; }
    }

    if (evDetailDescEl) {
      if (ev.detailDescription) { evDetailDescEl.innerHTML = ev.detailDescription; evDetailDescEl.style.display = ""; }
      else { evDetailDescEl.style.display = "none"; }
    }

    if (evCapacityEl) evCapacityEl.textContent = remainTxt || "";

    if (btnOpenRegister) {
      btnOpenRegister.disabled = !canReg;
      btnOpenRegister.onclick = () => {
        regTarget = ev;
        regEventSummary.innerHTML = `
          <div><strong>${esc(ev.title || "")}</strong></div>
          <div class="text-secondary small">${esc(ev.resourceName || "")} · ${esc(ev.branch || "")}</div>
          <div class="text-secondary small">${esc(fmtDateTime(s))} – ${esc(fmtDateTime(e))}</div>
        `;
        attendeeName.value = "";
        attendeeEmail.value = "";
        clearRegAlerts();
        btnSubmitReg.disabled = false;
        regBusy.classList.add("d-none");
        eventModal.hide();
        regModal.show();
      };
    }

    eventModal.show();
  }

  // ---------- Data load ----------
  async function loadBranches() {
    const set = new Set();
    try {
      const resSnap = await window.db.collection("resources").get();
      resSnap.forEach(d => {
        const br = (d.data()?.branch || "").trim();
        if (br) set.add(br);
      });
    } catch (err) {
      console.warn("Failed to read resources for branches:", err);
    }

    if (set.size === 0) {
      try {
        const now = new Date();
        const evSnap = await window.db.collection("events").where("start", ">=", now).get();
        evSnap.forEach(d => {
          const ev = d.data();
          if (ev?.visibility === "private" && ev?.status === "published") {
            const br = (ev.branch || "").trim();
            if (br) set.add(br);
          }
        });
      } catch (err) {
        console.warn("Failed to read events for branches:", err);
      }
    }

    const branches = Array.from(set).sort((a,b)=> a.localeCompare(b));
    const opts = [`<option value="ALL">All locations</option>`]
      .concat(branches.map(b => `<option value="${esc(b)}">${esc(b)}</option>`));
    branchFilter.innerHTML = opts.join("");
  }

  function attachEventsListener() {
    if (typeof unsubscribeEvents === "function") { unsubscribeEvents(); unsubscribeEvents = null; }

    const now = new Date();
    const col = window.db.collection("events");

    try {
      // Composite index: visibility asc, status asc, start asc
      unsubscribeEvents = col
        .where("visibility","==","private")
        .where("status","==","published")
        .where("start",">=", now)
        .orderBy("start","asc")
        .onSnapshot(snap => {
          allEvents = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
          applyFilter();
        }, err => {
          console.warn("private events preferred query error; falling back:", err);
          fallbackEventsListener();
        });
    } catch (err) {
      console.warn("private events preferred query threw; falling back:", err);
      fallbackEventsListener();
    }
  }

  function fallbackEventsListener() {
    const now = new Date();
    const col = window.db.collection("events");

    try {
      unsubscribeEvents = col
        .where("start", ">=", now)
        .orderBy("start", "asc")
        .onSnapshot(snap => {
          const rows = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
          allEvents = rows.filter(ev => ev.visibility === "private" && ev.status === "published");
          applyFilter();
        }, err => {
          console.error("private events fallback failed; trying one-time get:", err);
          col.where("start", ">=", now).orderBy("start","asc").get().then(snap2 => {
            const rows2 = snap2.docs.map(d => ({ _id: d.id, ...d.data() }));
            allEvents = rows2.filter(ev => ev.visibility === "private" && ev.status === "published");
            applyFilter();
          }).catch(err2 => {
            console.error("private events one-time fallback failed:", err2);
            containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load private events.</div>`;
          });
        });
    } catch (err) {
      console.error("private events fallback threw:", err);
      containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load private events.</div>`;
    }
  }

  // ---------- Registration submit ----------
  regForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearRegAlerts();
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

        if (ev.status !== "published" || ev.visibility !== "private") {
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

        tx.set(regRef, {
          eventId: eventRef.id,
          eventTitle: ev.title || "",
          start: ev.start || null,
          attendeeEmail: email,
          attendeeName: name,
          status: "registered",
          createdAt: new Date()
        });

        if (typeof ev.remaining === "number") {
          tx.update(eventRef, { remaining: ev.remaining - 1 });
        }
      });

      regOk.classList.remove("d-none");
      regOk.textContent = "Registration successful! Check your email.";
      regErr.classList.add("d-none");

      window.dispatchEvent(new CustomEvent("event:registered", {
        detail: { event: regTarget, attendee: { name, email } }
      }));

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

  // ---------- View navigation ----------
  function gotoToday(){ cursorDate = truncateToDay(new Date()); render(); }
  function prevPeriod(){
    if (currentView === "month"){ const d=new Date(cursorDate); d.setMonth(d.getMonth()-1); cursorDate=truncateToDay(d); }
    else if (currentView === "week"){ const d=new Date(cursorDate); d.setDate(d.getDate()-7); cursorDate=truncateToDay(d); }
    else if (currentView === "day"){ const d=new Date(cursorDate); d.setDate(d.getDate()-1); cursorDate=truncateToDay(d); }
    render();
  }
  function nextPeriod(){
    if (currentView === "month"){ const d=new Date(cursorDate); d.setMonth(d.getMonth()+1); cursorDate=truncateToDay(d); }
    else if (currentView === "week"){ const d=new Date(cursorDate); d.setDate(d.getDate()+7); cursorDate=truncateToDay(d); }
    else if (currentView === "day"){ const d=new Date(cursorDate); d.setDate(d.getDate()+1); cursorDate=truncateToDay(d); }
    render();
  }

  // ---------- Event Delegation ----------
  document.addEventListener("click", (ev) => {
    const card = ev.target.closest(".event-card");
    const monthBtn = ev.target.closest(".month-evt");
    const pill = ev.target.closest(".evt-pill");
    const el = card || monthBtn || pill;
    if (!el) return;
    const id = el.getAttribute("data-id");
    if (!id) return;
    const eventObj = allEvents.find(x => x._id === id);
    if (!eventObj) return;
    openEventDetails(eventObj);
  });

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      containerList.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      return;
    }

    await loadBranches();
    attachEventsListener();

    branchFilter.addEventListener("change", applyFilter);
    searchInput.addEventListener("input", () => {
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(applyFilter, 120);
    });

    btnMonth.addEventListener("click", () => { currentView="month"; render(); });
    btnWeek .addEventListener("click", () => { currentView="week";  render(); });
    btnDay  .addEventListener("click", () => { currentView="day";   render(); });
    btnList .addEventListener("click", () => { currentView="list";  render(); });

    btnToday.addEventListener("click", gotoToday);
    btnPrev .addEventListener("click", prevPeriod);
    btnNext .addEventListener("click", nextPeriod);
  });
})();
