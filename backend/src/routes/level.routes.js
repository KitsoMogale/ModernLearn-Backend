const express = require('express');
const router = express.Router();
const Level = require('../models/Level');

// GET levels by topic
router.get('/', async (req, res) => {
  try {
    const { topicId } = req.query;
    const filter = topicId ? { topicId } : {};
    const levels = await Level.find(filter).populate('topicId');
    res.json({ data: levels });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// GET level by ID
router.get('/:id', async (req, res) => {
  try {
    const level = await Level.findById(req.params.id).populate('topicId');
    if (!level) {
      return res.status(404).json({ error: { message: 'Level not found', status: 404 } });
    }
    res.json({ data: level });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST create level (admin only)
router.post('/', async (req, res) => {
  try {
    const level = await Level.create(req.body);
    res.status(201).json({ data: level });
  } catch (error) {
    res.status(400).json({ error: { message: error.message, status: 400 } });
  }
});

module.exports = router;
