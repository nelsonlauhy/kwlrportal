// /netlify/functions/create-meeting-invite.js
// Create a meeting via Microsoft Graph and send invites (sendUpdates=all)

const crypto = require("crypto");

// Node 18+ has global fetch
async function getGraphToken() {
  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Token error ${resp.status}: ${t}`);
  }
  return resp.json(); // { access_token, token_type, ... }
}

function stripZ(iso) {
  if (!iso) return null;
  // Graph expects local-format "YYYY-MM-DDTHH:mm:ss" when you also pass timeZone
  return iso.replace(/Z$/, "").replace(/\.\d{3}$/, "");
}

function buildEventPayload(attendee, ev, tz) {
  // organizer mailbox is implied by the /users/{organizer}/events path
  const startLocal = stripZ(ev.startISO);
  const endLocal   = stripZ(ev.endISO);
  const supportEmail = process.env.CC_EMAIL || "itsupport@livingrealtykw.com";

  const attendees = [
    {
      emailAddress: { address: attendee.email, name: attendee.name || attendee.email },
      type: "required",
    },
    {
      emailAddress: { address: supportEmail, name: "IT Support" },
      type: "optional",
    },
  ];

  // A per-registration transaction id prevents accidental duplicates if retried
  const txId = crypto
    .createHash("sha1")
    .update(`${ev.id}|${attendee.email}`)
    .digest("hex");

  return {
    subject: `Registration confirmed: ${ev.title}`,
    body: {
      contentType: "HTML",
      content: `
        <div style="font-family:Segoe UI,Arial,sans-serif">
          <p>Thanks for registering. This meeting request will add the event to your calendar.</p>
          <p><strong>${ev.title}</strong><br/>
          ${ev.location || ""}</p>
        </div>
      `,
    },
    start: { dateTime: startLocal, timeZone: tz }, // ex: "America/Toronto" or "UTC"
    end:   { dateTime: endLocal,   timeZone: tz },
    location: { displayName: ev.location || "" },
    attendees,
    allowNewTimeProposals: false,
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
    transactionId: txId,
    responseRequested: true,
  };
}

exports.handler = async (req) => {
  if (req.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { attendee, event: ev } = JSON.parse(req.body || "{}");
    if (!attendee?.email || !ev?.title || !ev?.startISO || !ev?.endISO) {
      return { statusCode: 400, body: "Missing required fields." };
    }

    const organizerEmail = process.env.ORGANIZER_EMAIL || process.env.O365_USER;
    if (!organizerEmail) {
      return { statusCode: 500, body: "Missing ORGANIZER_EMAIL (or O365_USER) env var." };
    }

    // Choose the time zone you want the meeting to be created in
    const TIMEZONE = process.env.EVENT_TIMEZONE || "America/Toronto";

    const token = await getGraphToken();
    const eventBody = buildEventPayload(attendee, ev, TIMEZONE);

    // POST /users/{organizer}/events?sendUpdates=all  -> sends the real meeting invite
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      organizerEmail
    )}/events?sendUpdates=all`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
        Prefer: `outlook.timezone="${TIMEZONE}"`,
      },
      body: JSON.stringify(eventBody),
    });

    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Graph create event ${resp.status}: ${t}`);
    }

    const data = await resp.json();
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: data.id }) };
  } catch (err) {
    console.error("create-meeting-invite error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
