// ConnectSukuu Finance API Stage 1.1 — dashboard aggregate and lookup fixes.
const prisma = require('../config/db');
const XLSX = require('xlsx');
const { createStudentNotifications } = require('../utils/studentNotifications');

const MANAGEMENT_ROLES = ['ACCOUNTANT'];
const APPROVAL_ROLES = ['HEAD_TEACHER'];
const PAYROLL_APPROVAL_ROLES = ['HEAD_TEACHER', 'OWNER'];
const VIEW_ROLES = ['ACCOUNTANT', 'HEAD_TEACHER', 'OWNER'];

function schoolId(req) {
  if (!req.user?.schoolId) throw new Error('User is not associated with a school.');
  return req.user.schoolId;
}
function positiveInt(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number.`);
  return Math.round(n);
}
function money(n) { return Math.round(Number(n || 0)); }
function payrollNumber(v, field, allowFloat=false) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number.`);
  return allowFloat ? Math.round(n * 100) / 100 : Math.round(n);
}

function payrollBoolean(v, fallback=false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return ['true','1','yes','y','on'].includes(String(v).trim().toLowerCase());
}

function calculatePayrollAmounts(input) {
  const basic = payrollNumber(input.basicSalary, 'basicSalary');
  const allowances = payrollNumber(input.allowances ?? 0, 'allowances');
  const baseDeductions = payrollNumber(input.deductions ?? 0, 'deductions');
  const tax = payrollNumber(input.taxAmount ?? 0, 'taxAmount');
  const statutory = payrollNumber(input.statutoryDeductions ?? 0, 'statutoryDeductions');
  const gross = input.grossSalary == null || input.grossSalary === ''
    ? basic + allowances
    : payrollNumber(input.grossSalary, 'grossSalary');

  const includeOtherDeduction = payrollBoolean(input.includeOtherDeduction, false);
  const percent = payrollNumber(input.otherDeductionPercent ?? 0, 'otherDeductionPercent', true);
  if (percent > 100) throw new Error('otherDeductionPercent must be between 0 and 100.');

  const suppliedOther = payrollNumber(input.otherDeductions ?? 0, 'otherDeductions');
  const other = !includeOtherDeduction
    ? 0
    : percent > 0
      ? Math.round(gross * percent / 100)
      : suppliedOther;

  const net = Math.max(0, gross - tax - statutory - other - baseDeductions);
  return { basic, allowances, baseDeductions, tax, statutory, gross, includeOtherDeduction, percent, other, net };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendError(res, err, fallback='Finance request failed.') {
  console.error('Finance error:', err);
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'A finance record with the same unique details already exists.' });
  }
  const msg = err?.message || fallback;
  return res.status(400).json({ error: msg });
}

async function ensureYearTermClass(sid, academicYearId, termId, classId) {
  const [year, term, schoolClass] = await Promise.all([
    prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId: sid } }),
    prisma.term.findFirst({ where: { id: termId, academicYear: { id: academicYearId, schoolId: sid } } }),
    prisma.schoolClass.findFirst({ where: { id: classId, academicYearId, academicYear: { schoolId: sid } } })
  ]);
  if (!year) throw new Error('Academic year not found for this school.');
  if (!term) throw new Error('Term not found for this academic year.');
  if (!schoolClass) throw new Error('Class not found for this academic year.');
  return { year, term, schoolClass };
}

// AcademicYear uses startsAt/endsAt in the current Prisma schema.
async function listYears(req,res) {
  try {
    const sid=schoolId(req);
    const rows=await prisma.academicYear.findMany({where:{schoolId:sid},orderBy:{startsAt:'desc'}});
    res.json(rows);
  } catch(e){sendError(res,e);}
}
async function listTerms(req,res) {
  try {
    const sid=schoolId(req), {academicYearId}=req.query;
    if(!academicYearId) return res.status(400).json({error:'academicYearId is required.'});
    const year=await prisma.academicYear.findFirst({where:{id:academicYearId,schoolId:sid}});
    if(!year) return res.status(404).json({error:'Academic year not found for this school.'});
    const rows=await prisma.term.findMany({where:{academicYearId,academicYear:{schoolId:sid}},orderBy:{name:'asc'}});
    res.json(rows);
  } catch(e){sendError(res,e);}
}
async function listClasses(req,res) {
  try {
    const sid=schoolId(req), {academicYearId}=req.query;
    if(!academicYearId) return res.status(400).json({error:'academicYearId is required.'});
    const rows=await prisma.schoolClass.findMany({where:{academicYearId,academicYear:{schoolId:sid}},orderBy:{name:'asc'}});
    res.json(rows);
  } catch(e){sendError(res,e);}
}

async function listFeePlans(req,res) {
  try {
    const sid=schoolId(req), {academicYearId,termId,classId}=req.query;
    const where={schoolId:sid};
    if(academicYearId) where.academicYearId=academicYearId;
    if(termId) where.termId=termId;
    if(classId) where.classId=classId;
    const rows=await prisma.feePlan.findMany({
      where, orderBy:{createdAt:'desc'},
      include:{academicYear:{select:{id:true,name:true}},term:{select:{id:true,name:true}},schoolClass:{select:{id:true,name:true}},items:{orderBy:{sortOrder:'asc'}}}
    });
    res.json(rows);
  } catch(e){sendError(res,e);}
}
async function createFeePlan(req,res) {
  try {
    const sid=schoolId(req), {academicYearId,termId,classId,name,description,currency='GHS',items=[]}=req.body;
    if(!academicYearId||!termId||!classId||!String(name||'').trim()) throw new Error('Academic year, term, class and fee plan name are required.');
    await ensureYearTermClass(sid,academicYearId,termId,classId);
    if(!Array.isArray(items)) throw new Error('items must be an array.');
    const normalized=items.map((x,i)=>{
      const itemName=String(x.name||'').trim();
      if(!itemName) throw new Error(`Fee component ${i+1} is missing a name.`);
      const code=String(x.code||itemName).trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40) || `ITEM_${i+1}`;
      const amount=x.amount===''||x.amount==null?null:positiveInt(x.amount,`${itemName} amount`);
      return {name:itemName,code,amount,isRequired:Boolean(x.isRequired),sortOrder:Number(x.sortOrder??i),description:x.description?String(x.description):null};
    });
    if(!normalized.some(x=>x.isRequired && x.name.toLowerCase()==='tuition')) {
      const tuition=normalized.find(x=>x.name.toLowerCase()==='tuition');
      if(tuition) tuition.isRequired=true;
      else throw new Error('A Tuition fee component is required in every fee plan.');
    }
    const row=await prisma.feePlan.create({
      data:{schoolId:sid,academicYearId,termId,classId,name:String(name).trim(),description:description?String(description).trim():null,currency:String(currency||'GHS').toUpperCase(),items:{create:normalized.map(item=>({schoolId:sid,...item}))}}
      ,include:{items:{orderBy:{sortOrder:'asc'}}}
    });
    res.status(201).json(row);
  } catch(e){sendError(res,e);}
}

async function updateFeePlan(req,res) {
  try {
    const sid=schoolId(req), id=req.params.id, {name,description,isActive,items}=req.body;
    const plan=await prisma.feePlan.findFirst({where:{id,schoolId:sid},include:{items:true}});
    if(!plan) return res.status(404).json({error:'Fee plan not found.'});
    const data={};
    if(name!==undefined) data.name=String(name).trim();
    if(description!==undefined) data.description=description?String(description).trim():null;
    if(isActive!==undefined) data.isActive=Boolean(isActive);
    if(Array.isArray(items)) {
      const normalized=items.map((x,i)=>{
        const itemName=String(x.name||'').trim();
        if(!itemName) throw new Error(`Fee component ${i+1} is missing a name.`);
        return {name:itemName,code:String(x.code||itemName).trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,40),amount:x.amount===''||x.amount==null?null:positiveInt(x.amount,`${itemName} amount`),isRequired:Boolean(x.isRequired),sortOrder:Number(x.sortOrder??i),description:x.description?String(x.description):null};
      });
      if(!normalized.some(x=>x.name.toLowerCase()==='tuition'&&x.isRequired)) throw new Error('Tuition must remain a required fee component.');
      const row=await prisma.$transaction(async tx=>{
        await tx.feePlanItem.deleteMany({where:{feePlanId:id}});
        return tx.feePlan.update({where:{id},data:{...data,items:{create:normalized.map(item=>({schoolId:sid,...item}))}},include:{items:{orderBy:{sortOrder:'asc'}}}});
      });
      return res.json(row);
    }
    res.json(await prisma.feePlan.update({where:{id},data,include:{items:{orderBy:{sortOrder:'asc'}}}}));
  } catch(e){sendError(res,e);}
}

async function classRosterData(
  sid,
  academicYearId,
  termId,
  classId,
  feePlanId
) {
  if (!academicYearId || !termId || !classId) {
    throw new Error(
      'academicYearId, termId and classId are required.'
    );
  }
  
  const { schoolClass } = await ensureYearTermClass(
    sid,
    academicYearId,
    termId,
    classId
  );
  
  /*
   * Automatically resolve the active fee plan for the selected
   * class when feePlanId is not explicitly supplied.
   */
  let feePlan = null;
  
  if (feePlanId) {
    feePlan = await prisma.feePlan.findFirst({
      where: {
        id: feePlanId,
        schoolId: sid,
        academicYearId,
        termId,
        classId
      },
      include: {
        items: {
          orderBy: {
            sortOrder: 'asc'
          }
        }
      }
    });
  } else {
    feePlan = await prisma.feePlan.findFirst({
      where: {
        schoolId: sid,
        academicYearId,
        termId,
        classId,
        isActive: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        items: {
          orderBy: {
            sortOrder: 'asc'
          }
        }
      }
    });
  }
  
  const enrollments = await prisma.enrollment.findMany({
    where: {
      academicYearId,
      classId,
      schoolClass: {
        academicYear: {
          schoolId: sid
        }
      },
      OR: [
        { termId },
        { termId: null }
      ]
    },
    orderBy: {
      student: {
        lastName: 'asc'
      }
    },
    include: {
      student: {
        select: {
          id: true,
          admissionNumber: true,
          firstName: true,
          lastName: true,
          status: true
        }
      }
    }
  });
  
  return {
    schoolClass,
    feePlan,
    students: enrollments
    .map(e => e.student)
    .filter(s => s.status === 'ACTIVE')
  };
}

async function classRoster(req, res) {
  try {
    const sid = schoolId(req);
    const {
      academicYearId,
      termId,
      classId,
      feePlanId
    } = req.query;
    
    if (!academicYearId || !termId || !classId) {
      throw new Error(
        'academicYearId, termId and classId are required.'
      );
    }
    
    const { schoolClass } = await ensureYearTermClass(
      sid,
      academicYearId,
      termId,
      classId
    );
    
    /*
     * Class-first fee workflow:
     *
     * If a feePlanId is supplied, validate that it belongs
     * to the selected school, academic year, term and class.
     *
     * Otherwise, automatically find the active fee plan
     * for the selected class.
     */
    let plan = null;
    
    if (feePlanId) {
      plan = await prisma.feePlan.findFirst({
        where: {
          id: feePlanId,
          schoolId: sid,
          academicYearId,
          termId,
          classId
        },
        include: {
          items: {
            orderBy: {
              sortOrder: 'asc'
            }
          }
        }
      });
    } else {
      plan = await prisma.feePlan.findFirst({
        where: {
          schoolId: sid,
          academicYearId,
          termId,
          classId,
          isActive: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        include: {
          items: {
            orderBy: {
              sortOrder: 'asc'
            }
          }
        }
      });
    }
    
    const enrollments = await prisma.enrollment.findMany({
      where: {
        academicYearId,
        classId,
        schoolClass: {
          academicYear: {
            schoolId: sid
          }
        },
        OR: [
          {
            termId
          },
          {
            termId: null
          }
        ]
      },
      orderBy: {
        student: {
          lastName: 'asc'
        }
      },
      include: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            status: true
          }
        }
      }
    });
    
    const students = enrollments
    .map(e => e.student)
    .filter(s => s.status === 'ACTIVE');
    
    res.json({
      academicYearId,
      termId,
      classId,
      class: schoolClass,
      feePlan: plan,
      students
    });
  } catch (e) {
    sendError(res, e);
  }
}

async function exportFeeRoster(req, res) {
  try {
    const sid = schoolId(req);
    const { academicYearId, termId, classId, feePlanId, format = 'xlsx' } = req.query;
    const data = await classRosterData(sid, academicYearId, termId, classId, feePlanId);
    const { schoolClass, feePlan, students } = data;

    if (!feePlan) {
      throw new Error('No active fee plan was found for the selected class, term and academic year.');
    }

    const items = feePlan.items || [];
    const studentIds = students.map(student => student.id);
    const existingFees = studentIds.length ? await prisma.studentFee.findMany({
      where: { schoolId: sid, academicYearId, termId, classId, studentId: { in: studentIds } },
      select: {
        id: true, studentId: true, feePlanItemId: true, description: true, amount: true,
        payments: { select: { amount: true, allocations: { select: { studentFeeId: true, amount: true } } } }
      }
    }) : [];
    const feeIds = existingFees.map(fee => fee.id);
    const allocations = feeIds.length ? await prisma.paymentAllocation.findMany({
      where: { schoolId: sid, studentFeeId: { in: feeIds } },
      select: { studentFeeId: true, amount: true }
    }) : [];
    const allocatedByFee = new Map();
    for (const allocation of allocations) {
      allocatedByFee.set(allocation.studentFeeId,
        (allocatedByFee.get(allocation.studentFeeId) || 0) + money(allocation.amount));
    }

    const feesByStudent = new Map();
    for (const fee of existingFees) {
      const allocated = allocatedByFee.get(fee.id) || 0;
      const directPaid = allocated > 0 ? allocated : (fee.payments || []).reduce((sum, payment) => {
        if ((payment.allocations || []).length) return sum;
        return sum + money(payment.amount);
      }, 0);
      const itemKey = fee.feePlanItemId || `description:${String(fee.description || '').toLowerCase()}`;
      if (!feesByStudent.has(fee.studentId)) feesByStudent.set(fee.studentId, { components: new Map(), billed: 0, paid: 0 });
      const record = feesByStudent.get(fee.studentId);
      record.components.set(itemKey, (record.components.get(itemKey) || 0) + money(fee.amount));
      record.billed += money(fee.amount);
      record.paid += directPaid;
    }

    const headers = [
      'Admission Number', 'Student Name', ...items.map(item => item.name),
      'Total Fees', 'Paid Amount', 'Outstanding Balance'
    ];
    const rows = students.map(student => {
      const financial = feesByStudent.get(student.id);
      let componentValues;
      let totalFees;
      let paidAmount;
      let outstanding;

      if (financial) {
        componentValues = items.map(item => {
          const actual = financial.components.get(item.id);
          const byDescription = financial.components.get(`description:${String(item.name || '').toLowerCase()}`);
          return actual ?? byDescription ?? 0;
        });
        totalFees = money(financial.billed);
        paidAmount = Math.min(totalFees, money(financial.paid));
        outstanding = Math.max(0, money(totalFees - paidAmount));
      } else {
        // Keep the existing bulk roster/template behavior for students who do not yet have fee records.
        componentValues = items.map(item => money(item.amount || 0));
        totalFees = money(componentValues.reduce((sum, amount) => sum + amount, 0));
        paidAmount = 0;
        outstanding = totalFees;
      }

      return [student.admissionNumber, `${student.firstName} ${student.lastName}`.trim(),
        ...componentValues, totalFees, paidAmount, outstanding];
    });
    const outputRows = [headers, ...rows];
    const safePart = value => String(value || 'term').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');
    const baseName = `fee-roster-${safePart(schoolClass.name || 'class')}-${safePart(data.term?.name || termId)}`;

    if (String(format).toLowerCase() === 'csv') {
      const csv = outputRows.map(row => row.map(value => {
        const text = String(value ?? '');
        return text.includes(',') || text.includes('"') || text.includes('\n')
          ? `"${text.replace(/"/g, '""')}"` : text;
      }).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send(csv);
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(outputRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Fee Roster');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    return res.send(buffer);
  } catch (e) {
    sendError(res, e);
  }
}

async function classRosterData(
  sid,
  academicYearId,
  termId,
  classId,
  feePlanId
) {
  if (!academicYearId || !termId || !classId) {
    throw new Error(
      'academicYearId, termId and classId are required.'
    );
  }
  
  const { schoolClass } = await ensureYearTermClass(
    sid,
    academicYearId,
    termId,
    classId
  );
  
  /*
   * Class-first fee workflow:
   *
   * 1. If feePlanId is supplied, validate and use that plan.
   * 2. If feePlanId is not supplied, automatically find the
   *    active fee plan for the selected school, academic year,
   *    term and class.
   */
  let feePlan = null;
  
  if (feePlanId) {
    feePlan = await prisma.feePlan.findFirst({
      where: {
        id: feePlanId,
        schoolId: sid,
        academicYearId,
        termId,
        classId
      },
      include: {
        items: {
          orderBy: {
            sortOrder: 'asc'
          }
        }
      }
    });
  } else {
    feePlan = await prisma.feePlan.findFirst({
      where: {
        schoolId: sid,
        academicYearId,
        termId,
        classId,
        isActive: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        items: {
          orderBy: {
            sortOrder: 'asc'
          }
        }
      }
    });
  }
  
  const enrollments = await prisma.enrollment.findMany({
    where: {
      academicYearId,
      classId,
      schoolClass: {
        academicYear: {
          schoolId: sid
        }
      },
      OR: [
        {
          termId
        },
        {
          termId: null
        }
      ]
    },
    orderBy: {
      student: {
        lastName: 'asc'
      }
    },
    include: {
      student: {
        select: {
          id: true,
          admissionNumber: true,
          firstName: true,
          lastName: true,
          status: true
        }
      }
    }
  });
  
  return {
    schoolClass,
    feePlan,
    students: enrollments
    .map(e => e.student)
    .filter(s => s.status === 'ACTIVE')
  };
}

async function importFeeRoster(req,res) {
  try {
    const sid = schoolId(req);
    const {
      academicYearId,
      termId,
      classId,
      feePlanId
    } = req.body;
    
    if(!req.file) {
      throw new Error('A CSV or Excel file is required.');
    }
    
    if(!academicYearId || !termId || !classId || !feePlanId) {
      throw new Error(
        'Academic year, term, class and fee plan are required.'
      );
    }
    
    const plan = await prisma.feePlan.findFirst({
      where:{
        id:feePlanId,
        schoolId:sid,
        academicYearId,
        termId,
        classId
      },
      include:{
        items:{
          orderBy:{
            sortOrder:'asc'
          }
        }
      }
    });
    
    if(!plan) {
      throw new Error(
        'Fee plan not found for the selected class, term and academic year.'
      );
    }
    
    const roster = await classRosterData(
      sid,
      academicYearId,
      termId,
      classId,
      feePlanId
    );
    
    const byAdm = new Map(
      roster.students.map(student=>[
        student.admissionNumber.toLowerCase(),
                          student
      ])
    );
    
    const wb = XLSX.read(
      req.file.buffer,
      {type:'buffer'}
    );
    
    const sheet = wb.Sheets[wb.SheetNames[0]];
    
    const rows = XLSX.utils.sheet_to_json(
      sheet,
      {defval:''}
    );
    
    const batch = await prisma.feeImportBatch.create({
      data:{
        schoolId:sid,
        academicYearId,
        termId,
        classId,
        fileName:req.file.originalname,
        format:String(req.file.originalname)
          .toLowerCase()
          .endsWith('.csv')
          ? 'CSV'
          : 'XLSX',
          status:'PROCESSING',
          importedById:req.user.id,
          totalRows:rows.length
      }
    });
    
    let success = 0;
    let failed = 0;
    
    for(let i=0;i<rows.length;i++) {
      const r = rows[i];
      
      const rowNumber = i + 2;
      
      const admission = String(
        r['Admission Number'] ||
        r.admissionNumber ||
        ''
      ).trim();
      
      let student =
      byAdm.get(admission.toLowerCase());
      
      let error = '';
      
      try {
        if(!admission) {
          throw new Error(
            'Admission Number is required.'
          );
        }
        
        if(!student) {
          throw new Error(
            'Student is not actively enrolled in the selected class.'
          );
        }
        
        /*
         * DUPLICATE PROTECTION
         *
         * A student must not receive another set of
         * fees for the same school, academic year,
         * term, class and fee plan.
         */
        const existingFees =
        await prisma.studentFee.findFirst({
          where:{
            schoolId:sid,
            studentId:student.id,
            academicYearId,
            termId,
            classId,
            feePlanId
          },
          select:{
            id:true,
            importBatchId:true
          }
        });
        
        if(existingFees) {
          throw new Error(
            'Fees for this student already exist for the selected academic year, term, class and fee plan.'
          );
        }
        
        await prisma.$transaction(
          async tx=>{
            const fees = [];
            
            /*
             * Create one StudentFee record per
             * fee-plan component supplied in the
             * spreadsheet.
             */
            for(const item of plan.items) {
              const raw =
              r[item.name] ??
              r[item.code] ??
              '';
        
        const amount =
        parseMoneyCell(raw);
        
        if(
          item.isRequired &&
          item.name.toLowerCase() === 'tuition' &&
          amount <= 0
        ) {
          throw new Error(
            'Tuition must be greater than zero.'
          );
        }
        
        if(amount > 0) {
          fees.push(
            await tx.studentFee.create({
              data:{
                schoolId:sid,
                studentId:student.id,
                academicYearId,
                termId,
                classId,
                feePlanId,
                feePlanItemId:item.id,
                description:item.name,
                amount,
                currency:plan.currency,
                status:'UNPAID',
                importBatchId:batch.id
              }
            })
          );
        }
            }
            
            /*
             * Optional payment supplied by the
             * spreadsheet.
             */
            const paid =
            parseMoneyCell(
              r['Paid Amount'] ||
              r.paidAmount ||
              0
            );
            
            if(paid > 0) {
              if(!fees.length) {
                throw new Error(
                  'Paid Amount cannot be recorded when no fee amount is present.'
                );
              }
              
              let remaining = paid;
              
              /*
               * Allocate the imported payment
               * against the fee components in
               * fee-plan order.
               */
              for(const fee of fees) {
                if(remaining <= 0) {
                  break;
                }
                
                const pay =
                Math.min(
                  remaining,
                  fee.amount
                );
                
                await tx.feePayment.create({
                  data:{
                    schoolId:sid,
                    studentFeeId:fee.id,
                    amount:pay,
                    currency:fee.currency,
                    paymentMethod:
                    String(
                      r['Payment Method'] ||
                      r.paymentMethod ||
                      ''
                    ).trim() || null,
                                           reference:
                                           String(
                                             r['Payment Reference'] ||
                                             r.paymentReference ||
                                             ''
                                           ).trim() || null,
                                           recordedById:req.user.id
                  }
                });
                
                remaining -= pay;
                
                await tx.studentFee.update({
                  where:{
                    id:fee.id
                  },
                  data:{
                    status:
                    pay >= fee.amount
                    ? 'PAID'
                    : 'PARTIAL'
                  }
                });
              }
              
              if(remaining > 0) {
                throw new Error(
                  'Paid Amount exceeds the imported fee total.'
                );
              }
            }
          }
        );
        
        success++;
        
        await prisma.feeImportRow.create({
          data:{
            importBatchId:batch.id,
            rowNumber,
            admissionNumber:admission,
            studentId:student.id,
            status:'IMPORTED'
          }
        });
        
      } catch(err) {
        failed++;
        
        error = err.message;
        
        await prisma.feeImportRow.create({
          data:{
            importBatchId:batch.id,
            rowNumber,
            admissionNumber:
            admission || null,
            studentId:
            student?.id || null,
            status:'FAILED',
            errorMessage:error
          }
        });
      }
    }
    
    const status =
    failed
    ? 'COMPLETED_WITH_ERRORS'
    : 'COMPLETED';
    
    await prisma.feeImportBatch.update({
      where:{
        id:batch.id
      },
      data:{
        status,
        successRows:success,
        failedRows:failed,
        completedAt:new Date()
      }
    });
    try {
      const imported = await prisma.feeImportRow.findMany({ where: { importBatchId: batch.id, status: 'IMPORTED', studentId: { not: null } }, select: { studentId: true } });
      const ids = [...new Set(imported.map(r => r.studentId).filter(Boolean))];
      await createStudentNotifications({ schoolId: sid, studentIds: ids, sourceKey: `fee-import:${batch.id}`, type: 'FEE_INVOICE', title: 'New fee invoice recorded', content: 'The Accountant has recorded or updated fee items for your account. Open Fees to review the amount, payments and remaining balance.', targetUrl: 'student-fees.html' });
      if (ids.length) {
        const invoiceStudents = await prisma.student.findMany({ where: { schoolId: sid, id: { in: ids } }, select: { firstName: true, lastName: true, parentRelationships: { where: { canReceiveNotifications: true }, select: { parent: { select: { userId: true } } } } } });
        const parentNotices = [];
        for (const item of invoiceStudents) {
          const label = `${item.firstName || ''} ${item.lastName || ''}`.trim() || 'your ward';
          for (const relationship of item.parentRelationships || []) {
            const userId = relationship.parent?.userId;
            if (userId) parentNotices.push({ schoolId: sid, userId, type: 'FEE_INVOICE', title: 'New fee invoice recorded', content: `A new fee invoice has been recorded for ${label}. Open your ward's fee statement to review the balance.` });
          }
        }
        if (parentNotices.length) await prisma.userNotification.createMany({ data: parentNotices });
      }
    } catch (noticeError) { console.error('Fee roster imported but student invoice notifications failed:', noticeError); }
    
    res.status(201).json({
      batchId:batch.id,
      status,
      totalRows:rows.length,
      successRows:success,
      failedRows:failed
    });
    
  } catch(e) {
    sendError(res,e);
  }
}

function parseMoneyCell(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value);
  }
  
  const cleaned = String(value)
  .trim()
  .replace(/,/g, '')
  .replace(/GHS/gi, '')
  .replace(/GH₵/gi, '')
  .replace(/₵/g, '')
  .replace(/\s+/g, '');
  
  if (!cleaned) return 0;
  
  const amount = Number(cleaned);
  
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid money amount: ${value}`);
  }
  
  return Math.round(amount);
}

async function listImportBatches(req,res) {
  try {
    const sid=schoolId(req);
    const rows=await prisma.feeImportBatch.findMany({where:{schoolId:sid},orderBy:{createdAt:'desc'},take:50,include:{schoolClass:{select:{name:true}},academicYear:{select:{name:true}},term:{select:{name:true}},rows:{where:{status:'FAILED'},take:20}}});
    res.json(rows);
  } catch(e){sendError(res,e);}
}

async function getImportBatch(req,res) {
  try {
    const row=await prisma.feeImportBatch.findFirst({where:{id:req.params.id,schoolId:schoolId(req)},include:{schoolClass:{select:{name:true}},academicYear:{select:{name:true}},term:{select:{name:true}},rows:{orderBy:{rowNumber:'asc'}}}});
    if(!row) return res.status(404).json({error:'Import batch not found.'});
    res.json(row);
  } catch(e){sendError(res,e);}
}

async function listPayments(req,res) {
  try {
    const sid=schoolId(req), {studentId,academicYearId,termId,classId}=req.query;
    const where={schoolId:sid};
    if(studentId) where.studentFee={studentId};
    if(academicYearId) where.studentFee={...(where.studentFee||{}),academicYearId};
    if(termId) where.studentFee={...(where.studentFee||{}),termId};
    if(classId) where.studentFee={...(where.studentFee||{}),classId};
    const rows=await prisma.feePayment.findMany({where:where,orderBy:{recordedAt:'desc'},take:200,include:{studentFee:{include:{student:{select:{admissionNumber:true,firstName:true,lastName:true}},schoolClass:{select:{name:true}},feePlanItem:{select:{name:true}}}}}});
    res.json(rows);
  } catch(e){sendError(res,e);}
}

// ============================================================
// STUDENT FEE LEDGER
// Returns the complete financial position of one student.
// ============================================================
async function studentFeeLedger(req,res) {
  try {
    const sid = schoolId(req);
    const {studentId,academicYearId,termId,classId} = req.query;

    if(!studentId) return res.status(400).json({error:'studentId is required.'});

    const student = await prisma.student.findFirst({
      where:{id:studentId,schoolId:sid},
      select:{id:true,admissionNumber:true,firstName:true,lastName:true,status:true}
    });

    if(!student) return res.status(404).json({error:'Student not found.'});

    const feeWhere = {schoolId:sid,studentId};
    if(academicYearId) feeWhere.academicYearId=academicYearId;
    if(termId) feeWhere.termId=termId;
    if(classId) feeWhere.classId=classId;

    const fees = await prisma.studentFee.findMany({
      where:feeWhere,
      orderBy:{createdAt:'asc'},
      include:{
        feePlan:{select:{id:true,name:true,currency:true}},
        feePlanItem:{select:{id:true,name:true,code:true,isRequired:true}},
        schoolClass:{select:{id:true,name:true}},
        academicYear:{select:{id:true,name:true}},
        term:{select:{id:true,name:true}},
        payments:{
          orderBy:{recordedAt:'desc'},
          select:{
            id:true,amount:true,currency:true,paymentMethod:true,
            reference:true,notes:true,recordedById:true,recordedAt:true,
            studentFeeId:true,
            allocations:{select:{studentFeeId:true,amount:true}}
          }
        }
      }
    });

    const feeIds = fees.map(f=>f.id);

    const allocations = feeIds.length
      ? await prisma.paymentAllocation.findMany({
          where:{schoolId:sid,studentFeeId:{in:feeIds}},
          select:{
            feePaymentId:true,
            studentFeeId:true,
            amount:true,
            feePayment:{
              select:{
                id:true,amount:true,currency:true,paymentMethod:true,
                reference:true,notes:true,recordedById:true,recordedAt:true,
                studentFeeId:true
              }
            }
          }
        })
      : [];

    const allocationsByFee = new Map();

    for(const a of allocations){
      if(!allocationsByFee.has(a.studentFeeId)) allocationsByFee.set(a.studentFeeId,[]);
      allocationsByFee.get(a.studentFeeId).push(a);
    }

    let totalBilled = 0;
    let totalPaid = 0;

    const components = fees.map(fee=>{
      const payments = [];
      const allocatedRows = allocationsByFee.get(fee.id) || [];
      const allocatedPaymentIds = new Set();

      // Count each split allocation only against its destination fee.
      for(const a of allocatedRows){
        const p = a.feePayment;
        payments.push({
          id:p.id,
          amount:money(a.amount),
          currency:p.currency,
          paymentMethod:p.paymentMethod,
          reference:p.reference,
          notes:p.notes,
          recordedById:p.recordedById,
          recordedAt:p.recordedAt,
          allocated:true
        });
        allocatedPaymentIds.add(p.id);
      }

      // Preserve support for older/direct payments that have no allocations.
      for(const p of (fee.payments || [])){
        const hasAllocations = Array.isArray(p.allocations) && p.allocations.length > 0;
        if(p.studentFeeId===fee.id && !hasAllocations && !allocatedPaymentIds.has(p.id)){
          payments.push({
            id:p.id,
            amount:money(p.amount),
            currency:p.currency,
            paymentMethod:p.paymentMethod,
            reference:p.reference,
            notes:p.notes,
            recordedById:p.recordedById,
            recordedAt:p.recordedAt,
            allocated:false
          });
        }
      }

      payments.sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));

      const paid = payments.reduce((sum,p)=>sum+money(p.amount),0);
      const billed = money(fee.amount);
      const outstanding = Math.max(0,billed-paid);

      totalBilled += billed;
      totalPaid += paid;

      return {
        id:fee.id,
        description:fee.description,
        amount:billed,
        currency:fee.currency,
        dueDate:fee.dueDate,
        status:outstanding===0?'PAID':paid>0?'PARTIAL':'UNPAID',
        paidAmount:paid,
        outstandingBalance:outstanding,
        feePlan:fee.feePlan,
        feePlanItem:fee.feePlanItem,
        academicYear:fee.academicYear,
        term:fee.term,
        schoolClass:fee.schoolClass,
        payments
      };
    });

    res.json({
      student,
      filters:{
        academicYearId:academicYearId || null,
        termId:termId || null,
        classId:classId || null
      },
      summary:{
        totalBilled,
        totalPaid,
        outstandingBalance:Math.max(0,totalBilled-totalPaid),
        currency:fees[0]?.currency || 'GHS'
      },
      components
    });
  } catch(e) {
    sendError(res,e);
  }
}

// ============================================================
// CLASS FINANCIAL ROSTER
// Returns one financial row per actively enrolled student.
// This is designed for the Accountant's class-first workflow.
// ============================================================
async function classFinancialRoster(req,res) {
try {
const sid=schoolId(req);
const {academicYearId,termId,classId}=req.query;

if(!academicYearId || !termId || !classId){
return res.status(400).json({error:'academicYearId, termId and classId are required.'});
}

const {schoolClass}=await ensureYearTermClass(sid,academicYearId,termId,classId);

const enrollments=await prisma.enrollment.findMany({
where:{
academicYearId,
classId,
schoolClass:{academicYear:{schoolId:sid}},
OR:[{termId},{termId:null}],
status:'ACTIVE',
student:{schoolId:sid,status:'ACTIVE'}
},
orderBy:{student:{lastName:'asc'}},
select:{student:{select:{id:true,admissionNumber:true,firstName:true,lastName:true,status:true}}}
});

const students=enrollments.map(e=>e.student);

if(!students.length){
return res.json({
academicYearId,
termId,
classId,
class:schoolClass,
summary:{studentCount:0,totalBilled:0,totalPaid:0,outstandingBalance:0,currency:'GHS'},
students:[]
});
}

const studentIds=students.map(s=>s.id);

const fees=await prisma.studentFee.findMany({
where:{schoolId:sid,academicYearId,termId,classId,studentId:{in:studentIds}},
include:{
payments:{
select:{
amount:true,
studentFeeId:true,
allocations:{select:{studentFeeId:true,amount:true}}
}
},
feePlanItem:{select:{id:true,name:true,code:true}}
}
});

const feeIds=fees.map(f=>f.id);

const allocations=feeIds.length
? await prisma.paymentAllocation.findMany({
where:{schoolId:sid,studentFeeId:{in:feeIds}},
select:{feePaymentId:true,studentFeeId:true,amount:true}
})
:[];

const allocatedByFee=new Map();

for(const a of allocations){
allocatedByFee.set(
a.studentFeeId,
(allocatedByFee.get(a.studentFeeId)||0)+money(a.amount)
);
}

const byStudent=new Map();

for(const student of students){
byStudent.set(student.id,{
student,
totalBilled:0,
totalPaid:0,
outstandingBalance:0,
components:[]
});
}

for(const fee of fees){
const row=byStudent.get(fee.studentId);
if(!row) continue;

let paid=allocatedByFee.get(fee.id)||0;

if(paid===0){
paid=(fee.payments||[]).reduce((sum,payment)=>{
if(payment.allocations?.length) return sum;
return payment.studentFeeId===fee.id ? sum+money(payment.amount) : sum;
},0);
}

const billed=money(fee.amount);
const outstanding=Math.max(0,billed-paid);

row.totalBilled+=billed;
row.totalPaid+=paid;
row.outstandingBalance+=outstanding;

row.components.push({
feeId:fee.id,
description:fee.description,
feePlanItem:fee.feePlanItem,
amount:billed,
paidAmount:paid,
outstandingBalance:outstanding,
status:outstanding===0?'PAID':paid>0?'PARTIAL':'UNPAID'
});
}

const rows=Array.from(byStudent.values());

const summary=rows.reduce((acc,row)=>{
acc.totalBilled+=row.totalBilled;
acc.totalPaid+=row.totalPaid;
acc.outstandingBalance+=row.outstandingBalance;
return acc;
},{
studentCount:rows.length,
totalBilled:0,
totalPaid:0,
outstandingBalance:0,
currency:'GHS'
});

res.json({academicYearId,termId,classId,class:schoolClass,summary,students:rows});
}catch(e){sendError(res,e);}
}


async function recordIndividualStudentFees(req,res) {
  try {
    const sid = schoolId(req);
    const { academicYearId, termId, classId, feePlanId, admissionNumber, items } = req.body || {};
    const admission = String(admissionNumber || '').trim();
    if (!academicYearId || !termId || !classId || !feePlanId || !admission) {
      throw new Error('Academic year, term, class, fee plan and student admission number are required.');
    }
    if (!Array.isArray(items)) throw new Error('Fee component amounts are required.');

    await ensureYearTermClass(sid, academicYearId, termId, classId);
    const plan = await prisma.feePlan.findFirst({
      where: { id: feePlanId, schoolId: sid, academicYearId, termId, classId, isActive: true },
      include: { items: { orderBy: { sortOrder: 'asc' } } }
    });
    if (!plan) throw new Error('An active fee plan was not found for the selected class, term and academic year.');

    const student = await prisma.student.findFirst({
      where: { schoolId: sid, admissionNumber: { equals: admission, mode: 'insensitive' }, status: 'ACTIVE' },
      select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true }
    });
    if (!student) throw new Error('No active student was found with that admission number in this school.');

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        academicYearId,
        classId,
        OR: [{ termId }, { termId: null }],
        schoolClass: { academicYear: { schoolId: sid } }
      },
      select: { id: true }
    });
    if (!enrollment) throw new Error('This student is not enrolled in the selected class for the selected academic year and term.');

    const existing = await prisma.studentFee.findFirst({
      where: { schoolId: sid, studentId: student.id, academicYearId, termId, classId, feePlanId },
      select: { id: true }
    });
    if (existing) throw new Error('Fees for this student already exist for the selected class, term and fee plan. Open the student ledger to review them.');

    const supplied = new Map();
    for (const entry of items) {
      if (!entry || !entry.feePlanItemId) continue;
      const value = positiveInt(entry.amount ?? 0, 'Fee component amount');
      supplied.set(String(entry.feePlanItemId), value);
    }
    const normalized = [];
    for (const item of plan.items) {
      const amount = supplied.has(item.id) ? supplied.get(item.id) : money(item.amount);
      if (item.name.toLowerCase() === 'tuition' && amount <= 0) {
        throw new Error('Tuition must be greater than zero.');
      }
      if (amount > 0) normalized.push({ item, amount });
    }
    if (!normalized.length) throw new Error('Enter an amount for at least one fee component.');

    const created = await prisma.$transaction(async tx => {
      const duplicate = await tx.studentFee.findFirst({
        where: { schoolId: sid, studentId: student.id, academicYearId, termId, classId, feePlanId },
        select: { id: true }
      });
      if (duplicate) throw new Error('Fees for this student have already been recorded for this fee plan.');
      return Promise.all(normalized.map(({ item, amount }) => tx.studentFee.create({
        data: {
          schoolId: sid, studentId: student.id, academicYearId, termId, classId,
          feePlanId, feePlanItemId: item.id, description: item.name, amount,
          currency: plan.currency, status: 'UNPAID'
        }
      })));
    }, { maxWait: 10000, timeout: 15000 });

    try {
      await createStudentNotifications({
        schoolId: sid, studentIds: [student.id], sourceKey: `individual-fee:${created[0].id}`,
        type: 'FEE_INVOICE', title: 'New fee invoice recorded',
        content: 'The Accountant has recorded fees for your account. Open Fees to review the amount and remaining balance.',
        targetUrl: 'student-fees.html'
      });
      const withGuardians = await prisma.student.findFirst({
        where: { id: student.id, schoolId: sid },
        select: {
          firstName: true, lastName: true,
          parentRelationships: { where: { canReceiveNotifications: true }, select: { parent: { select: { userId: true } } } }
        }
      });
      const notices = (withGuardians?.parentRelationships || [])
        .map(rel => rel.parent?.userId).filter(Boolean)
        .map(userId => ({
          schoolId: sid, userId, type: 'FEE_INVOICE', title: 'New fee invoice recorded',
          content: `A new fee invoice has been recorded for ${`${student.firstName || ''} ${student.lastName || ''}`.trim() || 'your ward'}. Open your ward's fee statement to review the balance.`
        }));
      if (notices.length) await prisma.userNotification.createMany({ data: notices });
    } catch (noticeError) {
      console.error('Individual student fees recorded but invoice notifications failed:', noticeError);
    }

    res.status(201).json({
      student: { id: student.id, admissionNumber: student.admissionNumber, firstName: student.firstName, lastName: student.lastName },
      feePlan: { id: plan.id, name: plan.name },
      createdCount: created.length,
      totalBilled: created.reduce((sum, fee) => sum + money(fee.amount), 0),
      fees: created
    });
  } catch (e) {
    sendError(res, e);
  }
}

async function recordPayment(req,res) {
  try {
    const sid = schoolId(req);
    const {
      studentFeeId,
      amount,
      paymentMethod,
      reference,
      notes
    } = req.body || {};

    if (!studentFeeId || typeof studentFeeId !== 'string' || !studentFeeId.trim()) {
      throw new Error('studentFeeId is required.');
    }

    const feeId = studentFeeId.trim();
    const value = positiveInt(amount, 'amount');

    if (value <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }

    const row = await prisma.$transaction(
      async tx => {
        // Keep the fee, payment history, allocation history and status update
        // within one transaction so the outstanding balance is checked consistently.
        const fee = await tx.studentFee.findFirst({
          where: {
            id: feeId,
            schoolId: sid
          }
        });

        if (!fee) {
          const error = new Error('Student fee not found.');
          error.statusCode = 404;
          throw error;
        }

        // A payment made through allocatePayment may also carry studentFeeId
        // when it has one allocation. Do not count that whole payment as a
        // direct payment as well as counting its allocation below.
        const existingPayments = await tx.feePayment.findMany({
          where: {
            schoolId: sid,
            studentFeeId: feeId
          },
          select: {
            amount: true,
            allocations: {
              select: { id: true }
            }
          }
        });

        const directPaid = existingPayments.reduce((sum, payment) => {
          if ((payment.allocations || []).length > 0) return sum;
          return sum + money(payment.amount);
        }, 0);

        const allocationTotals = await tx.paymentAllocation.aggregate({
          where: {
            schoolId: sid,
            studentFeeId: feeId
          },
          _sum: {
            amount: true
          }
        });

        const allocatedPaid = money(allocationTotals._sum.amount);
        const totalPaid = directPaid + allocatedPaid;
        const outstanding = Math.max(0, money(fee.amount) - totalPaid);

        if (outstanding <= 0) {
          throw new Error('This fee has already been fully paid.');
        }

        if (value > outstanding) {
          throw new Error(`Payment exceeds outstanding balance of ${outstanding}.`);
        }

        const payment = await tx.feePayment.create({
          data: {
            schoolId: sid,
            studentFeeId: feeId,
            amount: value,
            currency: fee.currency,
            paymentMethod: paymentMethod ? String(paymentMethod).trim() : null,
            reference: reference ? String(reference).trim() : null,
            notes: notes ? String(notes).trim() : null,
            recordedById: req.user.id
          }
        });

        const newPaid = totalPaid + value;
        const newStatus = newPaid >= money(fee.amount) ? 'PAID' : 'PARTIAL';

        await tx.studentFee.update({
          where: { id: fee.id },
          data: { status: newStatus }
        });

        return payment;
      },
      {
        maxWait: 10000,
        timeout: 15000,
        isolationLevel: 'Serializable'
      }
    );

    // Notifications are intentionally outside the financial transaction:
    // notification failure must not undo a payment that has already committed.
    try {
      const fee = await prisma.studentFee.findFirst({
        where: { id: feeId, schoolId: sid },
        select: {
          id: true,
          amount: true,
          currency: true,
          description: true,
          studentId: true,
          payments: {
            select: {
              amount: true,
              allocations: { select: { amount: true } }
            }
          },
          paymentAllocations: { select: { amount: true } }
        }
      });

      if (fee) {
        const direct = fee.payments.reduce((sum, payment) => {
          return sum + (!(payment.allocations || []).length ? Number(payment.amount || 0) : 0);
        }, 0);
        const allocated = fee.paymentAllocations.reduce((sum, allocation) => {
          return sum + Number(allocation.amount || 0);
        }, 0);
        const balance = Math.max(0, Number(fee.amount || 0) - direct - allocated);
        const balanceText = balance <= 0
          ? 'This fee is now fully paid.'
          : `Remaining balance: ${money(balance).toLocaleString()} ${fee.currency || 'GHS'}.`;

        await createStudentNotifications({
          schoolId: sid,
          studentIds: [fee.studentId],
          sourceKey: `fee-payment:${row.id}`,
          type: 'FEE_PAYMENT',
          title: 'Fee payment recorded',
          content: `A payment of ${money(row.amount).toLocaleString()} ${fee.currency || 'GHS'} was recorded for ${fee.description}. ${balanceText}`,
          targetUrl: 'student-fees.html'
        });

        const studentWithGuardians = await prisma.student.findFirst({
          where: { id: fee.studentId, schoolId: sid },
          select: {
            firstName: true,
            lastName: true,
            parentRelationships: {
              where: { canReceiveNotifications: true },
              select: { parent: { select: { userId: true } } }
            }
          }
        });

        const guardianIds = [...new Set(
          (studentWithGuardians?.parentRelationships || [])
            .map(rel => rel.parent?.userId)
            .filter(Boolean)
        )];

        if (guardianIds.length) {
          await prisma.userNotification.createMany({
            data: guardianIds.map(userId => ({
              schoolId: sid,
              userId,
              type: 'PAYMENT',
              title: 'Fee payment recorded',
              content: `A payment of ${money(row.amount).toLocaleString()} ${fee.currency || 'GHS'} was recorded for ${studentWithGuardians.firstName || ''} ${studentWithGuardians.lastName || ''} (${fee.description}). ${balanceText}`
            }))
          });
        }
      }
    } catch (noticeError) {
      console.error('Payment saved but student notification failed:', noticeError);
    }

    return res.status(201).json(row);
  } catch (e) {
    return sendError(res, e);
  }
}

/* ============================================================
   FINANCE: ARREARS + PAYMENT ALLOCATION
   ============================================================ */

async function studentAccount(req,res) {
try {
const sid=schoolId(req);
const {studentId,academicYearId,termId,classId}=req.query;
if(!studentId) throw new Error('studentId is required.');

const student=await prisma.student.findFirst({
where:{id:studentId,schoolId:sid},
select:{id:true,admissionNumber:true,firstName:true,lastName:true,status:true}
});
if(!student) return res.status(404).json({error:'Student not found.'});

const feeWhere={schoolId:sid,studentId};
if(academicYearId) feeWhere.academicYearId=academicYearId;
if(termId) feeWhere.termId=termId;
if(classId) feeWhere.classId=classId;

const fees=await prisma.studentFee.findMany({
where:feeWhere,
orderBy:{createdAt:'asc'},
include:{
feePlanItem:{select:{name:true,code:true}},
academicYear:{select:{id:true,name:true,startsAt:true}},
term:{select:{id:true,name:true}},
schoolClass:{select:{id:true,name:true}},
payments:{
select:{
id:true,
amount:true,
currency:true,
paymentMethod:true,
reference:true,
recordedAt:true,
studentFeeId:true,
allocations:{select:{studentFeeId:true,amount:true}}
}
}
}
});

const feeIds=fees.map(f=>f.id);

const allocations=feeIds.length
? await prisma.paymentAllocation.findMany({
where:{schoolId:sid,studentFeeId:{in:feeIds}},
select:{
feePaymentId:true,
studentFeeId:true,
amount:true,
feePayment:{
select:{
id:true,
amount:true,
currency:true,
paymentMethod:true,
reference:true,
recordedAt:true,
studentFeeId:true
}
}
}
})
:[];

const allocationsByFee=new Map();

for(const a of allocations){
if(!allocationsByFee.has(a.studentFeeId)) allocationsByFee.set(a.studentFeeId,[]);
allocationsByFee.get(a.studentFeeId).push(a);
}

const rows=fees.map(f=>{
const payments=[];
const seenPaymentIds=new Set();

for(const p of (f.payments||[])){
const matching=(p.allocations||[]).filter(a=>a.studentFeeId===f.id);
const allocatedAmount=matching.reduce((n,a)=>n+money(a.amount),0);

if(allocatedAmount>0){
payments.push({
id:p.id,
amount:allocatedAmount,
currency:p.currency,
paymentMethod:p.paymentMethod,
reference:p.reference,
recordedAt:p.recordedAt,
allocated:true
});
seenPaymentIds.add(p.id);
}else if(!matching.length && (!p.allocations||!p.allocations.length) && p.studentFeeId===f.id){
payments.push({
id:p.id,
amount:money(p.amount),
currency:p.currency,
paymentMethod:p.paymentMethod,
reference:p.reference,
recordedAt:p.recordedAt,
allocated:false
});
seenPaymentIds.add(p.id);
}
}

for(const a of (allocationsByFee.get(f.id)||[])){
if(seenPaymentIds.has(a.feePaymentId)) continue;

const p=a.feePayment;
payments.push({
id:p.id,
amount:money(a.amount),
currency:p.currency,
paymentMethod:p.paymentMethod,
reference:p.reference,
recordedAt:p.recordedAt,
allocated:true
});
}

const paid=payments.reduce((n,p)=>n+money(p.amount),0);

return {
id:f.id,
description:f.description,
amount:money(f.amount),
currency:f.currency,
status:paid>=money(f.amount)?'PAID':paid>0?'PARTIAL':'UNPAID',
academicYearId:f.academicYearId,
termId:f.termId,
classId:f.classId,
academicYear:f.academicYear,
term:f.term,
schoolClass:f.schoolClass,
feePlanItem:f.feePlanItem,
payments,
paidAmount:paid,
outstandingBalance:Math.max(0,money(f.amount)-paid)
};
});

let current=rows;
let previous=[];

if(academicYearId && termId){
current=rows.filter(f=>f.academicYearId===academicYearId && f.termId===termId);
previous=rows.filter(f=>f.academicYearId!==academicYearId || f.termId!==termId);
}else if(academicYearId){
current=rows.filter(f=>f.academicYearId===academicYearId);
previous=rows.filter(f=>f.academicYearId!==academicYearId);
}else if(termId){
current=rows.filter(f=>f.termId===termId);
previous=rows.filter(f=>f.termId!==termId);
}else if(classId){
current=rows.filter(f=>f.classId===classId);
previous=rows.filter(f=>f.classId!==classId);
}

const sum=(arr,key)=>arr.reduce((n,f)=>n+money(f[key]),0);

res.json({
student,
current:{
fees:current,
billed:sum(current,'amount'),
paid:sum(current,'paidAmount'),
outstanding:sum(current,'outstandingBalance')
},
previous:{
fees:previous,
billed:sum(previous,'amount'),
paid:sum(previous,'paidAmount'),
outstanding:sum(previous,'outstandingBalance')
},
total:{
billed:sum(rows,'amount'),
paid:sum(rows,'paidAmount'),
outstanding:sum(rows,'outstandingBalance')
}
});
}catch(e){sendError(res,e);}
}

async function paymentAllocationPreview(req,res) {
try {
const sid=schoolId(req);
const {studentId,academicYearId,termId,classId,amount}=req.query;

if(!studentId) throw new Error('studentId is required.');

let value=0;
if(amount!==undefined && amount!==null && String(amount).trim()!==''){
value=positiveInt(amount,'amount');
if(value<=0) throw new Error('Payment amount must be greater than zero.');
}

const student=await prisma.student.findFirst({
where:{id:studentId,schoolId:sid},
select:{id:true,admissionNumber:true,firstName:true,lastName:true,status:true}
});

if(!student) return res.status(404).json({error:'Student not found.'});

const fees=await prisma.studentFee.findMany({
where:{schoolId:sid,studentId},
orderBy:{createdAt:'asc'},
include:{
feePlanItem:{select:{name:true,code:true}},
academicYear:{select:{id:true,name:true,startsAt:true}},
term:{select:{id:true,name:true}},
schoolClass:{select:{id:true,name:true}}
}
});

const feeIds=fees.map(f=>f.id);

const [directPayments,allocationRows]=await Promise.all([
feeIds.length
? prisma.feePayment.findMany({
where:{schoolId:sid,studentFeeId:{in:feeIds}},
select:{id:true,studentFeeId:true,amount:true}
})
:[],
feeIds.length
? prisma.paymentAllocation.findMany({
where:{schoolId:sid,studentFeeId:{in:feeIds}},
select:{studentFeeId:true,amount:true}
})
:[]
]);

const directByFee=new Map();

for(const p of directPayments){
directByFee.set(p.studentFeeId,(directByFee.get(p.studentFeeId)||0)+money(p.amount));
}

const allocatedByFee=new Map();

for(const a of allocationRows){
allocatedByFee.set(a.studentFeeId,(allocatedByFee.get(a.studentFeeId)||0)+money(a.amount));
}

const outstanding=fees.map(f=>{
const allocated=allocatedByFee.get(f.id)||0;
const direct=allocated>0?0:(directByFee.get(f.id)||0);
const paid=allocated+direct;

return {
id:f.id,
description:f.description,
amount:money(f.amount),
currency:f.currency,
academicYearId:f.academicYearId,
termId:f.termId,
classId:f.classId,
academicYear:f.academicYear,
term:f.term,
schoolClass:f.schoolClass,
feePlanItem:f.feePlanItem,
paidAmount:paid,
outstandingBalance:Math.max(0,money(f.amount)-paid)
};
}).filter(f=>f.outstandingBalance>0);

const current=outstanding.filter(f=>
(!academicYearId || f.academicYearId===academicYearId) &&
(!termId || f.termId===termId) &&
(!classId || f.classId===classId)
);

const previous=outstanding.filter(f=>!current.includes(f));

const recommended=[];
let remaining=value;

if(value>0){
for(const f of previous.concat(current)){
if(remaining<=0) break;
const allocation=Math.min(remaining,f.outstandingBalance);
recommended.push({
studentFeeId:f.id,
description:f.description,
academicYearId:f.academicYearId,
termId:f.termId,
classId:f.classId,
outstandingBalance:f.outstandingBalance,
recommendedAmount:allocation
});
remaining-=allocation;
}
}

res.json({
student,
paymentAmount:value||null,
current,
previous,
recommended,
unallocatedAmount:value>0?remaining:null,
totalOutstanding:outstanding.reduce((n,f)=>n+f.outstandingBalance,0)
});
}catch(e){sendError(res,e);}
}

async function allocatePayment(req,res) {
try {
const sid=schoolId(req);
const {studentId,amount,paymentMethod,reference,notes,allocations}=req.body;

const value=positiveInt(amount,'amount');
if(value<=0) throw new Error('Payment amount must be greater than zero.');
if(!studentId) throw new Error('studentId is required.');
if(!Array.isArray(allocations)||!allocations.length) throw new Error('At least one payment allocation is required.');

const clean=allocations.map((a,i)=>({
studentFeeId:String(a.studentFeeId||''),
amount:positiveInt(a.amount,'allocations['+i+'].amount')
}));

if(clean.some(a=>!a.studentFeeId||a.amount<=0)) throw new Error('Every allocation requires a positive amount.');
if(clean.reduce((n,a)=>n+a.amount,0)!==value) throw new Error('Allocated amount must equal payment amount of '+value+'.');

const ids=[...new Set(clean.map(a=>a.studentFeeId))];

if(ids.length!==clean.length){
throw new Error('Each fee can only appear once in an allocation.');
}

const result=await prisma.$transaction(async tx=>{
const fees=await tx.studentFee.findMany({
where:{id:{in:ids},schoolId:sid,studentId},
select:{id:true,amount:true,currency:true,description:true}
});

if(fees.length!==ids.length){
throw new Error('One or more selected fees do not belong to this student and school.');
}

const existingDirect=await tx.feePayment.findMany({
where:{schoolId:sid,studentFeeId:{in:ids}},
select:{studentFeeId:true,amount:true}
});

const existingAllocations=await tx.paymentAllocation.findMany({
where:{schoolId:sid,studentFeeId:{in:ids}},
select:{studentFeeId:true,amount:true}
});

const directByFee=new Map();

for(const p of existingDirect){
directByFee.set(
p.studentFeeId,
(directByFee.get(p.studentFeeId)||0)+money(p.amount)
);
}

const allocatedByFee=new Map();

for(const a of existingAllocations){
allocatedByFee.set(
a.studentFeeId,
(allocatedByFee.get(a.studentFeeId)||0)+money(a.amount)
);
}

const byId=new Map(fees.map(f=>[f.id,f]));

for(const a of clean){
const fee=byId.get(a.studentFeeId);
const paid=(directByFee.get(a.studentFeeId)||0)+(allocatedByFee.get(a.studentFeeId)||0);
const outstanding=Math.max(0,money(fee.amount)-paid);

if(a.amount>outstanding){
throw new Error('Allocation exceeds outstanding balance for '+fee.description+': '+outstanding+'.');
}
}

const currency=fees[0]?.currency||'GHS';

const payment=await tx.feePayment.create({
data:{
schoolId:sid,
studentFeeId:clean.length===1?clean[0].studentFeeId:null,
amount:value,
currency,
paymentMethod:paymentMethod?String(paymentMethod).trim():null,
reference:reference?String(reference).trim():null,
notes:notes?String(notes).trim():null,
recordedById:req.user.id
}
});

const createdAllocations=[];

for(const a of clean){
const fee=byId.get(a.studentFeeId);
const oldPaid=(directByFee.get(a.studentFeeId)||0)+(allocatedByFee.get(a.studentFeeId)||0);
const newPaid=oldPaid+a.amount;

const allocation=await tx.paymentAllocation.create({
data:{
schoolId:sid,
feePaymentId:payment.id,
studentFeeId:a.studentFeeId,
amount:a.amount
}
});

await tx.studentFee.update({
where:{id:a.studentFeeId},
data:{status:newPaid>=money(fee.amount)?'PAID':'PARTIAL'}
});

createdAllocations.push({
id:allocation.id,
studentFeeId:a.studentFeeId,
amount:a.amount,
studentFee:{
id:fee.id,
description:fee.description,
amount:fee.amount
}
});
}

return {...payment,allocations:createdAllocations};
},{
maxWait:10000,
timeout:15000,
isolationLevel:'Serializable'
});

// Notify school leadership and guardians after the payment transaction commits.
try {
  const feeIds = [...new Set((result.allocations || []).map(a => a.studentFeeId).filter(Boolean))];
  const feesForNotice = feeIds.length ? await prisma.studentFee.findMany({
    where: { id: { in: feeIds }, schoolId: sid },
    select: { student: { select: { id: true, firstName: true, lastName: true, branchId: true, parentRelationships: { where: { canReceiveNotifications: true }, select: { parent: { select: { userId: true } } } } } } }
  }) : [];
  const branchIds = [...new Set(feesForNotice.map(f => f.student?.branchId).filter(Boolean))];
  const studentNames = [...new Set(feesForNotice.map(f => `${f.student?.firstName || ''} ${f.student?.lastName || ''}`.trim()).filter(Boolean))];
  const recipients = await prisma.user.findMany({
    where: { schoolId: sid, isActive: true, OR: [{ role: 'OWNER' }, ...(branchIds.length ? [{ role: { in: ['ADMINISTRATOR','HEAD_TEACHER','ACCOUNTANT'] }, branchId: { in: branchIds } }] : [])] },
    select: { id: true }
  });
  const parentIds = [...new Set(feesForNotice.flatMap(f => (f.student?.parentRelationships || []).map(r => r.parent?.userId).filter(Boolean)))];
  const allRecipientIds = [...new Set([...recipients.map(r => r.id), ...parentIds])];
  if (allRecipientIds.length) {
    const label = studentNames.length ? studentNames.join(', ') : 'a student';
    await prisma.userNotification.createMany({ data: allRecipientIds.map(userId => ({ schoolId: sid, userId, type: 'PAYMENT', title: 'Fee payment recorded', content: `A payment of ${money(result.amount).toLocaleString()} ${result.currency || 'GHS'} was recorded for ${label}.` })) });
  }
} catch (notificationError) { console.error('Payment saved, but payment notifications could not be created:', notificationError); }
try {
  const feeIds = [...new Set((result.allocations || []).map(a => a.studentFeeId).filter(Boolean))];
  const affected = feeIds.length ? await prisma.studentFee.findMany({ where: { id: { in: feeIds }, schoolId: sid }, select: { studentId: true, description: true, amount: true, currency: true } }) : [];
  await createStudentNotifications({ schoolId: sid, studentIds: affected.map(f => f.studentId), sourceKey: `fee-payment:${result.id}`, type: 'FEE_PAYMENT', title: 'Fee payment allocated', content: `A payment was allocated to your school fee account. Open Fees to review your updated balance.`, targetUrl: 'student-fees.html' });
} catch (noticeError) { console.error('Payment allocation saved but student notification failed:', noticeError); }
res.status(201).json(result);
}catch(e){sendError(res,e);}
}


/* FINANCE REPORTING FOUNDATION */

function reportDateRange(from,to){
const range={};
if(from) range.gte=new Date(from);
if(to) range.lte=new Date(String(to).includes('T')?to:String(to)+'T23:59:59.999Z');
return Object.keys(range).length?range:null;
}

async function financialSummaryReport(req,res) {
try {
const sid=schoolId(req); const {academicYearId,termId,classId,from,to}=req.query;
const feeWhere={schoolId:sid}; if(academicYearId) feeWhere.academicYearId=academicYearId; if(termId) feeWhere.termId=termId; if(classId) feeWhere.classId=classId;
const fees=await prisma.studentFee.findMany({where:feeWhere,select:{id:true,amount:true}}); const feeIds=new Set(fees.map(f=>f.id));
const billed=fees.reduce((n,f)=>n+money(f.amount),0);
const range={}; if(from) range.gte=new Date(from); if(to) range.lte=new Date(String(to).includes('T')?to:String(to)+'T23:59:59.999Z');
const payments=await prisma.feePayment.findMany({where:{schoolId:sid,...(Object.keys(range).length?{recordedAt:range}:{})},select:{id:true,studentFeeId:true,amount:true}});
const ids=payments.map(p=>p.id);
const allocations=ids.length?await prisma.paymentAllocation.findMany({where:{schoolId:sid,feePaymentId:{in:ids}},select:{feePaymentId:true,studentFeeId:true,amount:true}}):[];
const byPayment=new Map(); for(const a of allocations) if(feeIds.has(a.studentFeeId)) byPayment.set(a.feePaymentId,money(byPayment.get(a.feePaymentId)||0)+money(a.amount));
const collected=payments.reduce((n,p)=>byPayment.has(p.id)?n+byPayment.get(p.id):(p.studentFeeId&&feeIds.has(p.studentFeeId)?n+money(p.amount):n),0);
const [revenue,expenses,payroll,scholarships]=await Promise.all([
prisma.revenue.aggregate({where:{schoolId:sid,...(Object.keys(range).length?{receivedAt:range}:{})},_sum:{amount:true}}),
prisma.expense.aggregate({where:{schoolId:sid,status:'APPROVED',...(Object.keys(range).length?{expenseDate:range}:{})},_sum:{amount:true}}),
prisma.payrollRecord.aggregate({where:{schoolId:sid,status:'APPROVED'},_sum:{netSalary:true}}),
prisma.scholarship.aggregate({where:{schoolId:sid,status:'APPROVED'},_sum:{amount:true}})]);
const otherRevenue=money(revenue._sum.amount),approvedExpenses=money(expenses._sum.amount),approvedPayroll=money(payroll._sum.netSalary),approvedScholarships=money(scholarships._sum.amount),totalOutflow=approvedExpenses+approvedPayroll+approvedScholarships;
res.json({filters:{academicYearId:academicYearId||null,termId:termId||null,classId:classId||null,from:from||null,to:to||null},summary:{feesBilled:billed,feesCollected:collected,outstanding:Math.max(0,billed-collected),collectionRate:billed?Number(Math.min(100,collected/billed*100).toFixed(2)):0,otherRevenue,approvedExpenses,approvedPayroll,approvedScholarships,totalOutflow,activityBalance:collected+otherRevenue-totalOutflow}});
} catch(e){sendError(res,e);}
}

async function feeCollectionReport(req,res){
try{
const sid=schoolId(req);
const {academicYearId,termId,classId}=req.query;
if(!academicYearId||!termId) throw new Error('academicYearId and termId are required.');

const where={schoolId:sid,academicYearId,termId};
if(classId) where.classId=classId;

const fees=await prisma.studentFee.findMany({
where,
orderBy:{createdAt:'asc'},
include:{
student:{select:{id:true,admissionNumber:true,firstName:true,lastName:true,status:true}},
schoolClass:{select:{id:true,name:true}},
feePlanItem:{select:{id:true,name:true,code:true}}
}
});

const ids=fees.map(f=>f.id);
const [payments,allocations]=await Promise.all([
prisma.feePayment.findMany({
where:{schoolId:sid,studentFeeId:{in:ids}},
select:{id:true,studentFeeId:true,amount:true,currency:true,paymentMethod:true,reference:true,recordedAt:true}
}),
prisma.paymentAllocation.findMany({
where:{schoolId:sid,studentFeeId:{in:ids}},
select:{feePaymentId:true,studentFeeId:true,amount:true}
})
]);

const directByFee=new Map();
for(const p of payments){
if(p.studentFeeId) directByFee.set(p.studentFeeId,money(directByFee.get(p.studentFeeId)||0)+money(p.amount));
}

const allocatedByFee=new Map();
for(const a of allocations){
allocatedByFee.set(a.studentFeeId,money(allocatedByFee.get(a.studentFeeId)||0)+money(a.amount));
}

const rows=fees.map(f=>{
const direct=directByFee.get(f.id)||0;
const allocated=allocatedByFee.get(f.id)||0;
const paid=allocated>0?allocated:direct;
return {
student:f.student,
class:f.schoolClass,
feeId:f.id,
description:f.description,
feePlanItem:f.feePlanItem,
amount:money(f.amount),
paidAmount:paid,
outstandingBalance:Math.max(0,money(f.amount)-paid),
status:Math.max(0,money(f.amount)-paid)===0?'PAID':paid>0?'PARTIAL':'UNPAID'
};
});

const summary=rows.reduce((a,r)=>{
a.studentCountSet.add(r.student.id);
a.totalBilled+=r.amount;
a.totalPaid+=r.paidAmount;
a.outstandingBalance+=r.outstandingBalance;
return a;
},{studentCountSet:new Set(),totalBilled:0,totalPaid:0,outstandingBalance:0});

res.json({
filters:{academicYearId,termId,classId:classId||null},
summary:{
studentCount:summary.studentCountSet.size,
totalBilled:summary.totalBilled,
totalPaid:summary.totalPaid,
outstandingBalance:summary.outstandingBalance,
currency:'GHS'
},
rows
});
}catch(e){sendError(res,e);}
}


async function scholarshipStudentLookup(req,res){
  try{
    const sid=schoolId(req);
    const search=String(req.query.search||'').trim();
    if(search.length<2)return res.json([]);

    const students=await prisma.student.findMany({
      where:{
        schoolId:sid,
        status:'ACTIVE',
        OR:[
          {admissionNumber:{contains:search,mode:'insensitive'}},
          {firstName:{contains:search,mode:'insensitive'}},
          {lastName:{contains:search,mode:'insensitive'}}
        ]
      },
      select:{
        id:true,
        admissionNumber:true,
        firstName:true,
        lastName:true,
        enrollments:{
          where:{status:'ACTIVE'},
          orderBy:{enrolledAt:'desc'},
          take:1,
          select:{schoolClass:{select:{id:true,name:true,section:true}}}
        }
      },
      orderBy:[{lastName:'asc'},{firstName:'asc'}],
      take:50
    });

    res.json(students);
  }catch(e){sendError(res,e);}
}

async function dashboard(req,res) {
try {
const sid=schoolId(req);
const {from,to,academicYearId,termId}=req.query;
const feeWhere={schoolId:sid};
if(academicYearId) feeWhere.academicYearId=academicYearId;
if(termId) feeWhere.termId=termId;
const dateRange={};
if(from) dateRange.gte=new Date(from);
if(to) dateRange.lte=new Date(String(to).includes('T')?to:String(to)+'T23:59:59.999Z');
const [fees,payments,revenues,expenses,payroll,scholarships,pendingExpenses,pendingScholarships,pendingPayroll]=await Promise.all([
prisma.studentFee.aggregate({where:feeWhere,_sum:{amount:true}}),
prisma.feePayment.findMany({where:{schoolId:sid,...(Object.keys(dateRange).length?{recordedAt:dateRange}:{})},select:{id:true,studentFeeId:true,amount:true}}),
prisma.revenue.aggregate({where:{schoolId:sid,...(Object.keys(dateRange).length?{receivedAt:dateRange}:{})},_sum:{amount:true}}),
prisma.expense.aggregate({where:{schoolId:sid,status:'APPROVED',...(Object.keys(dateRange).length?{expenseDate:dateRange}:{})},_sum:{amount:true}}),
prisma.payrollRecord.aggregate({where:{schoolId:sid,status:'APPROVED'},_sum:{netSalary:true}}),
prisma.scholarship.aggregate({where:{schoolId:sid,status:'APPROVED'},_sum:{amount:true}}),
prisma.expense.findMany({where:{schoolId:sid,status:'PENDING'},orderBy:{createdAt:'desc'},take:10}),
prisma.scholarship.findMany({where:{schoolId:sid,status:'PENDING'},orderBy:{createdAt:'desc'},take:10,include:{student:{select:{admissionNumber:true,firstName:true,lastName:true}}}}),
prisma.payrollRecord.findMany({where:{schoolId:sid,status:'PENDING'},orderBy:{createdAt:'desc'},take:10,include:{employee:{select:{firstName:true,lastName:true,email:true}}}})
]);
const ids=payments.map(p=>p.id);
const allocations=ids.length?await prisma.paymentAllocation.findMany({where:{schoolId:sid,feePaymentId:{in:ids}},select:{feePaymentId:true,studentFeeId:true,amount:true}}):[];
const scoped=await prisma.studentFee.findMany({where:{schoolId:sid,...(academicYearId?{academicYearId}:{}),...(termId?{termId}:{})},select:{id:true}});
const scopedIds=new Set(scoped.map(f=>f.id));
const scopedFilter=academicYearId||termId;
const allocatedByPayment=new Map();
for(const a of allocations){
 if(!scopedFilter||scopedIds.has(a.studentFeeId)) allocatedByPayment.set(a.feePaymentId,money(allocatedByPayment.get(a.feePaymentId)||0)+money(a.amount));
}
const collected=payments.reduce((sum,p)=>{
 if(allocatedByPayment.has(p.id)) return sum+allocatedByPayment.get(p.id);
 if(p.studentFeeId&&(!scopedFilter||scopedIds.has(p.studentFeeId))) return sum+money(p.amount);
 return sum;
},0);
const billed=money(fees._sum.amount),otherRevenue=money(revenues._sum.amount),approvedExpenses=money(expenses._sum.amount),approvedPayroll=money(payroll._sum.netSalary),approvedScholarships=money(scholarships._sum.amount);
const totalOutflow=approvedExpenses+approvedPayroll+approvedScholarships;
const collectionRate=billed?Number(Math.min(100,collected/billed*100).toFixed(2)):0;
res.json({period:{from:from||null,to:to||null,academicYearId:academicYearId||null,termId:termId||null},summary:{feesBilled:billed,feesCollected:collected,outstanding:Math.max(0,billed-collected),collectionRate,otherRevenue,approvedExpenses,approvedPayroll,approvedScholarships,totalOutflow,activityBalance:collected+otherRevenue-totalOutflow},breakdown:{feesCollected:collected,otherRevenue,expenses:approvedExpenses,payroll:approvedPayroll,scholarships:approvedScholarships},pendingApprovals:{expenses:pendingExpenses,scholarships:pendingScholarships,payroll:pendingPayroll}});
} catch(e){sendError(res,e);}
}

async function listRevenue(req,res){try{const rows=await prisma.revenue.findMany({where:{schoolId:schoolId(req)},orderBy:{receivedAt:'desc'},take:200});res.json(rows);}catch(e){sendError(res,e);}}
async function createRevenue(req,res){try{const sid=schoolId(req),{source,description,amount,currency='GHS',receivedAt}=req.body;if(!String(source||'').trim())throw new Error('Revenue source is required.');const row=await prisma.revenue.create({data:{schoolId:sid,source:String(source).trim(),description:description?String(description).trim():null,amount:positiveInt(amount,'amount'),currency:String(currency||'GHS').toUpperCase(),receivedAt:receivedAt?new Date(receivedAt):new Date(),recordedById:req.user.id}});res.status(201).json(row);}catch(e){sendError(res,e);}}

async function listExpenses(req,res){try{const rows=await prisma.expense.findMany({where:{schoolId:schoolId(req)},orderBy:{createdAt:'desc'},take:200});res.json(rows);}catch(e){sendError(res,e);}}
async function createExpense(req,res){try{const sid=schoolId(req),{category,description,amount,currency='GHS',expenseDate}=req.body;if(!String(category||'').trim())throw new Error('Expense category is required.');const row=await prisma.expense.create({data:{schoolId:sid,category:String(category).trim(),description:description?String(description).trim():null,amount:positiveInt(amount,'amount'),currency:String(currency||'GHS').toUpperCase(),expenseDate:expenseDate?new Date(expenseDate):new Date(),requestedById:req.user.id}});res.status(201).json(row);}catch(e){sendError(res,e);}}
async function decideExpense(req,res){try{const sid=schoolId(req),{status,rejectionReason}=req.body;if(req.user.role!=='HEAD_TEACHER')return res.status(403).json({error:'Only the Head Teacher can approve or reject expenses.'});if(!['APPROVED','REJECTED'].includes(status))throw new Error('Decision must be APPROVED or REJECTED.');const row=await prisma.expense.findFirst({where:{id:req.params.id,schoolId:sid}});if(!row)return res.status(404).json({error:'Expense not found.'});if(row.status!=='PENDING')return res.status(409).json({error:`Expense is already ${row.status} and cannot be decided again.`});if(status==='REJECTED'&&!String(rejectionReason||'').trim())throw new Error('A rejection reason is required.');const updated=await prisma.expense.update({where:{id:row.id},data:{status,approvedById:req.user.id,approvedAt:new Date(),rejectionReason:status==='REJECTED'?String(rejectionReason).trim():null}});res.json(updated);}catch(e){sendError(res,e);}}

async function listScholarships(req,res){try{const rows=await prisma.scholarship.findMany({where:{schoolId:schoolId(req)},orderBy:{createdAt:'desc'},take:200,include:{student:{select:{admissionNumber:true,firstName:true,lastName:true}}}});res.json(rows);}catch(e){sendError(res,e);}}
async function createScholarship(req,res){
  try{
    const sid=schoolId(req),{studentId,name,description,type,amount,percentage}=req.body;
    const student=await prisma.student.findFirst({where:{id:studentId,schoolId:sid}});
    if(!student)throw new Error('Student not found.');
    if(!['FIXED','PERCENTAGE'].includes(type))throw new Error('Scholarship type must be FIXED or PERCENTAGE.');
    const scholarshipName=String(name||'Scholarship').trim()||'Scholarship';

    if(type==='FIXED'){
      if(positiveInt(amount,'amount')<=0)throw new Error('Fixed scholarship amount must be greater than zero.');
    }else{
      const pct=Number(percentage);
      if(!Number.isFinite(pct)||pct<=0||pct>100)throw new Error('Scholarship percentage must be between 0 and 100.');
      const existing=await prisma.scholarship.findMany({
        where:{schoolId:sid,studentId,status:{in:['PENDING','APPROVED']}},
        select:{id:true,name:true,type:true,percentage:true}
      });
      if(existing.some(x=>x.type==='PERCENTAGE'&&String(x.name||'').trim().toLowerCase()===scholarshipName.toLowerCase()))
        throw new Error(`A pending or approved ${scholarshipName} percentage scholarship already exists for this student.`);
      const total=existing.reduce((sum,x)=>sum+(x.type==='PERCENTAGE'?Number(x.percentage||0):0),0)+pct;
      if(total>100)throw new Error(`Scholarship percentage would total ${total}%. A student cannot have more than 100% percentage scholarship coverage.`);
    }

    const row=await prisma.scholarship.create({
      data:{schoolId:sid,studentId,name:scholarshipName,description:description?String(description).trim():null,type,
        amount:type==='FIXED'?positiveInt(amount,'amount'):null,
        percentage:type==='PERCENTAGE'?Number(percentage):null,status:'PENDING',requestedById:req.user.id},
      include:{student:{select:{id:true,admissionNumber:true,firstName:true,lastName:true}}}
    });
    res.status(201).json(row);
  }catch(e){sendError(res,e);}
}

async function updateScholarship(req,res){
  try{
    const sid=schoolId(req),id=req.params.id;
    const {name,description,type,amount,percentage}=req.body;
    const row=await prisma.scholarship.findFirst({where:{id,schoolId:sid}});
    if(!row)return res.status(404).json({error:'Scholarship not found.'});
    if(row.status!=='PENDING')return res.status(409).json({error:'Only pending scholarships can be amended.'});
    if(!['FIXED','PERCENTAGE'].includes(type))throw new Error('Scholarship type must be FIXED or PERCENTAGE.');
    const scholarshipName=String(name||'Scholarship').trim()||'Scholarship';

    if(type==='FIXED'){
      if(positiveInt(amount,'amount')<=0)throw new Error('Fixed scholarship amount must be greater than zero.');
    }else{
      const pct=Number(percentage);
      if(!Number.isFinite(pct)||pct<=0||pct>100)throw new Error('Scholarship percentage must be between 0 and 100.');
      const existing=await prisma.scholarship.findMany({
        where:{schoolId:sid,studentId:row.studentId,status:{in:['PENDING','APPROVED']},NOT:{id}},
        select:{id:true,name:true,type:true,percentage:true}
      });
      if(existing.some(x=>x.type==='PERCENTAGE'&&String(x.name||'').trim().toLowerCase()===scholarshipName.toLowerCase()))
        throw new Error(`A pending or approved ${scholarshipName} percentage scholarship already exists for this student.`);
      const total=existing.reduce((sum,x)=>sum+(x.type==='PERCENTAGE'?Number(x.percentage||0):0),0)+pct;
      if(total>100)throw new Error(`Scholarship percentage would total ${total}%. A student cannot have more than 100% percentage scholarship coverage.`);
    }

    const updated=await prisma.scholarship.update({
      where:{id:row.id},
      data:{name:scholarshipName,description:description?String(description).trim():null,type,
        amount:type==='FIXED'?positiveInt(amount,'amount'):null,
        percentage:type==='PERCENTAGE'?Number(percentage):null},
      include:{student:{select:{id:true,admissionNumber:true,firstName:true,lastName:true}}}
    });
    res.json(updated);
  }catch(e){sendError(res,e);}
}

async function deleteScholarship(req,res){
  try{
    const sid=schoolId(req);
    const row=await prisma.scholarship.findFirst({where:{id:req.params.id,schoolId:sid}});
    if(!row)return res.status(404).json({error:'Scholarship not found.'});
    if(row.status!=='PENDING')return res.status(409).json({error:'Only pending scholarships can be deleted. Approved or rejected records require the controlled finance workflow.'});
    await prisma.scholarship.delete({where:{id:row.id}});
    res.json({success:true,id:row.id});
  }catch(e){sendError(res,e);}
}

async function decideScholarship(req,res){try{const sid=schoolId(req),{status,rejectionReason}=req.body;if(req.user.role!=='HEAD_TEACHER')return res.status(403).json({error:'Only the Head Teacher can approve or reject scholarships.'});if(!['APPROVED','REJECTED'].includes(status))throw new Error('Decision must be APPROVED or REJECTED.');const row=await prisma.scholarship.findFirst({where:{id:req.params.id,schoolId:sid}});if(!row)return res.status(404).json({error:'Scholarship not found.'});if(row.status!=='PENDING')return res.status(409).json({error:`Scholarship is already ${row.status} and cannot be decided again.`});if(status==='REJECTED'&&!String(rejectionReason||'').trim())throw new Error('A rejection reason is required.');const updated=await prisma.scholarship.update({where:{id:row.id},data:{status,approvedById:req.user.id,approvedAt:new Date(),rejectionReason:status==='REJECTED'?String(rejectionReason).trim():null}});res.json(updated);}catch(e){sendError(res,e);}}

async function listPayroll(req,res){
  try{
    const sid=schoolId(req);
    const rows=await prisma.payrollRecord.findMany({
      where:{schoolId:sid},
      orderBy:{createdAt:'desc'},
      take:200,
      include:{employee:{select:{id:true,firstName:true,lastName:true,email:true,role:true}}}
    });

    const actorIds=[...new Set(rows.flatMap(x=>[x.preparedById,x.approvedById]).filter(Boolean))];
    const actors=actorIds.length
      ? await prisma.user.findMany({where:{id:{in:actorIds},schoolId:sid},select:{id:true,firstName:true,lastName:true,email:true,role:true}})
      : [];
    const actorMap=new Map(actors.map(x=>[x.id,x]));

    res.json(rows.map(row=>({
      ...row,
      preparedBy:actorMap.get(row.preparedById)||null,
      approvedBy:row.approvedById ? actorMap.get(row.approvedById)||null : null
    })));
  }catch(e){sendError(res,e);}
}

async function createPayroll(req,res){
  try{
    const sid=schoolId(req);
    const {employeeId,payPeriod}=req.body;
    const employee=await prisma.user.findFirst({where:{id:employeeId,schoolId:sid}});
    if(!employee)throw new Error('Employee not found in this school.');
    if(!String(payPeriod||'').trim())throw new Error('Pay period is required.');

    const calc=calculatePayrollAmounts(req.body);
    const row=await prisma.payrollRecord.create({data:{
      schoolId:sid,employeeId,payPeriod:String(payPeriod).trim(),
      basicSalary:calc.basic,allowances:calc.allowances,deductions:calc.baseDeductions,
      grossSalary:calc.gross,taxAmount:calc.tax,statutoryDeductions:calc.statutory,
      otherDeductions:calc.other,includeOtherDeduction:calc.includeOtherDeduction,
      otherDeductionPercent:calc.percent,netSalary:calc.net,status:'PENDING',preparedById:req.user.id
    },include:{employee:{select:{id:true,firstName:true,lastName:true,email:true,role:true}}}});
    res.status(201).json(row);
  }catch(e){sendError(res,e);}
}

async function importPayroll(req,res){
  try{
    if(req.user.role!=='ACCOUNTANT')return res.status(403).json({error:'Only the Accountant can import payroll.'});
    const sid=schoolId(req);
    const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
    if(!rows.length)throw new Error('No payroll rows were supplied.');
    if(rows.length>2000)throw new Error('A payroll import can contain at most 2,000 rows at a time.');

    const results={created:0,updated:0,errors:[],processed:0};
    for(let i=0;i<rows.length;i++){
      const source=rows[i]||{};
      const line=i+2;
      try{
        const employeeId=String(source.employeeId||'').trim();
        const payPeriod=String(source.payPeriod||'').trim();
        if(!employeeId)throw new Error('employeeId is required.');
        if(!payPeriod)throw new Error('payPeriod is required.');

        const employee=await prisma.user.findFirst({where:{id:employeeId,schoolId:sid}});
        if(!employee)throw new Error('Employee was not found in this school.');

        const calc=calculatePayrollAmounts(source);
        if(calc.basic<=0)throw new Error('basicSalary must be greater than zero.');

        const existing=await prisma.payrollRecord.findFirst({where:{schoolId:sid,employeeId,payPeriod}});
        if(existing && existing.status!=='PENDING'){
          throw new Error(`A ${existing.status} payroll already exists for this employee and pay period.`);
        }

        const data={
          schoolId:sid,employeeId,payPeriod,basicSalary:calc.basic,allowances:calc.allowances,
          deductions:calc.baseDeductions,grossSalary:calc.gross,taxAmount:calc.tax,
          statutoryDeductions:calc.statutory,otherDeductions:calc.other,
          includeOtherDeduction:calc.includeOtherDeduction,otherDeductionPercent:calc.percent,
          netSalary:calc.net,status:'PENDING',preparedById:req.user.id
        };

        if(existing){
          await prisma.payrollRecord.update({where:{id:existing.id},data});
          results.updated++;
        }else{
          await prisma.payrollRecord.create({data});
          results.created++;
        }
        results.processed++;
      }catch(err){
        results.errors.push({row:line,error:err?.message||'Invalid payroll row.'});
      }
    }

    res.status(results.processed?200:400).json(results);
  }catch(e){sendError(res,e);}
}

async function decidePayroll(req,res) {
  try {
    const sid=schoolId(req);
    const {status,rejectionReason}=req.body;

    if(!['HEAD_TEACHER','OWNER'].includes(req.user.role)){
      return res.status(403).json({error:'Only the Head Teacher or Owner can approve or reject payroll.'});
    }

    if(!['APPROVED','REJECTED'].includes(status)){
      throw new Error('Decision must be APPROVED or REJECTED.');
    }

    if(status==='REJECTED' && !String(rejectionReason||'').trim()){
      throw new Error('A rejection reason is required when rejecting payroll.');
    }

    const row=await prisma.payrollRecord.findFirst({
      where:{id:req.params.id,schoolId:sid}
    });

    if(!row) return res.status(404).json({error:'Payroll record not found.'});

    if(row.status!=='PENDING'){
      return res.status(409).json({
        error:`Payroll record is already ${row.status} and cannot be changed through the decision endpoint.`
      });
    }

    const updated=await prisma.payrollRecord.update({
      where:{id:row.id},
      data:{
        status,
        approvedById:req.user.id,
        approvedAt:new Date(),
        rejectionReason:status==='REJECTED' ? String(rejectionReason).trim() : null
      },
      include:{
        employee:{
          select:{id:true,firstName:true,lastName:true,email:true,role:true}
        }
      }
    });

    res.json({
      ...updated,
      approvalState:{
        decisionBy:req.user.role,
        approved:status==='APPROVED',
        rejected:status==='REJECTED',
        paid:Boolean(updated.paidAt)
      }
    });
  }catch(e){sendError(res,e);}
}

async function markPayrollPaid(req,res){
  try{
    const sid=schoolId(req);

    if(req.user.role!=='ACCOUNTANT'){
      return res.status(403).json({error:'Only the Accountant can mark approved payroll as paid.'});
    }

    const row=await prisma.payrollRecord.findFirst({
      where:{id:req.params.id,schoolId:sid}
    });

    if(!row) return res.status(404).json({error:'Payroll record not found.'});

    if(row.status!=='APPROVED'){
      return res.status(409).json({error:'Only approved payroll can be marked as paid.'});
    }

    if(row.paidAt){
      return res.status(409).json({error:'Payroll record is already marked as paid.'});
    }

    const updated=await prisma.payrollRecord.update({
      where:{id:row.id},
      data:{paidAt:new Date()},
      include:{
        employee:{
          select:{id:true,firstName:true,lastName:true,email:true,role:true}
        }
      }
    });

    res.json({
      ...updated,
      paymentState:{paid:true,paidAt:updated.paidAt}
    });
  }catch(e){sendError(res,e);}
}


async function updateExpense(req,res){
  try{
    const sid=schoolId(req);
    if(req.user.role!=='ACCOUNTANT') return res.status(403).json({error:'Only the Accountant can edit pending expenses.'});
    const row=await prisma.expense.findFirst({where:{id:req.params.id,schoolId:sid}});
    if(!row) return res.status(404).json({error:'Expense not found.'});
    if(row.status!=='PENDING') return res.status(409).json({error:`Expense is already ${row.status} and is locked.`});
    const {category,description,amount,currency='GHS',expenseDate}=req.body;
    if(!String(category||'').trim()) throw new Error('Expense category is required.');
    const updated=await prisma.expense.update({where:{id:row.id},data:{category:String(category).trim(),description:description?String(description).trim():null,amount:positiveInt(amount,'amount'),currency:String(currency||'GHS').toUpperCase(),expenseDate:expenseDate?new Date(expenseDate):row.expenseDate}});
    res.json(updated);
  }catch(e){sendError(res,e);}
}

async function deleteExpense(req,res){
  try{
    const sid=schoolId(req);
    if(req.user.role!=='ACCOUNTANT') return res.status(403).json({error:'Only the Accountant can delete pending expenses.'});
    const row=await prisma.expense.findFirst({where:{id:req.params.id,schoolId:sid}});
    if(!row) return res.status(404).json({error:'Expense not found.'});
    if(row.status!=='PENDING') return res.status(409).json({error:`Expense is already ${row.status} and is locked.`});
    await prisma.expense.delete({where:{id:row.id}});
    res.json({deleted:true,id:row.id});
  }catch(e){sendError(res,e);}
}

async function updatePayroll(req,res){
  try{
    const sid=schoolId(req);
    if(req.user.role!=='ACCOUNTANT') return res.status(403).json({error:'Only the Accountant can edit pending payroll.'});
    const row=await prisma.payrollRecord.findFirst({where:{id:req.params.id,schoolId:sid}});
    if(!row) return res.status(404).json({error:'Payroll record not found.'});
    if(!['PENDING','REJECTED'].includes(row.status)) {
      return res.status(409).json({error:`Payroll record is already ${row.status} and is locked.`});
    }
    const wasRejected=row.status==='REJECTED';
    const {employeeId,payPeriod,basicSalary,allowances=0,deductions=0,taxAmount=0,statutoryDeductions=0,otherDeductions=0}=req.body;
    const employee=await prisma.user.findFirst({where:{id:employeeId||row.employeeId,schoolId:sid}});
    if(!employee) throw new Error('Employee not found.');
    if(!String(payPeriod||'').trim()) throw new Error('Pay period is required.');
    const basic=positiveInt(basicSalary,'basicSalary');
    const allow=Number(allowances)||0, baseDed=Number(deductions)||0, tax=Number(taxAmount)||0, stat=Number(statutoryDeductions)||0, other=Number(otherDeductions)||0;
    for(const [v,n] of [[allow,'allowances'],[baseDed,'deductions'],[tax,'taxAmount'],[stat,'statutoryDeductions'],[other,'otherDeductions']]) if(!Number.isFinite(v)||v<0) throw new Error(`${n} must be zero or greater.`);
    const gross=basic+allow; const net=Math.max(0,gross-tax-stat-baseDed-other);
    const updated=await prisma.payrollRecord.update({where:{id:row.id},data:{
      employeeId:employee.id,
      payPeriod:String(payPeriod).trim(),
      basicSalary:basic,
      allowances:allow,
      deductions:baseDed,
      taxAmount:tax,
      statutoryDeductions:stat,
      otherDeductions:other,
      grossSalary:gross,
      netSalary:net,
      ...(wasRejected ? {status:'PENDING',approvedById:null,approvedAt:null,rejectionReason:null} : {})
    },include:{employee:{select:{id:true,firstName:true,lastName:true,email:true,role:true}}}});
    res.json(updated);
  }catch(e){sendError(res,e);}
}

async function deletePayroll(req,res){
  try{
    const sid=schoolId(req);
    if(req.user.role!=='ACCOUNTANT') return res.status(403).json({error:'Only the Accountant can delete pending payroll.'});
    const row=await prisma.payrollRecord.findFirst({where:{id:req.params.id,schoolId:sid}});
    if(!row) return res.status(404).json({error:'Payroll record not found.'});
    if(row.status!=='PENDING') return res.status(409).json({error:`Payroll record is already ${row.status} and is locked.`});
    await prisma.payrollRecord.delete({where:{id:row.id}});
    res.json({deleted:true,id:row.id});
  }catch(e){sendError(res,e);}
}

module.exports={allocatePayment,paymentAllocationPreview,studentAccount,listYears,listTerms,listClasses,listFeePlans,createFeePlan,updateFeePlan,classRoster,exportFeeRoster,importFeeRoster,listImportBatches,getImportBatch,listPayments,recordIndividualStudentFees,recordPayment,dashboard,listRevenue,createRevenue,listExpenses,createExpense,decideExpense,listScholarships,createScholarship,updateScholarship,deleteScholarship,decideScholarship,listPayroll,createPayroll,importPayroll,decidePayroll,markPayrollPaid,studentFeeLedger,classFinancialRoster,
financialSummaryReport,
feeCollectionReport,
  scholarshipStudentLookup,
updateExpense,deleteExpense,updatePayroll,deletePayroll};
