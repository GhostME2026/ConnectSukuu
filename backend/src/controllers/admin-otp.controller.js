const prisma=require('../config/db');
function guard(req,res,next){if(req.user?.role!=='SUPER_ADMIN')return res.status(403).json({error:'Super Admin access required.'});next();}
exports.guard=guard;
exports.getSettings=async(req,res,next)=>{try{
 const platform=await prisma.otpPlatformSettings.upsert({where:{id:'global'},create:{id:'global'},update:{}});
 const schools=await prisma.school.findMany({select:{id:true,name:true,slug:true},orderBy:{name:'asc'}});
 const settings=await prisma.otpSchoolSettings.findMany();
 const map=new Map(settings.map(x=>[x.schoolId,x]));
 res.json({platform,schools:schools.map(s=>({...s,otp:map.get(s.id)||null}))});
}catch(e){next(e)}};
exports.updatePlatform=async(req,res,next)=>{try{const d={};for(const k of ['enabled','emailEnabled','smsEnabled','welcomeEmailEnabled'])if(typeof req.body[k]==='boolean')d[k]=req.body[k];
 const row=await prisma.otpPlatformSettings.upsert({where:{id:'global'},create:{id:'global',...d},update:d});res.json({ok:true,platform:row});
}catch(e){next(e)}};
exports.updateSchool=async(req,res,next)=>{try{const school=await prisma.school.findUnique({where:{id:req.params.schoolId},select:{id:true}});if(!school)return res.status(404).json({error:'School not found'});
 const d={};for(const k of ['enabled','emailEnabled','smsEnabled'])if(typeof req.body[k]==='boolean')d[k]=req.body[k];
 const row=await prisma.otpSchoolSettings.upsert({where:{schoolId:school.id},create:{schoolId:school.id,...d},update:d});res.json({ok:true,settings:row});
}catch(e){next(e)}};
exports.updateUserExemption=async(req,res,next)=>{try{const user=await prisma.user.update({where:{id:req.params.userId},data:{otpExempt:Boolean(req.body.otpExempt)},select:{id:true,email:true,firstName:true,lastName:true,role:true,schoolId:true,otpExempt:true}});res.json({ok:true,user});
}catch(e){next(e)}};

exports.lookupUser=async(req,res,next)=>{try{
 const q=String(req.query.identifier||'').trim();
 if(q.length<3)return res.status(400).json({error:'Enter at least 3 characters of the staff email or phone number.'});
 const user=await prisma.user.findFirst({where:{OR:[{email:{contains:q,mode:'insensitive'}},{phone:{contains:q}}]},select:{id:true,email:true,phone:true,firstName:true,lastName:true,role:true,schoolId:true,otpExempt:true}});
 if(!user)return res.status(404).json({error:'No matching staff account was found.'});
 if(user.role==='STUDENT')return res.status(400).json({error:'Student accounts do not use staff sign-in OTP exemptions.'});
 res.json({user});
}catch(e){next(e)}};
