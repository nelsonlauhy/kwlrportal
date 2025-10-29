// netlify/functions/send-manager-reminder.js
import nodemailer from "nodemailer";

/**
 * Expected POST body:
 * {
 *   group: {
 *     branchName: string,
 *     branchId: number,
 *     managerName?: string,
 *     managerEmail?: string,
 *     items: Array<{ tradeNo?: string, agentNo?: string, agentName?: string }>
 *   }
 * }
 *
 * The HTML page calls this function ONCE PER BRANCH.
 */

function esc(s) {
  return (s == null ? "" : String(s)).trim();
}

function rowsHtml(items = []) {
  if (!items.length) {
    return `<tr><td colspan="3" style="color:#6c757d;padding:8px 0;">(No pending records)</td></tr>`;
  }
  return items
    .map(
      (it) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(it.tradeNo || "-")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(it.agentNo || "-")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(it.agentName || "-")}</td>
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
  // Simple health ping
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
          "Invalid payload: { group: { branchName, branchId, managerName?, managerEmail?, items:[] } } required",
      };
    }

    // Build the manager view link from branchId
    const link =
      typeof group.branchId === "number"
        ? `https://lridocreview.netlify.app/kwdocreviewmanager.html?branchid=${group.branchId}`
        : "";

    // Use the same transporter config as your working gala function
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

    // Where to send: keep it on the test alias unless you flip it later
    const TO = process.env.TEST_TO || "itsupport@livingrealtykw.com";
    const FROM = `KW Living Realty <${process.env.O365_USER}>`;

    const branchName = esc(group.branchName || "(No branch)");
    const subject = `[Reminder] Pending Trades — ${branchName} (${group.items.length})`;

    const html = `
      <div style="font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111;">
        <p>Hello,</p>
        <p>This is a scheduled system reminder for <strong>${branchName}</strong> with pending trade records requiring manager attention.</p>
        ${
          link
            ? `<p><a href="${link}" target="_blank" style="color:#0d6efd;">Open Manager View</a></p>`
            : ""
        }
        ${
          group.managerName || group.managerEmail
            ? `<p style="color:#6c757d;margin:6px 0 0 0;">
                 Manager: ${esc(group.managerName || "—")}
                 ${group.managerEmail ? `&lt;${esc(group.managerEmail)}&gt;` : ""}
               </p>`
            : ""
        }

        <table style="border-collapse:collapse;width:100%;max-width:760px;margin:12px 0;border:1px solid #eee;">
          <thead>
            <tr style="background:#f8f9fa;">
              <th align="left" style="padding:8px;border-bottom:1px solid #eee;">Trade No.</th>
              <th align="left" style="padding:8px;border-bottom:1px solid #eee;">Agent No.</th>
              <th align="left" style="padding:8px;border-bottom:1px solid #eee;">Agent Name</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml(group.items)}
          </tbody>
        </table>

        <p style="color:#6c757d;font-size:13px;margin-top:16px;">
          This is a scheduled system email. Please do not reply to this message.<br/>
          For questions, contact the Accounting Team at
          <a href="mailto:accounting@livingrealtykw.com" style="color:#0d6efd;">accounting@livingrealtykw.com</a>.
        </p>
      </div>
    `;

    const text =
      `Hello,\n\n` +
      `This is a scheduled system reminder for ${branchName} with pending trade records requiring manager attention.\n` +
      (link ? `Manager View: ${link}\n\n` : `\n`) +
      (group.managerName || group.managerEmail
        ? `Manager: ${esc(group.managerName || "—")} ${group.managerEmail ? `<${esc(group.managerEmail)}>` : ""}\n\n`
        : "") +
      `Items:\n${rowsText(group.items)}\n\n` +
      `This is a scheduled system email. Please do not reply.\n` +
      `For questions, contact accounting@livingrealtykw.com.\n`;

    await transporter.sendMail({
      from: FROM,
      to: TO, // keep test first
      subject,
      text,
      html,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, sentTo: TO, count: group.items.length }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
