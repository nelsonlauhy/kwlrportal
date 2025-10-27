// Event Detail Page (Firestore v8)
// Expects ?id=<eventDocId> in the URL.
// Works for BOTH public and private events (no visibility/status gating).
// Includes: dynamic "Back to Events" link, banner, badges, time, address/map, descriptions,
// and registration (honors allowRegistration, reg windows, capacity, not-started).

(function(){
  // ---------- DOM ----------
  const evBannerBox   = document.getElementById("evBannerBox");
  const evBannerImg   = document.getElementById("evBannerImg");
  const evTitleEl     = document.getElementById("evTitle");
  const evBadgesEl    = document.getElementById("evBadges");
  const evDateLineEl  = document.getElementById("evDateLine");
  const evShortDescEl = document.getElementById("evShortDesc");
  const evDetailDescEl= document.getElementById("evDetailDesc");
  const evCapacityEl  = document.getElementById("evCapacity");
  const btnOpenReg    = document.getElementById("btnOpenRegister");

  // Address + map
  const evAddressRow  = document.getElementById("evAddressRow");
  const evAddressText = document.getElementById("evAddressText");
  const evMapLink     = document.getElementById("evMapLink");
  const evMapToggle   = document.getElementById("evMapToggle");
  const evMapEmbed    = document.getElementById("evMapEmbed");
  const evMapIframe   = document.getElementById("evMapIframe");

  // Register modal
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

  // Back link element in header
  const backLink = document.querySelector(".back-link");

  // ---------- Config ----------
  // Optional (expose in firebaseConfig.js): window.MAPS_EMBED_API_KEY = "YOUR_KEY";
  const MAPS_EMBED_API_KEY = (typeof window !== "undefined" && window.MAPS_EMBED_API_KEY)
    ? String(window.MAPS_EMBED_API_KEY) : null;
  const MAP_MODE = "auto"; // "auto" | "link"

  // ---------- State ----------
  let eventObj = null;
  const resourceCache = Object.create(null);

  // ---------- Utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));
  function toDate(ts){
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtDateTime(d){
    if (!d) return "";
    const pad = n => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function stripHtmlToText(html) {
    const tmp=document.createElement("div");
    tmp.innerHTML=html||"";
    return (tmp.textContent||tmp.innerText||"").trim();
  }
  function normalizeHex(c){
    if(!c) return "#3b82f6";
    let x=String(c).trim();
    if(!x.startsWith("#")) x="#"+x;
    if(x.length===4) x="#"+x[1]+x[1]+x[2]+x[2]+x[3]+x[3];
    return x.toLowerCase();
  }
  function getParam(name){
    const url = new URL(location.href);
    return url.searchParams.get(name);
  }
  function ensureHttps(url){
    let s=String(url||"").trim();
    if(!s) return "";
    if(s.startsWith("ttps://")) s="h"+s;
    if(/^gs:\/\//i.test(s)) return ""; // not handling gs:// here
    if(!/^https?:\/\//i.test(s) && !s.startsWith("/")) s="https://"+s;
    return s;
  }

  function pickBannerUrl(ev){
    const nested = (obj, path) => {
      try { return path.split(".").reduce((a,k) => (a && a[k] != null ? a[k] : undefined), obj); }
      catch(_){ return undefined; }
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
    for (const raw of candidates){ const u=ensureHttps(raw); if (u) return u; }
    return "";
  }
  function pickBannerUrlFull(ev){
    const nested = (obj, path) => {
      try { return path.split(".").reduce((a,k) => (a && a[k] != null ? a[k] : undefined), obj); }
      catch(_){ return undefined; }
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
    for (const raw of candidates){ const u=ensureHttps(raw); if (u) return u; }
    return "";
  }

  // Registration allowed purely by business fields (not visibility/status)
  function canRegister(ev) {
    const now = new Date();
    if (ev.allowRegistration === false) return false;
    const opens = toDate(ev.regOpensAt), closes = toDate(ev.regClosesAt);
    if (opens && now < opens) return false;
    if (closes && now > closes) return false;
    if (typeof ev.remaining === "number" && ev.remaining <= 0) return false;
    const start = toDate(ev.start); if (start && now > start) return false;
    return true;
  }

  // ---------- Resource helpers ----------
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
          resourceCache[`id:${rid}`]=data; return data;
        }
      } catch(_){}
    }
    if (rid) {
      try {
        const q = await col.where("id","==",rid).limit(1).get();
        if (!q.empty){
          const data=q.docs[0].data();
          resourceCache[`id:${rid}`]=data; return data;
        }
      } catch(_){}
    }
    if (rname) {
      try {
        const q2 = await col.where("name","==",rname).get();
        if (!q2.empty){
          const all=q2.docs.map(d=>d.data());
          let best=all[0];
          if (rbranch){
            const exact=all.find(x => (x.branch||"")===rbranch);
            if (exact) best=exact;
          }
          resourceCache[`name:${rname}|${rbranch||""}`]=best; return best;
        }
      } catch(_){}
    }
    return null;
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
    const nothing =
      !meta.address && !meta.hmapsUrl && !meta.mapsUrl &&
      !(isFinite(meta.lat) && isFinite(meta.lng)) && !meta.mapsPlaceId;

    if (nothing) {
      evAddressRow.classList.add("d-none");
      evAddressText.textContent = "";
      evMapEmbed.classList.add("d-none");
      evMapToggle.classList.add("d-none");
      evMapIframe.removeAttribute("src");
      return;
    }

    evAddressRow.classList.remove("d-none");
    evAddressText.textContent = meta.address || meta.label || "";

    const targets = buildMapTargets(meta);

    if (targets.linkUrl) { evMapLink.href = targets.linkUrl; evMapLink.classList.remove("disabled"); }
    else { evMapLink.removeAttribute("href"); evMapLink.classList.add("disabled"); }

    if (!targets.hasEmbed) {
      evMapEmbed.classList.add("d-none");
      evMapToggle.classList.add("d-none");
      evMapIframe.removeAttribute("src");
    } else {
      evMapToggle.classList.remove("d-none");
      evMapToggle.textContent = "Show map";
      evMapEmbed.classList.add("d-none");
      evMapIframe.removeAttribute("src");
      evMapToggle.onclick = () => {
        const hidden = evMapEmbed.classList.contains("d-none");
        if (hidden) {
          if (!evMapIframe.getAttribute("src")) evMapIframe.src = targets.embedUrl;
          evMapEmbed.classList.remove("d-none");
          evMapToggle.textContent = "Hide map";
        } else {
          evMapEmbed.classList.add("d-none");
          evMapToggle.textContent = "Show map";
        }
      };
    }
  }

  // ---------- Render ----------
  function renderEvent(ev){
    // Title + badges
    const color = normalizeHex(ev.color || "#3b82f6");
    evTitleEl.innerHTML = `
      <span class="me-2" style="display:inline-block;width:1rem;height:1rem;border-radius:50%;background:${esc(color)};vertical-align:baseline;"></span>
      ${esc(ev.title || "Event Details")}
    `;

    const badges = [];
    if (ev.resourceName) badges.push(`<span class="badge badge-room"><i class="bi bi-building me-1"></i>${esc(ev.resourceName)}</span>`);
    if (ev.branch) badges.push(`<span class="badge badge-branch">${esc(ev.branch)}</span>`);
    if (ev.status) badges.push(`<span class="badge text-bg-light border">${esc(ev.status)}</span>`);
    if (ev.visibility) badges.push(`<span class="badge text-bg-light border">${esc(ev.visibility)}</span>`);
    evBadgesEl.innerHTML = badges.join(" ");

    // Date line
    const s = toDate(ev.start), e = toDate(ev.end);
    evDateLineEl.textContent = `${fmtDateTime(s)} – ${fmtDateTime(e)}`;

    // Banner
    const fullBanner = pickBannerUrlFull(ev);
    if (fullBanner) {
      evBannerImg.src = fullBanner;
      evBannerImg.alt = (ev.title ? `${ev.title} banner` : "Event banner");
      evBannerBox.classList.remove("d-none");
      evBannerImg.onerror = () => {
        evBannerImg.removeAttribute("src");
        evBannerBox.classList.add("d-none");
      };
    } else {
      evBannerImg.removeAttribute("src");
      evBannerBox.classList.add("d-none");
    }

    // Short desc
    if (ev.description) { evShortDescEl.textContent = ev.description; evShortDescEl.style.display = ""; }
    else evShortDescEl.style.display = "none";

    // Rich detailDescription
    if (ev.detailDescription) { evDetailDescEl.innerHTML = ev.detailDescription; evDetailDescEl.style.display = ""; }
    else evDetailDescEl.style.display = "none";

    // Capacity
    const remaining = (typeof ev.remaining === "number") ? ev.remaining : null;
    const capacity  = (typeof ev.capacity === "number") ? ev.capacity : null;
    const remainTxt = (remaining != null && capacity != null) ? `${remaining}/${capacity} seats left`
                    : (remaining != null ? `${remaining} seats left` : "");
    evCapacityEl.textContent = remainTxt || "";

    // Address / map
    const applyMeta = (res) => {
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
      if (!meta.mapsUrl)  delete meta.mapsUrl;
      setMapUI(meta);
    };

    if (ev.address || ev.hmapsUrl || ev.mapsUrl || ev.mapsPlaceId || (isFinite(ev.lat) && isFinite(ev.lng))) {
      applyMeta(null);
    } else {
      fetchResourceDataByAny(ev).then(applyMeta).catch(()=> setMapUI({}));
    }

    // --- Dynamic "Back to Events" link ---
    if (backLink) {
      const v = (ev.visibility || "").toLowerCase();
      backLink.href = (v === "public") ? "/events-public.html" : "/events-private.html";
    }

    // Register button
    const enabled = canRegister(ev);
    btnOpenReg.disabled = !enabled;
    btnOpenReg.onclick = () => {
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
      regModal.show();
    };
  }

  function clearRegAlerts(){
    [regWarn, regErr, regOk].forEach(el => { el.classList.add("d-none"); el.textContent=""; });
  }

  // ---------- Data load ----------
  async function loadEventById(id){
    const ref = window.db.collection("events").doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Event not found.");
    const data = snap.data();
    eventObj = { _id: snap.id, ...data };
    // NOTE: No visibility/status gating; show any event loaded by ID
    renderEvent(eventObj);
  }

  // ---------- Registration ----------
  regForm.addEventListener("submit", async (e) => {
    e.preventDefault(); clearRegAlerts(); btnSubmitReg.disabled = true; regBusy.classList.remove("d-none");
    try {
      if (!eventObj) throw new Error("No event loaded.");
      const name = attendeeName.value.trim();
      const email = attendeeEmail.value.trim().toLowerCase();
      if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Please enter a valid name and email.");

      const eventRef = window.db.collection("events").doc(eventObj._id);
      const regId = `${eventObj._id}_${email}`;
      const regRef = window.db.collection("eventRegistrations").doc(regId);

      await window.db.runTransaction(async (tx) => {
        const [evSnap, regSnap] = await Promise.all([tx.get(eventRef), tx.get(regRef)]);
        if (!evSnap.exists) throw new Error("Event not found.");
        const ev = evSnap.data();

        // Only enforce business fields (not visibility/status)
        const now = new Date();
        const opens = ev.regOpensAt?.toDate ? ev.regOpensAt.toDate() : (ev.regOpensAt ? new Date(ev.regOpensAt) : null);
        const closes = ev.regClosesAt?.toDate ? ev.regClosesAt.toDate() : (ev.regClosesAt ? new Date(ev.regClosesAt) : null);
        if (ev.allowRegistration === false) throw new Error("Registration is not allowed for this event.");
        if (opens && now < opens) throw new Error("Registration has not opened yet.");
        if (closes && now > closes) throw new Error("Registration has closed.");
        const start = ev.start?.toDate ? ev.start.toDate() : (ev.start ? new Date(ev.start) : null);
        if (start && now > start) throw new Error("This event has already started.");

        if (regSnap.exists && regSnap.data().status === "registered") throw new Error("You're already registered for this event.");
        if (typeof ev.remaining === "number" && ev.remaining <= 0) throw new Error("This event is full.");

        tx.set(regRef, {
          eventId: eventRef.id,
          eventTitle: ev.title || "",
          start: ev.start || null,
          attendeeEmail: email,
          attendeeName: name,
          status: "registered",
          createdAt: new Date()
        });
        if (typeof ev.remaining === "number") tx.update(eventRef, { remaining: ev.remaining - 1 });
      });

      regOk.classList.remove("d-none"); regOk.textContent = "Registration successful! Check your email.";
      regErr.classList.add("d-none");
      window.dispatchEvent(new CustomEvent("event:registered", { detail: { event: eventObj, attendee: { name, email } } }));
      setTimeout(() => regModal.hide(), 1200);

    } catch (err) {
      console.error("registration error:", err);
      regErr.textContent = err.message || "Registration failed. Please try again.";
      regErr.classList.remove("d-none");
    } finally {
      regBusy.classList.add("d-none"); btnSubmitReg.disabled = false;
    }
  });

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (!window.db) throw new Error("Firestore not initialized.");
      const id = getParam("id");
      if (!id) throw new Error("Missing event id.");
      await loadEventById(id);
    } catch (err) {
      console.error(err);
      if (evTitleEl) evTitleEl.textContent = err.message || "Failed to load event.";
      // Hide dependent sections if load failed
      btnOpenReg.disabled = true;
      evBannerBox?.classList.add("d-none");
      if (evShortDescEl) evShortDescEl.style.display = "none";
      if (evDetailDescEl) evDetailDescEl.style.display = "none";
      evAddressRow?.classList.add("d-none");
      if (backLink) backLink.href = "/events-public.html";
    }
  });
})();
