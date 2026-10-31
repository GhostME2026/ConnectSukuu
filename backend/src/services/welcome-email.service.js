const prisma = require('../config/db');
async function sendWelcomeEmail(user, school) {
  try {
    const settings = await prisma.otpPlatformSettings.upsert({
      where: { id: 'global' }, create: { id: 'global' }, update: {}
    });
    if (!settings.welcomeEmailEnabled || !user?.email) return { skipped: true };
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.RESEND_FROM || '').trim();
    if (!apiKey || !from) {
      console.warn('[welcome-email] Resend is not configured; signup remains successful.');
      return { skipped: true };
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17233c"><div style="background:#142b63;padding:28px 32px;border-radius:16px 16px 0 0;color:#fff"><h1 style="margin:0;font-size:25px">Welcome to Connect<span style="color:#72a5ff">Sukuu</span></h1><p style="margin:8px 0 0;color:#dbeafe">Your school journey starts here.</p></div><div style="padding:30px 32px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px"><p>Hello ${escapeHtml(name)},</p><p>Thank you for choosing ConnectSukuu. Your school workspace for <strong>${escapeHtml(school.name)}</strong> has been created.</p><p>From one place, you can organise school operations, manage staff and learners, monitor attendance and fees, and keep families informed.</p><p>Your account is ready. Sign in using the email address and password you registered with.</p><p style="margin-top:28px">Warm regards,<br><strong>ConnectSukuu Team</strong><br><span style="color:#64748b">School management, made simpler.</span></p></div></div>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [user.email], subject: `Welcome to ConnectSukuu, ${name}`, html }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Resend returned ${response.status}: ${(await response.text()).slice(0,160)}`);
    return { sent: true };
  } catch (error) {
    console.error('[welcome-email]', error.message);
    return { sent: false };
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
module.exports = { sendWelcomeEmail };
