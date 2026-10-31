require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/student.routes');
const academicRoutes = require('./routes/academic.routes');
const termRoutes = require('./routes/term.routes');
const classRoutes = require('./routes/class.routes');
const subjectRoutes = require('./routes/subject.routes');
const teachingAssignmentRoutes = require('./routes/teaching-assignment.routes');
const learningRoutes = require('./routes/learning.routes');
const timetableRoutes = require('./routes/timetable.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const assessmentRoutes = require('./routes/assessment.routes');
const financeRoutes = require('./routes/finance.routes');
const billingRoutes = require('./routes/billing.routes');
const adminRoutes = require('./routes/admin.routes');
const adminOtpRoutes = require('./routes/admin-otp.routes');
const staffRoutes = require('./routes/staff.routes');
const studentPortalRoutes =
require('./routes/studentPortal.routes');
const settingsRoutes = require('./routes/settings.routes');
const studentImportRoutes = require('./routes/studentImport.routes');
const studentImportHistoryRoutes = require('./routes/studentImportHistory.routes');
const schoolRoutes = require('./routes/school.routes');
const parentRoutes = require('./routes/parent.routes');
const parentPortalRoutes = require('./routes/parent-portal.routes');
const securityPortalRoutes = require('./routes/security-portal.routes');
const nurseAppointmentRoutes = require('./routes/nurse-appointment.routes');
const nursePortalRoutes = require('./routes/nurse-portal.routes');
const teacherPortalRoutes = require('./routes/teacher-portal.routes');
const ownerWorkspaceRoutes = require('./routes/owner-workspace.routes');
const branchRoutes = require('./routes/branch.routes');
const schoolEventRoutes = require('./routes/school-events.routes');


const assessmentEngineRoutes=require('./routes/assessment-engine.routes');
const gradingRoutes=require('./routes/grading.routes');
const publicContentRoutes = require('./routes/public-content.routes');

const app = express();

// Explicitly allow both production frontends. FRONTEND_URL remains an
// optional additional origin, not the sole source of CORS configuration.
const allowedOrigins = new Set([
  'https://connectsukuu.vercel.app',
  'https://ghostme2026.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL
].map(value => String(value || '').trim().replace(/\/$/, '')).filter(Boolean));

app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = String(origin || '').trim().replace(/\/$/, '');
    if (!normalizedOrigin || allowedOrigins.has(normalizedOrigin)) {
      return callback(null, true);
    }
    console.warn('[CORS] Rejected frontend origin:', normalizedOrigin);
    return callback(new Error('Origin not allowed by ConnectSukuu CORS policy'));
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
  optionsSuccessStatus: 204
}));

// Compress eligible API responses to reduce transfer time for larger JSON payloads.
app.use(compression());

//IMPORTANT: the Stripe webhook needs the raw, unparsed request body to check

app.post(
  '/api/billing/stripe/webhook',
  express.raw({ type: 'application/json' }),
  require('./controllers/billing.controller').stripeWebhook
);

app.use(express.json());
require('fs').mkdirSync(require('path').join(__dirname,'..','uploads','learning'),{recursive:true});
app.use('/uploads/learning',express.static(require('path').join(__dirname,'..','uploads','learning')));
require('fs').mkdirSync(require('path').join(__dirname,'..','uploads','profiles'),{recursive:true});
app.use('/uploads/profiles',express.static(require('path').join(__dirname,'..','uploads','profiles')));
// Student profile photos are uploaded by both the Student portal and Administrator.
// Serve the same directory so every role can load the stored photoUrl.
require('fs').mkdirSync(require('path').join(__dirname,'..','uploads','student-profiles'),{recursive:true});
app.use('/uploads/student-profiles',express.static(require('path').join(__dirname,'..','uploads','student-profiles')));


app.get('/', (req, res) => res.json({ status: 'ConnectSukuu API running' }));

// Readiness endpoint checks PostgreSQL itself, not just whether Node is listening.
app.get('/health/ready', async (req, res) => {
  try {
    const prisma = require('./config/db');
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: 'ready', database: 'connected' });
  } catch (err) {
    console.error('Database readiness check failed:', err.code || err.name || 'database error');
    return res.status(503).json({ status: 'not_ready', database: 'unavailable', retryable: true });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/students/import', studentImportRoutes);
app.use('/api/students/import-history', studentImportHistoryRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/student-portal', studentPortalRoutes);
app.use('/api/academic-years', academicRoutes);
app.use('/api/academic-years', termRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/teaching-assignments', teachingAssignmentRoutes);
app.use('/api/learning', learningRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/assessment-engine', assessmentEngineRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/billing', billingRoutes);
// Dedicated Super Admin OTP/security endpoints must be mounted explicitly.
app.use('/api/admin/otp', adminOtpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/parents', parentRoutes);
app.use('/api/parent-portal', parentPortalRoutes);
app.use('/api/security-portal', securityPortalRoutes);
app.use('/api/nurse-appointments', nurseAppointmentRoutes);
app.use('/api/nurse-portal', nursePortalRoutes);
app.use('/api/teacher-portal', teacherPortalRoutes);
app.use('/api/owner-workspace', ownerWorkspaceRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/school-events', schoolEventRoutes);
app.use('/api/grading-scales', gradingRoutes);
app.use('/api/public-content', publicContentRoutes);

//Catch-all error handler — keeps a bug in one route from crashing the whole server.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`ConnectSukuu API listening on port ${PORT}`));
