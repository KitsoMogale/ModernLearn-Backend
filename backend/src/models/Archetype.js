const mongoose = require('mongoose');

const archetypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  intent: {
    type: String,
    required: true,
  },
  applicableLevels: [{
    type: String,
    enum: ['Intro', 'Advanced', 'Graduate'],
  }],
  promptTemplate: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Archetype', archetypeSchema);
