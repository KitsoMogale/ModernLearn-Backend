const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
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
  learningGoals: [{
    type: String,
  }],
}, {
  timestamps: true,
});

module.exports = mongoose.model('Topic', topicSchema);
