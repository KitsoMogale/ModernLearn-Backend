const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema({
  clusterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cluster',
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
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
  }],
  learningGoal: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Node', nodeSchema);
