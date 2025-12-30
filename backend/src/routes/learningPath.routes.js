const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const LearningPath = require('../models/LearningPath');

router.use(authenticate);

// GET learning path for user's topic/level
router.get('/', async (req, res) => {
  try {
    const { topicId, levelId } = req.query;

    if (!topicId || !levelId) {
      return res.status(400).json({
        error: { message: 'topicId and levelId are required', status: 400 }
      });
    }

    const learningPath = await LearningPath.findOne({
      userId: req.user._id,
      topicId,
      levelId,
    })
      .populate('topicId')
      .populate('levelId')
      .sort({ generatedAt: -1 });

    if (!learningPath) {
      return res.status(404).json({ error: { message: 'Learning path not found', status: 404 } });
    }

    res.json({ data: learningPath });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST generate/regenerate learning path
router.post('/generate', async (req, res) => {
  try {
    const { topicId, levelId } = req.body;

    if (!topicId || !levelId) {
      return res.status(400).json({
        error: { message: 'topicId and levelId are required', status: 400 }
      });
    }

    // TODO: Implement learning path generation logic
    // - Analyze user's node states
    // - Identify gaps and weak areas
    // - Generate ordered steps with priorities
    // - Create actionable recommendations

    const learningPath = await LearningPath.create({
      userId: req.user._id,
      topicId,
      levelId,
      summary: 'Learning path generated based on your diagnostic results',
      steps: [],
    });

    res.status(201).json({ data: learningPath });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// PATCH update learning path step status
router.patch('/steps/:stepOrder', async (req, res) => {
  try {
    const { topicId, levelId, status } = req.body;
    const { stepOrder } = req.params;

    if (!topicId || !levelId || !status) {
      return res.status(400).json({
        error: { message: 'topicId, levelId, and status are required', status: 400 }
      });
    }

    const learningPath = await LearningPath.findOne({
      userId: req.user._id,
      topicId,
      levelId,
    });

    if (!learningPath) {
      return res.status(404).json({ error: { message: 'Learning path not found', status: 404 } });
    }

    const step = learningPath.steps.find(s => s.order === parseInt(stepOrder));
    if (!step) {
      return res.status(404).json({ error: { message: 'Step not found', status: 404 } });
    }

    step.status = status;
    await learningPath.save();

    res.json({ data: learningPath });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

module.exports = router;
