// /netlify/functions/send-reg-email.js
// Netlify Function: send post-registration confirmation via Office 365 SMTP

const nodemailer = require("nodemailer");

// Build basic HTML — server-side for consistency/safety
function buildEmailHTML({ attendee, event, summary }) {
  const safe = (s) => String(s ?? "");
  const title = safe(event.title);
  const when  = safe(summary.when);
  const loc   = safe(event.location);
  const desc  = safe(event.description);

  // detailDescription is trusted admin HTML; include if present
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

    <p style="margin:16px 0 0 0;color:#475569;">An iCalendar invite is attached—add it to your calendar.</p>
    <p style="margin:8px 0 0 0;color:#94a3b8;font-size:12px;">If you have questions, reply to this email.</p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
    <p style="font-size:12px;color:#94a3b8;margin:0;">KW Living Portal • Automated confirmation</p>
  </div>`;
}

// Build a simple ICS (UTC times); consumers map to local TZ automatically.
function buildICS({ event }) {
  const uid = `${event.id || "event"}@kw-living-portal`;
  const dtStart = event.startISO ? new Date(event.startISO) : null;
  const dtEnd   = event.endISO ? new Date(event.endISO) : null;

  const toICSUTC = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return [
      d.getUTCFullYear(),
      pad(d.getUTCMonth() + 1),
      pad(d.getUTCDate()),
      "T",
      pad(d.getUTCHours()),
      pad(d.getUTCMinutes()),
      pad(d.getUTCSeconds()),
      "Z",
    ].join("");
  };

  const DTSTART = dtStart ? toICSUTC(dtStart) : "";
  const DTEND   = dtEnd ? toICSUTC(dtEnd) : "";
  const SUMMARY = (event.title || "").replace(/\n/g, " ");
  const LOCATION = (event.location || "").replace(/\n/g, " ");
  const DESCRIPTION = (event.description || "").replace(/\n/g, " ");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KW Living Portal//Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    DTSTART ? `DTSTART:${DTSTART}` : "",
    DTEND ? `DTEND:${DTEND}` : "",
    `SUMMARY:${escapeICS(SUMMARY)}`,
    `LOCATION:${escapeICS(LOCATION)}`,
    `DESCRIPTION:${escapeICS(DESCRIPTION)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].filter(Boolean).join("\r\n");
}

function escapeICS(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

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

    // ENV VARS: set in Netlify dashboard (never commit secrets)
    const O365_USER = process.env.O365_USER; // office@livinggroupinc.com
    const O365_PASS = process.env.O365_PASS; // hdvdfyzbvdhmfckz
    const CC_EMAIL  = process.env.CC_EMAIL || "itsupport@livingrealtykw.com";
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
    const ics  = buildICS({ event: ev });

    const mailOptions = {
      from: `${FROM_NAME} <${O365_USER}>`,
      to: `${attendee.name || ""} <${attendee.email}>`,
      cc: CC_EMAIL,
      subject: `Registration confirmed: ${ev.title}`,
      html,
      replyTo: REPLY_TO,
      attachments: [
        {
          filename: "event.ics",
          content: ics,
          contentType: "text/calendar; charset=utf-8; method=PUBLISH",
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("send-reg-email error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err?.message || err) }),
    };
  }
};
