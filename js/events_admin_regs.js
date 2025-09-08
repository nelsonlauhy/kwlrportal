// events_admin_regs.js
// Adds a "Registrations" button to each event card and shows a modal with the list.
// Works with either collection name: "eventRegistrations" (preferred) or the typo "eventRegidtrations" (fallback).
// Avoids composite index requirement by sorting on the client.

(function(){
  const container = document.getElementById("eventsContainer");

  // Modal elements
  const modalEl = document.getElementById("regListModal");
  const modal   = modalEl ? new bootstrap.Modal(modalEl) : null;

  const regEventTitle = document.getElementById("regEventTitle");
  const regEventMeta  = document.getElementById("regEventMeta");
  const regListBody   = document.getElementById("regListBody");
  const regListCounts = document.getElementById("regListCounts");
  const regListStatus = document.getElementById("regListStatus");
  const btnCopyEmails = document.getElementById("btnCopyEmails");

  if (!container || !modal) return;

  // Observe list changes and enhance cards by injecting a "Registrations" button
  const observer = new MutationObserver(() => enhanceCards());
  observer.observe(container, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", enhanceCards);

  function enhanceCards() {
    const cards = container.querySelectorAll(".event-card");
    cards.forEach(card => {
      const id = extractEventId(card);
      if (!id) return;

      const right = card.querySelector(".text-end");
      if (!right) return;

      if (right.querySelector(".btn-view-reg")) return; // already added

      const btn = document.createElement("button");
      btn.className = "btn btn-outline-primary btn-sm me-1 btn-view-reg";
      btn.type = "button";
      btn.dataset.id = id;
      btn.innerHTML = `<i class="bi bi-people me-1"></i>Registrations`;
      btn.addEventListener("click", () => openRegistrations(card, id));

      const delBtn = right.querySelector("[data-action='delete']");
      if (delBtn && delBtn.parentElement === right) right.insertBefore(btn, delBtn);
      else right.appendChild(btn);
    });
  }

  function extractEventId(card) {
    return (card.querySelector("[data-action='edit']")?.getAttribute("data-id"))
        || (card.querySelector("[data-action='delete']")?.getAttribute("data-id"))
        || null;
  }

  async function openRegistrations(card, eventId) {
    const title = (card.querySelector(".event-title")?.textContent || "").trim();
    const meta  = (card.querySelector(".event-meta")?.textContent || "").trim();

    regEventTitle.textContent = title || eventId;
    regEventMeta.textContent  = meta;

    regListBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">
      <div class="spinner-border spinner-border-sm me-2"></div> Loading…
    </td></tr>`;
    regListCounts.textContent = "";
    regListStatus.textContent = "";

    modal.show();

    try {
      // Try preferred collection first
      let regs = await fetchRegs("eventRegistrations", eventId);

      // Fallback to the typo collection if needed
      if (!regs.length) {
        regs = await fetchRegs("eventRegidtrations", eventId);
      }

      if (!regs.length) {
        regListBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No registrations found.</td></tr>`;
        regListCounts.textContent = "0 registrations";
        enableCopy([]);
        return;
      }

      // Sort by createdAt desc on client to avoid composite index
      regs.sort((a, b) => (toDate(b.createdAt) - toDate(a.createdAt)));

      const rows = [];
      const emails = [];
      let idx = 1;

      for (const r of regs) {
        const name  = (r.attendeeName || "").toString();
        const email = (r.attendeeEmail || "").toString();
        const status= (r.status || "").toString();
        const at    = toDate(r.createdAt);
        const atStr = at ? fmtDateTime(at) : "";

        if (email) emails.push(email);

        rows.push(`
          <tr>
            <td class="text-muted">${idx++}</td>
            <td>${esc(name)}</td>
            <td><a href="mailto:${esc(email)}">${esc(email)}</a></td>
            <td>${esc(status)}</td>
            <td class="text-nowrap">${esc(atStr)}</td>
          </tr>
        `);
      }

      regListBody.innerHTML = rows.join("");
      regListCounts.textContent = `${rows.length} registration${rows.length===1?"":"s"}`;
      enableCopy(emails);

    } catch (err) {
      console.error("registrations load error:", err);
      regListBody.innerHTML = `<tr><td colspan="5" class="text-danger py-4 text-center">Failed to load registrations.</td></tr>`;
      regListStatus.textContent = err.message || "Error loading registrations.";
      enableCopy([]);
    }
  }

  async function fetchRegs(collectionName, eventId) {
    try {
      const snap = await window.db
        .collection(collectionName)
        .where("eventId","==", eventId)
        // .orderBy("createdAt","desc")  // removed to avoid composite index requirement
        .get();

      if (snap.empty) return [];
      return snap.docs.map(d => d.data() || []);
    } catch (err) {
      // If index error or collection missing, just return empty and let caller try fallback
      console.warn(`fetchRegs(${collectionName}) failed:`, err);
      return [];
    }
  }

  function enableCopy(emails) {
    if (!btnCopyEmails) return;
    btnCopyEmails.onclick = async () => {
      const text = emails.join(", ");
      try {
        await navigator.clipboard.writeText(text);
        toast("Emails copied.");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); toast("Emails copied."); }
        catch { toast("Copy failed."); }
        finally { document.body.removeChild(ta); }
      }
    };
  }

  function toast(msg) {
    if (!regListStatus) return;
    regListStatus.textContent = msg;
    setTimeout(() => { regListStatus.textContent = ""; }, 2000);
  }

  // Utilities (standalone to avoid coupling to other files)
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
    ));
  }
  function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate(); // Firestore Timestamp
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtDateTime(d) {
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
})();
