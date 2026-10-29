const express=require('express');
const router=express.Router();
const {
  listGradingScales,createGradingScale,assignClassGradingScale,getClassGradingScale,
  recalculateReportCard,submitCalculatedReportCard,getGradingScale,updateGradingScale,deleteGradingScale
}=require('../controllers/assessment-engine.controller');
const {requireRole}=require('../middleware/roles');
const {requireActiveSubscription}=require('../middleware/subscription');
const {requireAuth}=require('../middleware/auth');
router.use(requireAuth,requireActiveSubscription);

router.get('/grading-scales',requireRole('TEACHER','HEAD_OF_ACADEMICS','HEAD_TEACHER'),listGradingScales);
router.post('/grading-scales',requireRole('HEAD_OF_ACADEMICS','HEAD_TEACHER'),createGradingScale);
router.get('/grading-scales/:id',requireRole('HEAD_OF_ACADEMICS','HEAD_TEACHER'),getGradingScale);
router.patch('/grading-scales/:id',requireRole('HEAD_OF_ACADEMICS','HEAD_TEACHER'),updateGradingScale);
router.delete('/grading-scales/:id',requireRole('HEAD_OF_ACADEMICS','HEAD_TEACHER'),deleteGradingScale);
router.get('/classes/:classId/grading-scale',requireRole('TEACHER','HEAD_OF_ACADEMICS','HEAD_TEACHER'),getClassGradingScale);
router.put('/classes/:classId/grading-scale',requireRole('HEAD_OF_ACADEMICS'),assignClassGradingScale);
router.post('/report-cards/:id/recalculate',requireRole('TEACHER','HEAD_OF_ACADEMICS','HEAD_TEACHER'),recalculateReportCard);
router.post('/report-cards/:id/submit-calculated',requireRole('TEACHER'),submitCalculatedReportCard);
module.exports=router;
