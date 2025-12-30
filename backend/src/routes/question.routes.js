const express = require('express');
const router = express.Router();
const Question = require('../models/Question');

// GET questions (filter by node)
router.get('/', async (req, res) => {
  try {
    const { nodeId } = req.query;
    const filter = nodeId ? { nodeId } : {};
    const questions = await Question.find(filter)
      .populate('nodeId')
      .populate('archetypeId');
    res.json({ data: questions });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// GET question by ID
router.get('/:id', async (req, res) => {
  try {
    const question = await Question.findById(req.params.id)
      .populate('nodeId')
      .populate('archetypeId');

    if (!question) {
      return res.status(404).json({ error: { message: 'Question not found', status: 404 } });
    }
    res.json({ data: question });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST create question (admin only)
router.post('/', async (req, res) => {
  try {
    const question = await Question.create(req.body);
    res.status(201).json({ data: question });
  } catch (error) {
    res.status(400).json({ error: { message: error.message, status: 400 } });
  }
});

module.exports = router;
