import nodemailer from "nodemailer";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    const { submissionId, agentName, branch, email, guests = [], createdAt } = data;

    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.O365_USER,
        pass: process.env.O365_PASS,   // use your Netlify env var
      },
      requireTLS: true,
    });

    const guestListHtml = guests.length
      ? `<ul>${guests.map((g) => `<li>${(g.firstName||"").trim()} ${(g.lastName||"").trim()}</li>`).join("")}</ul>`
      : "<p>No guests added.</p>";

    const guestListText = guests.length
      ? guests.map((g) => ` - ${(g.firstName||"").trim()} ${(g.lastName||"").trim()}`).join("\n")
      : "No guests added.";

    // 1. Send confirmation to registrant
    await transporter.sendMail({
      from: `KW Living Realty <${process.env.O365_USER}>`,
      to: email,
      subject: "2025 Xmas Gala Registration Confirmation",
      text:
        `Hi ${agentName},\n\n` +
        `Thank you for registering for the 2025 Xmas Gala.\n` +
        `Branch: ${branch}\n` +
        `Submission Ref: ${submissionId}\n` +
        `Guests:\n${guestListText}\n\n` +
        `We will follow up with details closer to the event.\n\n— KW Living Realty`,
      html:
        `<p>Hi ${agentName},</p>` +
        `<p>Thank you for registering for the <strong>2025 Xmas Gala</strong>.</p>` +
        `<p><strong>Branch:</strong> ${branch}<br/><strong>Submission Ref:</strong> ${submissionId}</p>` +
        `<p><strong>Guests</strong>:</p>${guestListHtml}` +
        `<p>We will follow up with details closer to the event.</p>` +
        `<p>— KW Living Realty</p>`,
    });

    // 2. Send internal notice
    await transporter.sendMail({
      from: `KW Living Realty <${process.env.O365_USER}>`,
      to: "operations@livinggroupinc.com",
      subject: `New Xmas Gala Registration — ${agentName} (${branch})`,
      text:
        `Submission: ${submissionId}\n` +
        `Created: ${createdAt || "(from client)"}\n` +
        `Agent/Staff: ${agentName}\n` +
        `Branch: ${branch}\n` +
        `Email: ${email}\n` +
        `Guests:\n${guestListText}`,
      html:
        `<p><strong>Submission:</strong> ${submissionId}</p>` +
        `<p><strong>Created:</strong> ${createdAt || "(from client)"}</p>` +
        `<p><strong>Agent/Staff:</strong> ${agentName}<br/>` +
        `<strong>Branch:</strong> ${branch}<br/>` +
        `<strong>Email:</strong> ${email}</p>` +
        `<p><strong>Guests</strong>:</p>${guestListHtml}`,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
