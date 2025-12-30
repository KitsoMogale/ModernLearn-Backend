const express = require('express');
const router = express.Router();
const Subject = require('../models/Subject');

// GET all subjects
router.get('/', async (req, res) => {
  try {
    const subjects = await Subject.find();
    res.json({ data: subjects });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// GET subject by ID
router.get('/:id', async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({ error: { message: 'Subject not found', status: 404 } });
    }
    res.json({ data: subject });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST create subject (admin only - add auth middleware later)
router.post('/', async (req, res) => {
  try {
    const subject = await Subject.create(req.body);
    res.status(201).json({ data: subject });
  } catch (error) {
    res.status(400).json({ error: { message: error.message, status: 400 } });
  }
});

module.exports = router;
