const mongoose = require('mongoose');

const FAILURE_CATEGORIES = [
  'conceptual-understanding',
  'rule-application',
  'procedural-execution',
  'representation-interpretation',
  'problem-interpretation',
  'logical-reasoning',
  'quantitative-execution',
  'prerequisite-gap',
  'strategic-approach',
  'careless-execution'
];

const evidenceSchema = new mongoose.Schema({
  questionNumber: {
    type: String,
    required: true
  },
  studentAnswer: String,
  correctAnswer: String,
  reasoning: String
}, { _id: false });

const prerequisiteChainSchema = new mongoose.Schema({
  currentTopic: {
    type: String,
    required: true
  },
  immediatePrerequisite: String,
  gapLevel: String,
  testedPrerequisites: [String]
}, { _id: false });

const failureSignalSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: FAILURE_CATEGORIES,
    required: true,
    index: true
  },
  specificIssue: {
    type: String,
    required: true
  },
  rootCause: {
    type: String,
    required: true
  },
  misconceptionDescription: {
    type: String
  },
  detectedConcepts: [String],
  evidence: [evidenceSchema],
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.8
  },
  confirmedByAnalysis: {
    type: Boolean,
    default: true
  },
  severity: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  affectedQuestions: [String],
  prerequisiteChain: prerequisiteChainSchema
}, {
  timestamps: true
});

// Indexes
failureSignalSchema.index({ sessionId: 1, category: 1 });
failureSignalSchema.index({ sessionId: 1, severity: 1 });

// Statics
failureSignalSchema.statics.getBySession = function(sessionId) {
  return this.find({ sessionId }).sort({ severity: 1, createdAt: 1 });
};

failureSignalSchema.statics.getConfirmed = function(sessionId) {
  return this.find({ sessionId, confirmedByAnalysis: true }).sort({ severity: 1, createdAt: 1 });
};

failureSignalSchema.statics.CATEGORIES = FAILURE_CATEGORIES;

const FailureSignal = mongoose.model('FailureSignal', failureSignalSchema);

module.exports = FailureSignal;
