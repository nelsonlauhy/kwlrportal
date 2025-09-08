// /netlify/functions/send-reg-email.js
// Outlook-friendly meeting request (real invite) with VTIMEZONE + inline text/calendar part

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

    <p style="margin:16px 0 0 0;color:#475569;">📅 Click <b>Accept</b> / <b>Add to calendar</b> in your mail client.</p>

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

function pad(n) { return String(n).padStart(2, "0"); }
function toLocalYMDHMS(d) {
  // returns yyyymmddThhmmss in LOCAL time (for TZID lines)
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
function toUTCYMDHMS(d) {
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
  // Build using TZID (America/Toronto) + VTIMEZONE
  const uid = `${ev.id || "event"}@kw-living-portal`;
  const now = new Date(); // for DTSTAMP

  const start = new Date(ev.startISO);
  const end   = new Date(ev.endISO);

  const DTSTART = toLocalYMDHMS(start);
  const DTEND   = toLocalYMDHMS(end);
  const DTSTAMP = toUTCYMDHMS(now);

  const SUMMARY     = escapeICS(ev.title || "");
  const LOCATION    = escapeICS(ev.location || "");
  const DESCRIPTION = escapeICS(ev.description || "");

  const ORGANIZER = `ORGANIZER;CN=KW Living Portal:MAILTO:${organizerEmail}`;
  const ATTENDEE  = `ATTENDEE;CN=${escapeICS(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${attendee.email}`;

  // VTIMEZONE for America/Toronto (EST/EDT)
  const VTIMEZONE = [
    "BEGIN:VTIMEZONE",
    "TZID:America/Toronto",
    "X-LIC-LOCATION:America/Toronto",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE"
  ].join("\r\n");

  // Outlook-friendly extra X- fields
  const X_MS = [
    "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    "X-MICROSOFT-DISALLOW-COUNTER:FALSE",
    "X-MS-OLK-AUTOFILLLOCATION:FALSE",
    "X-MS-OLK-CONFTYPE:0"
  ].join("\r\n");

  const VALARM = [
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM"
  ].join("\r\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//KW Living Portal//Event//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${DTSTAMP}`,
    `DTSTART;TZID=America/Toronto:${DTSTART}`,
    `DTEND;TZID=America/Toronto:${DTEND}`,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    ORGANIZER,
    ATTENDEE,
    `SUMMARY:${SUMMARY}`,
    `LOCATION:${LOCATION}`,
    `DESCRIPTION:${DESCRIPTION}`,
    "CLASS:PUBLIC",
    "TRANSP:OPAQUE",
    X_MS,
    VALARM,
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ];

  // CRLF line endings are important
  return lines.join("\r\n");
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
      // Provide a plain text fallback (helps some clients)
      text: `You're registered for: ${ev.title}\nWhen: ${summary.when}\nWhere: ${ev.location || ""}`,
      html,
      replyTo: REPLY_TO,

      // 🔑 Inline calendar part as ALTERNATIVE (not an attachment)
      alternatives: [
        {
          content: ics,
          contentType: 'text/calendar; method=REQUEST; charset="UTF-8"; name="invite.ics"',
          contentDisposition: 'inline; filename="invite.ics"',
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
