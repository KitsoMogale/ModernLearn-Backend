const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['system', 'user', 'assistant'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
}, { _id: false, timestamps: true });

const tutorConversationSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  messages: [messageSchema],
  dailyMessageCount: {
    type: Number,
    default: 0,
  },
  lastMessageDate: {
    type: String, // 'YYYY-MM-DD' — used for daily reset
  },
}, { timestamps: true });

// Compound index — one conversation per session
tutorConversationSchema.index({ sessionId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('TutorConversation', tutorConversationSchema);
