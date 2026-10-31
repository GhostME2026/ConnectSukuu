const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { signToken } = require('../utils/jwt');
const { sendSms } = require('../services/bmsSms.service');

const sha = value => crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'connectsukuu-otp-secret-must-be-configured')).update(value).digest('hex');
const randomCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const genericReset = 'If an eligible account matches those details, password reset instructions will be sent.';
const genericOtp = 'If this account is eligible, a verification code has been sent.';
async function getSettings() {
  return prisma.otpPlatformSettings.upsert({where:{id:'global'},create:{id:'global'},update:{}});
}
async function otpPolicy(user, channel) {
  const global=await getSettings();
  if (!global.enabled || (channel==='EMAIL'&&!global.emailEnabled) || (channel==='SMS'&&!global.smsEnabled) || user.otpExempt) return false;
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
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[user.email],subject:purpose==='LOGIN'?'ConnectSukuu sign-in code':'ConnectSukuu password reset code',text:`Your ConnectSukuu verification code is ${code}. It expires in ${purpose==='LOGIN'?'10':'15'} minutes. Do not share this code.`}),signal:AbortSignal.timeout(15000)});
    if(!response.ok){const detail=await response.text().catch(()=> '');throw new Error(`Email provider rejected the message (${response.status}): ${detail.slice(0,180)}`);}
  } else {
    if (!user.phone) throw new Error('This account has no phone number configured.');
    const result = await sendSms({schoolId:user.schoolId||null,eventType:'OTP',recipient:user.phone,message:`ConnectSukuu ${purpose==='LOGIN'?'sign-in':'password reset'} code: ${code}. Expires in ${purpose==='LOGIN'?'10':'15'} minutes. Do not share it.`});
    if (result?.skipped) throw new Error('SMS delivery is disabled in Super Admin SMS Delivery settings.');
  }
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
  if(password.length<10) return res.status(400).json({error:'Use a password with at least 10 characters.'});
  const user=await prisma.user.findFirst({where:{OR:[{email:identifier},{phone:identifier}]}});
  if(!user||user.role==='SUPER_ADMIN') return res.status(400).json({error:'The reset code is invalid or has expired.'});
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
