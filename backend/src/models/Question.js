const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true,
  },
  archetypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Archetype',
    required: true,
  },
  prompt: {
    type: String,
    required: true,
  },
  difficultyTag: {
    type: String,
    required: true,
  },
  expectedAnswerForm: {
    type: String,
    enum: ['numeric', 'text', 'symbolic'],
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Question', questionSchema);
