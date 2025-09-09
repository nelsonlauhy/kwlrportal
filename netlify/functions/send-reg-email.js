// /netlify/functions/send-reg-email.js
// Fallback confirmation email (METHOD:REQUEST calendar part), no CC to IT.

const nodemailer = require("nodemailer");

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
      <tr><td style="padding:8px 0;width:90px;color:#64748b;">When</td><td style="padding:8px 0;">${when}</td></tr>
      <tr><td style="padding:8px 0;width:90px;color:#64748b;">Where</td><td style="padding:8px 0;">${loc || "—"}</td></tr>
      <tr><td style="padding:8px 0;width:90px;color:#64748b;">Summary</td><td style="padding:8px 0;">${desc || "—"}</td></tr>
    </table>

    ${detailHTML}

    <p style="margin:16px 0 0 0;color:#475569;">📅 This email includes a calendar invite — click <b>Accept</b> to add it.</p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
    <p style="font-size:12px;color:#94a3b8;margin:0;">KW Living Portal • Automated confirmation</p>
  </div>`;
}

function escapeICS(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function pad(n){return String(n).padStart(2,"0");}
function toUTCYMDHMS(d){
  return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+"T"+pad(d.getUTCHours())+pad(d.getUTCMinutes())+pad(d.getUTCSeconds())+"Z";
}

function buildICS({ event, organizerEmail, attendee }) {
  const uid = `${event.id || "event"}@kw-living-portal`;
  const now = new Date();
  const dtstamp = toUTCYMDHMS(now);

  const start = new Date(event.startISO);
  const end   = new Date(event.endISO);
  const DTSTART = toUTCYMDHMS(start);
  const DTEND   = toUTCYMDHMS(end);

  const SUMMARY = escapeICS(event.title || "");
  const LOCATION = escapeICS(event.location || "");
  const DESCRIPTION = escapeICS(event.description || "");

  const ORGANIZER = `ORGANIZER;CN=KW Living Portal:MAILTO:${organizerEmail}`;
  const ATTENDEE  = `ATTENDEE;CN=${escapeICS(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${attendee.email}`;

  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//KW Living Portal//Event//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${DTSTART}`,
    `DTEND:${DTEND}`,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    ORGANIZER,
    ATTENDEE,
    `SUMMARY:${SUMMARY}`,
    `LOCATION:${LOCATION}`,
    `DESCRIPTION:${DESCRIPTION}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

exports.handler = async (req) => {
  if (req.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(req.body || "{}");
    const { attendee, event: ev, summary } = body;

    if (!attendee?.email || !ev?.title || !ev?.startISO || !ev?.endISO) {
      return { statusCode: 400, body: "Missing required fields." };
    }

    const O365_USER = process.env.O365_USER;
    const O365_PASS = process.env.O365_PASS;
    const FROM_NAME = process.env.FROM_NAME || "KW Living Portal";
    const REPLY_TO  = process.env.REPLY_TO || O365_USER;

    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: { user: O365_USER, pass: O365_PASS },
      tls: { ciphers: "TLSv1.2" },
    });

    const html = buildEmailHTML({ attendee, event: ev, summary });
    const ics  = buildICS({ event: ev, organizerEmail: O365_USER, attendee });

    const mailOptions = {
      from: `${FROM_NAME} <${O365_USER}>`,
      to: `${attendee.name || ""} <${attendee.email}>`,
      subject: `Registration confirmed: ${ev.title}`,
      text: `You're registered for: ${ev.title}\nWhen: ${summary.when}\nWhere: ${ev.location || ""}`,
      html,
      replyTo: REPLY_TO,
      alternatives: [
        {
          content: ics,
          contentType: 'text/calendar; method=REQUEST; charset="UTF-8"; name="invite.ics"',
          contentDisposition: 'inline; filename="invite.ics"',
          headers: { "Content-Class": "urn:content-classes:calendarmessage" }
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

