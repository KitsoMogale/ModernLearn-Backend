const express = require('express');
const router = express.Router();
const Topic = require('../models/Topic');

// GET all topics (optionally filter by subject)
router.get('/', async (req, res) => {
  try {
    const { subjectId } = req.query;
    const filter = subjectId ? { subjectId } : {};
    const topics = await Topic.find(filter).populate('subjectId');
    res.json({ data: topics });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// GET topic by ID
router.get('/:id', async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id).populate('subjectId');
    if (!topic) {
      return res.status(404).json({ error: { message: 'Topic not found', status: 404 } });
    }
    res.json({ data: topic });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST create topic (admin only)
router.post('/', async (req, res) => {
  try {
    const topic = await Topic.create(req.body);
    res.status(201).json({ data: topic });
  } catch (error) {
    res.status(400).json({ error: { message: error.message, status: 400 } });
  }
});

module.exports = router;
