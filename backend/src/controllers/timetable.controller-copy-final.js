const prisma = require('../config/db');

const VALID_DAYS = [1,2,3,4,5,6,7];

function isValidTime(v){return typeof v==='string'&&/^([01]\d|2[0-3]):([0-5]\d)$/.test(v)}
function mins(v){const [h,m]=String(v).slice(0,5).split(':').map(Number);return h*60+m}
function overlap(a,b,c,d){return mins(a)<mins(d)&&mins(c)<mins(b)}
function room(v){return typeof v==='string'&&v.trim()?v.trim():null}

const include={
 academicYear:{select:{id:true,name:true,isCurrent:true}},
 term:{select:{id:true,name:true,isCurrent:true}},
 schoolClass:{select:{id:true,name:true,level:true,section:true}},
 teachingAssignment:{
  select:{id:true,assignmentType:true,
   schoolClass:{select:{id:true,name:true,level:true,section:true}},
   subject:{select:{id:true,name:true,code:true}},
   teacher:{select:{id:true,firstName:true,lastName:true,email:true}}
  }
 }
};

async function context(req, p){
 const year=await prisma.academicYear.findFirst({where:{id:p.academicYearId,schoolId:req.user.schoolId}});
 if(!year)return {status:404,error:'Academic year not found'};
 const term=await prisma.term.findFirst({where:{id:p.termId,academicYearId:p.academicYearId,academicYear:{schoolId:req.user.schoolId}}});
 if(!term)return {status:404,error:'Term not found for this academic year'};
 const cls=await prisma.schoolClass.findFirst({where:{id:p.classId,academicYearId:p.academicYearId,schoolId:req.user.schoolId}});
 if(!cls)return {status:404,error:'Class not found for this academic year'};
 let assignment=null;
 if(p.teachingAssignmentId){
  assignment=await prisma.teachingAssignment.findFirst({
   where:{id:p.teachingAssignmentId,schoolId:req.user.schoolId,academicYearId:p.academicYearId},
   include:{schoolClass:{select:{id:true,name:true}},subject:{select:{id:true,name:true}},teacher:{select:{id:true,firstName:true,lastName:true,email:true}}}
  });
  if(!assignment)return {status:404,error:'Teaching assignment not found for this academic year'};
  if(assignment.classId!==p.classId)return {status:400,error:'The teaching assignment does not belong to the selected class'};
 }
 return {year,term,cls,assignment};
}

async function conflicts(req,p,excludeId){
 const rows=await prisma.timetableEntry.findMany({
  where:{schoolId:req.user.schoolId,academicYearId:p.academicYearId,termId:p.termId,dayOfWeek:p.dayOfWeek,...(excludeId?{id:{not:excludeId}}:{})},
  include:{schoolClass:{select:{id:true}},teachingAssignment:{select:{teacherId:true}}}
 });
 let teacherId=null;
 if(p.teachingAssignmentId){
  const a=await prisma.teachingAssignment.findFirst({where:{id:p.teachingAssignmentId,schoolId:req.user.schoolId},select:{teacherId:true}});
  teacherId=a?.teacherId||null;
 }
 for(const x of rows){
  if(!overlap(p.startTime,p.endTime,x.startTime,x.endTime))continue;
  if(x.schoolClass?.id===p.classId)return 'Class timetable conflict: this class already has a period during this time';
  if(teacherId&&x.teachingAssignment?.teacherId===teacherId)return 'Teacher timetable conflict: this teacher is already scheduled during this time';
  if(room(p.room)&&x.room&&room(p.room).toLowerCase()===x.room.toLowerCase())return 'Room timetable conflict: this room is already occupied during this time';
 }
 return null;
}

async function listTimetable(req,res){
 try{
  const {academicYearId,termId,classId,teacherId,dayOfWeek}=req.query;
  const where={schoolId:req.user.schoolId};
  if(academicYearId)where.academicYearId=academicYearId;
  if(termId)where.termId=termId;
  if(classId)where.classId=classId;
  if(dayOfWeek){
   const d=Number(dayOfWeek);if(!VALID_DAYS.includes(d))return res.status(400).json({error:'Invalid day of week'});where.dayOfWeek=d;
  }
  const rows=await prisma.timetableEntry.findMany({where,include,orderBy:[{dayOfWeek:'asc'},{startTime:'asc'}]});
  let result=rows;
  if(teacherId)result=result.filter(x=>x.teachingAssignment?.teacher?.id===teacherId);
  if(req.user.role==='TEACHER')result=result.filter(x=>x.teachingAssignment?.teacher?.id===req.user.id);
  res.json(result);
 }catch(e){console.error('listTimetable error:',e);res.status(500).json({error:'Failed to load timetable'})}
}

async function listTimetableAssignments(req,res){
 try{
  const {academicYearId,classId,teacherId,subjectId}=req.query;
  const where={schoolId:req.user.schoolId,...(academicYearId?{academicYearId}:{}),...(classId?{classId}:{}),...(teacherId?{teacherId}:{}),...(subjectId?{subjectId}:{})};
  const rows=await prisma.teachingAssignment.findMany({
   where,include:{academicYear:{select:{id:true,name:true,isCurrent:true}},schoolClass:{select:{id:true,name:true,level:true,section:true}},subject:{select:{id:true,name:true,code:true}},teacher:{select:{id:true,firstName:true,lastName:true,email:true}},_count:{select:{timetableEntries:true}}},
   orderBy:[{schoolClass:{name:'asc'}},{subject:{name:'asc'}}]
  });
  res.json(rows);
 }catch(e){console.error('listTimetableAssignments error:',e);res.status(500).json({error:'Failed to load teaching assignments'})}
}

async function createTimetableEntry(req,res){
 try{
  const {academicYearId,termId,classId,teachingAssignmentId,dayOfWeek,days,startTime,endTime,room:rawRoom}=req.body;
  const requestedDays=Array.isArray(days)?days:[dayOfWeek];
  const parsedDays=[...new Set(requestedDays.map(Number))];
  if(!academicYearId||!termId||!classId||!parsedDays.length||parsedDays.some(d=>!VALID_DAYS.includes(d))||!startTime||!endTime)
    return res.status(400).json({error:'Academic year, term, class, day(s), start time and end time are required'});
  if(!isValidTime(startTime)||!isValidTime(endTime))return res.status(400).json({error:'Start time and end time must use HH:MM format'});
  if(mins(startTime)>=mins(endTime))return res.status(400).json({error:'End time must be later than start time'});
  const c=await context(req,{academicYearId,termId,classId,teachingAssignmentId});
  if(c.error)return res.status(c.status).json({error:c.error});

  for(const day of parsedDays){
    const conflict=await conflicts(req,{academicYearId,termId,classId,teachingAssignmentId:teachingAssignmentId||null,dayOfWeek:day,startTime,endTime,room:rawRoom});
    if(conflict)return res.status(409).json({error:`${['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][day]}: ${conflict}`});
  }

  const rows=await prisma.$transaction(async tx=>{
    const created=[];
    for(const day of parsedDays){
      created.push(await tx.timetableEntry.create({
        data:{schoolId:req.user.schoolId,academicYearId,termId,classId,teachingAssignmentId:teachingAssignmentId||null,dayOfWeek:day,startTime,endTime,room:room(rawRoom)}
      }));
    }
    return created;
  });

  const full=await prisma.timetableEntry.findMany({where:{id:{in:rows.map(x=>x.id)},schoolId:req.user.schoolId},include,orderBy:[{dayOfWeek:'asc'},{startTime:'asc'}]});
  res.status(201).json({success:true,created:full.length,entries:full,message:`${full.length} timetable period${full.length===1?'':'s'} created successfully.`});
 }catch(e){console.error('createTimetableEntry error:',e);res.status(500).json({error:'Failed to create timetable entry'})}
}

async function updateTimetableEntry(req,res){
 try{
  const existing=await prisma.timetableEntry.findFirst({where:{id:req.params.id,schoolId:req.user.schoolId}});
  if(!existing)return res.status(404).json({error:'Timetable entry not found'});
  const {academicYearId,termId,classId,teachingAssignmentId,dayOfWeek,startTime,endTime,room:rawRoom}=req.body;
  if(!academicYearId||!termId||!classId||dayOfWeek===undefined||!startTime||!endTime)return res.status(400).json({error:'Academic year, term, class, day, start time and end time are required'});
  const day=Number(dayOfWeek);if(!VALID_DAYS.includes(day))return res.status(400).json({error:'Day of week must be between 1 and 7'});
  if(!isValidTime(startTime)||!isValidTime(endTime))return res.status(400).json({error:'Start time and end time must use HH:MM format'});
  if(mins(startTime)>=mins(endTime))return res.status(400).json({error:'End time must be later than start time'});
  const c=await context(req,{academicYearId,termId,classId,teachingAssignmentId});
  if(c.error)return res.status(c.status).json({error:c.error});
  const conflict=await conflicts(req,{academicYearId,termId,classId,teachingAssignmentId:teachingAssignmentId||null,dayOfWeek:day,startTime,endTime,room:rawRoom},existing.id);
  if(conflict)return res.status(409).json({error:conflict});
  const row=await prisma.timetableEntry.update({where:{id:existing.id},data:{academicYearId,termId,classId,teachingAssignmentId:teachingAssignmentId||null,dayOfWeek:day,startTime,endTime,room:room(rawRoom)},include});
  res.json(row);
 }catch(e){console.error('updateTimetableEntry error:',e);res.status(500).json({error:'Failed to update timetable entry'})}
}

async function deleteTimetableEntry(req,res){
 try{
  const row=await prisma.timetableEntry.findFirst({where:{id:req.params.id,schoolId:req.user.schoolId}});
  if(!row)return res.status(404).json({error:'Timetable entry not found'});
  await prisma.timetableEntry.delete({where:{id:row.id}});
  res.json({success:true});
 }catch(e){console.error('deleteTimetableEntry error:',e);res.status(500).json({error:'Failed to delete timetable entry'})}
}

async function copyContext(req,b){
 const keys=['sourceAcademicYearId','sourceTermId','sourceClassId','targetAcademicYearId','targetTermId','targetClassId'];
 if(keys.some(k=>!b[k]))return {status:400,error:'All source and destination selections are required'};
 const s=await context(req,{academicYearId:b.sourceAcademicYearId,termId:b.sourceTermId,classId:b.sourceClassId});
 if(s.error)return {status:s.status,error:`Source: ${s.error}`};
 const t=await context(req,{academicYearId:b.targetAcademicYearId,termId:b.targetTermId,classId:b.targetClassId});
 if(t.error)return {status:t.status,error:`Destination: ${t.error}`};
 if(b.sourceAcademicYearId===b.targetAcademicYearId&&b.sourceTermId===b.targetTermId&&b.sourceClassId===b.targetClassId)return {status:400,error:'Source and destination must be different'};
 return {s,t};
}

async function copyPreview(req,res){
 try{
  const b=req.body,c=await copyContext(req,b);if(c.error)return res.status(c.status).json({error:c.error});
  const rows=await prisma.timetableEntry.findMany({where:{schoolId:req.user.schoolId,academicYearId:b.sourceAcademicYearId,termId:b.sourceTermId,classId:b.sourceClassId},include:{teachingAssignment:{select:{subjectId:true,subject:{select:{id:true,name:true,code:true}}}}},orderBy:[{dayOfWeek:'asc'},{startTime:'asc'}]});
  const targets=await prisma.teachingAssignment.findMany({where:{schoolId:req.user.schoolId,academicYearId:b.targetAcademicYearId,classId:b.targetClassId},select:{id:true,subjectId:true,assignmentType:true,subject:{select:{id:true,name:true,code:true}}},orderBy:{assignmentType:'asc'}});
  const bySubject=new Map();for(const a of targets)if(!bySubject.has(a.subjectId)||a.assignmentType==='PRIMARY')bySubject.set(a.subjectId,a);
  const entries=rows.map(x=>({id:x.id,dayOfWeek:x.dayOfWeek,startTime:x.startTime,endTime:x.endTime,room:x.room,subject:x.teachingAssignment?.subject||null,targetAssignment:x.teachingAssignment?.subjectId?bySubject.get(x.teachingAssignment.subjectId)||null:null}));
  const unmatched=entries.filter(x=>x.subject&&!x.targetAssignment).length;
  res.json({academicYearId:b.sourceAcademicYearId,termId:b.sourceTermId,classId:b.sourceClassId,targetAcademicYearId:b.targetAcademicYearId,targetTermId:b.targetTermId,targetClassId:b.targetClassId,total:entries.length,ready:entries.length-unmatched,unmatched,entries});
 }catch(e){console.error('copyPreview error:',e);res.status(500).json({error:'Failed to preview timetable copy'})}
}

async function copyTimetable(req,res){
 try{
  const b=req.body||{};
  const c=await copyContext(req,b);
  if(c.error)return res.status(c.status).json({error:c.error});

  const rows=await prisma.timetableEntry.findMany({
   where:{
    schoolId:req.user.schoolId,
    academicYearId:b.sourceAcademicYearId,
    termId:b.sourceTermId,
    classId:b.sourceClassId,
   },
   include:{teachingAssignment:{select:{subjectId:true}}},
   orderBy:[{dayOfWeek:'asc'},{startTime:'asc'}],
  });

  if(!rows.length)return res.status(400).json({error:'The source timetable is empty'});

  const targets=await prisma.teachingAssignment.findMany({
   where:{
    schoolId:req.user.schoolId,
    academicYearId:b.targetAcademicYearId,
    classId:b.targetClassId,
   },
   select:{id:true,subjectId:true,assignmentType:true},
  });

  const bySubject=new Map();
  for(const a of targets){
   if(!bySubject.has(a.subjectId)||a.assignmentType==='PRIMARY')bySubject.set(a.subjectId,a);
  }

  const destinationWhere={
   schoolId:req.user.schoolId,
   academicYearId:b.targetAcademicYearId,
   termId:b.targetTermId,
   classId:b.targetClassId,
  };

  const result=await prisma.$transaction(async tx=>{
   if(b.overwrite===true || b.overwrite==='true'){
    await tx.timetableEntry.deleteMany({where:destinationWhere});
   }

   const existing=await tx.timetableEntry.findMany({
    where:destinationWhere,
    select:{dayOfWeek:true,startTime:true,endTime:true},
   });

   const overlaps=(a,b,c,d)=>{
    const toMinutes=v=>{const [h,m]=String(v).slice(0,5).split(':').map(Number);return h*60+m};
    return toMinutes(a)<toMinutes(d)&&toMinutes(c)<toMinutes(b);
   };

   const copied=[];
   const skipped=[];
   let unmatched=0;

   for(const x of rows){
    const assignmentId=x.teachingAssignment?.subjectId
      ? bySubject.get(x.teachingAssignment.subjectId)?.id || null
      : null;

    if(x.teachingAssignment?.subjectId && !assignmentId)unmatched++;

    if(!b.overwrite){
     const conflict=existing.find(e=>e.dayOfWeek===x.dayOfWeek && overlaps(x.startTime,x.endTime,e.startTime,e.endTime));
     if(conflict){
      skipped.push({dayOfWeek:x.dayOfWeek,startTime:x.startTime,endTime:x.endTime});
      continue;
     }
    }

    const created=await tx.timetableEntry.create({
     data:{
      schoolId:req.user.schoolId,
      academicYearId:b.targetAcademicYearId,
      termId:b.targetTermId,
      classId:b.targetClassId,
      teachingAssignmentId:assignmentId,
      dayOfWeek:x.dayOfWeek,
      startTime:x.startTime,
      endTime:x.endTime,
      room:x.room,
     },
    });
    copied.push(created.id);
    existing.push({dayOfWeek:x.dayOfWeek,startTime:x.startTime,endTime:x.endTime});
   }

   return {copied:copied.length,skipped:skipped.length,unmatched,skippedItems:skipped};
  });

  const parts=[`${result.copied} timetable item${result.copied===1?'':'s'} copied successfully.`];
  if(result.skipped)parts.push(`${result.skipped} existing period${result.skipped===1?' was':'s were'} left unchanged because replacement was not selected.`);
  if(result.unmatched)parts.push(`${result.unmatched} assigned lesson${result.unmatched===1?'':'s'} had no matching destination teaching assignment and ${result.unmatched===1?'was':'were'} copied as empty period${result.unmatched===1?'':'s'}.`);

  return res.json({
   success:true,
   copied:result.copied,
   skipped:result.skipped,
   unmatched:result.unmatched,
   message:parts.join(' '),
  });
 }catch(e){
  console.error('copyTimetable error:',e);
  if(e?.code==='P2002')return res.status(409).json({error:'The destination timetable contains a duplicate period. Preview again or enable replacement.'});
  return res.status(500).json({error:e?.message||'Failed to copy timetable'});
 }
}

module.exports={listTimetable,listTimetableAssignments,createTimetableEntry,updateTimetableEntry,deleteTimetableEntry,previewCopyTimetable:copyPreview,copyTimetable};
