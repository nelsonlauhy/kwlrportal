// Public Events (Firestore v8)
// Views: Month / Week / Day / List
// - Force default month view on load
// - Reset view on pageshow to avoid browser restoring old list view
// - Supports branch filter, search, modal detail, registration

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
  const regModal   = regModalEl ? new bootstrap.Modal(regModalEl) : null;
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
  const eventModal   = eventModalEl ? new bootstrap.Modal(eventModalEl) : null;
  const evTitleEl    = document.getElementById("evTitle");
  const evMetaEl     = document.getElementById("evMeta");
  const evDateLineEl = document.getElementById("evDateLine");
  const evShortDescEl= document.getElementById("evShortDesc");
  const evDetailDescEl = document.getElementById("evDetailDesc");
  const evCapacityEl = document.getElementById("evCapacity");
  const btnOpenRegister = document.getElementById("btnOpenRegister");

  // Banner in modal
  const evBannerBox = document.getElementById("evBannerBox");
  const evBannerImg = document.getElementById("evBannerImg");

  // Address + map controls
  const evAddressRow  = document.getElementById("evAddressRow");
  const evAddressText = document.getElementById("evAddressText");
  const evMapLink     = document.getElementById("evMapLink");
  const evMapToggle   = document.getElementById("evMapToggle");
  const evMapEmbed    = document.getElementById("evMapEmbed");
  const evMapIframe   = document.getElementById("evMapIframe");

  // ---------- Config ----------
  const MAPS_EMBED_API_KEY =
    (typeof window !== "undefined" && window.MAPS_EMBED_API_KEY)
      ? String(window.MAPS_EMBED_API_KEY)
      : null;

  const MAP_MODE = "auto"; // "auto" | "link"

  // ---------- State ----------
  let allEvents = [];
  let filtered  = [];
  let unsubscribeEvents = null;

  const resourceCache = Object.create(null);

  // Force default state
  let currentView = "month";
  let cursorDate  = truncateToDay(new Date());
  let showPastEvents = false;

  let regTarget = null;

  // ---------- Utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));

  function stripHtmlToText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
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
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDate(d) {
    if (!d) return "";
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function truncateToDay(d) {
    const x = new Date(d);
    x.setHours(0,0,0,0);
    return x;
  }

  function monthLabel(d) {
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  function normalizeHex(c) {
    if (!c) return "#3b82f6";
    let x = String(c).trim();
    if (!x.startsWith("#")) x = "#" + x;
    if (x.length === 4) x = "#" + x[1]+x[1]+x[2]+x[2]+x[3]+x[3];
    return x.toLowerCase();
  }

  function idealTextColor(bgHex) {
    const h = normalizeHex(bgHex).slice(1);
    const r = parseInt(h.substring(0,2),16);
    const g = parseInt(h.substring(2,4),16);
    const b = parseInt(h.substring(4,6),16);
    const yiq = (r*299 + g*587 + b*114) / 1000;
    return yiq >= 150 ? "#000000" : "#ffffff";
  }

  function ensureHttps(url) {
    let s = String(url || "").trim();
    if (!s) return "";
    if (s.startsWith("ttps://")) s = "h" + s;
    if (/^gs:\/\//i.test(s)) return "";
    if (!/^https?:\/\//i.test(s) && !s.startsWith("/")) s = "https://" + s;
    return s;
  }

  function clearRegAlerts() {
    [regWarn, regErr, regOk].forEach(el => {
      if (!el) return;
      el.classList.add("d-none");
      el.textContent = "";
    });
  }

  function isPastEvent(ev) {
    const now = new Date();
    const end = toDate(ev.end) || toDate(ev.start);
    return !!(end && end < now);
  }

  function canRegister(ev) {
    const now = new Date();
    const opens = toDate(ev.regOpensAt);
    const closes = toDate(ev.regClosesAt);
    const start = toDate(ev.start);

    if (ev.allowRegistration === false) return false;
    if (opens && now < opens) return false;
    if (closes && now > closes) return false;
    if (start && now > start) return false;
    if (typeof ev.remaining === "number" && ev.remaining <= 0) return false;
    return true;
  }

  function getEventDisplayColors(ev, fallbackDisabled = false) {
    const past = isPastEvent(ev);
    if (past) {
      return { bg: "#e5e7eb", border: "#d1d5db", text: "#6b7280", past: true, disabled: true };
    }
    const disabled = fallbackDisabled || !canRegister(ev);
    if (disabled) {
      return { bg: "#f1f5f9", border: "#e2e8f0", text: "#64748b", past: false, disabled: true };
    }
    const bg = normalizeHex(ev.color || "#3b82f6");
    return { bg, border: bg, text: idealTextColor(bg), past: false, disabled: false };
  }

  function injectPastEventStyles() {
    if (document.getElementById("past-event-style-patch")) return;
    const style = document.createElement("style");
    style.id = "past-event-style-patch";
    style.textContent = `
      .month-evt.past,
      .evt-pill.past {
        background:#e5e7eb !important;
        border-color:#d1d5db !important;
        color:#6b7280 !important;
      }
      .event-card.past {
        background:#f8fafc;
        border:1px solid #e5e7eb;
        opacity:.96;
      }
      .event-card.past .event-title,
      .event-card.past .event-meta,
      .event-card.past .text-secondary,
      .event-card.past .small {
        color:#6b7280 !important;
      }
      .event-card.past .badge-room,
      .event-card.past .badge-branch {
        background:#eef2f7 !important;
        color:#6b7280 !important;
        border-color:#d1d5db !important;
      }
    `;
    document.head.appendChild(style);
  }

  function pickBannerUrl(ev) {
    const nested = (obj, path) => {
      try {
        return path.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), obj);
      } catch (_) {
        return undefined;
      }
    };

    const candidates = [
      ev.bannerThumbUrl,
      ev.bannerUrl,
      nested(ev,"banner.thumbUrl"),
      nested(ev,"banner.url"),
      ev.imageThumbUrl,
      ev.imageUrl,
      ev.coverThumbUrl,
      ev.coverUrl,
      ev.thumbnail,
      ev.thumbnailUrl
    ].filter(Boolean);

    for (const raw of candidates) {
      const u = ensureHttps(raw);
      if (u) return u;
    }
    return "";
  }

  function pickBannerUrlFull(ev) {
    const nested = (obj, path) => {
      try {
        return path.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), obj);
      } catch (_) {
        return undefined;
      }
    };

    const candidates = [
      ev.bannerUrl,
      nested(ev,"banner.url"),
      ev.imageUrl,
      ev.coverUrl,
      ev.thumbnailUrl,
      ev.bannerThumbUrl,
      nested(ev,"banner.thumbUrl"),
      ev.imageThumbUrl,
      ev.coverThumbUrl,
      ev.thumbnail
    ].filter(Boolean);

    for (const raw of candidates) {
      const u = ensureHttps(raw);
      if (u) return u;
    }
    return "";
  }

  // ---------- Map helpers ----------
  function pickAddrMeta(ev, res) {
    const meta = {
      address     : ev.address ?? res?.address ?? null,
      hmapsUrl    : ensureHttps(ev.hmapsUrl ?? res?.hmapsUrl ?? ""),
      mapsUrl     : ensureHttps(ev.mapsUrl  ?? res?.mapsUrl  ?? ""),
      mapsPlaceId : ev.mapsPlaceId ?? res?.mapsPlaceId ?? null,
      lat         : (ev.lat ?? res?.lat ?? null),
      lng         : (ev.lng ?? res?.lng ?? null),
      label       : (ev.resourceName || ev.title || res?.name || "Location")
    };

    if (meta.lat != null) meta.lat = Number(meta.lat);
    if (meta.lng != null) meta.lng = Number(meta.lng);
    if (!meta.hmapsUrl) delete meta.hmapsUrl;
    if (!meta.mapsUrl) delete meta.mapsUrl;

    return meta;
  }

  function buildMapTargets(meta) {
    const labelPart = meta.label ? encodeURIComponent(meta.label) : "";
    const addrPart  = meta.address ? encodeURIComponent(meta.address) : "";

    let linkUrl = "";
    if (meta.hmapsUrl) linkUrl = meta.hmapsUrl;
    else if (meta.mapsUrl) linkUrl = meta.mapsUrl;
    else if (meta.mapsPlaceId) linkUrl = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(meta.mapsPlaceId)}`;
    else if (isFinite(meta.lat) && isFinite(meta.lng)) linkUrl = `https://www.google.com/maps?q=${meta.lat},${meta.lng}`;
    else if (meta.address) linkUrl = `https://www.google.com/maps?q=${labelPart ? labelPart + "%20" : ""}${addrPart}`;

    let embedUrl = null;
    if (MAP_MODE !== "link") {
      if (MAPS_EMBED_API_KEY && meta.mapsPlaceId) {
        embedUrl = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(MAPS_EMBED_API_KEY)}&q=place_id:${encodeURIComponent(meta.mapsPlaceId)}`;
      } else if (MAPS_EMBED_API_KEY && isFinite(meta.lat) && isFinite(meta.lng)) {
        embedUrl = `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(MAPS_EMBED_API_KEY)}&center=${meta.lat},${meta.lng}&zoom=16&maptype=roadmap`;
      } else if (meta.address) {
        embedUrl = `https://www.google.com/maps?q=${addrPart}&output=embed`;
      }
    }

    return { linkUrl, embedUrl, hasEmbed: !!embedUrl };
  }

  function setMapUI(meta) {
    if (!evAddressRow) return;

    const nothing =
      !meta.address && !meta.hmapsUrl && !meta.mapsUrl &&
      !(isFinite(meta.lat) && isFinite(meta.lng)) && !meta.mapsPlaceId;

    if (nothing) {
      evAddressRow.classList.add("d-none");
      if (evAddressText) evAddressText.textContent = "";
      if (evMapEmbed) evMapEmbed.classList.add("d-none");
      if (evMapToggle) evMapToggle.classList.add("d-none");
      if (evMapIframe) evMapIframe.src = "about:blank";
      return;
    }

    evAddressRow.classList.remove("d-none");
    if (evAddressText) evAddressText.textContent = meta.address || "Location available";

    const { linkUrl, embedUrl, hasEmbed } = buildMapTargets(meta);

    if (evMapLink) {
      evMapLink.href = linkUrl || "#";
      evMapLink.classList.toggle("disabled", !linkUrl);
      evMapLink.setAttribute("aria-disabled", String(!linkUrl));
    }

    if (evMapToggle) {
      evMapToggle.classList.toggle("d-none", !hasEmbed);
      evMapToggle.onclick = null;
    }

    if (evMapEmbed) evMapEmbed.classList.add("d-none");
    if (evMapIframe) evMapIframe.src = "about:blank";

    if (hasEmbed && evMapToggle && evMapEmbed && evMapIframe) {
      evMapToggle.onclick = () => {
        const opening = evMapEmbed.classList.contains("d-none");
        if (opening) {
          evMapIframe.src = embedUrl;
          evMapEmbed.classList.remove("d-none");
          evMapToggle.innerHTML = `<i class="bi bi-chevron-up"></i> Hide map`;
        } else {
          evMapEmbed.classList.add("d-none");
          evMapIframe.src = "about:blank";
          evMapToggle.innerHTML = `<i class="bi bi-map"></i> View map`;
        }
      };
      evMapToggle.innerHTML = `<i class="bi bi-map"></i> View map`;
    }
  }

  async function fetchResourceDataByAny(ev) {
    const idsToTry = [];
    const namesToTry = [];

    if (ev.resourceId) idsToTry.push(String(ev.resourceId));
    if (ev.resourceID) idsToTry.push(String(ev.resourceID));
    if (ev.resourceName) namesToTry.push(String(ev.resourceName));

    for (const id of idsToTry) {
      if (resourceCache[id]) return resourceCache[id];
      try {
        const snap = await window.db.collection("resources").doc(id).get();
        if (snap.exists) {
          const data = { id: snap.id, ...snap.data() };
          resourceCache[id] = data;
          return data;
        }
      } catch (_) {}
    }

    for (const name of namesToTry) {
      if (resourceCache[name]) return resourceCache[name];
      try {
        const qs = await window.db.collection("resources").where("name", "==", name).limit(1).get();
        if (!qs.empty) {
          const d = qs.docs[0];
          const data = { id: d.id, ...d.data() };
          resourceCache[name] = data;
          return data;
        }
      } catch (_) {}
    }

    return null;
  }

  // ---------- Filter ----------
  function applyFilter() {
    const q = (searchInput?.value || "").toLowerCase().trim();
    const brSel = (branchFilter?.value || "ALL").toUpperCase();
    const now = new Date();

    filtered = allEvents.filter(ev => {
      const br = (ev.branch || "").toUpperCase();
      if (brSel !== "ALL" && br !== brSel) return false;

      const end = toDate(ev.end) || toDate(ev.start);
      const isPast = end && end < now;
      if (!showPastEvents && isPast) return false;

      if (!q) return true;

      const detailTxt = stripHtmlToText(ev.detailDescription || "");
      const hay = [ev.title, ev.description, ev.resourceName, ev.branch, detailTxt]
        .map(v => (v || "").toString().toLowerCase());

      return hay.some(v => v.includes(q));
    });

    render();
  }

  // ---------- Date helpers ----------
  function startOfWeek(d) {
    const x = truncateToDay(d);
    const day = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - day);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function sameDay(a, b) {
    return a && b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function overlaps(evStart, evEnd, rangeStart, rangeEnd) {
    const s = evStart ? evStart.getTime() : 0;
    const e = evEnd ? evEnd.getTime() : s;
    return s < rangeEnd.getTime() && e > rangeStart.getTime();
  }

  function activeViewButton() {
    [btnMonth, btnWeek, btnDay, btnList].forEach(b => {
      if (b) b.classList.remove("active");
    });

    const activeBtnMap = {
      month: btnMonth,
      week: btnWeek,
      day: btnDay,
      list: btnList
    };

    const activeBtn = activeBtnMap[currentView] || btnMonth;
    if (activeBtn) activeBtn.classList.add("active");
  }

  function forceDefaultMonthView() {
    currentView = "month";
    cursorDate = truncateToDay(new Date());

    if (containerList) containerList.style.display = "none";
    if (containerCal) containerCal.style.display = "";

    render();
  }

  // ---------- List ----------
  function renderEventCard(e) {
    const s = toDate(e.start);
    const en = toDate(e.end);
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(en)}`;
    const canReg = canRegister(e);
    const detailTxt = stripHtmlToText(e.detailDescription || "");
    const hasShort = !!(e.description && String(e.description).trim());
    const hasDetail = !!detailTxt;
    const location = e.resourceName || "";
    const branch = e.branch || "";
    const badgeCap = (typeof e.capacity === "number") ? `Capacity: ${e.capacity}` : "";
    const badgeSeats = (typeof e.remaining === "number") ? `Seats left: ${e.remaining}` : "";
    const regBtnLabel = canReg ? "Register" : "Closed";
    const banner = pickBannerUrl(e);

    const display = getEventDisplayColors(e, !canReg);
    const cardCls = display.past ? "event-card past" : "event-card";

    return `
      <div class="${cardCls}" data-id="${esc(e._id)}" role="button" aria-label="${esc(e.title || 'Event')}">
        <div class="event-card-inner">
          ${banner ? `
            <div class="event-banner-wrap">
              <img class="event-banner-img" src="${esc(banner)}" alt="${esc(e.title || "Event banner")}" loading="lazy">
            </div>
          ` : ``}

          <div class="event-body">
            <div class="event-head">
              <div>
                <div class="event-title">${esc(e.title || "Untitled Event")}</div>
                <div class="event-meta">
                  <span><i class="bi bi-calendar-event"></i> ${esc(dateLine)}</span>
                </div>
              </div>
              <div class="event-head-actions">
                ${location ? `<span class="badge badge-room">${esc(location)}</span>` : ``}
                ${branch ? `<span class="badge badge-branch">${esc(branch)}</span>` : ``}
              </div>
            </div>

            ${hasShort ? `<div class="mt-2">${esc(e.description)}</div>` : ``}
            ${hasDetail ? `<div class="mt-2 text-secondary small">${esc(detailTxt.length > 180 ? detailTxt.slice(0,180) + "…" : detailTxt)}</div>` : ``}

            <div class="event-footer">
              <div class="small text-secondary">
                ${badgeCap ? `<span class="me-3">${esc(badgeCap)}</span>` : ``}
                ${badgeSeats ? `<span>${esc(badgeSeats)}</span>` : ``}
              </div>
              <button type="button" class="btn btn-sm ${canReg ? 'btn-primary' : 'btn-outline-secondary'}"
                data-open-register="${esc(e._id)}" ${canReg ? "" : "disabled"}>
                ${esc(regBtnLabel)}
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderList() {
    if (containerCal) containerCal.style.display = "none";
    if (containerList) containerList.style.display = "grid";

    if (!filtered.length) {
      if (containerList) {
        containerList.innerHTML = `<div class="text-center text-secondary py-5">No events found.</div>`;
      }
      if (calLabel) calLabel.textContent = showPastEvents ? "All Events" : "Upcoming Events";
      return;
    }

    const rows = filtered
      .slice()
      .sort((a,b)=> (toDate(a.start)?.getTime()||0) - (toDate(b.start)?.getTime()||0))
      .map(renderEventCard)
      .join("");

    if (containerList) containerList.innerHTML = rows;
    if (calLabel) calLabel.textContent = showPastEvents ? "All Events" : "Upcoming Events";
  }

  // ---------- Month ----------
  function renderMonth() {
    if (containerList) containerList.style.display = "none";
    if (containerCal) containerCal.style.display = "";

    const y = cursorDate.getFullYear();
    const m = cursorDate.getMonth();
    const first = new Date(y, m, 1);
    const next = new Date(y, m + 1, 1);
    const gridStart = startOfWeek(first);
    const gridEnd = addDays(startOfWeek(next), 7 * 6);

    const events = filtered.filter(ev =>
      overlaps(toDate(ev.start), toDate(ev.end) || toDate(ev.start), gridStart, gridEnd)
    );

    const byDay = Object.create(null);
    for (const ev of events) {
      const s = toDate(ev.start);
      const e = toDate(ev.end) || s;
      let d = truncateToDay(s);
      const last = truncateToDay(e);

      while (d <= last) {
        const k = fmtDateTime(d).slice(0,10);
        (byDay[k] ||= []).push(ev);
        d = addDays(d, 1);
      }
    }

    let html = `<div class="month-grid">`;

    const weekdays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    html += weekdays.map(w => `<div class="month-weekday">${w}</div>`).join("");

    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const inMonth = d.getMonth() === m;
      const today = sameDay(d, new Date());
      const k = fmtDateTime(d).slice(0,10);

      const items = (byDay[k] || []).slice()
        .sort((a,b)=> (toDate(a.start)?.getTime()||0) - (toDate(b.start)?.getTime()||0));

      const evHtml = items.map(e => {
        const display = getEventDisplayColors(e);
        const disable = display.disabled ? "full" : "";
        const pastCls = display.past ? "past" : "";

        return `<button class="month-evt ${disable} ${pastCls}" data-id="${esc(e._id)}"
                  title="${esc(e.title || "")}"
                  style="background:${esc(display.bg)};border-color:${esc(display.border)};color:${esc(display.text)};">
            ${esc(e.title || "Event")}
          </button>`;
      }).join("");

      html += `
        <div class="month-cell ${inMonth ? "" : "muted"} ${today ? "today" : ""}">
          <div class="month-daynum">${d.getDate()}</div>
          <div class="month-events">${evHtml}</div>
        </div>`;
    }

    html += `</div>`;
    if (containerCal) containerCal.innerHTML = html;
    if (calLabel) calLabel.textContent = monthLabel(cursorDate);
  }

  // ---------- Week ----------
  function renderWeek() {
    if (containerList) containerList.style.display = "none";
    if (containerCal) containerCal.style.display = "";

    const start = new Date(cursorDate);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    if (calLabel) {
      calLabel.textContent =
        `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(end - 1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }

    const evs = filtered.filter(ev => {
      const s = toDate(ev.start);
      const ee = toDate(ev.end) || s;
      if (!s || !ee) return false;
      return s < end && ee > start;
    });

    const hours = Array.from({ length: 13 }, (_, i) => i + 7);

    const cols = [];
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(start);
      dayDate.setDate(start.getDate() + d);

      const dayStart = new Date(dayDate);
      const dayEnd = new Date(dayDate);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const dayEvents = evs.filter(e => {
        const s = toDate(e.start);
        const ee = toDate(e.end) || s;
        return s && ee && s < dayEnd && ee > dayStart;
      }).sort((a,b)=> (toDate(a.start)?.getTime()||0) - (toDate(b.start)?.getTime()||0));

      const slots = hours.map(() => `<div class="time-slot"></div>`).join("");

      const pills = dayEvents.map(e => {
        const s = toDate(e.start);
        const ee = toDate(e.end) || new Date(s.getTime() + 60 * 60 * 1000);
        const startHour = s.getHours() + s.getMinutes() / 60;
        const durHours = Math.max(0.5, (ee - s) / (1000 * 60 * 60));
        const top = (startHour - 7) * 44;
        const height = Math.max(20, durHours * 44 - 6);

        const display = getEventDisplayColors(e);
        const full = display.disabled ? "full" : "";
        const pastCls = display.past ? "past" : "";

        return `<button class="evt-pill ${full} ${pastCls}" data-id="${esc(e._id)}"
                      style="top:${top + 2}px;height:${height}px;background:${esc(display.bg)};border-color:${esc(display.border)};color:${esc(display.text)}"
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

    const heads = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, idx) => {
      if (idx === 0) return `<div class="time-head"></div>`;
      const d = new Date(start);
      d.setDate(start.getDate() + idx - 1);
      return `<div class="time-head">${name}<br><span class="muted">${d.getMonth()+1}/${d.getDate()}</span></div>`;
    }).join("");

    const labels = hours.map(h => `<div class="slot-label">${String(h).padStart(2, "0")}:00</div>`).join("");

    if (containerCal) {
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
  }

  // ---------- Day ----------
  function renderDay() {
    if (containerList) containerList.style.display = "none";
    if (containerCal) containerCal.style.display = "";

    const start = truncateToDay(cursorDate);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);

    if (calLabel) calLabel.textContent = fmtDate(start);

    const evs = filtered.filter(ev => {
      const s = toDate(ev.start);
      const ee = toDate(ev.end) || s;
      if (!s || !ee) return false;
      return s < end && ee > start;
    }).sort((a,b)=> (toDate(a.start)?.getTime()||0) - (toDate(b.start)?.getTime()||0));

    const hours = Array.from({ length: 13 }, (_, i) => i + 7);
    const slots = hours.map(() => `<div class="time-slot"></div>`).join("");

    const pills = evs.map(e => {
      const s = toDate(e.start);
      const ee = toDate(e.end) || new Date(s.getTime() + 60 * 60 * 1000);
      const startHour = s.getHours() + s.getMinutes() / 60;
      const durHours = Math.max(0.5, (ee - s) / (1000 * 60 * 60));
      const top = (startHour - 7) * 44;
      const height = Math.max(20, durHours * 44 - 6);

      const display = getEventDisplayColors(e);
      const full = display.disabled ? "full" : "";
      const pastCls = display.past ? "past" : "";

      return `<button class="evt-pill ${full} ${pastCls}" data-id="${esc(e._id)}"
                    style="top:${top + 2}px;height:${height}px;background:${esc(display.bg)};border-color:${esc(display.border)};color:${esc(display.text)}"
                    title="${esc(e.title || "")}">
                ${esc(e.title || "Event")}
              </button>`;
    }).join("");

    const head = `
      <div class="time-head"></div>
      <div class="time-head" style="grid-column: span 7; text-align:left;">
        ${fmtDate(start)}
      </div>`;

    const labels = hours.map(h => `<div class="slot-label">${String(h).padStart(2, "0")}:00</div>`).join("");

    if (containerCal) {
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
  }

  // ---------- Master render ----------
  function render() {
    activeViewButton();

    if (currentView === "month") return renderMonth();
    if (currentView === "week") return renderWeek();
    if (currentView === "day") return renderDay();
    return renderList();
  }

  // ---------- Event detail ----------
  function openEventDetails(ev) {
    const s = toDate(ev.start);
    const e = toDate(ev.end) || s;
    const canReg = canRegister(ev);

    if (evTitleEl) evTitleEl.textContent = ev.title || "Event";
    if (evMetaEl) evMetaEl.textContent = [ev.resourceName, ev.branch].filter(Boolean).join(" · ");
    if (evDateLineEl) evDateLineEl.textContent = `${fmtDateTime(s)} – ${fmtDateTime(e)}`;

    const bannerFull = pickBannerUrlFull(ev);
    if (evBannerBox && evBannerImg) {
      if (bannerFull) {
        evBannerImg.src = bannerFull;
        evBannerImg.alt = ev.title || "Event banner";
        evBannerBox.classList.remove("d-none");
      } else {
        evBannerImg.removeAttribute("src");
        evBannerImg.alt = "";
        evBannerBox.classList.add("d-none");
      }
    }

    const applyMeta = (resData) => {
      const meta = pickAddrMeta(ev, resData);
      setMapUI(meta);
    };

    if (ev.address || ev.hmapsUrl || ev.mapsUrl || ev.mapsPlaceId || (isFinite(ev.lat) && isFinite(ev.lng))) {
      applyMeta(null);
    } else {
      fetchResourceDataByAny(ev).then(applyMeta).catch(() => setMapUI({}));
    }

    if (evShortDescEl) {
      if (ev.description) {
        evShortDescEl.textContent = ev.description;
        evShortDescEl.style.display = "";
      } else {
        evShortDescEl.style.display = "none";
      }
    }

    if (evDetailDescEl) {
      if (ev.detailDescription) {
        evDetailDescEl.innerHTML = ev.detailDescription;
        evDetailDescEl.style.display = "";
      } else {
        evDetailDescEl.style.display = "none";
      }
    }

    if (evCapacityEl) {
      evCapacityEl.textContent = "";
      evCapacityEl.style.display = "none";
    }

    if (btnOpenRegister) {
      btnOpenRegister.disabled = !canReg;
      btnOpenRegister.onclick = () => {
        regTarget = ev;

        if (regEventSummary) {
          regEventSummary.innerHTML = `
            <div><strong>${esc(ev.title || "")}</strong></div>
            <div class="text-secondary small">${esc(ev.resourceName || "")} · ${esc(ev.branch || "")}</div>
            <div class="text-secondary small">${esc(fmtDateTime(s))} – ${esc(fmtDateTime(e))}</div>`;
        }

        if (attendeeName) attendeeName.value = "";
        if (attendeeEmail) attendeeEmail.value = "";

        clearRegAlerts();
        if (btnSubmitReg) btnSubmitReg.disabled = false;
        if (regBusy) regBusy.classList.add("d-none");

        if (eventModal) eventModal.hide();
        if (regModal) regModal.show();
      };
    }

    if (eventModal) eventModal.show();
  }

  // ---------- Data ----------
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
        const evSnap = await window.db.collection("events")
          .where("visibility", "==", "public")
          .where("status", "==", "published")
          .get();

        evSnap.forEach(d => {
          const ev = d.data();
          const br = (ev?.branch || "").trim();
          if (br) set.add(br);
        });
      } catch (err) {
        console.warn("Failed to read events for branches:", err);
      }
    }

    const branches = Array.from(set).sort((a,b)=> a.localeCompare(b));
    const opts = [`<option value="ALL">All locations</option>`]
      .concat(branches.map(b => `<option value="${esc(b)}">${esc(b)}</option>`));

    if (branchFilter) branchFilter.innerHTML = opts.join("");
  }

  function attachEventsListener() {
    if (typeof unsubscribeEvents === "function") {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }

    const col = window.db.collection("events");
    const query = col
      .where("visibility", "==", "public")
      .where("status", "==", "published")
      .orderBy("start", "desc");

    try {
      unsubscribeEvents = query.onSnapshot(snap => {
        allEvents = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        applyFilter();
      }, err => {
        console.warn("Query failed, falling back:", err);
        fallbackEventsListener();
      });
    } catch (err) {
      console.warn("Query setup error:", err);
      fallbackEventsListener();
    }
  }

  function fallbackEventsListener() {
    const col = window.db.collection("events");

    try {
      unsubscribeEvents = col.onSnapshot(snap => {
        const rows = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        allEvents = rows
          .filter(ev => ev.visibility === "public" && ev.status === "published")
          .sort((a,b)=> {
            const da = toDate(a.start)?.getTime() || 0;
            const db = toDate(b.start)?.getTime() || 0;
            return db - da;
          });

        applyFilter();
      });
    } catch (err) {
      console.error("Fallback failed:", err);
    }
  }

  // ---------- Registration ----------
  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearRegAlerts();
      if (btnSubmitReg) btnSubmitReg.disabled = true;
      if (regBusy) regBusy.classList.remove("d-none");

      try {
        if (!regTarget) throw new Error("No event selected.");

        const name = attendeeName?.value.trim() || "";
        const email = (attendeeEmail?.value || "").trim().toLowerCase();

        if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
          throw new Error("Please enter a valid name and email.");
        }

        const eventRef = window.db.collection("events").doc(regTarget._id);
        const regId = `${regTarget._id}_${email}`;
        const regRef = window.db.collection("eventRegistrations").doc(regId);

        await window.db.runTransaction(async (tx) => {
          const [evSnap, regSnap] = await Promise.all([
            tx.get(eventRef),
            tx.get(regRef)
          ]);

          if (!evSnap.exists) throw new Error("Event not found.");
          const ev = evSnap.data();

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

        if (regOk) {
          regOk.classList.remove("d-none");
          regOk.textContent = "Registration successful! Check your email.";
        }

        if (regErr) regErr.classList.add("d-none");

        window.dispatchEvent(new CustomEvent("event:registered", {
          detail: { event: regTarget, attendee: { name, email } }
        }));

        setTimeout(() => {
          if (regModal) regModal.hide();
        }, 1200);

      } catch (err) {
        console.error("registration error:", err);
        if (regErr) {
          regErr.textContent = err.message || "Registration failed. Please try again.";
          regErr.classList.remove("d-none");
        }
      } finally {
        if (regBusy) regBusy.classList.add("d-none");
        if (btnSubmitReg) btnSubmitReg.disabled = false;
      }
    });
  }

  // ---------- Navigation ----------
  function gotoToday() {
    cursorDate = truncateToDay(new Date());
    render();
  }

  function prevPeriod() {
    if (currentView === "month") {
      const d = new Date(cursorDate);
      d.setMonth(d.getMonth() - 1);
      cursorDate = truncateToDay(d);
    } else if (currentView === "week") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() - 7);
      cursorDate = truncateToDay(d);
    } else if (currentView === "day") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() - 1);
      cursorDate = truncateToDay(d);
    }
    render();
  }

  function nextPeriod() {
    if (currentView === "month") {
      const d = new Date(cursorDate);
      d.setMonth(d.getMonth() + 1);
      cursorDate = truncateToDay(d);
    } else if (currentView === "week") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() + 7);
      cursorDate = truncateToDay(d);
    } else if (currentView === "day") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() + 1);
      cursorDate = truncateToDay(d);
    }
    render();
  }

  // ---------- Delegation ----------
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

  // ---------- Prevent restore old cached UI ----------
  window.addEventListener("pageshow", function(event) {
    if (event.persisted) {
      forceDefaultMonthView();
    }
  });

  window.addEventListener("popstate", function() {
    forceDefaultMonthView();
  });

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      if (containerList) {
        containerList.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      }
      return;
    }

    injectPastEventStyles();

    // Force month view every fresh load
    currentView = "month";
    cursorDate = truncateToDay(new Date());

    if (containerList) containerList.style.display = "none";
    if (containerCal) containerCal.style.display = "";

    showPastEvents = true;
    const pastToggle = document.getElementById("togglePastEvents");
    if (pastToggle) pastToggle.checked = true;

    await loadBranches();
    attachEventsListener();

    if (branchFilter) {
      branchFilter.addEventListener("change", applyFilter);
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(searchInput._t);
        searchInput._t = setTimeout(applyFilter, 120);
      });
    }

    if (btnMonth) btnMonth.addEventListener("click", () => { currentView = "month"; render(); });
    if (btnWeek)  btnWeek.addEventListener("click",  () => { currentView = "week"; render(); });
    if (btnDay)   btnDay.addEventListener("click",   () => { currentView = "day"; render(); });
    if (btnList)  btnList.addEventListener("click",  () => { currentView = "list"; render(); });

    if (btnToday) btnToday.addEventListener("click", gotoToday);
    if (btnPrev)  btnPrev.addEventListener("click", prevPeriod);
    if (btnNext)  btnNext.addEventListener("click", nextPeriod);

    if (pastToggle) {
      pastToggle.addEventListener("change", function(e) {
        showPastEvents = e.target.checked;
        applyFilter();
      });
    }

    render();
  });
})();