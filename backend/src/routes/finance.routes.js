const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  listYears,listTerms,listClasses,
  listFeePlans,createFeePlan,updateFeePlan,classRoster,
  studentFeeLedger,classFinancialRoster,exportFeeRoster,importFeeRoster,listImportBatches,getImportBatch,
  listPayments,recordIndividualStudentFees,recordPayment,studentAccount,paymentAllocationPreview,allocatePayment,dashboard,
  listRevenue,createRevenue,listExpenses,createExpense,decideExpense,
  listScholarships,createScholarship,decideScholarship,
  listPayroll,createPayroll,importPayroll,decidePayroll,markPayrollPaid,
financialSummaryReport,
feeCollectionReport,
  scholarshipStudentLookup,

updateExpense,
deleteExpense,
updateScholarship,
deleteScholarship,
updatePayroll,
deletePayroll,}=require('../controllers/finance.controller');
const {requireAuth}=require('../middleware/auth');
const {requireRole}=require('../middleware/roles');
const {requireActiveSubscription}=require('../middleware/subscription');

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}});

router.use(requireAuth,requireActiveSubscription);

const view=requireRole('ACCOUNTANT','HEAD_TEACHER','OWNER');
const manage=requireRole('ACCOUNTANT');
const approve=requireRole('HEAD_TEACHER');

router.get('/reports/financial-summary',view,financialSummaryReport);
router.get('/reports/fee-collection',view,feeCollectionReport);
router.get('/dashboard',view,dashboard);
router.get('/years',view,listYears);
router.get('/terms',view,listTerms);
router.get('/classes',view,listClasses);

router.get('/fee-plans',view,listFeePlans);
router.post('/fee-plans',manage,createFeePlan);
router.patch('/fee-plans/:id',manage,updateFeePlan);

router.get('/class-roster',view,classRoster);
router.get('/student-ledger',view,studentFeeLedger);
router.get('/class-financial-roster',view,classFinancialRoster);
router.get('/fee-roster/export',manage,exportFeeRoster);
router.post('/fee-roster/import',manage,upload.single('file'),importFeeRoster);
router.get('/imports',view,listImportBatches);
router.get('/imports/:id',view,getImportBatch);

router.get('/payments',view,listPayments);
router.post('/individual-student-fees',manage,recordIndividualStudentFees);
router.post('/payments',manage,recordPayment);
router.get('/student-account',view,studentAccount);
router.get('/payment-allocation-preview',view,paymentAllocationPreview);
router.post('/allocate-payment',manage,allocatePayment);

router.get('/scholarship-student-lookup',view,scholarshipStudentLookup);

router.get('/revenue',view,listRevenue);
router.post('/revenue',manage,createRevenue);

router.get('/expenses',view,listExpenses);
router.post('/expenses',manage,createExpense);
router.patch('/expenses/:id/decision',approve,decideExpense);

router.get('/scholarships',view,listScholarships);
router.post('/scholarships',manage,createScholarship);
router.patch('/scholarships/:id/decision',approve,decideScholarship);
router.patch('/scholarships/:id',manage,updateScholarship);
router.delete('/scholarships/:id',manage,deleteScholarship);

router.get('/payroll',view,listPayroll);
router.post('/payroll',manage,createPayroll);
router.post('/payroll/import',manage,importPayroll);
router.patch('/payroll/:id/decision',requireRole('HEAD_TEACHER','OWNER'),decidePayroll);

router.patch('/payroll/:id/paid',requireRole('ACCOUNTANT'),markPayrollPaid);
router.patch('/expenses/:id',manage,updateExpense);
router.delete('/expenses/:id',manage,deleteExpense);
router.patch('/payroll/:id',manage,updatePayroll);
router.delete('/payroll/:id',manage,deletePayroll);

module.exports=router;
