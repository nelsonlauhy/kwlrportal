// events_admin_regs.js
// Adds "Registrations" button to each event card and shows a modal with the list.
// Firestore v8 is already loaded; window.db is set by firebaseConfig.js

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
    // Find action areas inside each card and add a button if missing
    const cards = container.querySelectorAll(".event-card");
    cards.forEach(card => {
      const id = extractEventId(card);
      if (!id) return;

      // Action area (right column)
      const right = card.querySelector(".text-end");
      if (!right) return;

      // Skip if already added
      if (right.querySelector(".btn-view-reg")) return;

      const btn = document.createElement("button");
      btn.className = "btn btn-outline-primary btn-sm me-1 btn-view-reg";
      btn.setAttribute("type","button");
      btn.setAttribute("data-id", id);
      btn.innerHTML = `<i class="bi bi-people me-1"></i>Registrations`;

      btn.addEventListener("click", () => openRegistrations(card, id));

      // Insert before Delete, if present, else append
      const delBtn = right.querySelector("[data-action='delete']");
      if (delBtn && delBtn.parentElement === right) {
        right.insertBefore(btn, delBtn);
      } else {
        right.appendChild(btn);
      }
    });
  }

  // Try to extract the event id from buttons already rendered in the card
  function extractEventId(card) {
    const editBtn = card.querySelector("[data-action='edit']");
    if (editBtn) return editBtn.getAttribute("data-id");
    const delBtn = card.querySelector("[data-action='delete']");
    if (delBtn) return delBtn.getAttribute("data-id");
    return null;
  }

  async function openRegistrations(card, eventId) {
    // Try to read some basic event info from the card DOM
    const title = (card.querySelector(".event-title")?.textContent || "").trim();
    const meta  = (card.querySelector(".event-meta")?.textContent || "").trim();

    regEventTitle.textContent = title || eventId;
    regEventMeta.textContent  = meta;

    // Reset table
    regListBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">
      <div class="spinner-border spinner-border-sm me-2"></div> Loading…
    </td></tr>`;
    regListCounts.textContent = "";
    regListStatus.textContent = "";

    modal.show();

    try {
      const snap = await window.db.collection("eventRegistrations")
        .where("eventId","==", eventId)
        .orderBy("createdAt","desc")
        .get();

      if (snap.empty) {
        regListBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No registrations found.</td></tr>`;
        regListCounts.textContent = "0 registrations";
        enableCopy([]);
        return;
      }

      const rows = [];
      const emails = [];
      let idx = 1;

      snap.docs.forEach(doc => {
        const r = doc.data() || {};
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
      });

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

  // Copy helper
  function enableCopy(emails) {
    if (!btnCopyEmails) return;
    btnCopyEmails.onclick = async () => {
      const text = emails.join(", ");
      try {
        await navigator.clipboard.writeText(text);
        toast("Emails copied.");
      } catch {
        // Fallback: select hidden textarea
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

  // Tiny toast using Bootstrap’s modal footer area
  function toast(msg) {
    if (!regListStatus) return;
    regListStatus.textContent = msg;
    setTimeout(() => { regListStatus.textContent = ""; }, 2000);
  }

  // Utilities (copied lightweight versions to avoid coupling to events_admin.js)
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
    ));
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
})();
