const express = require('express');
const router = express.Router();
const Node = require('../models/Node');

// GET nodes (filter by cluster)
router.get('/', async (req, res) => {
  try {
    const { clusterId } = req.query;
    const filter = clusterId ? { clusterId } : {};
    const nodes = await Node.find(filter)
      .populate('clusterId')
      .populate('dependencies');
    res.json({ data: nodes });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// GET node by ID
router.get('/:id', async (req, res) => {
  try {
    const node = await Node.findById(req.params.id)
      .populate('clusterId')
      .populate('dependencies');

    if (!node) {
      return res.status(404).json({ error: { message: 'Node not found', status: 404 } });
    }
    res.json({ data: node });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// POST create node (admin only)
router.post('/', async (req, res) => {
  try {
    const node = await Node.create(req.body);
    res.status(201).json({ data: node });
  } catch (error) {
    res.status(400).json({ error: { message: error.message, status: 400 } });
  }
});

module.exports = router;
