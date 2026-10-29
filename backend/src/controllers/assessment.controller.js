
const prisma = require('../config/db');
const { sendSms } = require('../services/bmsSms.service');

const assessmentInclude = {
  academicYear:{select:{id:true,name:true,isCurrent:true}},
  term:{select:{id:true,name:true,isCurrent:true}},
  schoolClass:{select:{id:true,name:true,level:true,section:true}},
  subject:{select:{id:true,name:true,code:true}},
  teacher:{select:{id:true,firstName:true,lastName:true,email:true}},
  _count:{select:{scores:true}}
};
const reportCardInclude = {
  academicYear:{select:{id:true,name:true,isCurrent:true}},
  term:{select:{id:true,name:true,isCurrent:true}},
  schoolClass:{select:{id:true,name:true,level:true,section:true}},
  student:{select:{id:true,firstName:true,lastName:true,admissionNumber:true}},
  teacher:{select:{id:true,firstName:true,lastName:true}},
  academicReviewer:{select:{id:true,firstName:true,lastName:true}},
  headTeacher:{select:{id:true,firstName:true,lastName:true}},
  _count:{select:{subjects:true}}
};
const sid=req=>req.user.schoolId;
const clean=v=>typeof v==='string'?v.trim():'';
function num(v,label){const n=Number(v);if(!Number.isFinite(n)){const e=new Error(label+' must be a valid number');e.status=400;throw e;}return n;}

async function context({schoolId,academicYearId,termId,classId}){
  const academicYear=await prisma.academicYear.findFirst({where:{id:academicYearId,schoolId}});
  if(!academicYear)throw Object.assign(new Error('Academic year not found'),{status:404});
  const term=await prisma.term.findFirst({where:{id:termId,academicYearId,academicYear:{schoolId}}});
  if(!term)throw Object.assign(new Error('Term not found for this academic year'),{status:404});
  const schoolClass=await prisma.schoolClass.findFirst({where:{id:classId,schoolId,academicYearId}});
  if(!schoolClass)throw Object.assign(new Error('Class not found for this academic year'),{status:404});
  return {academicYear,term,schoolClass};
}
async function assessmentWeightTotal({schoolId,academicYearId,termId,classId,subjectId,excludeId=null}){
  const rows=await prisma.assessment.findMany({
    where:{
      schoolId,academicYearId,termId,classId,subjectId,
      ...(excludeId?{id:{not:excludeId}}:{})
    },
    select:{weight:true}
  });
  return Math.round(rows.reduce((sum,row)=>sum+(Number(row.weight)||0),0)*100)/100;
}
async function assignment({schoolId,academicYearId,classId,subjectId,teacherId}){
  const a=await prisma.teachingAssignment.findFirst({where:{schoolId,academicYearId,classId,subjectId,teacherId}});
  if(!a)throw Object.assign(new Error('The selected teacher is not assigned to this subject and class for the academic year'),{status:409});
  return a;
}
async function enrollment({schoolId,studentId,enrollmentId,academicYearId,classId}){
  const where={schoolId,studentId,academicYearId,classId}; if(enrollmentId)where.id=enrollmentId;
  const e=await prisma.enrollment.findFirst({where,include:{student:{select:{id:true,firstName:true,lastName:true,admissionNumber:true}}}});
  if(!e)throw Object.assign(new Error('Student is not enrolled in the selected class and academic year'),{status:409});
  return e;
}
const own=(req,row)=>req.user.role!=='TEACHER'||row.teacherId===req.user.id;

async function listAssessments(req,res){
 try{
  const w={schoolId:sid(req)},q=req.query;
  for(const k of ['academicYearId','termId','classId','subjectId','status'])if(q[k])w[k]=q[k];
  if(req.user.role==='TEACHER')w.teacherId=req.user.id; else if(q.teacherId)w.teacherId=q.teacherId;
  res.json(await prisma.assessment.findMany({where:w,include:assessmentInclude,orderBy:[{assessmentDate:'desc'},{createdAt:'desc'}]}));
 }catch(e){console.error(e);res.status(500).json({error:'Failed to load assessments'});}
}
async function getAssessmentPerformance(req,res){
 try{
  if(!['HEAD_TEACHER','HEAD_OF_ACADEMICS'].includes(req.user.role))return res.status(403).json({error:'Only the Head Teacher or Head of Academics can view assessment performance'});
  const row=await prisma.assessment.findFirst({where:{id:req.params.id,schoolId:sid(req)},include:{
   academicYear:{select:{id:true,name:true}},term:{select:{id:true,name:true}},schoolClass:{select:{id:true,name:true,level:true,section:true}},subject:{select:{id:true,name:true,code:true}},teacher:{select:{id:true,firstName:true,lastName:true}},
   scores:{orderBy:{student:{lastName:'asc'}},include:{student:{select:{id:true,firstName:true,lastName:true,admissionNumber:true}},enrollment:{select:{id:true,classId:true,academicYearId:true}}}}
  }});
  if(!row)return res.status(404).json({error:'Assessment not found'});
  const values=row.scores.map(x=>Number(x.score)).filter(Number.isFinite),max=Number(row.maxScore)||100,average=values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
  res.json({id:row.id,title:row.title,assessmentType:row.assessmentType,maxScore:max,weight:Number(row.weight||0),status:row.status,assessmentDate:row.assessmentDate,academicYear:row.academicYear,term:row.term,schoolClass:row.schoolClass,subject:row.subject,teacher:row.teacher,summary:{studentsScored:values.length,average,averagePercentage:max?(average/max)*100:0,highest:values.length?Math.max(...values):0,lowest:values.length?Math.min(...values):0},scores:row.scores.map(x=>({student:x.student,score:Number(x.score),percentage:max?(Number(x.score)/max)*100:0}))});
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to load assessment performance'});}
}
async function getAssessment(req,res){
 try{
  const row=await prisma.assessment.findFirst({where:{id:req.params.id,schoolId:sid(req)},include:{...assessmentInclude,scores:{orderBy:{student:{lastName:'asc'}},include:{student:{select:{id:true,firstName:true,lastName:true,admissionNumber:true}},enrollment:{select:{id:true,classId:true,academicYearId:true}}}}}});
  if(!row)return res.status(404).json({error:'Assessment not found'});
  // Opening a score sheet must never be blocked by the weight allocation rule.
  // The exact-100% rule is enforced at submission time instead.
  if(!own(req,row))return res.status(403).json({error:'You can only access your own assessments'});
  res.json(row);
 }catch(e){console.error(e);res.status(500).json({error:'Failed to load assessment'});}
}
async function createAssessment(req,res){
 try{
  const b=req.body||{}; if(!b.academicYearId||!b.termId||!b.classId||!b.subjectId||!b.title||b.maxScore===undefined)return res.status(400).json({error:'Academic year, term, class, subject, title and maximum score are required'});
  const teacher=req.user.role==='TEACHER'?req.user.id:clean(b.teacherId); if(!teacher)return res.status(400).json({error:'Teacher is required'});
  await context({schoolId:sid(req),academicYearId:b.academicYearId,termId:b.termId,classId:b.classId});
  await assignment({schoolId:sid(req),academicYearId:b.academicYearId,classId:b.classId,subjectId:b.subjectId,teacherId:teacher});
  const max=num(b.maxScore,'Maximum score'),weight=b.weight===undefined||b.weight===''?0:num(b.weight,'Weight');
  if(max<=0)return res.status(400).json({error:'Maximum score must be greater than zero'});
  if(weight<0||weight>100)return res.status(400).json({error:'Weight must be between 0 and 100'});
  const existingWeight=await assessmentWeightTotal({schoolId:sid(req),academicYearId:b.academicYearId,termId:b.termId,classId:b.classId,subjectId:b.subjectId});
  if(existingWeight+weight>100)return res.status(409).json({error:`Assessment weights for this subject and term cannot exceed 100%. Current allocation is ${existingWeight}%.`});
  res.status(201).json(await prisma.assessment.create({data:{schoolId:sid(req),academicYearId:b.academicYearId,termId:b.termId,classId:b.classId,subjectId:b.subjectId,teacherId:teacher,title:clean(b.title),assessmentType:clean(b.assessmentType)||'OTHER',maxScore:max,weight,assessmentDate:b.assessmentDate?new Date(b.assessmentDate):null},include:assessmentInclude}));
 }catch(e){
  if(e.status===409)return res.status(409).json({error:e.message||'The selected teacher is not assigned to this subject and class for the academic year'});
  console.error(e);res.status(e.status||500).json({error:e.message||'Failed to create assessment'});
}
}
async function updateAssessment(req,res){
 try{
  const row=await prisma.assessment.findFirst({where:{id:req.params.id,schoolId:sid(req)}});if(!row)return res.status(404).json({error:'Assessment not found'});
  if(!own(req,row))return res.status(403).json({error:'You can only edit your own assessments'});if(row.status!=='DRAFT')return res.status(409).json({error:'Only draft assessments can be edited'});
  const b=req.body||{},d={};if(b.title!==undefined)d.title=clean(b.title);if(b.assessmentType!==undefined)d.assessmentType=clean(b.assessmentType)||'OTHER';
  if(b.maxScore!==undefined){d.maxScore=num(b.maxScore,'Maximum score');if(d.maxScore<=0)return res.status(400).json({error:'Maximum score must be greater than zero'});}
  if(b.weight!==undefined){
    d.weight=num(b.weight,'Weight');
    if(d.weight<0||d.weight>100)return res.status(400).json({error:'Weight must be between 0 and 100'});
    const existingWeight=await assessmentWeightTotal({schoolId:sid(req),academicYearId:row.academicYearId,termId:row.termId,classId:row.classId,subjectId:row.subjectId,excludeId:row.id});
    if(existingWeight+d.weight>100)return res.status(409).json({error:`Assessment weights for this subject and term cannot exceed 100%. Other assessments already use ${existingWeight}%.`});
  }
  if(b.assessmentDate!==undefined)d.assessmentDate=b.assessmentDate?new Date(b.assessmentDate):null;
  res.json(await prisma.assessment.update({where:{id:row.id},data:d,include:assessmentInclude}));
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to update assessment'});}
}
async function deleteAssessment(req,res){
 try{
  const row=await prisma.assessment.findFirst({where:{id:req.params.id,schoolId:sid(req)}});
  if(!row)return res.status(404).json({error:'Assessment not found'});
  if(req.user.role!=='TEACHER'||row.teacherId!==req.user.id)return res.status(403).json({error:'Only the assigned teacher can delete this assessment'});
  if(row.status!=='DRAFT')return res.status(409).json({error:'Only draft assessments can be deleted'});
  await prisma.assessment.delete({where:{id:row.id}});
  res.json({deleted:true,id:row.id});
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to delete assessment'});}
}
async function saveScores(req,res){
 try{
  const row=await prisma.assessment.findFirst({where:{id:req.params.id,schoolId:sid(req)}});
  if(!row)return res.status(404).json({error:'Assessment not found'});
  if(!own(req,row))return res.status(403).json({error:'You can only enter scores for your own assessments'});
  if(row.status!=='DRAFT')return res.status(409).json({error:'Scores can only be changed while the assessment is in draft'});
  if(!Array.isArray(req.body?.scores)||!req.body.scores.length)return res.status(400).json({error:'At least one score is required'});
  const cleanScores=[];
  for(const x of req.body.scores){
    const studentId=clean(x.studentId);if(!studentId)return res.status(400).json({error:'Every score requires a student'});
    const enrolled=await enrollment({schoolId:sid(req),studentId,enrollmentId:clean(x.enrollmentId)||null,academicYearId:row.academicYearId,classId:row.classId});
    const score=num(x.score,'Score');if(score<0||score>row.maxScore)return res.status(400).json({error:`Score for ${studentId} must be between 0 and ${row.maxScore}`});
    cleanScores.push({studentId,enrollmentId:enrolled.id,score});
  }
  const schoolId=sid(req);
  const result=await prisma.$transaction(cleanScores.map(x=>prisma.assessmentScore.upsert({
    where:{assessmentId_studentId:{assessmentId:row.id,studentId:x.studentId}},
    create:{school:{connect:{id:schoolId}},assessment:{connect:{id:row.id}},student:{connect:{id:x.studentId}},enrollment:{connect:{id:x.enrollmentId}},score:x.score},
    update:{enrollmentId:x.enrollmentId,score:x.score}
  })));
  res.json({count:result.length,scores:result});
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to save scores'});}
}
async function submitAssessment(req,res){
 try{
  const row=await prisma.assessment.findFirst({where:{id:req.params.id,schoolId:sid(req)},include:{_count:{select:{scores:true}}}});
  if(!row)return res.status(404).json({error:'Assessment not found'});if(req.user.role!=='TEACHER'||row.teacherId!==req.user.id)return res.status(403).json({error:'Only the assigned teacher can submit this assessment'});if(row.status!=='DRAFT')return res.status(409).json({error:'Only draft assessments can be submitted'});if(!row._count.scores)return res.status(409).json({error:'Enter at least one student score before submitting'});
  const totalWeight=await assessmentWeightTotal({schoolId:sid(req),academicYearId:row.academicYearId,termId:row.termId,classId:row.classId,subjectId:row.subjectId});
  if(Math.abs(totalWeight-100)>0.001)return res.status(409).json({error:`Assessment weights must total exactly 100% before submission. Current allocation is ${totalWeight}%.`});
  res.json(await prisma.assessment.update({where:{id:row.id},data:{status:'SUBMITTED'},include:assessmentInclude}));
 }catch(e){console.error(e);res.status(500).json({error:'Failed to submit assessment'});}
}
async function closeAssessment(req,res){
 try{
  const row=await prisma.assessment.findFirst({where:{id:req.params.id,schoolId:sid(req)}});if(!row)return res.status(404).json({error:'Assessment not found'});
  if(!['HEAD_TEACHER','HEAD_OF_ACADEMICS'].includes(req.user.role))return res.status(403).json({error:'Only the Head Teacher or Head of Academics can close an assessment'});if(row.status!=='SUBMITTED')return res.status(409).json({error:'Only submitted assessments can be closed'});
  res.json(await prisma.assessment.update({where:{id:row.id},data:{status:'CLOSED'},include:assessmentInclude}));
 }catch(e){console.error(e);res.status(500).json({error:'Failed to close assessment'});}
}
async function hydrateReportCardSubjectTeachers(row,schoolId){
  if(!row||!Array.isArray(row.subjects))return row;

  const teacherIds=[...new Set(
    row.subjects.map(s=>s.teacherId).filter(Boolean)
  )];

  const teachers=teacherIds.length
    ? await prisma.user.findMany({
        where:{id:{in:teacherIds},schoolId},
        select:{id:true,firstName:true,lastName:true,email:true}
      })
    : [];

  const byId=new Map(teachers.map(t=>[t.id,t]));

  row.subjects=row.subjects.map(s=>({
    ...s,
    teacher:s.teacherId?(byId.get(s.teacherId)||null):null
  }));

  return row;
}

async function hydrateReportCardAssessmentBreakdown(row,schoolId){
  if(!row || !Array.isArray(row.subjects) || !row.subjects.length)return row;
  const subjectIds=[...new Set(row.subjects.map(s=>s.subjectId).filter(Boolean))];
  if(!subjectIds.length)return row;
  const assessments=await prisma.assessment.findMany({
    where:{
      schoolId,
      academicYearId:row.academicYearId,
      termId:row.termId,
      classId:row.classId,
      subjectId:{in:subjectIds},
      status:{in:['SUBMITTED','CLOSED']}
    },
    orderBy:[{assessmentDate:'asc'},{createdAt:'asc'}],
    select:{
      id:true,title:true,assessmentType:true,maxScore:true,weight:true,status:true,assessmentDate:true,subjectId:true,
      scores:{where:{studentId:row.studentId},select:{score:true}}
    }
  });
  const bySubject=new Map();
  for(const a of assessments){
    if(!bySubject.has(a.subjectId))bySubject.set(a.subjectId,[]);
    const max=Number(a.maxScore)||0;
    const score=a.scores?.length?Number(a.scores[0].score):null;
    bySubject.get(a.subjectId).push({
      id:a.id,title:a.title,type:a.assessmentType,maxScore:max,weight:Number(a.weight||0),
      score:Number.isFinite(score)?score:null,
      percentage:Number.isFinite(score)&&max>0?Math.round(score/max*10000)/100:null,
      status:a.status,assessmentDate:a.assessmentDate
    });
  }
  row.subjects=row.subjects.map(s=>{
    const breakdown=bySubject.get(s.subjectId)||[];
    return {...s,assessmentBreakdown:breakdown};
  });
  return row;
}

async function hydrateReportCard(row,schoolId){
  if(!row || !Array.isArray(row.subjects) || !row.subjects.length)return row;
  const subjectIds=[...new Set(row.subjects.map(s=>s.subjectId).filter(Boolean))];
  const teacherIds=[...new Set(row.subjects.map(s=>s.teacherId).filter(Boolean))];
  const [teachers,assessments]=await Promise.all([
    teacherIds.length?prisma.user.findMany({where:{id:{in:teacherIds},schoolId},select:{id:true,firstName:true,lastName:true,email:true}}):Promise.resolve([]),
    subjectIds.length?prisma.assessment.findMany({
      where:{schoolId,academicYearId:row.academicYearId,termId:row.termId,classId:row.classId,subjectId:{in:subjectIds},status:{in:['SUBMITTED','CLOSED']}},
      orderBy:[{assessmentDate:'asc'},{createdAt:'asc'}],
      select:{id:true,title:true,assessmentType:true,maxScore:true,weight:true,status:true,assessmentDate:true,subjectId:true,scores:{where:{studentId:row.studentId},select:{score:true}}}
    }):Promise.resolve([])
  ]);
  const teacherById=new Map(teachers.map(x=>[x.id,x]));
  const breakdownBySubject=new Map();
  for(const a of assessments){
    if(!breakdownBySubject.has(a.subjectId))breakdownBySubject.set(a.subjectId,[]);
    const max=Number(a.maxScore)||0;
    const score=a.scores&&a.scores.length?Number(a.scores[0].score):null;
    breakdownBySubject.get(a.subjectId).push({
      id:a.id,title:a.title,type:a.assessmentType,maxScore:max,weight:Number(a.weight||0),
      score:Number.isFinite(score)?score:null,
      percentage:Number.isFinite(score)&&max>0?Math.round(score/max*10000)/100:null,
      status:a.status,assessmentDate:a.assessmentDate
    });
  }
  row.subjects=row.subjects.map(s=>({
    ...s,
    teacher:s.teacherId?(teacherById.get(s.teacherId)||null):null,
    assessmentBreakdown:breakdownBySubject.get(s.subjectId)||[]
  }));
  return row;
}

async function canTeacherAccessReportCard(row,teacherId,schoolId){
  if(!row)return false;
  if(row.teacherId===teacherId)return true;
  if(Array.isArray(row.subjects)&&row.subjects.some(s=>s.teacherId===teacherId))return true;
  const classSubjects=await prisma.classSubject.findMany({
    where:{schoolId,classId:row.classId},
    select:{subjectId:true}
  });
  const ids=[...new Set(classSubjects.map(x=>x.subjectId))];
  if(!ids.length)return false;
  const assignment=await prisma.teachingAssignment.findFirst({
    where:{schoolId,academicYearId:row.academicYearId,classId:row.classId,subjectId:{in:ids},teacherId},
    select:{id:true}
  });
  return !!assignment;
}

async function synchronizeReportCardSubjectRows(row,schoolId){
  const classSubjects=await prisma.classSubject.findMany({
    where:{schoolId,classId:row.classId},
    select:{subjectId:true},
    orderBy:{createdAt:'asc'}
  });
  const subjectIds=[...new Set(classSubjects.map(x=>x.subjectId))];
  if(!subjectIds.length)return {count:0,subjectIds:[]};
  const assignments=await prisma.teachingAssignment.findMany({
    where:{schoolId,academicYearId:row.academicYearId,classId:row.classId,subjectId:{in:subjectIds}},
    select:{subjectId:true,teacherId:true,assignmentType:true},
    orderBy:{createdAt:'asc'}
  });
  const teacherBySubject=new Map();
  for(const a of assignments){
    if(a.assignmentType==='PRIMARY'&&!teacherBySubject.has(a.subjectId))teacherBySubject.set(a.subjectId,a.teacherId);
  }
  for(const a of assignments){
    if(!teacherBySubject.has(a.subjectId))teacherBySubject.set(a.subjectId,a.teacherId);
  }
  for(const subjectId of subjectIds){
    const teacherId=teacherBySubject.get(subjectId)||null;
    const existing=await prisma.reportCardSubject.findFirst({
      where:{reportCardId:row.id,subjectId},
      select:{id:true,teacherId:true}
    });
    if(existing){
      if(teacherId && existing.teacherId!==teacherId){
        await prisma.reportCardSubject.update({where:{id:existing.id},data:{teacherId}});
      }
    }else{
      await prisma.reportCardSubject.create({
        data:{schoolId,reportCardId:row.id,subjectId,teacherId,totalScore:0,maxScore:100,percentage:0,grade:null,remark:null,teacherRemark:null}
      });
    }
  }
  return {count:subjectIds.length,subjectIds};
}


async function calculateReportCardMetrics(row,schoolId){
  const [classSubjects,subjectRows]=await Promise.all([
    prisma.classSubject.findMany({where:{schoolId,classId:row.classId},select:{subjectId:true}}),
    prisma.reportCardSubject.findMany({where:{schoolId,reportCardId:row.id},select:{subjectId:true,totalScore:true,maxScore:true,percentage:true,grade:true}})
  ]);
  const subjectIds=[...new Set(classSubjects.map(x=>x.subjectId).filter(Boolean))];

  const bySubject=new Map(subjectRows.map(s=>[s.subjectId,s]));

  const completedSubjectIds=subjectIds.filter(subjectId=>{
    const s=bySubject.get(subjectId);
    return !!s &&
      Number.isFinite(Number(s.totalScore)) &&
      Number.isFinite(Number(s.maxScore)) &&
      Number(s.maxScore)>0 &&
      Number.isFinite(Number(s.percentage)) &&
      String(s.grade||'').trim()!=='';
  });

  const totals=completedSubjectIds.reduce((acc,subjectId)=>{
    const s=bySubject.get(subjectId);
    acc.totalScore+=Number(s.totalScore||0);
    acc.totalMaximum+=Number(s.maxScore||0);
    return acc;
  },{totalScore:0,totalMaximum:0});

  const subjectsTotal=subjectIds.length;
  const subjectsCompleted=completedSubjectIds.length;
  const complete=subjectsTotal>0 && subjectsCompleted===subjectsTotal;

  const average=totals.totalMaximum>0
    ? Math.round((totals.totalScore/totals.totalMaximum*100)*100)/100
    : null;

  let overallGrade=null;
  let position=null;
  let totalStudents=0;
  let scale=null;
  let peers=[];
  const classScale=await prisma.classGradingScale.findFirst({where:{schoolId,academicYearId:row.academicYearId,classId:row.classId}});
  const reads=[prisma.gradingScale.findFirst({where:classScale?{schoolId,id:classScale.gradingScaleId}:{schoolId,isDefault:true},include:{bands:true}})];
  if(complete) reads.push(prisma.reportCard.findMany({
    where:{schoolId,academicYearId:row.academicYearId,termId:row.termId,classId:row.classId},
    select:{id:true,subjects:{select:{subjectId:true,totalScore:true,maxScore:true,percentage:true,grade:true}}}
  }));
  const results=await Promise.all(reads);
  scale=results[0];
  if(complete) peers=results[1]||[];
  if(scale?.bands?.length && average!==null){
    const band=scale.bands.find(b=>average>=Number(b.minPercentage)&&average<=Number(b.maxPercentage));
    overallGrade=band?.label||null;
  }

  if(complete){
    const ranked=[];

    for(const peer of peers){
      const peerMap=new Map(peer.subjects.map(s=>[s.subjectId,s]));

      const peerComplete=subjectsTotal>0 && subjectIds.every(subjectId=>{
        const s=peerMap.get(subjectId);
        return !!s &&
          Number.isFinite(Number(s.totalScore)) &&
          Number.isFinite(Number(s.maxScore)) &&
          Number(s.maxScore)>0 &&
          Number.isFinite(Number(s.percentage)) &&
          String(s.grade||'').trim()!=='';
      });

      if(!peerComplete)continue;

      const peerTotal=subjectIds.reduce((sum,subjectId)=>{
        return sum+Number(peerMap.get(subjectId)?.totalScore||0);
      },0);

      const peerMaximum=subjectIds.reduce((sum,subjectId)=>{
        return sum+Number(peerMap.get(subjectId)?.maxScore||0);
      },0);

      if(peerMaximum>0){
        ranked.push({
          reportCardId:peer.id,
          average:(peerTotal/peerMaximum)*100
        });
      }
    }

    totalStudents=ranked.length;
    ranked.sort((a,b)=>b.average-a.average);

    const current=ranked.find(x=>x.reportCardId===row.id);
    if(current){
      position=1+ranked.filter(x=>x.average>current.average+1e-9).length;
    }
  }

  return {
    totalScore:totals.totalMaximum>0?Math.round(totals.totalScore*100)/100:null,
    totalMaximum:totals.totalMaximum>0?Math.round(totals.totalMaximum*100)/100:null,
    average,
    overallGrade,
    position,
    totalStudents,
    subjectsCompleted,
    subjectsTotal,
    complete
  };
}


async function listReportCardStudents(req,res){
 try{
  if(!['TEACHER','HEAD_OF_ACADEMICS','HEAD_TEACHER'].includes(req.user.role))
    return res.status(403).json({error:'You do not have permission to load report-card students'});
  const academicYearId=clean(req.query?.academicYearId);
  const classId=clean(req.query?.classId);
  if(!academicYearId||!classId)
    return res.status(400).json({error:'Academic year and class are required'});

  const rows=await prisma.enrollment.findMany({
    where:{schoolId:sid(req),academicYearId,classId},
    include:{student:{select:{id:true,firstName:true,lastName:true,admissionNumber:true}}},
    orderBy:{student:{lastName:'asc'}}
  });

  const seen=new Set();
  const students=[];
  for(const row of rows){
    const s=row.student;
    if(!s||seen.has(s.id))continue;
    seen.add(s.id);
    students.push(s);
  }
  return res.json(students);
 }catch(e){
  console.error('listReportCardStudents:',e);
  return res.status(500).json({error:'Failed to load enrolled students for report-card creation'});
 }
}

async function listReportCards(req,res){
 try{
  const w={schoolId:sid(req)},q=req.query;
  for(const k of ['academicYearId','termId','classId','studentId','status'])if(q[k])w[k]=q[k];
  if(req.user.role==='TEACHER')w.OR=[{teacherId:req.user.id},{subjects:{some:{teacherId:req.user.id}}}];
  res.json(await prisma.reportCard.findMany({where:w,include:reportCardInclude,orderBy:{updatedAt:'desc'}}));
 }catch(e){console.error(e);res.status(500).json({error:'Failed to load report cards'});}
}








async function getReportCard(req,res){
 try{
  const schoolId=sid(req);
  let row=await prisma.reportCard.findFirst({
    where:{id:req.params.id,schoolId},
    include:{...reportCardInclude,subjects:{orderBy:{subject:{name:'asc'}},include:{subject:{select:{id:true,name:true,code:true}}}}}
  });
  if(!row)return res.status(404).json({error:'Report card not found'});
  if(['DRAFT','RETURNED'].includes(row.status)){
    // Synchronize only when class subjects have actually been added since this card was created.
    // Previously this performed a sequence of reads/writes every time a user opened a report.
    const classSubjects=await prisma.classSubject.findMany({where:{schoolId,classId:row.classId},select:{subjectId:true}});
    const existingIds=new Set((row.subjects||[]).map(s=>String(s.subjectId)));
    const hasMissing=classSubjects.some(s=>!existingIds.has(String(s.subjectId)));
    if(hasMissing){
      await synchronizeReportCardSubjectRows({id:row.id,academicYearId:row.academicYearId,classId:row.classId},schoolId);
      row=await prisma.reportCard.findFirst({
        where:{id:row.id,schoolId},
        include:{...reportCardInclude,subjects:{orderBy:{subject:{name:'asc'}},include:{subject:{select:{id:true,name:true,code:true}}}}}
      });
      if(!row)return res.status(404).json({error:'Report card not found'});
    }
  }
  if(req.user.role==='TEACHER' && !await canTeacherAccessReportCard(row,req.user.id,schoolId)){
    return res.status(403).json({error:'You can only access report cards assigned to you or one of your assigned subjects'});
  }
  // Hydration and summary metrics are independent reads after any required synchronization.
  const [,metrics]=await Promise.all([
    hydrateReportCard(row,schoolId),
    calculateReportCardMetrics(row,schoolId)
  ]);
  row.calculatedMetrics=metrics;
  return res.json(row);
 }catch(e){
  console.error('getReportCard:',e);
  return res.status(e.status||500).json({error:e.message||'Failed to load report card'});
 }
}

async function createReportCard(req,res){
 try{
  const b=req.body||{};
  if(!b.academicYearId||!b.termId||!b.classId||!b.studentId)return res.status(400).json({error:'Academic year, term, class and student are required'});
  const schoolId=sid(req);
  await context({schoolId,academicYearId:b.academicYearId,termId:b.termId,classId:b.classId});
  const e=await enrollment({schoolId,studentId:b.studentId,academicYearId:b.academicYearId,classId:b.classId});
  const existing=await prisma.reportCard.findFirst({where:{schoolId,studentId:b.studentId,academicYearId:b.academicYearId,termId:b.termId}});
  if(existing)return res.status(409).json({error:'A report card already exists for this student and term'});

  let teacherId=null;
  if(req.user.role==='TEACHER')teacherId=req.user.id;
  else if(b.teacherId){
    teacherId=clean(b.teacherId);
    const teacher=await prisma.user.findFirst({where:{id:teacherId,schoolId,role:'TEACHER'},select:{id:true}});
    if(!teacher)return res.status(404).json({error:'Selected teacher was not found'});
  }

  const classSubjects=await prisma.classSubject.findMany({where:{schoolId,classId:b.classId},select:{subjectId:true}});
  if(!classSubjects.length)return res.status(409).json({error:'No subjects are assigned to this class yet. Open Academic Setup and assign subjects to the class first.'});

  const created=await prisma.reportCard.create({data:{schoolId,academicYearId:b.academicYearId,termId:b.termId,classId:b.classId,studentId:e.student.id,teacherId,status:'DRAFT'}});
  await synchronizeReportCardSubjectRows({id:created.id,academicYearId:created.academicYearId,classId:created.classId},schoolId);

  const hydrated=await prisma.reportCard.findFirst({
    where:{id:created.id,schoolId},
    include:{...reportCardInclude,subjects:{orderBy:{subject:{name:'asc'}},include:{subject:{select:{id:true,name:true,code:true}}}}}
  });
  res.status(201).json(await hydrateReportCard(hydrated,schoolId));
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to create report card'});}
}


async function updateReportCard(req,res){
 try{
  const row=await prisma.reportCard.findFirst({where:{id:req.params.id,schoolId:sid(req)}});
  if(!row)return res.status(404).json({error:'Report card not found'});
  const b=req.body||{},d={};
  if(b.teacherRemark!==undefined){
    if(req.user.role!=='TEACHER'||row.teacherId!==req.user.id)return res.status(403).json({error:'Only the assigned class teacher can update the general teacher remark'});
    if(!['DRAFT','RETURNED'].includes(row.status))return res.status(409).json({error:'General teacher remark is locked at this stage'});
    d.teacherRemark=clean(b.teacherRemark)||null;
  }
  if(b.academicRemark!==undefined){
    if(req.user.role!=='HEAD_OF_ACADEMICS')return res.status(403).json({error:'Only the Head of Academics can update the academic remark'});
    if(!['SUBMITTED','RETURNED'].includes(row.status))return res.status(409).json({error:'Academic remark can only be updated after teacher submission or return'});
    d.academicRemark=clean(b.academicRemark)||null;
  }
  if(b.finalRemark!==undefined){
    if(req.user.role!=='HEAD_TEACHER')return res.status(403).json({error:'Only the Head Teacher can update the final remark'});
    if(row.status!=='ENDORSED')return res.status(409).json({error:'Final remark requires an endorsed report card'});
    d.finalRemark=clean(b.finalRemark)||null;
  }
  const saved=await prisma.reportCard.update({where:{id:row.id},data:d,include:reportCardInclude});
  res.json(saved);
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to update report card'});}
}


async function submitReportCard(req,res){
 try{
  const row=await prisma.reportCard.findFirst({where:{id:req.params.id,schoolId:sid(req)},include:{subjects:true}});
  if(!row)return res.status(404).json({error:'Report card not found'});
  if(req.user.role!=='TEACHER'||row.teacherId!==req.user.id)return res.status(403).json({error:'Only the assigned class teacher can submit the consolidated report'});
  if(!['DRAFT','RETURNED'].includes(row.status))return res.status(409).json({error:'This report card is not ready for teacher submission'});
  if(!row.subjects.length)return res.status(409).json({error:'No subjects are attached to this consolidated report yet'});
  const incomplete=row.subjects.filter(s=>s.grade===null||s.grade===undefined||String(s.grade).trim()==='');
  if(incomplete.length)return res.status(409).json({error:'Every subject must have a result before the consolidated report can be submitted',missingSubjectIds:incomplete.map(s=>s.subjectId)});
  const saved=await prisma.reportCard.update({where:{id:row.id},data:{status:'SUBMITTED',submittedAt:new Date(),returnedAt:null,returnReason:null},include:reportCardInclude});
  res.json(saved);
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to submit report card'});}
}


async function decideReportCard(req,res){
 try{
  const row=await prisma.reportCard.findFirst({where:{id:req.params.id,schoolId:sid(req)}});if(!row)return res.status(404).json({error:'Report card not found'});const action=clean(req.body?.action).toUpperCase(),reason=clean(req.body?.reason);let d;
  if(action==='ENDORSE'){if(req.user.role!=='HEAD_OF_ACADEMICS')return res.status(403).json({error:'Only the Head of Academics can endorse report cards'});if(row.status!=='SUBMITTED')return res.status(409).json({error:'Only submitted report cards can be endorsed'});d={status:'ENDORSED',academicReviewerId:req.user.id,endorsedAt:new Date()};}
  else if(action==='FINALIZE'){if(req.user.role!=='HEAD_TEACHER')return res.status(403).json({error:'Only the Head Teacher can finalize report cards'});if(row.status!=='ENDORSED')return res.status(409).json({error:'Only endorsed report cards can be finalized'});d={status:'FINALIZED',headTeacherId:req.user.id,finalizedAt:new Date()};}
  else if(action==='RELEASE'){if(req.user.role!=='HEAD_TEACHER')return res.status(403).json({error:'Only the Head Teacher can release report cards'});if(row.status!=='FINALIZED')return res.status(409).json({error:'Only finalized report cards can be released'});d={status:'RELEASED',headTeacherId:req.user.id,releasedAt:new Date()};}
  else if(action==='RETURN'){if(!reason)return res.status(400).json({error:'A return reason is required'});if(req.user.role==='HEAD_OF_ACADEMICS'&&row.status==='SUBMITTED'||req.user.role==='HEAD_TEACHER'&&row.status==='ENDORSED')d={status:'RETURNED',returnedAt:new Date(),returnReason:reason};else return res.status(409).json({error:'This report card cannot be returned at its current workflow stage'});}
  else return res.status(400).json({error:'Action must be ENDORSE, FINALIZE, RELEASE or RETURN'});
  const saved = await prisma.reportCard.update({where:{id:row.id},data:d,include:reportCardInclude});
  if (action === 'RELEASE') {
    // Notify the guardian only after the RELEASED status is committed.
    // The report's private marks remain inside the authenticated portal.
    void prisma.student.findFirst({
      where: { id: saved.studentId, schoolId: saved.schoolId },
      select: { firstName: true, lastName: true, guardianPhone: true }
    }).then(student => {
      if (!student?.guardianPhone) return null;
      const portalBase = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
      const signInLink = portalBase ? `${portalBase}/signin.html` : '';
      const notice = `ConnectSukuu: ${student.firstName} ${student.lastName}'s final report card is ready.`;
      const message = `${notice} ${signInLink ? `Open ${signInLink} and sign in to view it.` : 'Sign in to ConnectSukuu to view it.'}`;
      return sendSms({
        schoolId: saved.schoolId,
        eventType: 'REPORT_CARD',
        recipient: student.guardianPhone,
        message,
        idempotencyKey: `report:${saved.id}:${student.guardianPhone}`
      });
    }).catch(error => console.error('SMS report-card notification failed:', error.message || error));
  }
  res.json(saved);
 }catch(e){console.error(e);res.status(500).json({error:'Failed to update report-card workflow'});}
}
async function saveReportCardSubject(req,res){
 try{
  const row=await prisma.reportCard.findFirst({where:{id:req.params.id,schoolId:sid(req)},select:{id:true,status:true,teacherId:true}});
  if(!row)return res.status(404).json({error:'Report card not found'});
  const subjectId=clean(req.body?.subjectId);
  if(!subjectId)return res.status(400).json({error:'Subject is required'});
  const reportSubject=await prisma.reportCardSubject.findFirst({where:{reportCardId:row.id,subjectId},select:{id:true,teacherId:true}});
  if(!reportSubject)return res.status(404).json({error:'This subject is not part of the consolidated report card'});
  if(req.user.role==='TEACHER'){
    if(reportSubject.teacherId!==req.user.id)return res.status(403).json({error:'You can only enter results for your assigned subject'});
    if(!['DRAFT','RETURNED'].includes(row.status))return res.status(409).json({error:'Report-card results are locked at this stage'});

    const reportContext=await prisma.reportCard.findUnique({
      where:{id:row.id},
      select:{academicYearId:true,termId:true,classId:true}
    });
    const generated=reportContext?await prisma.assessment.findFirst({
      where:{
        schoolId:sid(req),
        academicYearId:reportContext.academicYearId,
        termId:reportContext.termId,
        classId:reportContext.classId,
        subjectId,
        status:{in:['SUBMITTED','CLOSED']}
      },
      select:{id:true}
    }):null;
    if(generated)return res.status(409).json({error:'This subject result is generated from assessment scores and is locked. Correct the source assessment before report-card generation.'});
  }else if(req.user.role==='HEAD_OF_ACADEMICS'){
    if(!['DRAFT','RETURNED','SUBMITTED'].includes(row.status))return res.status(409).json({error:'Subject remarks are locked at this workflow stage'});
    const teacherRemark=clean(req.body?.teacherRemark??req.body?.remark)||null;
    return res.json(await prisma.reportCardSubject.update({where:{id:reportSubject.id},data:{teacherRemark,remark:teacherRemark}}));
  }else if(req.user.role!=='HEAD_TEACHER')return res.status(403).json({error:'You do not have permission to edit report-card subject results'});
  const totalScore=num(req.body?.totalScore,'Total score'),maxScore=num(req.body?.maxScore,'Maximum score');
  if(maxScore<=0)return res.status(400).json({error:'Maximum score must be greater than zero'});
  if(totalScore<0||totalScore>maxScore)return res.status(400).json({error:'Total score must be between zero and the maximum score'});
  const percentage=Math.round(totalScore/maxScore*10000)/100,grade=clean(req.body?.grade)||null,teacherRemark=clean(req.body?.teacherRemark??req.body?.remark)||null;
  res.json(await prisma.reportCardSubject.update({where:{id:reportSubject.id},data:{totalScore,maxScore,percentage,grade,remark:teacherRemark,teacherRemark}}));
 }catch(e){console.error(e);res.status(e.status||500).json({error:e.message||'Failed to save report-card subject result'});}
}








async function syncReportCardSubjects(req,res){
 try{
  const schoolId=sid(req);
  const row=await prisma.reportCard.findFirst({where:{id:req.params.id,schoolId},select:{id:true,academicYearId:true,classId:true,status:true,teacherId:true}});
  if(!row)return res.status(404).json({error:'Report card not found'});
  if(req.user.role==='TEACHER' && row.teacherId!==req.user.id){
    const own=await prisma.reportCardSubject.findFirst({where:{reportCardId:row.id,teacherId:req.user.id},select:{id:true}});
    if(!own)return res.status(403).json({error:'You can only synchronize report cards assigned to you or one of your assigned subjects'});
  }
  if(!['DRAFT','RETURNED'].includes(row.status))return res.status(409).json({error:'Subjects can only be synchronized while the report card is editable'});
  const classSubjects=await prisma.classSubject.findMany({where:{schoolId,classId:row.classId},select:{subjectId:true},distinct:['subjectId']});
  if(!classSubjects.length)return res.status(409).json({error:'No subjects are assigned to this class yet. Open Academic Setup and assign subjects to the class first.'});
  const subjectIds=classSubjects.map(x=>x.subjectId).filter(Boolean);
  const assignments=await prisma.teachingAssignment.findMany({where:{schoolId,academicYearId:row.academicYearId,classId:row.classId,subjectId:{in:subjectIds}},select:{subjectId:true,teacherId:true,assignmentType:true},orderBy:{createdAt:'asc'}});
  const primary=new Map();
  for(const a of assignments)if(a.assignmentType==='PRIMARY'&&!primary.has(a.subjectId))primary.set(a.subjectId,a.teacherId);
  for(const a of assignments)if(!primary.has(a.subjectId))primary.set(a.subjectId,a.teacherId);
  for(const subjectId of subjectIds){
    const teacherId=primary.get(subjectId)||null;
    await prisma.reportCardSubject.upsert({
      where:{reportCardId_subjectId:{reportCardId:row.id,subjectId}},
      create:{schoolId,reportCardId:row.id,subjectId,teacherId,totalScore:0,maxScore:100,percentage:0,grade:null,remark:null,teacherRemark:null},
      update:teacherId?{teacherId}:{}
    });
  }
  const full=await prisma.reportCard.findFirst({where:{id:row.id,schoolId},include:{...reportCardInclude,subjects:{orderBy:{subject:{name:'asc'}},include:{subject:{select:{id:true,name:true,code:true}}}}}});
  if(!full)return res.status(404).json({error:'Report card not found'});
  await hydrateReportCard(full,schoolId);
  full.calculatedMetrics=await calculateReportCardMetrics(full,schoolId);
  res.json(full);
 }catch(e){
  console.error('syncReportCardSubjects:',e);
  res.status(e.status||500).json({error:e.message||'Failed to synchronize report-card subjects'});
 }
}

async function dashboardSummary(req,res){
 try{
  const b={schoolId:sid(req)},q=req.query;if(q.academicYearId)b.academicYearId=q.academicYearId;if(q.termId)b.termId=q.termId;const tw=req.user.role==='TEACHER'?{teacherId:req.user.id}:{};
  const [a,sa,ca,r,e,f,rr]=await Promise.all([
   prisma.assessment.count({where:{...b,...tw}}),prisma.assessment.count({where:{...b,...tw,status:'SUBMITTED'}}),prisma.assessment.count({where:{...b,...tw,status:'CLOSED'}}),
   prisma.reportCard.count({where:{...b,...tw}}),prisma.reportCard.count({where:{...b,status:'ENDORSED'}}),prisma.reportCard.count({where:{...b,status:'FINALIZED'}}),prisma.reportCard.count({where:{...b,status:'RELEASED'}})
  ]);
  res.json({assessments:a,submittedAssessments:sa,closedAssessments:ca,reportCards:r,endorsedReportCards:e,finalizedReportCards:f,releasedReportCards:rr});
 }catch(e){console.error(e);res.status(500).json({error:'Failed to load assessment dashboard summary'});}
}
module.exports={listReportCardStudents,syncReportCardSubjects,getAssessmentPerformance,deleteAssessment,listAssessments,getAssessment,createAssessment,updateAssessment,saveScores,submitAssessment,closeAssessment,listReportCards,getReportCard,createReportCard,updateReportCard,submitReportCard,decideReportCard,saveReportCardSubject,dashboardSummary};
