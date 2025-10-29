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
 */

function esc(s) {
  return (s == null ? "" : String(s)).trim();
}

// Map incoming branchName to the display version
function displayBranchName(raw) {
  const v = (raw || "").trim().toUpperCase();
  if (v === "YONGE & EGLINTO") return "YONGE & EGLINTON BRANCH";
  if (v === "WOODBINE BRANCH") return "WOODBINE BRANCH";
  if (v === "NORTH MARKHAM") return "NORTH MARKHAM BRANCH";
  if (v === "ICI BRANCH") return "ICI BRANCH";
  if (v === "MISSISSAUGA OFF") return "MISSISSAUGA BRANCH";
  // default: return original as-is
  return raw || "(No branch)";
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
          "Invalid payload: { group: { branchName, branchId, managerName?, managerEmail?, items:[] } } required",
      };
    }

    // Link for manager view
    const link =
      typeof group.branchId === "number"
        ? `https://lridocreview.netlify.app/kwdocreviewmanager.html?branchid=${group.branchId}`
        : "";

    // Normalize branch name for display
    const branchDisplay = displayBranchName(group.branchName);

    // Greeting with manager name
    const managerName = esc(group.managerName);
    const greet = managerName ? `Hi ${managerName},` : "Hello,";

    // Transporter (same settings as your working gala function)
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

    const TO = process.env.TEST_TO || "itsupport@livingrealtykw.com";
    const FROM = `KW Living Realty <${process.env.O365_USER}>`;

    const subject = `[Reminder] Pending Trades — ${branchDisplay} (${group.items.length})`;

    // Smaller font + tighter rows (font-size:12px; padding 4px; line-height 1.2)
    const html = `
      <div style="font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111;">
        <p>${greet}</p>
        <p>This is a scheduled system reminder for <strong>${esc(branchDisplay)}</strong> with pending trade records requiring manager attention.</p>
        ${
          link
            ? `<p><a href="${link}" target="_blank" style="color:#0d6efd;">Open Manager View</a></p>`
            : ""
        }
        ${
          group.managerEmail
            ? `<p style="color:#6c757d;margin:6px 0 0 0;">Manager Email: &lt;${esc(group.managerEmail)}&gt;</p>`
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
          For questions, contact the Accounting Team at
          <a href="mailto:accounting@livingrealtykw.com" style="color:#0d6efd;">accounting@livingrealtykw.com</a>.
        </p>
      </div>
    `;

    const text =
      `${greet}\n\n` +
      `This is a scheduled system reminder for ${branchDisplay} with pending trade records requiring manager attention.\n` +
      (link ? `Manager View: ${link}\n\n` : `\n`) +
      (group.managerEmail ? `Manager Email: <${esc(group.managerEmail)}>\n\n` : "") +
      `Items:\n${rowsText(group.items)}\n\n` +
      `This is a scheduled system email. Please do not reply.\n` +
      `For questions, contact accounting@livingrealtykw.com.\n`;

    await transporter.sendMail({
      from: FROM,
      to: TO, // still sending to test address
      subject,
      text,
      html,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sentTo: TO, count: group.items.length }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
