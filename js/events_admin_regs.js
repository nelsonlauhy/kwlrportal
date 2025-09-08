// /netlify/functions/send-reg-email.js
// Send a real Outlook-friendly meeting request (inline text/calendar; method=REQUEST)

const nodemailer = require("nodemailer");

// ---------- HTML body ----------
function buildEmailHTML({ attendee, event, summary }) {
  const safe = (s) => String(s ?? "");
  const title = safe(event.title);
  const when  = safe(summary.when);
  const loc   = safe(event.location);
  const desc  = safe(event.description);

  const detailHTML = event.detailDescription
    ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
       <div style="font-size:14px;line-height:1.6;">${event.detailDescription}</div>`
    : "";

  return `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;padding:16px;color:#0f172a;">
    <h2 style="margin:0 0 8px 0;">You're registered: ${title}</h2>
    <p style="margin:0 0 16px 0;color:#475569;">Hi ${safe(attendee.name)},<br/>Thanks for registering. Here are your event details:</p>

    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:8px 0;width:90px;color:#64748b;">When</td>
        <td style="padding:8px 0;">${when}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;width:90px;color:#64748b;">Where</td>
        <td style="padding:8px 0;">${loc || "—"}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;width:90px;color:#64748b;">Summary</td>
        <td style="padding:8px 0;">${desc || "—"}</td>
      </tr>
    </table>

    ${detailHTML}

    <p style="margin:16px 0 0 0;color:#475569;">📅 Click <b>Accept</b> (or Add to Calendar) in your mail client to add this to your calendar.</p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
    <p style="font-size:12px;color:#94a3b8;margin:0;">KW Living Portal • Automated confirmation</p>
  </div>`;
}

// ---------- ICS helpers ----------
function escapeICS(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function toICSUTC(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function buildICS({ ev, organizerEmail, attendee }) {
  const uid = `${ev.id || "event"}@kw-living-portal`;
  const now = new Date();
  const dtstamp = toICSUTC(now);

  const dtStart = ev.startISO ? new Date(ev.startISO) : null;
  const dtEnd   = ev.endISO ? new Date(ev.endISO) : null;

  const DTSTART = dtStart ? toICSUTC(dtStart) : "";
  const DTEND   = dtEnd ? toICSUTC(dtEnd) : "";

  const SUMMARY     = escapeICS(ev.title || "");
  const LOCATION    = escapeICS(ev.location || "");
  const DESCRIPTION = escapeICS(ev.description || "");

  const ORGANIZER = `ORGANIZER;CN=KW Living Portal:MAILTO:${organizerEmail}`;
  const ATTENDEE  = `ATTENDEE;CN=${escapeICS(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${attendee.email}`;

  // CRLF line endings are important for ICS
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//KW Living Portal//Event//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    DTSTART ? `DTSTART:${DTSTART}` : "",
    DTEND ? `DTEND:${DTEND}` : "",
    `SEQUENCE:0`,
    `STATUS:CONFIRMED`,
    `${ORGANIZER}`,
    `${ATTENDEE}`,
    `SUMMARY:${SUMMARY}`,
    `LOCATION:${LOCATION}`,
    `DESCRIPTION:${DESCRIPTION}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ].filter(Boolean).join("\r\n");
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { attendee, event: ev, summary } = body;

    if (!attendee?.email || !ev?.title || !ev?.startISO || !ev?.endISO) {
      return { statusCode: 400, body: "Missing required fields." };
    }

    // Env vars
    const O365_USER = process.env.O365_USER; // office@livinggroupinc.com
    const O365_PASS = process.env.O365_PASS;
    const CC_EMAIL  = process.env.CC_EMAIL || "itsupport@livingrealtykw.com";
    const FROM_NAME = process.env.FROM_NAME || "KW Living Portal";
    const REPLY_TO  = process.env.REPLY_TO || O365_USER;

    // SMTP transport (Office 365)
    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: { user: O365_USER, pass: O365_PASS },
      tls: { ciphers: "TLSv1.2" },
    });

    const html = buildEmailHTML({ attendee, event: ev, summary });
    const ics  = buildICS({ ev, organizerEmail: O365_USER, attendee });

    const mailOptions = {
      from: `${FROM_NAME} <${O365_USER}>`,
      to: `${attendee.name || ""} <${attendee.email}>`,
      cc: CC_EMAIL,
      subject: `Registration confirmed: ${ev.title}`,
      html,
      replyTo: REPLY_TO,

      // The magic: inline calendar part as an ALTERNATIVE (not an attachment),
      // with Outlook-friendly header forcing calendar inspector.
      alternatives: [
        {
          content: ics,
          contentType: 'text/calendar; method=REQUEST; charset="utf-8"',
          headers: {
            "Content-Class": "urn:content-classes:calendarmessage"
          }
        }
      ]
    };

    await transporter.sendMail(mailOptions);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("send-reg-email error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err?.message || err) }) };
  }
};
