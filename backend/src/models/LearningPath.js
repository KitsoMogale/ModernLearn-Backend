const mongoose = require('mongoose');

const nodeRefSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true,
  },
  nodeName: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    enum: ['red', 'yellow'],
    required: true,
  },
}, { _id: false });

const learningPathStepSchema = new mongoose.Schema({
  order: {
    type: Number,
    required: true,
  },
  clusterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cluster',
    required: true,
  },
  clusterName: {
    type: String,
    required: true,
  },
  nodeChain: [nodeRefSchema],
  reason: {
    type: String,
    required: true,
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    required: true,
  },
  status: {
    type: String,
    enum: ['not-started', 'in-progress', 'addressed'],
    default: 'not-started',
  },
  estimatedEffort: {
    type: String,
    required: true,
  },
  suggestedActions: [{
    type: String,
  }],
}, { _id: false });

const learningPathSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
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
  generatedAt: {
    type: Date,
    default: Date.now,
  },
  graphSnapshotId: {
    type: String,
  },
  summary: {
    type: String,
    required: true,
  },
  steps: [learningPathStepSchema],
}, {
  timestamps: true,
});

module.exports = mongoose.model('LearningPath', learningPathSchema);
