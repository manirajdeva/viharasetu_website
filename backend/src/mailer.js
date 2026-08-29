/**
 * mailer.js
 * One tiny outbound-email helper with three transports, chosen by MAIL_TRANSPORT:
 *   console — write the message to the server log (default; no setup needed)
 *   smtp    — SMTP_HOST/PORT/USER/PASS (e.g. a Gmail account + app password)
 *   resend  — RESEND_API_KEY (https://resend.com; needs a verified domain)
 *
 * Used only for the password-reset OTP. Keep the body plain text.
 */

const config = require('./config');
const log = require('./logger');

async function sendMail({ to, subject, text }) {
  const t = config.mail.transport || 'console';

  if (t === 'console') {
    log.info(`[mailer:console] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
    return;
  }

  if (t === 'resend') {
    if (!config.mail.resendApiKey) throw new Error('MAIL_TRANSPORT=resend but RESEND_API_KEY is not set.');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mail.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: config.mail.from, to: [to], subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend responded ${res.status}: ${body.slice(0, 200)}`);
    }
    return;
  }

  if (t === 'smtp') {
    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch {
      throw new Error('MAIL_TRANSPORT=smtp needs the "nodemailer" package (npm install).');
    }
    const { host, port, user, pass } = config.mail.smtp;
    if (!host || !user) throw new Error('MAIL_TRANSPORT=smtp but SMTP_HOST / SMTP_USER are not set.');
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({ from: config.mail.from, to, subject, text });
    return;
  }

  throw new Error(`Unknown MAIL_TRANSPORT: "${t}" (use console | smtp | resend).`);
}

module.exports = { sendMail };
