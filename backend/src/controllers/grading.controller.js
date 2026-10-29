const prisma = require('../config/db');

const DEFAULT_BANDS = [
  {label:'A',minPercentage:80,maxPercentage:100,points:4,remark:'Excellent'},
  {label:'B',minPercentage:70,maxPercentage:79.99,points:3,remark:'Very good'},
  {label:'C',minPercentage:60,maxPercentage:69.99,points:2,remark:'Good'},
  {label:'D',minPercentage:50,maxPercentage:59.99,points:1,remark:'Pass'},
  {label:'E',minPercentage:40,maxPercentage:49.99,points:0.5,remark:'Needs improvement'},
  {label:'F',minPercentage:0,maxPercentage:39.99,points:0,remark:'Fail'}
];

const clean=v=>typeof v==='string'?v.trim():'';
const LEGACY_IMPLICIT_DEFAULT_NAMES = new Set(['default 100-point scale','default a-f','default a-f scale']);
const isLegacyImplicitDefault = name => LEGACY_IMPLICIT_DEFAULT_NAMES.has(String(name||'').trim().toLowerCase());

function validateBands(bands){
  if(!Array.isArray(bands)||bands.length<2)return 'At least two grading bands are required.';
  const seen=new Set();
  const rows=bands.map((b,i)=>({
    label:clean(b.label),
    minPercentage:Number(b.minPercentage),
    maxPercentage:Number(b.maxPercentage),
    points:b.points===null||b.points===undefined||b.points===''?null:Number(b.points),
    remark:clean(b.remark)||null,
    i
  }));
  for(const b of rows){
    if(!b.label)return `Band ${b.i+1} requires a label.`;
    if(seen.has(b.label.toUpperCase()))return `Duplicate grading label: ${b.label}.`;
    seen.add(b.label.toUpperCase());
    if(!Number.isFinite(b.minPercentage)||!Number.isFinite(b.maxPercentage)||b.minPercentage<0||b.maxPercentage>100||b.minPercentage>b.maxPercentage)return `Invalid percentage range for ${b.label}.`;
    if(b.points!==null&&!Number.isFinite(b.points))return `Invalid points value for ${b.label}.`;
  }
  rows.sort((x,y)=>x.minPercentage-y.minPercentage);
  if(Math.abs(rows[0].minPercentage-0)>0.001)return 'The grading scale must begin at 0%.';
  if(Math.abs(rows[rows.length-1].maxPercentage-100)>0.001)return 'The grading scale must end at 100%.';
  for(let i=1;i<rows.length;i++){
    const previous=rows[i-1],current=rows[i];
    // Integer percentage bands are inclusive (0–39, 40–44, etc.); decimal
    // bands retain continuous boundaries (39.99, 40.00, etc.).
    const wholeNumberBoundary=Number.isInteger(previous.maxPercentage)&&Number.isInteger(current.minPercentage);
    if(wholeNumberBoundary){
      if(current.minPercentage>previous.maxPercentage+1)return `There is a gap between ${previous.label} and ${current.label}.`;
      if(current.minPercentage<=previous.maxPercentage)return `The ranges for ${previous.label} and ${current.label} overlap.`;
    }else{
      if(current.minPercentage>previous.maxPercentage+0.011)return `There is a gap between ${previous.label} and ${current.label}.`;
      if(current.minPercentage<previous.maxPercentage-0.011)return `The ranges for ${previous.label} and ${current.label} overlap.`;
    }
  }
  return null;
}

async function getDefaultGradingScale(req,res){
  try{
    const schoolId=req.user.schoolId;
    const rows=await prisma.gradingScale.findMany({where:{schoolId,isDefault:true},include:{bands:{orderBy:{minPercentage:'desc'}}}});
    const scale=rows.find(x=>!isLegacyImplicitDefault(x.name)&&Array.isArray(x.bands)&&x.bands.length>0);
    if(!scale)return res.status(409).json({error:'No usable default grading system has been selected. Configure a real grading system with grade bands in Academic Setup first.'});
    res.json(scale);
  }catch(e){console.error(e);res.status(500).json({error:e.message||'Failed to load grading scale'});}
}

async function updateDefaultGradingScale(req,res){
  try{
    if(!['HEAD_OF_ACADEMICS','HEAD_TEACHER'].includes(req.user.role))return res.status(403).json({error:'Only academic leadership can manage the grading scale'});
    const schoolId=req.user.schoolId,b=req.body||{};
    const validation=validateBands(b.bands);
    if(validation)return res.status(400).json({error:validation});
    const name=clean(b.name)||'Default A-F';
    let scale=await prisma.gradingScale.findFirst({where:{schoolId,isDefault:true}});
    if(!scale)scale=await prisma.gradingScale.create({data:{schoolId,name,description:clean(b.description)||null,isDefault:true}});
    else scale=await prisma.gradingScale.update({where:{id:scale.id},data:{name,description:clean(b.description)||null,isDefault:true}});
    await prisma.gradingScaleBand.deleteMany({where:{gradingScaleId:scale.id}});
    await prisma.gradingScaleBand.createMany({data:b.bands.map(x=>({gradingScaleId:scale.id,label:clean(x.label),minPercentage:Number(x.minPercentage),maxPercentage:Number(x.maxPercentage),points:x.points===null||x.points===undefined||x.points===''?null:Number(x.points),remark:clean(x.remark)||null}))});
    const saved=await prisma.gradingScale.findUnique({where:{id:scale.id},include:{bands:{orderBy:{minPercentage:'desc'}}}});
    res.json(saved);
  }catch(e){console.error(e);res.status(500).json({error:e.message||'Failed to save grading scale'});}
}

module.exports={getDefaultGradingScale,updateDefaultGradingScale};
