const prisma = require('../config/db');
const fs = require('fs');
const path = require('path');
const { createStudentNotifications } = require('../utils/studentNotifications');
const { sendSms } = require('../services/bmsSms.service');
const OWNER_ANNOUNCERS = ['OWNER'];
const ANNOUNCERS = ['OWNER','HEAD_TEACHER','HEAD_OF_ACADEMICS','ADMINISTRATOR'];
const SUPPORT_ROLES = ['OWNER','HEAD_TEACHER','ADMINISTRATOR'];
const MESSAGE_BLOCKED_FOR_OWNER = ['STUDENT','PARENT'];
const MESSAGE_UPLOAD_DIR = path.resolve(__dirname,'../../uploads/messages');
const STAFF_ROLES = ['OWNER','HEAD_TEACHER','HEAD_OF_ACADEMICS','ADMINISTRATOR','ACCOUNTANT','TEACHER','NURSE','SECURITY','STUDENT','PARENT'];
const MESSAGE_ROLES = ['OWNER','HEAD_TEACHER','HEAD_OF_ACADEMICS','ADMINISTRATOR','ACCOUNTANT','NURSE'];
const MESSAGE_RECIPIENT_ROLES = ['OWNER','HEAD_TEACHER','HEAD_OF_ACADEMICS','ADMINISTRATOR','ACCOUNTANT','NURSE'];
const announcementInFlight = new Set();
function messagePageForRole(role){return ({OWNER:'owner-messages.html',HEAD_TEACHER:'headteacher-messages.html',ADMINISTRATOR:'administrator-messages.html',HEAD_OF_ACADEMICS:'hoa-dashboard.html',ACCOUNTANT:'accountant-dashboard.html',NURSE:'nurse-messages.html'})[role]||'owner-notifications.html';}
function announcementPageForRole(role){return ({OWNER:'owner-announcements.html',HEAD_TEACHER:'headteacher-announcements.html',ADMINISTRATOR:'administrator-announcements.html',HEAD_OF_ACADEMICS:'hoa-dashboard.html',ACCOUNTANT:'accountant-dashboard.html',TEACHER:'teacher-announcements.html',NURSE:'nurse-announcements.html',SECURITY:'security-announcements.html',STUDENT:'student-announcements.html',PARENT:'parent-announcements.html'})[role]||'owner-notifications.html';}
const ANNOUNCEMENT_BLOCKED = { ADMINISTRATOR: ['OWNER','SUPER_ADMIN','ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS'], HEAD_TEACHER: ['OWNER','SUPER_ADMIN','ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS'], HEAD_OF_ACADEMICS: ['OWNER','SUPER_ADMIN','ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS'] };
function allowedAnnouncementRoles(role){ return STAFF_ROLES.filter(r => !(ANNOUNCEMENT_BLOCKED[role] || []).includes(r)); }
const clean = v => typeof v === 'string' ? v.trim() : '';
const isOwner = req => req.user.role === 'OWNER';
function fail(res, status, error) { return res.status(status).json({ error }); }

async function createAnnouncement(req, res) {
  if (!ANNOUNCERS.includes(req.user.role)) return fail(res,403,'Your role cannot publish announcements.');
  const title = clean(req.body.title), content = clean(req.body.content);
  let audienceRoles = Array.isArray(req.body.audienceRoles) ? [...new Set(req.body.audienceRoles.map(x=>String(x).toUpperCase()).filter(x=>STAFF_ROLES.includes(x)))] : [];
  let audienceAll = Boolean(req.body.audienceAll);
  let branchId = req.body.branchId || null;
  if (!title || !content) return fail(res,400,'Announcement title and content are required.');
  if (!isOwner(req)) {
    branchId = req.user.branchId;
    if (!branchId) return fail(res,403,'Assign your account to a branch before publishing announcements.');
    const permitted = allowedAnnouncementRoles(req.user.role);
    audienceRoles = audienceRoles.filter(r => permitted.includes(r));
    if (audienceAll) audienceRoles = permitted;
    // Non-owner broadcasts are expanded to eligible groups, never to peer leadership roles.
    audienceAll = false;
  } else if (branchId) {
    const branch = await prisma.branch.findFirst({where:{id:branchId,schoolId:req.user.schoolId}});
    if (!branch) return fail(res,400,'Choose a valid branch.');
  }
  if (!audienceAll && !audienceRoles.length) return fail(res,400,'Choose at least one audience group or select everyone.');
  const requestKey = JSON.stringify([req.user.schoolId,req.user.id,title,content,Boolean(audienceAll),[...audienceRoles].sort(),branchId||null]);
  if (announcementInFlight.has(requestKey)) return fail(res,409,'This announcement is already being published. Please wait for the current request to finish.');
  announcementInFlight.add(requestKey);
  try {
    const announcement = await prisma.announcement.create({data:{schoolId:req.user.schoolId,branchId,createdById:req.user.id,title,content,audienceAll,audienceRoles}});
    const roleFilter = audienceAll ? STAFF_ROLES : audienceRoles;
    const recipients = await prisma.user.findMany({where:{schoolId:req.user.schoolId,isActive:true,role:{in:roleFilter},...(branchId?{branchId}:{})},select:{id:true,role:true,branchId:true}});
    const filtered = recipients.filter(u => req.user.role==='OWNER' || u.role!=='OWNER');
    if (filtered.length) await prisma.userNotification.createMany({data:filtered.map(u=>({schoolId:req.user.schoolId,userId:u.id,type:'ANNOUNCEMENT',title,content:content.length>220?content.slice(0,217)+'…':content,targetUrl:announcementPageForRole(u.role)}))});
    let parentSmsSubmitted = 0, parentSmsSkipped = 0, parentSmsFailed = 0;
    if (audienceAll || audienceRoles.includes('PARENT')) {
      const parentStudents = await prisma.student.findMany({
        where: { schoolId: req.user.schoolId, status: 'ACTIVE', ...(branchId ? { branchId } : {}) },
        select: {
          id: true, guardianPhone: true,
          parentRelationships: {
            where: { canReceiveNotifications: true },
            select: { parent: { select: { user: { select: { phone: true } } } } }
          }
        }
      });
      const targets = new Map();
      for (const student of parentStudents) {
        const linkedPhones = (student.parentRelationships || []).map(r => String(r.parent?.user?.phone || '').trim()).filter(Boolean);
        const phones = linkedPhones.length ? linkedPhones : [String(student.guardianPhone || '').trim()].filter(Boolean);
        for (const phone of phones) if (!targets.has(phone)) targets.set(phone, { student, phone });
      }
      for (const [key, target] of targets) {
        try {
          const result = await sendSms({
            schoolId: req.user.schoolId, eventType: 'ANNOUNCEMENT', recipient: target.phone,
            message: `ConnectSukuu announcement: ${title}. ${content}`.slice(0, 500),
            idempotencyKey: `announcement:${announcement.id}:${key}`
          });
          if (result.skipped) parentSmsSkipped++; else if (result.sent) parentSmsSubmitted++;
        } catch (smsError) {
          parentSmsFailed++;
          console.error('createAnnouncement: parent SMS failed:', smsError.message || smsError);
        }
      }
    }
    let studentRecipientCount = 0;
    if (audienceAll || audienceRoles.includes('STUDENT')) {
      const students = await prisma.student.findMany({ where: { schoolId: req.user.schoolId, status: 'ACTIVE', ...(branchId ? { branchId } : {}) }, select: { id: true } });
      if (students.length) {
        const created = await createStudentNotifications({ schoolId: req.user.schoolId, studentIds: students.map(x => x.id), sourceKey: `announcement:${announcement.id}`, type: 'ANNOUNCEMENT', title, content, targetUrl: `announcement:${announcement.id}` });
        studentRecipientCount = created.count || 0;
      }
    }
    res.status(201).json({...announcement,recipientCount:filtered.length + studentRecipientCount,studentRecipientCount,parentSmsSubmitted,parentSmsSkipped,parentSmsFailed});
  } catch(e){console.error('createAnnouncement:',e);res.status(500).json({error:'Unable to publish announcement.'});}
  finally { announcementInFlight.delete(requestKey); }
}
async function listAnnouncements(req,res){
  try {
    const where={schoolId:req.user.schoolId};
    if(req.user.role!=='OWNER') where.OR=[{branchId:req.user.branchId},{branchId:null}];
    const rows=await prisma.announcement.findMany({where,orderBy:{createdAt:'desc'},take:100});
    res.json(rows.filter(a=>req.user.role==='OWNER'||a.createdById===req.user.id||(!a.audienceAll&&a.audienceRoles.includes(req.user.role))||a.audienceAll||a.audienceRoles.includes(req.user.role)));
  } catch(e){console.error('listAnnouncements:',e);res.status(500).json({error:'Unable to load announcements.'});}
}
async function listContacts(req,res){
  if(!MESSAGE_ROLES.includes(req.user.role)) return fail(res,403,'Direct messaging is not enabled for this role.');
  try {
    const eligibleRoles=MESSAGE_RECIPIENT_ROLES.filter(role=>role!=='OWNER');
    const select={id:true,firstName:true,lastName:true,email:true,role:true,branchId:true,photoUrl:true};
    const baseWhere={schoolId:req.user.schoolId,isActive:true,id:{not:req.user.id},role:{in:eligibleRoles}};
    let users=[];
    let owner=null;
    if(req.user.role==='OWNER'){
      // Owners can reach eligible staff across their school; never list another Owner as a recipient.
      users=await prisma.user.findMany({where:baseWhere,select,orderBy:[{role:'asc'},{firstName:'asc'}],take:500});
    } else {
      if(!req.user.branchId) return fail(res,403,'Assign your account to a branch before messaging.');
      // Keep staff branch-scoped, but fetch the active Owner separately because Owners commonly
      // have no branchId. This avoids accidentally excluding the Owner from the OR/branch filter.
      const [staff,schoolOwner]=await Promise.all([
        prisma.user.findMany({where:{...baseWhere,branchId:req.user.branchId},select,orderBy:[{role:'asc'},{firstName:'asc'}],take:500}),
        prisma.user.findFirst({where:{schoolId:req.user.schoolId,isActive:true,role:'OWNER',id:{not:req.user.id}},select})
      ]);
      users=staff;
      owner=schoolOwner;
    }
    if(owner)users.push(owner);
    users.sort((a,b)=>String(a.role||'').localeCompare(String(b.role||''))||String(a.firstName||'').localeCompare(String(b.firstName||''))||String(a.lastName||'').localeCompare(String(b.lastName||'')));
    res.json(users);
  } catch(e){console.error('listContacts:',e);res.status(500).json({error:'Unable to load message recipients.'});}
}
async function listMessages(req,res){
  if(!MESSAGE_ROLES.includes(req.user.role)) return fail(res,403,'Direct messaging is not enabled for this role.');
  try { const rows=await prisma.directMessage.findMany({where:{schoolId:req.user.schoolId,OR:[{senderId:req.user.id},{recipientId:req.user.id}]},orderBy:{createdAt:'desc'},take:500}); const ids=[...new Set(rows.flatMap(m=>[m.senderId,m.recipientId]))]; const people=ids.length?await prisma.user.findMany({where:{schoolId:req.user.schoolId,id:{in:ids}},select:{id:true,firstName:true,lastName:true,email:true,role:true,photoUrl:true}}):[]; const byId=new Map(people.map(p=>[p.id,p])); res.json(rows.reverse().map(m=>({...m,sender:byId.get(m.senderId)||null,recipient:byId.get(m.recipientId)||null,attachmentPath:undefined}))); }
  catch(e){console.error('listMessages:',e);res.status(500).json({error:'Unable to load messages.'});}
}
async function sendMessage(req,res){
  if(!MESSAGE_ROLES.includes(req.user.role)) return fail(res,403,'Direct messaging is not enabled for this role.');
  const recipientId=clean(req.body?.recipientId || req.body?.recipient), subject=clean(req.body?.subject), content=clean(req.body?.content || req.body?.message || req.body?.messageText);
  if(!recipientId||(!content&&!req.file)) return fail(res,400,'Choose a staff recipient and enter a message or attach a file. Check that the Owner workspace routes and upload middleware are installed and the backend has been restarted.');
  if(content.length>10000) return fail(res,400,'Message text must be 10,000 characters or fewer.');
  try{
    const recipient=await prisma.user.findFirst({where:{id:recipientId,schoolId:req.user.schoolId,isActive:true,role:{in:MESSAGE_RECIPIENT_ROLES}}});
    if(!recipient) return fail(res,404,'Recipient not found, inactive, or not eligible for direct messaging.');
    // Only the six message-enabled leadership/support roles can address one another.
    // Owner is not exposed to students, parents, teachers, or security accounts.
    if(!isOwner(req)&&(!req.user.branchId||(recipient.role!=='OWNER'&&recipient.branchId!==req.user.branchId))) return fail(res,403,'You can only message users within your assigned branch.');
    const message=await prisma.directMessage.create({data:{schoolId:req.user.schoolId,branchId:req.user.branchId||recipient.branchId||null,senderId:req.user.id,recipientId,subject,content:content||'(Attachment)',attachmentName:req.file?.originalname||null,attachmentPath:req.file?.filename||null}});
    let notificationWarning=false;
    try { await prisma.userNotification.create({data:{schoolId:req.user.schoolId,userId:recipient.id,type:'MESSAGE',title:subject||'New direct message',content:content.length>220?content.slice(0,217)+'…':content,targetUrl:messagePageForRole(recipient.role)}}); }
    catch(notificationError){notificationWarning=true;console.error('sendMessage: message saved but notification failed:',notificationError)}
    res.status(201).json({...message,attachmentPath:undefined,notificationWarning});
  }catch(e){console.error('sendMessage:',e);res.status(500).json({error:'Unable to send message.'});}
}
async function downloadMessageAttachment(req,res){
  if(!MESSAGE_ROLES.includes(req.user.role)) return fail(res,403,'You do not have access to direct-message attachments.');
  try{const message=await prisma.directMessage.findFirst({where:{id:req.params.id,schoolId:req.user.schoolId,OR:[{senderId:req.user.id},{recipientId:req.user.id}]}});if(!message)return fail(res,404,'Message not found.');if(!message.attachmentPath)return fail(res,404,'No attachment is available for this message.');const full=path.resolve(MESSAGE_UPLOAD_DIR,message.attachmentPath);if(!full.startsWith(MESSAGE_UPLOAD_DIR+path.sep)||!fs.existsSync(full))return fail(res,404,'Attachment file is unavailable.');return res.download(full,message.attachmentName||'message-attachment');}catch(e){console.error('downloadMessageAttachment:',e);return res.status(500).json({error:'Unable to download attachment.'});}
}
async function markMessageRead(req,res){
  if(!MESSAGE_ROLES.includes(req.user.role)) return fail(res,403,'Direct messaging is not enabled for this role.');
  try { const result=await prisma.directMessage.updateMany({where:{id:req.params.id,schoolId:req.user.schoolId,recipientId:req.user.id,readAt:null},data:{readAt:new Date()}}); if(!result.count){const exists=await prisma.directMessage.findFirst({where:{id:req.params.id,schoolId:req.user.schoolId,recipientId:req.user.id},select:{id:true}});if(!exists)return fail(res,404,'Incoming message not found.');} return res.json({message:'Message marked as read.'}); }
  catch(e){console.error('markMessageRead:',e);return res.status(500).json({error:'Unable to mark message as read.'});}
}
async function listNotifications(req,res){
  try{const rows=await prisma.userNotification.findMany({where:{schoolId:req.user.schoolId,userId:req.user.id},orderBy:{createdAt:'desc'},take:100});res.json(rows);}
  catch(e){console.error('listNotifications:',e);res.status(500).json({error:'Unable to load notifications.'});}
}
async function markNotificationRead(req,res){
  try{const item=await prisma.userNotification.findFirst({where:{id:req.params.id,schoolId:req.user.schoolId,userId:req.user.id}});if(!item)return fail(res,404,'Notification not found.');const updated=await prisma.userNotification.update({where:{id:item.id},data:{readAt:item.readAt||new Date()}});res.json(updated);}
  catch(e){console.error('markNotificationRead:',e);res.status(500).json({error:'Unable to update notification.'});}
}
async function createSupportTicket(req,res){
  if(!SUPPORT_ROLES.includes(req.user.role)) return fail(res,403,'Support access is limited to the Owner, Head Teacher and Administrator.');
  const category=clean(req.body.category),subject=clean(req.body.subject),content=clean(req.body.content);
  if(!category||!subject||!content) return fail(res,400,'Choose an issue category and enter a subject and description.');
  try{
    const ticket=await prisma.supportTicket.create({data:{schoolId:req.user.schoolId,branchId:req.user.branchId||null,createdById:req.user.id,category,subject,content,attachmentName:req.file?.originalname||clean(req.body.attachmentName)||null,attachmentPath:req.file?.filename||null}});
    const [school, requester, admins] = await Promise.all([
      prisma.school.findUnique({where:{id:req.user.schoolId},select:{name:true}}),
      prisma.user.findUnique({where:{id:req.user.id},select:{firstName:true,lastName:true,email:true,role:true}}),
      prisma.user.findMany({where:{role:'SUPER_ADMIN',isActive:true,email:{not:null}},select:{email:true}})
    ]);
    // Platform notifications work without a custom email domain or Resend configuration.
    try {
      await prisma.platformNotification.create({data:{
        type:'SUPPORT_TICKET',
        title:'New support ticket',
        content:`${school?.name||'A school'} submitted: ${subject}`,
        targetUrl:'admin.html?view=support'
      }});
    } catch(notificationError) {
      console.warn('[support-ticket-notification]',notificationError.message);
    }
    // Email is best-effort. Ticket creation must never fail because email is not configured.
    const apiKey=String(process.env.RESEND_API_KEY||'').trim(), from=String(process.env.RESEND_FROM||'').trim();
    if(apiKey&&from&&admins.length){
      const esc=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({
        from,to:admins.map(a=>a.email),subject:`New ConnectSukuu support ticket: ${subject}`,
        html:`<div style="font-family:Arial,sans-serif;background:#f3f6fc;padding:28px;color:#17233c"><div style="max-width:620px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><header style="padding:24px;background:#101d3a;color:white"><b style="color:#93c5fd">CONNECTSUKUU</b><h2>New support request</h2></header><main style="padding:26px"><p><b>School:</b> ${esc(school?.name)}</p><p><b>From:</b> ${esc((requester?.firstName||'')+' '+(requester?.lastName||''))} (${esc(requester?.email)})</p><p><b>Category:</b> ${esc(category)}</p><h3>${esc(subject)}</h3><p style="white-space:pre-wrap;line-height:1.6">${esc(content)}</p><p><a href="${esc(process.env.FRONTEND_URL||'https://connectsukuu.vercel.app')}/super-admin/admin.html?view=support">Open Support Inbox</a></p></main></div></div>`,
        text:`New support ticket from ${school?.name||'a school'}: ${subject}\n${content}`
      }),signal:AbortSignal.timeout(12000)}).catch(e=>console.warn('[support-ticket-email]',e.message));
    } else {
      console.info('[support-ticket-email] Email alert deferred: RESEND_API_KEY/RESEND_FROM or Super Admin email is missing.');
    }
    res.status(201).json({...ticket,attachmentPath:undefined});
  }
  catch(e){console.error('createSupportTicket:',e);res.status(500).json({error:'Unable to submit support request.'});}
}
async function listSupportTickets(req,res){
  if(!SUPPORT_ROLES.includes(req.user.role)) return fail(res,403,'You do not have access to support requests.');
  try{const where={schoolId:req.user.schoolId};if(req.user.role!=='OWNER')where.createdById=req.user.id;const rows=await prisma.supportTicket.findMany({where,orderBy:{createdAt:'desc'},take:100});res.json(rows);}
  catch(e){console.error('listSupportTickets:',e);res.status(500).json({error:'Unable to load support requests.'});}
}
async function downloadSupportAttachment(req,res){
  if(!SUPPORT_ROLES.includes(req.user.role)) return fail(res,403,'You do not have access to support attachments.');
  try{const where={id:req.params.id,schoolId:req.user.schoolId};if(req.user.role!=='OWNER')where.createdById=req.user.id;const ticket=await prisma.supportTicket.findFirst({where});if(!ticket)return fail(res,404,'Support request not found.');if(!ticket.attachmentPath)return fail(res,404,'No attachment was uploaded for this request.');const full=path.resolve(__dirname,'../../uploads/support',ticket.attachmentPath);if(!full.startsWith(path.resolve(__dirname,'../../uploads/support')+path.sep)||!fs.existsSync(full))return fail(res,404,'Attachment file is unavailable.');return res.download(full,ticket.attachmentName||'support-attachment');}
  catch(e){console.error('downloadSupportAttachment:',e);res.status(500).json({error:'Unable to download attachment.'});}
}

async function getAccount(req,res){
  if(req.user.role!=='OWNER') return fail(res,403,'Only the Owner can view school account and subscription details.');
  try{
    const [owner,school,branchCount,cancellationRequest]=await Promise.all([
      prisma.user.findFirst({where:{id:req.user.id,schoolId:req.user.schoolId,role:'OWNER'},select:{id:true,firstName:true,lastName:true,email:true,phone:true,role:true,createdAt:true}}),
      prisma.school.findUnique({where:{id:req.user.schoolId},select:{id:true,name:true,slug:true,code:true,createdAt:true,trialEndsAt:true,subscriptionStatus:true,plan:true,billingProvider:true,billingCycle:true,subscriptionRenewsAt:true,subscriptionExempt:true,subscriptionExemptReason:true}}),
      prisma.branch.count({where:{schoolId:req.user.schoolId,status:'ACTIVE'}}),
      prisma.subscriptionCancellationRequest.findFirst({where:{schoolId:req.user.schoolId},orderBy:{requestedAt:'desc'},select:{id:true,status:true,reason:true,reviewNote:true,requestedAt:true,reviewedAt:true}})
    ]);
    if(!owner||!school) return fail(res,404,'Owner or school account not found.');
    return res.json({user:owner,school,activeBranchCount:branchCount,cancellationRequest});
  }catch(e){console.error('owner.getAccount:',e);return res.status(500).json({error:'Unable to load Owner account details.'});}
}
async function requestSubscriptionCancellation(req,res){
  if(req.user.role!=='OWNER') return fail(res,403,'Only the Owner can request subscription cancellation.');
  const reason=clean(req.body?.reason);
  if(reason.length>1000) return fail(res,400,'Please keep the cancellation reason under 1,000 characters.');
  try{
    const school=await prisma.school.findUnique({where:{id:req.user.schoolId},select:{id:true,subscriptionStatus:true,subscriptionExempt:true}});
    if(!school) return fail(res,404,'School account not found.');
    if(school.subscriptionExempt) return fail(res,409,'This school has platform-granted access. Contact the Super Admin to review the exemption instead of cancelling a paid subscription.');
    if(school.subscriptionStatus==='CANCELED') return fail(res,409,'This subscription is already canceled.');
    const pending=await prisma.subscriptionCancellationRequest.findFirst({where:{schoolId:school.id,status:'PENDING'}});
    if(pending) return res.status(200).json({message:'A cancellation request is already awaiting Super Admin review.',request:pending});
    const request=await prisma.subscriptionCancellationRequest.create({data:{schoolId:school.id,requestedById:req.user.id,reason:reason||null}});
    return res.status(201).json({message:'Cancellation request sent to the Super Admin for approval. Your subscription remains active until a decision is made.',request});
  }catch(e){console.error('owner.requestSubscriptionCancellation:',e);return res.status(500).json({error:'Unable to submit the cancellation request.'});}
}

module.exports={getAccount,requestSubscriptionCancellation,createAnnouncement,listAnnouncements,listContacts,listMessages,sendMessage,downloadMessageAttachment,markMessageRead,listNotifications,markNotificationRead,createSupportTicket,listSupportTickets,downloadSupportAttachment};
