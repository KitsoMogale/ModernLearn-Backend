const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const diagnosisController = require('../controllers/diagnosisController');
const remediationController = require('../controllers/remediationController');
const { uploadMultiple, handleUploadError } = require('../middleware/upload');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Session CRUD
router.post('/', sessionController.createSession);
router.get('/:id', sessionController.getSession);
router.delete('/:id', sessionController.deleteSession);

// Image upload and OCR
router.post('/:id/upload', uploadMultiple, handleUploadError, sessionController.uploadImages);
router.post('/:id/extract', sessionController.extractQuestions);

// Question management
router.patch('/:id/questions', sessionController.updateQuestions);

// Diagnosis (single-pass, no conversation)
router.post('/:id/analyze', diagnosisController.analyzeSession);
router.get('/:id/failures', diagnosisController.getFailures);

// Remediation
router.post('/:id/generate-remediation', remediationController.generateRemediation);
router.get('/:id/remediation', remediationController.getRemediation);

// User sessions
router.get('/user/all', sessionController.getUserSessions);

module.exports = router;
