const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutorController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.post('/chat', tutorController.chat);
router.get('/:sessionId/history', tutorController.getHistory);

module.exports = router;
