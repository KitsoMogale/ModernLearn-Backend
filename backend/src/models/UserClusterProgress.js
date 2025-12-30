const mongoose = require('mongoose');

const userClusterProgressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  clusterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cluster',
    required: true,
  },
  questionsAnswered: {
    type: Number,
    default: 0,
  },
  completed: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

// Compound index for efficient queries
userClusterProgressSchema.index({ userId: 1, clusterId: 1 }, { unique: true });

module.exports = mongoose.model('UserClusterProgress', userClusterProgressSchema);
