// /js/events_comm.js
// Lightweight email dispatcher for post-registration notifications.
// Listens for window "event:registered" and calls the Netlify function.

(function () {
  const API_ENDPOINT = "/.netlify/functions/send-reg-email"; // default Netlify path

  // Helpers (duplicated minimally to stay decoupled from events_public.js)
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
      minute: "2-digit"
    });
  }

  async function sendEmail(payload) {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Email API failed: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error("send-reg-email error:", err);
      // Non-blocking for UX. You can surface a toast here if you want.
      return { ok: false, error: String(err) };
    }
  }

  window.addEventListener("event:registered", async (e) => {
    const { event, attendee } = e.detail || {};
    if (!event || !attendee) return;

    const start = toDate(event.start);
    const end = toDate(event.end);

    // Prepare minimal data; backend will build the final HTML + ICS
    const payload = {
      attendee: {
        name: attendee.name,
        email: attendee.email
      },
      event: {
        id: event._id,
        title: event.title || "",
        branch: event.branch || "",
        resourceName: event.resourceName || "",
        description: event.description || "",
        detailDescription: event.detailDescription || "", // trusted HTML from admin side
        startISO: start ? start.toISOString() : null,
        endISO: end ? end.toISOString() : null,
        color: event.color || "#3b82f6",
        location: [event.resourceName, event.branch].filter(Boolean).join(" · "),
      },
      // Optional UI-facing summary (for logging/troubleshooting)
      summary: {
        when: `${fmtDateTimeLocal(start)} – ${fmtDateTimeLocal(end)}`,
      },
    };

    await sendEmail(payload);
  });
})();
