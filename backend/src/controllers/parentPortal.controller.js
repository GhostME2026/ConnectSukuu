const prisma = require('../config/db');
const schoolId = req => req.user.schoolId;
const userId = req => req.user.id;

async function profile(req) {
  return prisma.parentProfile.findFirst({
    where: { userId: userId(req), schoolId: schoolId(req) },
    select: {
      id: true,
      relationships: {
        where: { student: { schoolId: schoolId(req) } },
        include: { student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true, status:true, branchId:true, branch:{select:{name:true}}, school:{select:{name:true}} } } }
      }
    }
  });
}
async function linkedStudent(req, studentId) {
  if (!studentId) return null;
  const p = await prisma.parentProfile.findFirst({ where: { userId:userId(req), schoolId:schoolId(req), relationships:{some:{studentId, student:{schoolId:schoolId(req)}}} }, select:{id:true} });
  return p ? studentId : null;
}
async function getMe(req,res) {
  try {
    const [user,parent] = await Promise.all([
      prisma.user.findFirst({where:{id:userId(req),schoolId:schoolId(req),role:'PARENT'},select:{id:true,firstName:true,lastName:true,email:true,phone:true,role:true,photoUrl:true,schoolId:true,branchId:true}}), profile(req)
    ]);
    if (!user) return res.status(404).json({error:'Parent account not found.'});
    return res.json({user,parentProfile:parent?{id:parent.id}:null,wards:(parent?.relationships||[]).map(r=>r.student)});
  } catch(e) { console.error('parentPortal.getMe:',e); return res.status(500).json({error:'Could not load the parent profile.'}); }
}
async function getWards(req,res) {
  try {
    const p=await profile(req);
    const wards=(p?.relationships||[]).map(r=>({...r.student,relationship:r.relationship,isPrimary:r.isPrimary,canReceiveNotifications:r.canReceiveNotifications}));
    return res.json({wards});
  } catch(e) { console.error('parentPortal.getWards:',e); return res.status(500).json({error:'Could not load linked children.'}); }
}
async function getAcademics(req,res) {
  try {
    const studentId=await linkedStudent(req,req.query.studentId);
    if(!studentId)return res.status(404).json({error:'This child is not linked to your parent account.'});
    // Match the Student portal's underlying sources, but authorize the student
    // through ParentStudent before querying any academic record.
    const [reportCards, assessments, homeworks] = await Promise.all([
      prisma.reportCard.findMany({
        where:{studentId,schoolId:schoolId(req),status:'RELEASED'},
        include:{academicYear:{select:{name:true}},term:{select:{name:true}},schoolClass:{select:{name:true}},subjects:{include:{subject:{select:{name:true}}}}},
        orderBy:{releasedAt:'desc'},take:100
      }),
      prisma.assessmentScore.findMany({
        // The linked student ID is authoritative; checking the related
        // assessment's school also avoids hiding legacy scores whose redundant
        // AssessmentScore.schoolId field was not populated consistently.
        where:{studentId},
        include:{assessment:{include:{school:{select:{id:true}},subject:{select:{name:true}},academicYear:{select:{name:true}},term:{select:{name:true}},schoolClass:{select:{name:true}}}}},
        orderBy:{updatedAt:'desc'},take:500
      }),
      prisma.learningSubmission.findMany({
        where:{studentId},
        include:{learningAssignment:{include:{school:{select:{id:true}},teachingAssignment:{include:{subject:{select:{name:true}},schoolClass:{select:{name:true}},academicYear:{select:{name:true}}}}}}},
        orderBy:{submittedAt:'desc'},take:500
      })
    ]);
    const schoolAssessments=assessments.filter(x=>x.assessment?.school?.id===schoolId(req));
    const schoolHomeworks=homeworks.filter(x=>x.learningAssignment?.school?.id===schoolId(req)&&x.learningAssignment?.status==='PUBLISHED');
    const gradedAssessments=schoolAssessments.filter(x=>x.score!==null && x.score!==undefined && Number(x.assessment?.maxScore)>0);
    const gradedHomeworks=schoolHomeworks.filter(x=>x.score!==null && x.score!==undefined && Number(x.learningAssignment?.maxScore)>0);
    const earned=gradedAssessments.reduce((sum,x)=>sum+Number(x.score),0)+gradedHomeworks.reduce((sum,x)=>sum+Number(x.score),0);
    const possible=gradedAssessments.reduce((sum,x)=>sum+Number(x.assessment.maxScore),0)+gradedHomeworks.reduce((sum,x)=>sum+Number(x.learningAssignment.maxScore),0);
    const performance={
      gradedAssessments:gradedAssessments.length,assessmentCount:schoolAssessments.length,
      gradedHomeworks:gradedHomeworks.length,homeworkCount:schoolHomeworks.length,
      averagePercentage:possible>0?Math.round(earned/possible*1000)/10:null
    };
    return res.json({reportCards,assessments:schoolAssessments,homeworks:schoolHomeworks,performance});
  } catch(e) { console.error('parentPortal.getAcademics:',e); return res.status(500).json({error:'Could not load academic results.'}); }
}
async function getAttendance(req,res) {
  try {
    const studentId=await linkedStudent(req,req.query.studentId);
    if(!studentId)return res.status(404).json({error:'This child is not linked to your parent account.'});
    const records=await prisma.attendanceRecord.findMany({where:{schoolId:schoolId(req),studentId},include:{schoolClass:{select:{name:true}},term:{select:{name:true}}},orderBy:[{attendanceDate:'desc'},{createdAt:'desc'}],take:500});
    return res.json({records});
  } catch(e) { console.error('parentPortal.getAttendance:',e); return res.status(500).json({error:'Could not load attendance records.'}); }
}
async function getFees(req,res) {
  try {
    const studentId=await linkedStudent(req,req.query.studentId);
    if(!studentId)return res.status(404).json({error:'This child is not linked to your parent account.'});
    const rows=await prisma.studentFee.findMany({
      where:{schoolId:schoolId(req),studentId},
      include:{
        payments:{select:{id:true,amount:true,currency:true,paymentMethod:true,reference:true,notes:true,recordedAt:true,studentFeeId:true,allocations:{select:{studentFeeId:true,amount:true}}}},
      },
      orderBy:[{dueDate:'asc'},{createdAt:'desc'}]
    });
    const feeIds=rows.map(f=>f.id);
    const allocations=feeIds.length?await prisma.paymentAllocation.findMany({
      where:{schoolId:schoolId(req),studentFeeId:{in:feeIds}},
      select:{feePaymentId:true,studentFeeId:true,amount:true,createdAt:true,feePayment:{select:{id:true,amount:true,currency:true,paymentMethod:true,reference:true,notes:true,recordedAt:true,studentFeeId:true}}}
    }):[];
    const allocationsByFee=new Map();
    for(const a of allocations){if(!allocationsByFee.has(a.studentFeeId))allocationsByFee.set(a.studentFeeId,[]);allocationsByFee.get(a.studentFeeId).push(a)}
    const fees=rows.map(f=>{
      const paymentHistory=[],seenPaymentIds=new Set();
      for(const p of (f.payments||[])){
        const matching=(p.allocations||[]).filter(a=>a.studentFeeId===f.id);
        const allocatedAmount=matching.reduce((sum,a)=>sum+Number(a.amount||0),0);
        if(allocatedAmount>0){
          paymentHistory.push({...p,allocatedAmount,allocationDate:matching[0]?.createdAt||null});seenPaymentIds.add(p.id);
        }else if(!matching.length&&!(p.allocations||[]).length&&p.studentFeeId===f.id){
          paymentHistory.push({...p,allocatedAmount:Number(p.amount||0)});seenPaymentIds.add(p.id);
        }
      }
      for(const a of (allocationsByFee.get(f.id)||[])){
        if(seenPaymentIds.has(a.feePaymentId))continue;
        paymentHistory.push({...a.feePayment,allocatedAmount:Number(a.amount||0),allocationDate:a.createdAt});seenPaymentIds.add(a.feePaymentId);
      }
      paymentHistory.sort((a,b)=>new Date(b.recordedAt||b.allocationDate||0)-new Date(a.recordedAt||a.allocationDate||0));
      const paidAmount=paymentHistory.reduce((sum,p)=>sum+Number(p.allocatedAmount??p.amount??0),0);
      const balance=Math.max(0,Number(f.amount||0)-paidAmount);
      return {...f,paidAmount,balance,status:balance<=0?'PAID':paidAmount>0?'PARTIAL':f.status,paymentHistory};
    });
    const totals=fees.reduce((t,f)=>({total:t.total+Number(f.amount||0),paid:t.paid+f.paidAmount,balance:t.balance+f.balance}),{total:0,paid:0,balance:0});
    return res.json({fees,totals});
  } catch(e) { console.error('parentPortal.getFees:',e); return res.status(500).json({error:'Could not load fee records.'}); }
}
async function getAnnouncements(req,res) {
  try {
    const p=await profile(req); const branchIds=[...new Set((p?.relationships||[]).map(r=>r.student?.branchId).filter(Boolean))];
    const branchFilter=branchIds.length?[{branchId:null},{branchId:{in:branchIds}}]:[{branchId:null}];
    const announcements=await prisma.announcement.findMany({where:{schoolId:schoolId(req),OR:[{audienceAll:true},{audienceRoles:{has:'PARENT'}}],AND:[{OR:branchFilter}]},orderBy:{createdAt:'desc'},take:100});
    return res.json({announcements});
  } catch(e) { console.error('parentPortal.getAnnouncements:',e); return res.status(500).json({error:'Could not load parent announcements.'}); }
}
async function getNotifications(req,res) {
  try {
    const {announcements}=await getAnnouncementRows(req);
    const targets=announcements.map(a=>`announcement:${a.id}`);
    if(targets.length){
      const existing=await prisma.userNotification.findMany({where:{schoolId:schoolId(req),userId:userId(req),type:'ANNOUNCEMENT',targetUrl:{in:targets}},select:{targetUrl:true}});
      const present=new Set(existing.map(n=>n.targetUrl));
      const missing=announcements.filter(a=>!present.has(`announcement:${a.id}`));
      if(missing.length)await prisma.userNotification.createMany({data:missing.map(a=>({schoolId:schoolId(req),userId:userId(req),type:'ANNOUNCEMENT',title:a.title,content:String(a.content||'').slice(0,4000),targetUrl:`announcement:${a.id}`})),skipDuplicates:true});
    }
    const notifications=await prisma.userNotification.findMany({where:{schoolId:schoolId(req),userId:userId(req)},orderBy:{createdAt:'desc'},take:200});
    return res.json({notifications,unreadCount:notifications.filter(n=>!n.readAt).length});
  } catch(e) { console.error('parentPortal.getNotifications:',e); return res.status(500).json({error:'Could not load parent notifications.'}); }
}
async function getAnnouncementRows(req) {
  const p=await profile(req); const branchIds=[...new Set((p?.relationships||[]).map(r=>r.student?.branchId).filter(Boolean))];
  const branchFilter=branchIds.length?[{branchId:null},{branchId:{in:branchIds}}]:[{branchId:null}];
  const announcements=await prisma.announcement.findMany({where:{schoolId:schoolId(req),OR:[{audienceAll:true},{audienceRoles:{has:'PARENT'}}],AND:[{OR:branchFilter}]},orderBy:{createdAt:'desc'},take:100});
  return {announcements};
}
async function markNotificationRead(req,res) {
  try { const result=await prisma.userNotification.updateMany({where:{id:req.params.id,schoolId:schoolId(req),userId:userId(req)},data:{readAt:new Date()}});if(!result.count)return res.status(404).json({error:'Notification not found.'});return res.json({success:true}); }
  catch(e) { console.error('parentPortal.markNotificationRead:',e); return res.status(500).json({error:'Could not update the notification.'}); }
}
async function markAllNotificationsRead(req,res) {
  try { await prisma.userNotification.updateMany({where:{schoolId:schoolId(req),userId:userId(req),readAt:null},data:{readAt:new Date()}});return res.json({success:true}); }
  catch(e) { console.error('parentPortal.markAllNotificationsRead:',e); return res.status(500).json({error:'Could not update parent notifications.'}); }
}
async function getSecurityLogs(req,res) {
  try {
    const p=await profile(req); const linkedIds=(p?.relationships||[]).map(r=>r.student?.id).filter(Boolean);
    if(!linkedIds.length)return res.json({logs:[]});
    const requested=req.query.studentId;
    if(requested&&!linkedIds.includes(requested))return res.status(403).json({error:'You are not authorized to view this child’s security logs.'});
    const logs=await prisma.studentGateLog.findMany({where:{schoolId:schoolId(req),studentId:requested||{in:linkedIds}},include:{student:{select:{id:true,firstName:true,lastName:true,admissionNumber:true,classLevel:true}},recordedBy:{select:{firstName:true,lastName:true,role:true}}},orderBy:{occurredAt:'desc'},take:500});
    return res.json({logs});
  } catch(e) { console.error('parentPortal.getSecurityLogs:',e); return res.status(500).json({error:'Could not load student entry and exit logs.'}); }
}
module.exports={getMe,getWards,getAcademics,getAttendance,getFees,getAnnouncements,getNotifications,markNotificationRead,markAllNotificationsRead,getSecurityLogs};
