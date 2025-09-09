// /netlify/functions/notify-registration.js
// Sends a simple notification to IT Support with registrant name & email.

const nodemailer = require("nodemailer");

exports.handler = async (req) => {
  if (req.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(req.body || "{}");
    const { attendee, event: ev, invitedVia } = body;

    if (!attendee?.email || !ev?.title) {
      return { statusCode: 400, body: "Missing required fields." };
    }

    const O365_USER = process.env.O365_USER;
    const O365_PASS = process.env.O365_PASS;
    const FROM_NAME = process.env.FROM_NAME || "KW Living Portal";
    const IT_EMAIL  = process.env.IT_SUPPORT_EMAIL || "itsupport@livingrealtykw.com";

    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: { user: O365_USER, pass: O365_PASS },
      tls: { ciphers: "TLSv1.2" },
    });

    const subject = `New registration: ${ev.title}`;
    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;padding:16px;color:#0f172a;">
        <h3 style="margin:0 0 8px 0;">New Event Registration</h3>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;width:110px;color:#64748b;">Event</td><td style="padding:6px 0;"><strong>${escapeHtml(ev.title)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Registrant</td><td style="padding:6px 0;">${escapeHtml(attendee.name || "")}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(attendee.email)}">${escapeHtml(attendee.email)}</a></td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Branch/Room</td><td style="padding:6px 0;">${escapeHtml([ev.resourceName, ev.branch].filter(Boolean).join(" · "))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Delivery</td><td style="padding:6px 0;">${escapeHtml(invitedVia || "unknown")}</td></tr>
        </table>
        <p style="color:#94a3b8;font-size:12px;margin-top:12px;">This is a reference notification only.</p>
      </div>`;

    await transporter.sendMail({
      from: `${FROM_NAME} <${O365_USER}>`,
      to: IT_EMAIL,
      subject,
      html
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("notify-registration error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err?.message || err) }) };
  }
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));
}
