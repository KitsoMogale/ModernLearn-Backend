const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const UserNodeState = require('../models/UserNodeState');
const UserClusterProgress = require('../models/UserClusterProgress');
const Question = require('../models/Question');
const Cluster = require('../models/Cluster');

router.use(authenticate);

// GET next question for active cluster
router.get('/next-question', async (req, res) => {
  try {
    const { clusterId } = req.query;

    if (!clusterId) {
      return res.status(400).json({ error: { message: 'clusterId is required', status: 400 } });
    }

    // Check cluster progress
    const progress = await UserClusterProgress.findOne({
      userId: req.user._id,
      clusterId,
    });

    const cluster = await Cluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).json({ error: { message: 'Cluster not found', status: 404 } });
    }

    // Check if budget reached
    if (progress && progress.questionsAnswered >= cluster.questionBudget) {
      return res.json({ data: null, message: 'Question budget reached' });
    }

    // TODO: Implement intelligent question selection based on node states
    // For now, return a random question from cluster's nodes
    const questions = await Question.find({ nodeId: { $in: cluster.nodeIds } })
      .populate('nodeId')
      .populate('archetypeId');

    if (questions.length === 0) {
      return res.json({ data: null, message: 'No questions available' });
    }

    const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
    res.json({ data: randomQuestion });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST submit answer
router.post('/submit-answer', async (req, res) => {
  try {
    const { questionId, answer, clusterId } = req.body;

    if (!questionId || !answer || !clusterId) {
      return res.status(400).json({
        error: { message: 'questionId, answer, and clusterId are required', status: 400 }
      });
    }

    // TODO: Implement AI-based answer evaluation
    // TODO: Update node confidence based on evaluation
    // TODO: Propagate evidence to dependent nodes

    // Update cluster progress
    await UserClusterProgress.findOneAndUpdate(
      { userId: req.user._id, clusterId },
      { $inc: { questionsAnswered: 1 } },
      { upsert: true, new: true }
    );

    res.json({ data: { submitted: true, message: 'Answer submitted successfully' } });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// GET user's node states for a cluster
router.get('/node-states', async (req, res) => {
  try {
    const { clusterId } = req.query;

    if (!clusterId) {
      return res.status(400).json({ error: { message: 'clusterId is required', status: 400 } });
    }

    const cluster = await Cluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).json({ error: { message: 'Cluster not found', status: 404 } });
    }

    const nodeStates = await UserNodeState.find({
      userId: req.user._id,
      nodeId: { $in: cluster.nodeIds },
    }).populate('nodeId');

    res.json({ data: nodeStates });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

module.exports = router;
