const prisma = require('../config/db');

const SUBSCRIPTION_STATUSES = new Set(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED']);

function safeSchoolSummary(s) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    plan: s.plan,
    subscriptionStatus: s.subscriptionStatus,
    trialEndsAt: s.trialEndsAt,
    billingProvider: s.billingProvider,
    billingCycle: s.billingCycle,
    subscriptionRenewsAt: s.subscriptionRenewsAt,
    subscriptionExempt: s.subscriptionExempt,
    subscriptionExemptReason: s.subscriptionExemptReason,
    subscriptionExemptAt: s.subscriptionExemptAt,
    subscriptionExemptBy: s.subscriptionExemptBy,
    createdAt: s.createdAt,
    archivedAt: s.archivedAt || null,
  };
}

// GET /api/admin/schools — platform-wide, SUPER_ADMIN only.
async function listSchools(req, res) {
  const schools = await prisma.school.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { users: true, students: true } } },
  });

  res.json(schools.map((s) => ({
    ...safeSchoolSummary(s),
    userCount: s._count.users,
    studentCount: s._count.students,
  })));
}

// GET /api/admin/schools/:id — aggregate-only account visibility.
// Never expose staff/owner/parent names, emails, IDs, or account-level metadata to SUPER_ADMIN.
async function getSchool(req, res) {
  const school = await prisma.school.findUnique({
    where: { id: req.params.id },
    include: {
      branches: { select: { id: true, name: true, status: true, createdAt: true } },
      _count: { select: { students: true, users: true } },
    },
  });
  if (!school) return res.status(404).json({ error: 'School not found' });

  // Only expose the three school leadership contacts needed for platform support.
  // Parent identities and all other staff identities remain private.
  const keyContacts = await prisma.user.findMany({
    where: { schoolId: school.id, role: { in: ['OWNER', 'ADMINISTRATOR', 'HEAD_TEACHER'] } },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, isActive: true },
  });
  const roleOrder = { OWNER: 0, ADMINISTRATOR: 1, HEAD_TEACHER: 2 };
  keyContacts.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);
  const staffCount = await prisma.user.count({
    where: {
      schoolId: school.id,
      role: { in: ['OWNER', 'HEAD_TEACHER', 'ADMINISTRATOR', 'HEAD_OF_ACADEMICS', 'ACCOUNTANT', 'TEACHER', 'NURSE', 'SECURITY'] },
    },
  });

  return res.json({
    ...safeSchoolSummary(school),
    branches: school.branches,
    keyContacts,
    userCount: school._count.users,
    staffCount,
    studentCount: school._count.students,
  });
}

// PATCH /api/admin/schools/:id
// Super Admin can edit permitted school fields and explicitly grant/revoke demo access.
// Exemption does not fabricate a payment or change the billing status.
async function updateSchool(req, res) {
  const { name, plan, subscriptionStatus, trialEndsAt, subscriptionExempt,
    subscriptionExemptReason } = req.body || {};
  const data = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'School name must be a non-empty string' });
    data.name = name.trim();
  }
  if (plan !== undefined) {
    if (typeof plan !== 'string' || !plan.trim()) return res.status(400).json({ error: 'Plan must be a non-empty string' });
    data.plan = plan.trim();
  }
  if (subscriptionStatus !== undefined) {
    if (!SUBSCRIPTION_STATUSES.has(subscriptionStatus)) return res.status(400).json({ error: 'Invalid subscription status' });
    data.subscriptionStatus = subscriptionStatus;
  }
  if (trialEndsAt !== undefined) {
    const parsed = new Date(trialEndsAt);
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'trialEndsAt must be a valid date' });
    data.trialEndsAt = parsed;
  }
  if (subscriptionExempt !== undefined) {
    if (typeof subscriptionExempt !== 'boolean') return res.status(400).json({ error: 'subscriptionExempt must be true or false' });
    data.subscriptionExempt = subscriptionExempt;
    if (subscriptionExempt) {
      const reason = typeof subscriptionExemptReason === 'string' ? subscriptionExemptReason.trim() : '';
      if (!reason) return res.status(400).json({ error: 'Provide subscriptionExemptReason when granting an exemption' });
      data.subscriptionExemptReason = reason;
      data.subscriptionExemptAt = new Date();
      data.subscriptionExemptBy = req.user.id;
    } else {
      data.subscriptionExemptReason = null;
      data.subscriptionExemptAt = null;
      data.subscriptionExemptBy = null;
    }
  } else if (subscriptionExemptReason !== undefined) {
    return res.status(400).json({ error: 'Set subscriptionExempt to true when providing an exemption reason' });
  }

  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No supported school fields were provided' });

  try {
    const school = await prisma.school.update({ where: { id: req.params.id }, data });
    return res.json(safeSchoolSummary(school));
  } catch (err) {
    if (err && err.code === 'P2025') return res.status(404).json({ error: 'School not found' });
    throw err;
  }
}

// DELETE /api/admin/schools/:id — destructive operation; existing behavior retained.
async function archiveSchool(req, res) {
  try {
    const school = await prisma.school.update({
      where: { id: req.params.id },
      data: { archivedAt: new Date() },
    });
    return res.json({ success: true, archivedAt: school.archivedAt });
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'School not found.' });
    console.error('admin.archiveSchool:', error);
    return res.status(500).json({ error: 'Could not archive this school.' });
  }
}

async function restoreSchool(req, res) {
  try {
    const school = await prisma.school.update({
      where: { id: req.params.id },
      data: { archivedAt: null },
    });
    return res.json({ success: true, archivedAt: school.archivedAt });
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'School not found.' });
    console.error('admin.restoreSchool:', error);
    return res.status(500).json({ error: 'Could not restore this school.' });
  }
}

// Permanent deletion is deliberately archive-first and may be blocked by related records.
async function deleteSchool(req, res) {
  const schoolId = req.params.id;
  try {
    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, archivedAt: true } });
    if (!school) return res.status(404).json({ error: 'School not found.' });
    if (!school.archivedAt) return res.status(409).json({ error: 'Archive this school before permanent deletion.' });
    await prisma.$transaction([
      prisma.payment.deleteMany({ where: { schoolId } }),
      prisma.student.deleteMany({ where: { schoolId } }),
      prisma.user.deleteMany({ where: { schoolId } }),
      prisma.branch.deleteMany({ where: { schoolId } }),
      prisma.school.delete({ where: { id: schoolId } }),
    ]);
    return res.json({ success: true });
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'School not found.' });
    if (error?.code === 'P2003' || error?.code === 'P2014') {
      return res.status(409).json({ error: 'This school still has linked academic or financial records. It remains archived; permanent deletion was blocked to protect related data.' });
    }
    console.error('admin.deleteSchool:', error);
    return res.status(500).json({ error: 'Could not permanently delete this school.' });
  }
}

// GET /api/admin/support-tickets — platform-wide support inbox for SUPER_ADMIN.
async function listSupportTickets(req, res) {
  try {
    const tickets = await prisma.supportTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 250 });
    if (!tickets.length) return res.json([]);
    const userIds = [...new Set(tickets.map(t => t.createdById).filter(Boolean))];
    const schoolIds = [...new Set(tickets.map(t => t.schoolId).filter(Boolean))];
    const [users, schools] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, firstName: true, lastName: true } }),
      prisma.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true } }),
    ]);
    const userById = new Map(users.map(u => [u.id, u]));
    const schoolById = new Map(schools.map(s => [s.id, s]));
    return res.json(tickets.map(ticket => {
      const creator = userById.get(ticket.createdById);
      return {
        ...ticket,
        attachmentPath: undefined,
        creatorEmail: creator?.email || null,
        creatorName: creator ? `${creator.firstName || ''} ${creator.lastName || ''}`.trim() : null,
        schoolName: schoolById.get(ticket.schoolId)?.name || 'Unknown school',
      };
    }));
  } catch (error) {
    console.error('admin.listSupportTickets:', error);
    return res.status(500).json({ error: 'Could not load the platform support inbox.' });
  }
}

// PATCH /api/admin/support-tickets/:id — update workflow status only.
async function updateSupportTicketStatus(req, res) {
  const allowed = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
  const status = String(req.body?.status || '').trim().toUpperCase();
  if (!allowed.has(status)) return res.status(400).json({ error: 'Choose a valid support status.' });
  try {
    const ticket = await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status } });
    return res.json({ id: ticket.id, status: ticket.status, updatedAt: ticket.updatedAt });
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Support request not found.' });
    console.error('admin.updateSupportTicketStatus:', error);
    return res.status(500).json({ error: 'Could not update the support request.' });
  }
}


async function listCancellationRequests(req,res){
  try{
    const requests=await prisma.subscriptionCancellationRequest.findMany({orderBy:[{status:'asc'},{requestedAt:'desc'}],take:200,include:{school:{select:{id:true,name:true,slug:true,plan:true,subscriptionStatus:true,billingProvider:true,billingCycle:true,subscriptionRenewsAt:true}}}});
    const rows=await Promise.all(requests.map(async r=>{const owner=await prisma.user.findFirst({where:{id:r.requestedById,schoolId:r.schoolId,role:'OWNER'},select:{firstName:true,lastName:true,email:true,phone:true}});return {...r,owner};}));
    return res.json(rows);
  }catch(e){console.error('admin.listCancellationRequests:',e);return res.status(500).json({error:'Could not load cancellation requests.'});}
}
async function reviewCancellationRequest(req,res){
  const decision=String(req.body?.decision||'').toUpperCase();const reviewNote=typeof req.body?.reviewNote==='string'?req.body.reviewNote.trim():'';
  if(!['APPROVE','REJECT'].includes(decision))return res.status(400).json({error:'Choose approve or reject.'});
  if(decision==='REJECT'&&!reviewNote)return res.status(400).json({error:'Add a short reason when rejecting a cancellation request.'});
  try{
    const request=await prisma.subscriptionCancellationRequest.findUnique({where:{id:req.params.id}});
    if(!request)return res.status(404).json({error:'Cancellation request not found.'});
    if(request.status!=='PENDING')return res.status(409).json({error:'This request has already been reviewed.'});
    const updated=await prisma.$transaction(async tx=>{
      const changed=await tx.subscriptionCancellationRequest.update({where:{id:request.id},data:{status:decision==='APPROVE'?'APPROVED':'REJECTED',reviewedById:req.user.id,reviewNote:reviewNote||null,reviewedAt:new Date()}});
      if(decision==='APPROVE') await tx.school.update({where:{id:request.schoolId},data:{subscriptionStatus:'CANCELED'}});
      return changed;
    });
    return res.json({message:decision==='APPROVE'?'Cancellation approved. The school subscription is now canceled.':'Cancellation request rejected.',request:updated});
  }catch(e){console.error('admin.reviewCancellationRequest:',e);return res.status(500).json({error:'Could not review the cancellation request.'});}
}

module.exports = { listCancellationRequests, reviewCancellationRequest, listSchools, getSchool, updateSchool, archiveSchool, restoreSchool, deleteSchool, listSupportTickets, updateSupportTicketStatus };
