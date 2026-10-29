const express=require('express');
const {requireAuth}=require('../middleware/auth');
const {requireActiveSubscription}=require('../middleware/subscription');
const c=require('../controllers/owner-workspace.controller');
const multer=require('multer');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const uploadDir=path.resolve(__dirname,'../../uploads/support');
const messageUploadDir=path.resolve(__dirname,'../../uploads/messages');
fs.mkdirSync(uploadDir,{recursive:true});fs.mkdirSync(messageUploadDir,{recursive:true});
function makeUpload(dir,maxBytes){return multer({storage:multer.diskStorage({destination:(req,file,cb)=>cb(null,dir),filename:(req,file,cb)=>cb(null,crypto.randomBytes(16).toString('hex')+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:maxBytes},fileFilter:(req,file,cb)=>{const allowed=/\.(png|jpe?g|webp|gif|pdf|txt|docx?|xlsx?|pptx?)$/i.test(file.originalname);cb(allowed?null:new Error('Allowed attachments: common images, PDF, TXT, DOC/DOCX, XLS/XLSX or PPT/PPTX.'),allowed)}})}
const upload=makeUpload(uploadDir,5*1024*1024);
const messageUpload=makeUpload(messageUploadDir,10*1024*1024);
function handleMessageUpload(req,res,next){messageUpload.single('attachment')(req,res,err=>{if(err){const status=err.code==='LIMIT_FILE_SIZE'?413:400;return res.status(status).json({error:err.code==='LIMIT_FILE_SIZE'?'Attachment must be 10 MB or smaller.':err.message||'Invalid attachment.'})}next()})}
const router=express.Router();
router.get('/account',requireAuth,c.getAccount);
router.post('/subscription/cancellation-requests',requireAuth,c.requestSubscriptionCancellation);
router.use(requireAuth,requireActiveSubscription);
router.get('/announcements',c.listAnnouncements);router.post('/announcements',c.createAnnouncement);
router.get('/contacts',c.listContacts);router.get('/messages',c.listMessages);router.post('/messages',handleMessageUpload,c.sendMessage);router.get('/messages/:id/attachment',c.downloadMessageAttachment);router.patch('/messages/:id/read',c.markMessageRead);
router.get('/notifications',c.listNotifications);router.patch('/notifications/:id/read',c.markNotificationRead);
router.get('/support',c.listSupportTickets);router.post('/support',upload.single('attachment'),c.createSupportTicket);router.get('/support/:id/attachment',c.downloadSupportAttachment);
module.exports=router;
