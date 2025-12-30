const mongoose = require('mongoose');

const levelSchema = new mongoose.Schema({
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic',
    required: true,
  },
  name: {
    type: String,
    enum: ['Intro', 'Advanced', 'Graduate'],
    required: true,
  },
  expectedBackground: {
    type: String,
    required: true,
  },
  totalQuestionLimit: {
    type: Number,
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Level', levelSchema);
