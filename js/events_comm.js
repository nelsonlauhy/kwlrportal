// /js/events_comm.js
// After successful registration, try to create a meeting invite via Graph.
// Fallback to email confirmation if meeting creation fails.

(function () {
  const MEETING_ENDPOINT = "/.netlify/functions/create-meeting-invite";
  const EMAIL_ENDPOINT   = "/.netlify/functions/send-reg-email"; // fallback

  function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtDateTimeLocal(d) {
    if (!d) return "";
    return d.toLocaleString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function call(endpoint, payload) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${endpoint} -> ${res.status}`);
    return res.json();
  }

  window.addEventListener("event:registered", async (e) => {
    const { event, attendee } = e.detail || {};
    if (!event || !attendee) return;

    const start = toDate(event.start);
    const end   = toDate(event.end);

    const payload = {
      attendee: { name: attendee.name, email: attendee.email },
      event: {
        id: event._id,
        title: event.title || "",
        branch: event.branch || "",
        resourceName: event.resourceName || "",
        description: event.description || "",
        detailDescription: event.detailDescription || "",
        startISO: start ? start.toISOString() : null,
        endISO: end ? end.toISOString() : null,
        location: [event.resourceName, event.branch].filter(Boolean).join(" · "),
        color: event.color || "#3b82f6",
      },
      summary: { when: `${fmtDateTimeLocal(start)} – ${fmtDateTimeLocal(end)}` },
    };

    try {
      // 1) Try Graph meeting request
      await call(MEETING_ENDPOINT, payload);
    } catch (err) {
      console.error("create-meeting-invite failed, falling back to email:", err);
      try {
        // 2) Fallback to email (your existing function)
        await call(EMAIL_ENDPOINT, payload);
      } catch (err2) {
        console.error("send-reg-email also failed:", err2);
      }
    }
  });
})();

