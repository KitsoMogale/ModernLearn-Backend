const mongoose = require('mongoose');

const userNodeStateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true,
  },
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 1,
    default: 0,
  },
  state: {
    type: String,
    enum: ['green', 'yellow', 'red'],
    default: 'red',
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index for efficient queries
userNodeStateSchema.index({ userId: 1, nodeId: 1 }, { unique: true });

module.exports = mongoose.model('UserNodeState', userNodeStateSchema);
