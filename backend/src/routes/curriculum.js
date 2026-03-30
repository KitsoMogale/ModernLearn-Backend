const express = require('express');
const router = express.Router();
const curriculumController = require('../controllers/curriculumController');

// GET /api/curriculum — list all profiles
router.get('/', curriculumController.listProfiles);

// GET /api/curriculum/:code/:grade/:subject — get specific profile
router.get('/:code/:grade/:subject', curriculumController.getProfile);

// POST /api/curriculum — create or update profile
router.post('/', curriculumController.upsertProfile);

module.exports = router;
