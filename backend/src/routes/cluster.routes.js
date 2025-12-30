const express = require('express');
const router = express.Router();
const Cluster = require('../models/Cluster');

// GET clusters (filter by topic and/or level)
router.get('/', async (req, res) => {
  try {
    const { topicId, levelId } = req.query;
    const filter = {};
    if (topicId) filter.topicId = topicId;
    if (levelId) filter.levelId = levelId;

    const clusters = await Cluster.find(filter)
      .populate('topicId')
      .populate('levelId')
      .populate('nodeIds')
      .sort({ order: 1 });

    res.json({ data: clusters });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// GET cluster by ID
router.get('/:id', async (req, res) => {
  try {
    const cluster = await Cluster.findById(req.params.id)
      .populate('topicId')
      .populate('levelId')
      .populate('nodeIds');

    if (!cluster) {
      return res.status(404).json({ error: { message: 'Cluster not found', status: 404 } });
    }
    res.json({ data: cluster });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST create cluster (admin only)
router.post('/', async (req, res) => {
  try {
    const cluster = await Cluster.create(req.body);
    res.status(201).json({ data: cluster });
  } catch (error) {
    res.status(400).json({ error: { message: error.message, status: 400 } });
  }
});

module.exports = router;
