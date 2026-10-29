/*
Finance Phase 2 — arrears and payment allocation helpers.
Designed to use the existing StudentFee/FeePayment foundation; no schema migration is required.
Integrate these functions into finance.controller.js and export them.
*/

function parsePositiveMoney(value, field='amount') {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${field} must be a positive whole number.`);
  }
  return n;
}

async function studentAccount(req,res) {
  try {
    const sid=schoolId(req);
    const {studentId, academicYearId, termId, classId}=req.query;
    if(!studentId) throw new Error('studentId is required.');

    const student=await prisma.student.findFirst({
      where:{id:studentId,schoolId:sid},
      select:{id:true,admissionNumber:true,firstName:true,lastName:true,status:true}
    });
    if(!student) return res.status(404).json({error:'Student not found.'});

    const currentWhere={schoolId:sid,studentId,academicYearId,termId};
    if(classId) currentWhere.classId=classId;

    const currentFees=await prisma.studentFee.findMany({
      where:currentWhere,
      orderBy:[{createdAt:'asc'}],
      include:{feePlanItem:{select:{id:true,name:true,code:true,isRequired:true}}}
    });

    /*
      Previous balances are intentionally NOT copied into the current fee plan.
      They remain separate StudentFee records belonging to their original term/year.
      We fetch every earlier fee for this student and calculate the unpaid amount.
    */
    const allFees=await prisma.studentFee.findMany({
      where:{schoolId:sid,studentId},
      orderBy:[{academicYear:{startsAt:'desc'}},{term:{createdAt:'desc'}},{createdAt:'asc'}],
      include:{
        academicYear:{select:{id:true,name:true,startsAt:true}},
        term:{select:{id:true,name:true}},
        feePlanItem:{select:{id:true,name:true,code:true}},
        payments:{select:{id:true,amount:true,currency:true,paymentMethod:true,reference:true,recordedAt:true,notes:true}}
      }
    });

    const currentIds=new Set(currentFees.map(f=>f.id));
    const balanceOf=f=>{
      const paid=(f.payments||[]).reduce((a,p)=>a+(Number(p.amount)||0),0);
      return {paid,outstanding:Math.max(0,Number(f.amount||0)-paid)};
    };

    const prior=allFees
      .filter(f=>!currentIds.has(f.id))
      .map(f=>({...f,balance:balanceOf(f)}))
      .filter(f=>f.balance.outstanding>0);

    const current= currentFees.map(f=>({...f,balance:balanceOf(f)}));
    const sum=arr=>arr.reduce((a,f)=>a+f.balance.outstanding,0);
    const billed=arr=>arr.reduce((a,f)=>a+Number(f.amount||0),0);
    const paid=arr=>arr.reduce((a,f)=>a+f.balance.paid,0);

    res.json({
      student,
      current:{fees:current,totalBilled:billed(current),totalPaid:paid(current),outstandingBalance:sum(current)},
      previousArrears:{
        fees:prior,
        totalOutstanding:sum(prior)
      },
      accountBalance:sum(current)+sum(prior)
    });
  } catch(e){sendError(res,e);}
}

async function paymentAllocationPreview(req,res) {
  try {
    const sid=schoolId(req);
    const {studentId,academicYearId,termId,classId}=req.query;
    if(!studentId) throw new Error('studentId is required.');
    const student=await prisma.student.findFirst({
      where:{id:studentId,schoolId:sid},
      select:{id:true,admissionNumber:true,firstName:true,lastName:true}
    });
    if(!student) return res.status(404).json({error:'Student not found.'});

    const fees=await prisma.studentFee.findMany({
      where:{schoolId:sid,studentId},
      orderBy:{createdAt:'asc'},
      include:{
        academicYear:{select:{id:true,name:true,startsAt:true}},
        term:{select:{id:true,name:true}},
        schoolClass:{select:{id:true,name:true,section:true}},
        feePlanItem:{select:{id:true,name:true,code:true}}
      }
    });

    const ids=fees.map(f=>f.id);
    const payments=ids.length?await prisma.feePayment.findMany({
      where:{schoolId:sid,studentFeeId:{in:ids}},
      select:{studentFeeId:true,amount:true}
    }):[];
    const paidBy=new Map();
    for(const p of payments) paidBy.set(p.studentFeeId,(paidBy.get(p.studentFeeId)||0)+Number(p.amount||0));

    const rows=fees.map(f=>{
      const paid=paidBy.get(f.id)||0;
      return {
        studentFeeId:f.id,
        description:f.description,
        amount:Number(f.amount||0),
        paid,
        outstanding:Math.max(0,Number(f.amount||0)-paid),
        academicYear:f.academicYear,
        term:f.term,
        schoolClass:f.schoolClass,
        feePlanItem:f.feePlanItem
      };
    }).filter(f=>f.outstanding>0);

    let filtered=rows;
    if(academicYearId) filtered=filtered.filter(f=>f.academicYear?.id===academicYearId);
    if(termId) filtered=filtered.filter(f=>f.term?.id===termId);
    if(classId) filtered=filtered.filter(f=>f.schoolClass?.id===classId);

    const previous=rows.filter(f=>!(f.academicYear?.id===academicYearId && f.term?.id===termId && (!classId || f.schoolClass?.id===classId)));

    res.json({
      student,
      current:filtered,
      previousArrears:previous,
      recommendedOrder:[...previous,...filtered]
    });
  } catch(e){sendError(res,e);}
}

async function allocatePayment(req,res) {
  try {
    const sid=schoolId(req);
    const {
      studentId, amount, paymentMethod, reference, notes, allocations,
      academicYearId, termId, classId
    }=req.body;
    const total=parsePositiveMoney(amount);
    if(!studentId) throw new Error('studentId is required.');
    if(!Array.isArray(allocations)||!allocations.length) throw new Error('At least one payment allocation is required.');

    const student=await prisma.student.findFirst({where:{id:studentId,schoolId:sid},select:{id:true}});
    if(!student) return res.status(404).json({error:'Student not found.'});

    const normalized=allocations.map((a,i)=>({
      studentFeeId:String(a.studentFeeId||''),
      amount:parsePositiveMoney(a.amount,`allocations[${i}].amount`)
    })).filter(a=>a.studentFeeId);

    if(!normalized.length) throw new Error('At least one valid payment allocation is required.');

    const allocatedTotal=normalized.reduce((a,x)=>a+x.amount,0);
    if(allocatedTotal!==total) throw new Error(`Allocated amount ${allocatedTotal} must equal payment amount ${total}.`);

    const uniqueIds=[...new Set(normalized.map(x=>x.studentFeeId))];

    const result=await prisma.$transaction(async tx=>{
      const fees=await tx.studentFee.findMany({
        where:{schoolId:sid,id:{in:uniqueIds},studentId},
        select:{id:true,amount:true,currency:true,academicYearId:true,termId:true,classId:true,description:true}
      });
      if(fees.length!==uniqueIds.length) throw new Error('One or more selected fees do not belong to this student or school.');

      const feeMap=new Map(fees.map(f=>[f.id,f]));
      const payments=await tx.feePayment.findMany({
        where:{schoolId:sid,studentFeeId:{in:uniqueIds}},
        select:{studentFeeId:true,amount:true}
      });
      const paidBy=new Map();
      for(const p of payments) paidBy.set(p.studentFeeId,(paidBy.get(p.studentFeeId)||0)+Number(p.amount||0));

      for(const a of normalized){
        const fee=feeMap.get(a.studentFeeId);
        const outstanding=Math.max(0,Number(fee.amount||0)-(paidBy.get(fee.id)||0));
        if(a.amount>outstanding) throw new Error(`Allocation exceeds outstanding balance for ${fee.description}. Available: ${outstanding}.`);
      }

      const receiptReference=(reference&&String(reference).trim())||`RCPT-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
      const created=[];
      for(const a of normalized){
        const fee=feeMap.get(a.studentFeeId);
        const payment=await tx.feePayment.create({
          data:{
            schoolId:sid,
            studentFeeId:fee.id,
            amount:a.amount,
            currency:fee.currency,
            paymentMethod:paymentMethod?String(paymentMethod):null,
            reference:receiptReference,
            notes:notes?String(notes):`Payment allocation${academicYearId&&termId?' · '+academicYearId+' · '+termId:''}`,
            recordedById:req.user.id
          }
        });
        const newPaid=(paidBy.get(fee.id)||0)+a.amount;
        await tx.studentFee.update({
          where:{id:fee.id},
          data:{status:newPaid>=fee.amount?'PAID':'PARTIAL'}
        });
        created.push(payment);
      }
      return {receiptReference,payments:created};
    },{
      isolationLevel:'Serializable'
    });

    res.status(201).json({
      studentId,
      amount:total,
      reference:result.receiptReference,
      allocationCount:result.payments.length,
      payments:result.payments
    });
  } catch(e){sendError(res,e);}
}

module.exports={
  studentAccount,
  paymentAllocationPreview,
  allocatePayment
};
