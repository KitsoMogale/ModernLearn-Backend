const express = require('express');
const router = express.Router();
const remediationController = require('../controllers/remediationController');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Learning step operations
router.patch('/:unitId/step/:stepNumber', remediationController.completeStep);

// Practice problem operations
router.post('/:unitId/problem/:problemNumber/submit', remediationController.submitProblemAnswer);
router.post('/:unitId/problem/:problemNumber/hint', remediationController.getProblemHint);
router.post('/:unitId/more-problems', remediationController.generateMoreProblems);

// Success check operations
router.patch('/:unitId/success-check/:checkIndex', remediationController.verifySuccessCheck);

// Self-review checklist operations
router.patch('/:unitId/checklist/:itemIndex', remediationController.toggleChecklistItem);

module.exports = router;
