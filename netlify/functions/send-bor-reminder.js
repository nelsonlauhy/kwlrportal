// netlify/functions/send-bor-reminders.js
import nodemailer from "nodemailer";

/**
 * Expected POST body:
 * {
 *   group: {
 *     borName: string,
 *     borEmail?: string,
 *     items: Array<{ tradeNo?: string, agentNo?: string, agentName?: string }>
 *   }
 * }
 */

function esc(s) {
  return (s == null ? "" : String(s)).trim();
}

function rowsHtml(items = []) {
  if (!items.length) {
    return `<tr><td colspan="3" style="color:#6c757d;padding:4px 6px;line-height:1.2;">(No pending records)</td></tr>`;
  }
  return items
    .map(
      (it) => `
      <tr>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;line-height:1.2;">${esc(it.tradeNo || "-")}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;line-height:1.2;">${esc(it.agentNo || "-")}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;line-height:1.2;">${esc(it.agentName || "-")}</td>
      </tr>`
    )
    .join("");
}

function rowsText(items = []) {
  if (!items.length) return "(No pending records)";
  return items
    .map(
      (it) =>
        ` - Trade: ${esc(it.tradeNo || "-")} | Agent No: ${esc(
          it.agentNo || "-"
        )} | Agent Name: ${esc(it.agentName || "-")}`
    )
    .join("\n");
}

export const handler = async (event) => {
  // Simple ping
  if (event.httpMethod === "GET") {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ts: Date.now() }) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const { group } = payload;

    if (!group || !Array.isArray(group.items)) {
      return {
        statusCode: 400,
        body:
          "Invalid payload: { group: { borName, borEmail?, items:[] } } required",
      };
    }

    const borName = esc(group.borName);
    const borEmail = esc(group.borEmail);
    const greet = borName ? `Hi ${borName},` : "Hello,";

    // --- Review link ---
    const link = borEmail
      ? `https://lridocreview.netlify.app/kwdocreviewbor.html?boremail=${encodeURIComponent(borEmail)}`
      : "";

    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.O365_USER,
        pass: process.env.O365_PASS,
      },
      requireTLS: true,
    });

    // --- Recipient setup (TEST MODE) ---
    const TO = "itsupport@livingrealtykw.com";
    // const TO = borEmail || "itsupport@livingrealtykw.com";  // (for live mode)
    // const CC = "accounting@livingrealtykw.com";
    // const BCC = "itsupport@livingrealtykw.com";

    const FROM = `KW Living Realty <${process.env.O365_USER}>`;
    const subject = `[Reminder] Pending Trades Review — BoR: ${borName || "(Unknown)"} (${group.items.length})`;

    const html = `
      <div style="font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111;">
        <p>${greet}</p>
        <p>This is a scheduled system reminder for <strong>Broker of Record</strong> with pending trade records requiring review and approval.</p>
        ${
          link
            ? `<p><a href="${link}" target="_blank" style="color:#0d6efd;">Open BoR Review Page</a></p>`
            : ""
        }

        <table style="border-collapse:collapse;width:100%;max-width:760px;margin:10px 0;border:1px solid #eee;font-size:12px;line-height:1.2;">
          <thead>
            <tr style="background:#f8f9fa;">
              <th align="left" style="padding:6px;border-bottom:1px solid #eee;">Trade No.</th>
              <th align="left" style="padding:6px;border-bottom:1px solid #eee;">Agent No.</th>
              <th align="left" style="padding:6px;border-bottom:1px solid #eee;">Agent Name</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml(group.items)}
          </tbody>
        </table>

        <p style="color:#6c757d;font-size:12px;margin-top:12px;">
          This is a scheduled system email. Please do not reply to this message.<br/>
          If there is any problem, contact
          <a href="mailto:accounting@livingrealtykw.com" style="color:#0d6efd;">accounting@livingrealtykw.com</a>.
        </p>
      </div>
    `;

    const text =
      `${greet}\n\n` +
      `This is a scheduled system reminder for the Broker of Record with pending trade records requiring review.\n` +
      (link ? `BoR Review Page: ${link}\n\n` : "\n") +
      `Items:\n${rowsText(group.items)}\n\n` +
      `This is a scheduled system email. Please do not reply.\n` +
      `If there is any problem, contact accounting@livingrealtykw.com.\n`;

    const mailOptions = {
      from: FROM,
      to: TO,
      subject,
      text,
      html,
      // cc: CC,   // (remarked for testing)
      // bcc: BCC, // (remarked for testing)
    };

    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        sentTo: TO,
        reviewLink: link,
        count: group.items.length,
      }),
    };
  } catch (err) {
    console.error("send-bor-reminders error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
