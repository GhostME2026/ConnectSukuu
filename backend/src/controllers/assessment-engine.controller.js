const prisma = require('../config/db');

const sid = req => req.user.schoolId;
const clean = v => typeof v === 'string' ? v.trim() : '';
const round2 = v => Math.round(Number(v) * 100) / 100;

const DEFAULT_BANDS = [
  {label:'A', minPercentage:80, maxPercentage:100, points:4, remark:'Excellent'},
  {label:'B', minPercentage:70, maxPercentage:79.99, points:3, remark:'Very good'},
  {label:'C', minPercentage:60, maxPercentage:69.99, points:2, remark:'Good'},
  {label:'D', minPercentage:50, maxPercentage:59.99, points:1, remark:'Pass'},
  {label:'E', minPercentage:40, maxPercentage:49.99, points:0.5, remark:'Needs improvement'},
  {label:'F', minPercentage:0, maxPercentage:39.99, points:0, remark:'Fail'}
];

async function ensureDefaultScale(schoolId){
  let scale=await prisma.gradingScale.findFirst({where:{schoolId,isDefault:true}});
  if(!scale) scale=await prisma.gradingScale.findFirst({where:{schoolId,name:'Default 100-Point Scale'}});
  if(!scale){
    scale=await prisma.gradingScale.create({data:{schoolId,name:'Default 100-Point Scale',description:'Default A-F grading scale. Additional grading scales can be added later.',isDefault:true}});
  }else if(!scale.isDefault){
    scale=await prisma.gradingScale.update({where:{id:scale.id},data:{isDefault:true}});
  }
  const existing=await prisma.gradingScaleBand.findMany({where:{schoolId,gradingScaleId:scale.id},select:{id:true,label:true,minPercentage:true,maxPercentage:true}});
  const labels=new Set(existing.map(x=>x.label));
  const expected=DEFAULT_BANDS.map(x=>x.label);
  const exact=existing.length===expected.length && expected.every(x=>labels.has(x));
  if(!exact){
    await prisma.gradingScaleBand.deleteMany({where:{schoolId,gradingScaleId:scale.id}});
    await prisma.gradingScaleBand.createMany({data:DEFAULT_BANDS.map(b=>({...b,schoolId,gradingScaleId:scale.id}))});
  }
  return scale;
}





async function listGradingScales(req,res){
 try{
  await ensureDefaultScale(sid(req));
  const rows=await prisma.gradingScale.findMany({where:{schoolId:sid(req)},orderBy:[{isDefault:'desc'},{name:'asc'}]});
  const bands=await prisma.gradingScaleBand.findMany({where:{schoolId:sid(req),gradingScaleId:{in:rows.map(x=>x.id)}},orderBy:[{gradingScaleId:'asc'},{minPercentage:'desc'}]});
  const by=new Map(rows.map(x=>[x.id,[]]));for(const b of bands)by.get(b.gradingScaleId)?.push(b);
  res.json(rows.map(x=>({...x,bands:by.get(x.id)||[]})));
 }catch(e){console.error(e);res.status(500).json({error:'Failed to load grading scales'});}
}

async function createGradingScale(req,res){
 try{
  const schoolId=sid(req), name=clean(req.body?.name);
  if(!name)return res.status(400).json({error:'Grading scale name is required'});
  const raw=Array.isArray(req.body?.bands)?req.body.bands:[];
  if(!raw.length)return res.status(400).json({error:'At least one grading band is required'});
  const bands=raw.map((b,i)=>({
    label:clean(b?.label)||`Band ${i+1}`,
    minPercentage:Number(b?.minPercentage),
    maxPercentage:Number(b?.maxPercentage),
    points:b?.points===''||b?.points==null?null:Number(b.points),
    remark:clean(b?.remark)||null
  }));
  if(bands.some(b=>!Number.isFinite(b.minPercentage)||!Number.isFinite(b.maxPercentage)||b.minPercentage<0||b.maxPercentage>100||b.minPercentage>b.maxPercentage))return res.status(400).json({error:'Each grading band must have valid percentage limits from 0 to 100'});
  const ordered=[...bands].sort((a,b)=>a.minPercentage-b.minPercentage);
  for(let i=1;i<ordered.length;i++) if(ordered[i].minPercentage<=ordered[i-1].maxPercentage) return res.status(400).json({error:'Grading bands cannot overlap'});
  const scale=await prisma.gradingScale.create({data:{schoolId,name,description:clean(req.body?.description)||null,isDefault:false}});
  await prisma.gradingScaleBand.createMany({data:bands.map(b=>({...b,schoolId,gradingScaleId:scale.id}))});
  res.status(201).json({...scale,bands:await prisma.gradingScaleBand.findMany({where:{gradingScaleId:scale.id},orderBy:{minPercentage:'desc'}})});
 }catch(e){console.error(e);res.status(e.code==='P2002'?409:500).json({error:e.code==='P2002'?'A grading scale with that name already exists':'Failed to create grading scale'});}
}

async function assignClassGradingScale(req,res){
 try{
  const schoolId=sid(req),academicYearId=clean(req.body?.academicYearId),classId=clean(req.params.classId),gradingScaleId=clean(req.body?.gradingScaleId);
  if(!academicYearId||!gradingScaleId)return res.status(400).json({error:'Academic year and grading scale are required'});
  const cls=await prisma.schoolClass.findFirst({where:{id:classId,schoolId,academicYearId}});
  if(!cls)return res.status(404).json({error:'Class not found for this academic year'});
  const scale=await prisma.gradingScale.findFirst({where:{id:gradingScaleId,schoolId}});
  if(!scale)return res.status(404).json({error:'Grading scale not found'});
  const row=await prisma.classGradingScale.upsert({where:{academicYearId_classId:{academicYearId,classId}},create:{schoolId,academicYearId,classId,gradingScaleId},update:{gradingScaleId}});
  res.json(row);
 }catch(e){console.error(e);res.status(500).json({error:'Failed to assign grading scale to class'});}
}

async function getClassGradingScale(req,res){
 try{
  const schoolId=sid(req),academicYearId=clean(req.query?.academicYearId),classId=clean(req.params.classId);
  if(!academicYearId)return res.status(400).json({error:'Academic year is required'});
  let row=await prisma.classGradingScale.findFirst({where:{schoolId,academicYearId,classId}});
  if(!row){
    const d=await ensureDefaultScale(schoolId);
    row={gradingScaleId:d.id};
  }
  const scale=await prisma.gradingScale.findFirst({where:{id:row.gradingScaleId,schoolId}});
  if(!scale)return res.status(404).json({error:'Assigned grading scale not found'});
  const bands=await prisma.gradingScaleBand.findMany({where:{schoolId,gradingScaleId:scale.id},orderBy:{minPercentage:'desc'}});
  res.json({...scale,bands});
 }catch(e){console.error(e);res.status(500).json({error:'Failed to load class grading scale'});}
}

function gradeFor(bands, percentage){
  const p=Number(percentage);
  return bands.find(b=>p>=Number(b.minPercentage)&&p<=Number(b.maxPercentage))||null;
}

async function calculateSubject(schoolId, report, subjectId){
  const assessments=await prisma.assessment.findMany({
    where:{schoolId,academicYearId:report.academicYearId,termId:report.termId,classId:report.classId,subjectId,status:'CLOSED'},
    orderBy:{assessmentDate:'asc'},
    include:{subject:{select:{id:true,name:true,code:true}},scores:{where:{studentId:report.studentId},select:{score:true}}}
  });
  const scored=assessments.filter(a=>a.scores.length && Number.isFinite(Number(a.scores[0].score)));
  const weightSum=scored.reduce((s,a)=>s+Number(a.weight||0),0);
  const hasPositiveWeights=weightSum>0;
  const weighted=hasPositiveWeights
    ? scored.reduce((s,a)=>s+(Number(a.scores[0].score)/Number(a.maxScore))*Number(a.weight||0),0)/weightSum*100
    : (scored.length ? scored.reduce((s,a)=>s+(Number(a.scores[0].score)/Number(a.maxScore))*100,0)/scored.length : 0);
  const allClosedScored = assessments.length>0 && scored.length===assessments.length;
  const breakdown=assessments.map(a=>({id:a.id,title:a.title,assessmentType:a.assessmentType,maxScore:Number(a.maxScore),weight:Number(a.weight||0),score:a.scores[0]?.score??null,percentage:a.scores[0]?round2(Number(a.scores[0].score)/Number(a.maxScore)*100):null,status:a.status}));
  return {assessments,scored,weightSum,weighted:round2(weighted),allClosedScored,breakdown};
}

async function recalculateReportCard(req,res){
 try{
  const schoolId=sid(req);
  const report=await prisma.reportCard.findFirst({where:{id:req.params.id,schoolId}});
  if(!report)return res.status(404).json({error:'Report card not found'});
  if(!['DRAFT','RETURNED','SUBMITTED','ENDORSED'].includes(report.status))return res.status(409).json({error:'This report card is already locked'});
  const clsSubjects=await prisma.classSubject.findMany({where:{schoolId,classId:report.classId},select:{subjectId:true},orderBy:{subjectId:'asc'}});
  if(!clsSubjects.length)return res.status(409).json({error:'No subjects are assigned to this class yet.'});
  const scaleRow=await prisma.classGradingScale.findFirst({where:{schoolId,academicYearId:report.academicYearId,classId:report.classId}});
  const scale=await prisma.gradingScale.findFirst({where:{id:scaleRow?.gradingScaleId|| (await ensureDefaultScale(schoolId)).id,schoolId}});
  const bands=scale?await prisma.gradingScaleBand.findMany({where:{schoolId,gradingScaleId:scale.id},orderBy:{minPercentage:'desc'}}):[];
  const results=[];
  for(const cs of clsSubjects){
    const calc=await calculateSubject(schoolId,report,cs.subjectId);
    const band=gradeFor(bands,calc.weighted);
    const subject=await prisma.subject.findFirst({where:{id:cs.subjectId,schoolId},select:{id:true,name:true,code:true}});
    const assignment=await prisma.teachingAssignment.findFirst({where:{schoolId,academicYearId:report.academicYearId,classId:report.classId,subjectId:cs.subjectId,assignmentType:'PRIMARY'},orderBy:{createdAt:'asc'},select:{teacherId:true}});
    const existing=await prisma.reportCardSubject.findFirst({where:{reportCardId:report.id,subjectId:cs.subjectId},select:{id:true,teacherId:true,teacherRemark:true,remark:true}});
    const teacherId=existing?.teacherId||assignment?.teacherId||null;
    const ready=calc.allClosedScored;
    const updated=await prisma.reportCardSubject.upsert({
      where:{reportCardId_subjectId:{reportCardId:report.id,subjectId:cs.subjectId}},
      create:{schoolId,reportCardId:report.id,subjectId:cs.subjectId,teacherId,totalScore:ready?calc.weighted:null,maxScore:100,percentage:ready?calc.weighted:null,grade:ready?(band?.label||null):null,remark:existing?.remark||null,teacherRemark:existing?.teacherRemark||null},
      update:{teacherId:teacherId||undefined,totalScore:ready?calc.weighted:null,maxScore:100,percentage:ready?calc.weighted:null,grade:ready?(band?.label||null):null}
    });
    results.push({subject,teacherId,ready,weightedPercentage:calc.weighted,grade:band?.label||null,gradeRemark:band?.remark||null,weightSum:calc.weightSum,breakdown:calc.breakdown,reportCardSubjectId:updated.id});
  }
  const complete=results.length>0&&results.every(x=>x.ready);
  res.json({reportCardId:report.id,status:report.status,gradingScale:scale?{id:scale.id,name:scale.name}:null,complete,subjects:results});
 }catch(e){console.error('recalculateReportCard:',e);res.status(500).json({error:e.message||'Failed to calculate report-card results'});}
}

async function submitCalculatedReportCard(req,res){
 try{
  const schoolId=sid(req);
  const report=await prisma.reportCard.findFirst({where:{id:req.params.id,schoolId}});
  if(!report)return res.status(404).json({error:'Report card not found'});
  if(req.user.role!=='TEACHER'||report.teacherId!==req.user.id)return res.status(403).json({error:'Only the assigned class teacher can submit the consolidated report'});
  if(!['DRAFT','RETURNED'].includes(report.status))return res.status(409).json({error:'This report card is not ready for teacher submission'});
  const clsSubjects=await prisma.classSubject.findMany({where:{schoolId,classId:report.classId},select:{subjectId:true}});
  if(!clsSubjects.length)return res.status(409).json({error:'No subjects are assigned to this class yet.'});
  const blockers=[];
  for(const cs of clsSubjects){
    const assessments=await prisma.assessment.findMany({where:{schoolId,academicYearId:report.academicYearId,termId:report.termId,classId:report.classId,subjectId:cs.subjectId}});
    if(!assessments.length){blockers.push({subjectId:cs.subjectId,reason:'No assessments exist'});continue;}
    const open=assessments.filter(a=>a.status!=='CLOSED');
    const missing=[];
    for(const a of assessments){const s=await prisma.assessmentScore.findFirst({where:{assessmentId:a.id,studentId:report.studentId},select:{id:true,score:true}});if(!s)missing.push(a.title);}
    if(open.length||missing.length)blockers.push({subjectId:cs.subjectId,reason:open.length?'All assessments must be closed before report submission.':'A student score is missing for one or more assessments.',openAssessments:open.map(a=>a.title),missingScores:missing});
  }
  if(blockers.length)return res.status(409).json({error:'The consolidated report is not complete yet.',blockers});
  // Recalculate one final time immediately before submission.
  const clsScale=await prisma.classGradingScale.findFirst({where:{schoolId,academicYearId:report.academicYearId,classId:report.classId}});
  const scale=await prisma.gradingScale.findFirst({where:{id:clsScale?.gradingScaleId|| (await ensureDefaultScale(schoolId)).id,schoolId}});
  const bands=scale?await prisma.gradingScaleBand.findMany({where:{schoolId,gradingScaleId:scale.id}}):[];
  for(const cs of clsSubjects){
    const assessments=await prisma.assessment.findMany({where:{schoolId,academicYearId:report.academicYearId,termId:report.termId,classId:report.classId,subjectId:cs.subjectId,status:'CLOSED'},include:{scores:{where:{studentId:report.studentId},select:{score:true}}}});
    const w=assessments.reduce((s,a)=>s+Number(a.weight||0),0);
    const pct=w>0?assessments.reduce((s,a)=>s+(Number(a.scores[0].score)/Number(a.maxScore))*Number(a.weight||0),0)/w*100:assessments.reduce((s,a)=>s+(Number(a.scores[0].score)/Number(a.maxScore))*100,0)/assessments.length;
    const band=gradeFor(bands,pct);
    await prisma.reportCardSubject.update({where:{reportCardId_subjectId:{reportCardId:report.id,subjectId:cs.subjectId}},data:{totalScore:round2(pct),maxScore:100,percentage:round2(pct),grade:band?.label||null}});
  }
  const updated=await prisma.reportCard.update({where:{id:report.id},data:{status:'SUBMITTED',submittedAt:new Date(),returnedAt:null,returnReason:null}});
  res.json(updated);
 }catch(e){console.error('submitCalculatedReportCard:',e);res.status(500).json({error:e.message||'Failed to submit consolidated report'});}
}

async function loadDefaultGradingScale(schoolId){
  const fallback={
  name:'Default A-F Scale',
  bands:[
    {label:'A',minPercentage:80,maxPercentage:100,points:4,remark:'Excellent'},
    {label:'B',minPercentage:70,maxPercentage:79.99,points:3,remark:'Very good'},
    {label:'C',minPercentage:60,maxPercentage:69.99,points:2,remark:'Good'},
    {label:'D',minPercentage:50,maxPercentage:59.99,points:1,remark:'Pass'},
    {label:'E',minPercentage:40,maxPercentage:49.99,points:0.5,remark:'Needs improvement'},
    {label:'F',minPercentage:0,maxPercentage:39.99,points:0,remark:'Fail'}
  ]
};
  try{
    const model=prisma.gradingScale;
    if(!model || typeof model.findFirst!=='function')return fallback;
    const scale=await model.findFirst({
      where:{schoolId,isDefault:true},
      include:{bands:{orderBy:{minPercentage:'desc'}}}
    });
    if(scale&&Array.isArray(scale.bands)&&scale.bands.length)return scale;
  }catch(error){
    console.warn('loadDefaultGradingScale: database grading scale unavailable; using A-F fallback:',error.message);
  }
  return fallback;
}


async function listGradingScales(req,res){
 try{
  const schoolId=sid(req);
  const rows=await prisma.gradingScale.findMany({
    where:{schoolId},
    include:{bands:{orderBy:{minPercentage:'desc'}}},
    orderBy:[{isDefault:'desc'},{name:'asc'}]
  });
  return res.json(rows);
 }catch(e){
  console.error(e);
  return res.status(500).json({error:e.message||'Failed to load grading scales'});
 }
}

async function createGradingScale(req,res){
 try{
  const schoolId=sid(req);
  const body=req.body||{};
  const name=String(body.name||'').trim();
  if(!name)return res.status(400).json({error:'Grading scale name is required'});
  const description=body.description==null?null:String(body.description).trim()||null;
  const isDefault=Boolean(body.isDefault);
  if(isDefault)await prisma.gradingScale.updateMany({where:{schoolId,isDefault:true},data:{isDefault:false}});
  const row=await prisma.gradingScale.create({data:{schoolId,name,description,isDefault}});
  return res.status(201).json(row);
 }catch(e){
  console.error(e);
  return res.status(500).json({error:e.message||'Failed to create grading scale'});
 }
}

async function getGradingScale(req,res){
 try{
  const row=await prisma.gradingScale.findFirst({
   where:{id:req.params.id,schoolId:sid(req)},
   include:{bands:{orderBy:{minPercentage:'desc'}}}
  });
  if(!row)return res.status(404).json({error:'Grading scale not found'});
  return res.json(row);
 }catch(e){
  console.error(e);
  return res.status(500).json({error:e.message||'Failed to load grading scale'});
 }
}

async function updateGradingScale(req,res){
 try{
  const schoolId=sid(req);
  const current=await prisma.gradingScale.findFirst({where:{id:req.params.id,schoolId}});
  if(!current)return res.status(404).json({error:'Grading scale not found'});
  const body=req.body||{};
  const data={};
  if(body.name!==undefined){
   const name=String(body.name||'').trim();
   if(!name)return res.status(400).json({error:'Grading scale name is required'});
   data.name=name;
  }
  if(body.description!==undefined)data.description=body.description==null?null:String(body.description).trim()||null;
  if(body.isDefault!==undefined){
   data.isDefault=Boolean(body.isDefault);
   if(data.isDefault)await prisma.gradingScale.updateMany({where:{schoolId,isDefault:true,id:{not:current.id}},data:{isDefault:false}});
  }
  const row=await prisma.gradingScale.update({where:{id:current.id},data,include:{bands:{orderBy:{minPercentage:'desc'}}}});
  return res.json(row);
 }catch(e){
  console.error(e);
  return res.status(500).json({error:e.message||'Failed to update grading scale'});
 }
}

async function deleteGradingScale(req,res){
 try{
  const row=await prisma.gradingScale.findFirst({where:{id:req.params.id,schoolId:sid(req)}});
  if(!row)return res.status(404).json({error:'Grading scale not found'});
  await prisma.gradingScale.delete({where:{id:row.id}});
  return res.json({ok:true});
 }catch(e){
  console.error(e);
  return res.status(500).json({error:e.message||'Failed to delete grading scale'});
 }
}

module.exports={listGradingScales,createGradingScale,assignClassGradingScale,getClassGradingScale,recalculateReportCard,submitCalculatedReportCard,getGradingScale,updateGradingScale,deleteGradingScale};
