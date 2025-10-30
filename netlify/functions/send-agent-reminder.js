// netlify/functions/send-agent-reminder.js
import nodemailer from "nodemailer";

/**
 * Expected POST body:
 * {
 *   group: {
 *     agentNo: string,
 *     agentName?: string,
 *     agentEmail?: string,
 *     agentViewUrl?: string,
 *     items: Array<{ tradeNo?: string, branchName?: string }>
 *   }
 * }
 */

function esc(s) {
  return (s == null ? "" : String(s)).trim();
}

function rowsHtml(items = []) {
  if (!items.length) {
    return `<tr><td colspan="2" style="color:#6c757d;padding:4px 6px;line-height:1.2;">(No pending records)</td></tr>`;
  }
  return items
    .map(
      (it) => `
      <tr>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;line-height:1.2;">${esc(it.tradeNo || "-")}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;line-height:1.2;">${esc(it.branchName || "-")}</td>
      </tr>`
    )
    .join("");
}

function rowsText(items = []) {
  if (!items.length) return "(No pending records)";
  return items
    .map((it) => ` - Trade: ${esc(it.tradeNo || "-")} | Branch: ${esc(it.branchName || "-")}`)
    .join("\n");
}

export const handler = async (event) => {
  // Health check
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
          "Invalid payload: { group: { agentEmail?, agentViewUrl?, items:[] } } required",
      };
    }

    const agentEmail = esc(group.agentEmail);
    const agentViewUrl = esc(group.agentViewUrl);
    const greet = "Hello,";

    const subject = `[Reminder] Pending Trade Record Review (${group.items.length})`;

    // Office 365 SMTP
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

    // Recipients (Production)
    const TO = agentEmail || "itsupport@livingrealtykw.com"; // safety fallback
    const CC = "accounting@livingrealtykw.com";
    const BCC = "itsupport@livingrealtykw.com";
    const FROM = `KW Living Realty <${process.env.O365_USER}>`;

    const openLinkHtml = agentViewUrl
      ? `<p><a href="${agentViewUrl}" target="_blank" style="color:#0d6efd;">Open Trade Review</a></p>`
      : "";

    const html = `
      <div style="font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111;">
        <p>${greet}</p>
        <p>This is a system reminder for your pending trade records that require your review and approval.</p>
        ${openLinkHtml}

        <table style="border-collapse:collapse;width:100%;max-width:760px;margin:10px 0;border:1px solid #eee;font-size:12px;line-height:1.2;">
          <thead>
            <tr style="background:#f8f9fa;">
              <th align="left" style="padding:6px;border-bottom:1px solid #eee;">Trade No.</th>
              <th align="left" style="padding:6px;border-bottom:1px solid #eee;">Branch</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml(group.items)}
          </tbody>
        </table>

        <p style="color:#6c757d;font-size:12px;margin-top:12px;">
          If there is any problem, please contact 
          <a href="mailto:accounting@livingrealtykw.com" style="color:#0d6efd;">accounting@livingrealtykw.com</a>.
        </p>
      </div>
    `;

    const text =
      `${greet}\n\n` +
      `This is a system reminder for your pending trade records that require your review and approval.\n` +
      (agentViewUrl ? `Trade Review Link: ${agentViewUrl}\n\n` : `\n`) +
      `Items:\n${rowsText(group.items)}\n\n` +
      `This is a scheduled system email. Please do not reply.\n` +
      `For questions, contact accounting@livingrealtykw.com.\n`;

    await transporter.sendMail({
      from: FROM,
      to: TO,
      cc: CC,
      bcc: BCC,
      subject,
      text,
      html,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        sentTo: TO,
        cc: CC,
        bcc: BCC,
        count: group.items.length,
      }),
    };
  } catch (err) {
    console.error("send-agent-reminder error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
