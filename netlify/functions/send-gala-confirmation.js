// netlify/functions/send-gala-confirmation.js
import nodemailer from "nodemailer";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    const {
      submissionId,
      agentName,
      branch,
      email,
      guests = [],
      createdAt,
      // new from client: registrant dietary info (optional)
      registrantDiet = {} // { vegetarian: boolean, allergies: string }
    } = data;

    const yesNo = (b) => (b ? "Yes" : "No");
    const safe = (s) => (s || "").trim();
    const fmtDiet = (diet) =>
      `<ul style="margin:0;padding-left:18px;">
        <li><strong>Vegetarian:</strong> ${yesNo(!!diet.vegetarian)}</li>
        <li><strong>Allergies:</strong> ${safe(diet.allergies) || "—"}</li>
      </ul>`;

    // Build guest list with dietary
    const guestListHtml = guests.length
      ? `<table style="border-collapse:collapse;width:100%;max-width:560px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 4px;">First</th>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 4px;">Last</th>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 4px;">Vegetarian</th>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 4px;">Allergies</th>
            </tr>
          </thead>
          <tbody>
            ${guests
              .map(
                (g) => `
              <tr>
                <td style="border-bottom:1px solid #eee;padding:6px 4px;">${safe(g.firstName)}</td>
                <td style="border-bottom:1px solid #eee;padding:6px 4px;">${safe(g.lastName)}</td>
                <td style="border-bottom:1px solid #eee;padding:6px 4px;">${yesNo(!!g.vegetarian)}</td>
                <td style="border-bottom:1px solid #eee;padding:6px 4px;">${safe(g.allergies) || "—"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
      : "<p>No guests added.</p>";

    const guestListText = guests.length
      ? guests
          .map(
            (g) =>
              ` - ${safe(g.firstName)} ${safe(g.lastName)} | Vegetarian: ${yesNo(
                !!g.vegetarian
              )} | Allergies: ${safe(g.allergies) || "—"}`
          )
          .join("\n")
      : "No guests added.";

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

    // 1) Confirmation to registrant (now includes registrant dietary + guest dietary)
    await transporter.sendMail({
      from: `KW Living Realty <${process.env.O365_USER}>`,
      to: email,
      subject: "45th Christmas Gala Registration Confirmation",
      text:
        `Hi ${agentName},\n\n` +
        `Thank you for registering for the 45th Christmas Gala.\n\n` +
        `Branch: ${branch}\n` +
        `Submission Ref: ${submissionId}\n` +
        `\n` +
        `Your Meal Preferences:\n` +
        ` - Vegetarian: ${yesNo(!!registrantDiet.vegetarian)}\n` +
        ` - Allergies: ${safe(registrantDiet.allergies) || "—"}\n` +
        `\n` +
        `Guest(s):\n${guestListText}\n\n` +
        `We will follow up with details closer to the event.\n\n— KW Living Realty`,
      html:
        `<p>Hi ${agentName},</p>` +
        `<p>Thank you for registering for the <strong>45th Christmas Gala</strong>.</p>` +
        `<p><strong>Branch:</strong> ${branch}<br/><strong>Submission Ref:</strong> ${submissionId}</p>` +
        `<p><strong>Your Meal Preferences</strong>:</p>${fmtDiet(registrantDiet)}` +
        `<p><strong>Guest(s)</strong>:</p>${guestListHtml}` +
        `<p>We will follow up with details closer to the event.</p>` +
        `<p>— KW Living Realty</p>`,
    });

    // 2) Internal notice (adds registrant & guest dietary for kitchen/seating)
    await transporter.sendMail({
      from: `KW Living Realty <${process.env.O365_USER}>`,
      to: "itoperations@livinggroupinc.com",
      subject: `New Xmas Gala Registration — ${agentName} (${branch})`,
      text:
        `Submission: ${submissionId}\n` +
        `Created: ${createdAt || "(from client)"}\n` +
        `Agent/Staff: ${agentName}\n` +
        `Branch: ${branch}\n` +
        `Email: ${email}\n` +
        `\n` +
        `Registrant Dietary:\n` +
        ` - Vegetarian: ${yesNo(!!registrantDiet.vegetarian)}\n` +
        ` - Allergies: ${safe(registrantDiet.allergies) || "—"}\n` +
        `\n` +
        `Guests:\n${guestListText}`,
      html:
        `<p><strong>Submission:</strong> ${submissionId}</p>` +
        `<p><strong>Created:</strong> ${createdAt || "(from client)"}</p>` +
        `<p><strong>Agent/Staff:</strong> ${agentName}<br/>` +
        `<strong>Branch:</strong> ${branch}<br/>` +
        `<strong>Email:</strong> ${email}</p>` +
        `<p><strong>Registrant Dietary</strong>:</p>${fmtDiet(registrantDiet)}` +
        `<p><strong>Guest(s)</strong>:</p>${guestListHtml}`,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
