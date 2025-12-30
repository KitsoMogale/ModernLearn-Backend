const mongoose = require('mongoose');

const clusterSchema = new mongoose.Schema({
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic',
    required: true,
  },
  levelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Level',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  intendedLearningOutcome: {
    type: String,
    required: true,
  },
  order: {
    type: Number,
    required: true,
  },
  questionBudget: {
    type: Number,
    required: true,
  },
  nodeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
  }],
}, {
  timestamps: true,
});

module.exports = mongoose.model('Cluster', clusterSchema);
