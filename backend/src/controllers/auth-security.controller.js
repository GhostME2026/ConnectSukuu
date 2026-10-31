const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { signToken } = require('../utils/jwt');
const { sendSms } = require('../services/bmsSms.service');

const sha = value => {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) throw new Error('JWT_SECRET must be configured before OTP or password reset can be used.');
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
};
const randomCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const genericReset = 'If an eligible account matches those details, password reset instructions will be sent.';
const genericOtp = 'If this account is eligible, a verification code has been sent.';
async function getSettings() {
  return prisma.otpPlatformSettings.upsert({where:{id:'global'},create:{id:'global'},update:{}});
}
async function otpPolicy(user, channel) {
  const global=await getSettings();
  // Super Admin is deliberately excluded from staff sign-in OTP.
  if (user.role === 'SUPER_ADMIN' || !global.enabled || (channel==='EMAIL'&&!global.emailEnabled) || (channel==='SMS'&&!global.smsEnabled) || user.otpExempt) return false;
  if (user.schoolId) {
    const school=await prisma.otpSchoolSettings.findUnique({where:{schoolId:user.schoolId}});
    if (school && (!school.enabled || (channel==='EMAIL'&&!school.emailEnabled) || (channel==='SMS'&&!school.smsEnabled))) return false;
  }
  return true;
}
async function deliver(user, channel, code, purpose) {
  if (channel==='EMAIL') {
    if (!user.email) throw new Error('This account has no email address configured.');
    const apiKey=String(process.env.RESEND_API_KEY||'').trim();
    const from=String(process.env.RESEND_FROM||'').trim();
    if(!apiKey||!from) throw new Error('Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM.');
    const minutes = purpose === 'LOGIN' ? 10 : 15;
    const subject = purpose === 'LOGIN' ? 'Your ConnectSukuu sign-in code' : 'Reset your ConnectSukuu password';
    const html = securityEmailHtml({ code, purpose, minutes, name: user.firstName || 'there' });
    const text = `Hello ${user.firstName || 'there'}, your ConnectSukuu ${purpose === 'LOGIN' ? 'sign-in' : 'password reset'} code is ${code}. It expires in ${minutes} minutes. Do not share this code with anyone.`;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[user.email],subject,html,text}),signal:AbortSignal.timeout(15000)});
    if(!response.ok){const detail=await response.text().catch(()=> '');throw new Error(`Email provider rejected the message (${response.status}): ${detail.slice(0,180)}`);}
  } else {
    if (!user.phone) throw new Error('This account has no phone number configured.');
    const result = await sendSms({schoolId:user.schoolId||null,eventType:'OTP',recipient:user.phone,message:`ConnectSukuu ${purpose==='LOGIN'?'sign-in':'password reset'} code: ${code}. Expires in ${purpose==='LOGIN'?'10':'15'} minutes. Do not share it.`});
    if (result?.skipped) throw new Error('SMS delivery is disabled in Super Admin SMS Delivery settings.');
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function securityEmailHtml({ code, purpose, minutes, name }) {
  const isLogin = purpose === 'LOGIN';
  const heading = isLogin ? 'Your sign-in code' : 'Reset your password';
  const intro = isLogin
    ? 'Use this one-time code to securely access your ConnectSukuu workspace.'
    : 'We received a request to reset the password for your ConnectSukuu account.';
  const action = isLogin ? 'Complete your sign-in' : 'Continue your password reset';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:32px 12px;background:#f3f6fc;font-family:Arial,Helvetica,sans-serif;color:#17233c">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e3eaf5;border-radius:20px;overflow:hidden;box-shadow:0 16px 45px rgba(16,29,58,.08)">
    <div style="padding:30px 34px;background:linear-gradient(125deg,#101d3a 0%,#173b82 62%,#2563eb 100%);color:#fff">
      <div style="font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#bfdbfe">CONNECTSUKUU</div>
      <div style="font-size:27px;line-height:1.2;font-weight:800;margin-top:12px">School management,<br><span style="color:#93c5fd">made simpler.</span></div>
      <div style="font-size:13px;color:#dbeafe;margin-top:12px">A smarter way to keep your school connected.</div>
    </div>
    <div style="padding:34px">
      <div style="display:inline-block;padding:7px 11px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:700;letter-spacing:.7px">ACCOUNT SECURITY</div>
      <h1 style="font-size:25px;line-height:1.3;margin:18px 0 10px;color:#101d3a">${heading}</h1>
      <p style="font-size:15px;line-height:1.7;color:#52627b;margin:0 0 18px">Hello ${escapeHtml(name)}, ${intro}</p>
      <div style="padding:23px 16px;text-align:center;border:1px solid #dbeafe;border-radius:15px;background:linear-gradient(180deg,#f8fbff,#eff6ff)">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase">Your one-time code</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:36px;letter-spacing:9px;font-weight:800;color:#1d4ed8;margin:12px 0 7px">${escapeHtml(code)}</div>
        <div style="font-size:12px;color:#64748b">Expires in ${minutes} minutes</div>
      </div>
      <p style="font-size:14px;line-height:1.7;color:#52627b;margin:22px 0 0">${action}. Enter the code in the ConnectSukuu page where you started this request.</p>
      <div style="margin-top:22px;padding:14px 16px;border-left:3px solid #f59e0b;background:#fffbeb;color:#854d0e;font-size:12px;line-height:1.6"><strong>Keep your account safe:</strong> Never share this code. ConnectSukuu staff will never ask you to send it to them. If you did not make this request, you can safely ignore this email.</div>
      <p style="font-size:14px;line-height:1.6;color:#52627b;margin:26px 0 0">Regards,<br><strong style="color:#101d3a">The ConnectSukuu Team</strong></p>
    </div>
    <div style="padding:18px 30px;background:#f8fafc;border-top:1px solid #e8edf5;text-align:center;color:#94a3b8;font-size:11px;line-height:1.6">© ${new Date().getFullYear()} ConnectSukuu · Accra, Ghana<br>This is an automated account-security message. Please do not reply.</div>
  </div></body></html>`;
}

exports.beginLoginOtp = async(user, channel='EMAIL') => {
 const normalized=String(channel||'EMAIL').toUpperCase();
 if(!['EMAIL','SMS'].includes(normalized)) throw new Error('Choose email or SMS verification.');
 if(!await otpPolicy(user,normalized)) throw new Error('This verification method is not enabled for this account.');
 const recent=await prisma.authOtpChallenge.count({where:{userId:user.id,purpose:'LOGIN',createdAt:{gte:new Date(Date.now()-60*60*1000)}}});
 if(recent>=5) throw new Error('Too many verification requests. Try again later.');
 const code=randomCode(),expiresAt=new Date(Date.now()+10*60*1000);
 await prisma.authOtpChallenge.updateMany({where:{userId:user.id,purpose:'LOGIN',usedAt:null},data:{usedAt:new Date()}});
 const challenge=await prisma.authOtpChallenge.create({data:{userId:user.id,schoolId:user.schoolId,channel:normalized,purpose:'LOGIN',codeHash:sha(code),expiresAt}});
 await deliver(user,normalized,code,'LOGIN');
 return challenge.id;
};
exports.verifyLoginOtp = async(req,res,next)=>{
 try {
  const id=String(req.body.challengeId||''), code=String(req.body.code||'').trim();
  const c=await prisma.authOtpChallenge.findUnique({where:{id},include:{user:true}});
  if(!c||c.purpose!=='LOGIN'||c.usedAt||c.expiresAt<=new Date()||c.attempts>=5) return res.status(400).json({error:'The code is invalid or has expired.'});
  if(sha(code)!==c.codeHash){await prisma.authOtpChallenge.update({where:{id},data:{attempts:{increment:1}}});return res.status(400).json({error:'The code is invalid or has expired.'});}
  await prisma.authOtpChallenge.update({where:{id},data:{usedAt:new Date()}});
  if(c.user.isActive===false) return res.status(403).json({error:'This account is inactive.'});
  const u=c.user, token=signToken({userId:u.id,schoolId:u.schoolId,role:u.role});
  res.json({token,user:{id:u.id,email:u.email,role:u.role,schoolId:u.schoolId,branchId:u.branchId,isActive:u.isActive,mustChangePassword:u.mustChangePassword},requiresPasswordChange:u.mustChangePassword});
 }catch(e){next(e);}
};
exports.requestPasswordReset=async(req,res)=>{
 try{
  const identifier=String(req.body.identifier||req.body.email||'').trim().toLowerCase();
  const user=identifier?await prisma.user.findFirst({where:{OR:[{email:identifier},{phone:identifier}]}}):null;
  if(user&&user.isActive!==false&&user.role!=='SUPER_ADMIN'){
   const channel=String(req.body.channel||'EMAIL').toUpperCase();
   if(['EMAIL','SMS'].includes(channel)){
    const recent=await prisma.passwordResetToken.count({where:{userId:user.id,createdAt:{gte:new Date(Date.now()-60*60*1000)}}});
    if(recent>=3) return res.json({ok:true,message:genericReset});
    const code=randomCode(),expiresAt=new Date(Date.now()+15*60*1000);
    await prisma.passwordResetToken.updateMany({where:{userId:user.id,usedAt:null},data:{usedAt:new Date()}});
    const row=await prisma.passwordResetToken.create({data:{userId:user.id,tokenHash:sha(code),expiresAt,channel}});
    try{await deliver(user,channel,code,'RESET');}catch(e){console.error('[password-reset-delivery]',e.message);await prisma.passwordResetToken.update({where:{id:row.id},data:{usedAt:new Date()}});}
   }
  }
  res.json({ok:true,message:genericReset});
 }catch(e){console.error('requestPasswordReset',e);res.json({ok:true,message:genericReset});}
};
exports.completePasswordReset=async(req,res)=>{
 try{
  const code=String(req.body.code||'').trim(),identifier=String(req.body.identifier||'').trim().toLowerCase(),password=String(req.body.newPassword||'');
  if(password.length<8) return res.status(400).json({error:'Password must be at least 8 characters long.'});
  const user=await prisma.user.findFirst({where:{OR:[{email:identifier},{phone:identifier}]}});
  if(!user||user.role==='SUPER_ADMIN') return res.status(400).json({error:'The reset code is invalid or has expired.'});
  if (user.role === 'OWNER' && (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))) {
    return res.status(400).json({error:'Owner passwords must be at least 12 characters and include uppercase, lowercase, a number and a symbol.'});
  }
  const row=await prisma.passwordResetToken.findFirst({where:{userId:user.id,usedAt:null,expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'}});
  if(!row||row.attempts>=5||sha(code)!==row.tokenHash){if(row) await prisma.passwordResetToken.update({where:{id:row.id},data:{attempts:{increment:1}}});return res.status(400).json({error:'The reset code is invalid or has expired.'});}
  const passwordHash=await bcrypt.hash(password,12);
  await prisma.$transaction([
   prisma.user.update({where:{id:user.id},data:{passwordHash,mustChangePassword:false,passwordChangedAt:new Date()}}),
   prisma.passwordResetToken.update({where:{id:row.id},data:{usedAt:new Date()}}),
   prisma.passwordResetToken.updateMany({where:{userId:user.id,usedAt:null},data:{usedAt:new Date()}})
  ]);
  res.json({ok:true,message:'Password reset successfully. Sign in with your new password.'});
 }catch(e){console.error('completePasswordReset',e);res.status(500).json({error:'Could not reset password. Please try again.'});}
};
