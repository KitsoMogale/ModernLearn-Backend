const mongoose = require('mongoose');

const FAILURE_CATEGORIES = [
  'conceptual-understanding',      // Doesn't understand the concept
  'rule-application',              // Knows rule but applies incorrectly
  'procedural-execution',          // Understands but executes wrong
  'representation-interpretation', // Can't interpret notation/diagrams
  'problem-interpretation',        // Misunderstands the question
  'logical-reasoning',             // Makes illogical leaps
  'quantitative-execution',        // Arithmetic/calculation errors
  'prerequisite-gap',              // Missing foundational knowledge
  'strategic-approach',            // Wrong problem-solving strategy
  'careless-execution'             // Knows it but makes careless mistakes
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

const probingHistorySchema = new mongoose.Schema({
  state: {
    type: String,
    enum: [
      'INITIAL_ERROR_ANALYSIS',
      'STUDENT_REASONING_EXTRACTION',
      'MISCONCEPTION_TEST',
      'RULE_VERIFICATION',
      'PREREQUISITE_CHECK',
      'BOUNDARY_CASE_TEST',
      'ROOT_CAUSE_CONFIRMATION',
      'FAILURE_RECORDED'
    ],
    required: true
  },
  question: String,
  studentResponse: String,
  aiAnalysis: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
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
  detectedConcepts: [String],
  evidence: [evidenceSchema],
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.5
  },
  confirmedByProbing: {
    type: Boolean,
    default: false
  },
  rootCause: {
    type: String
  },
  misconceptionDescription: {
    type: String
  },
  prerequisiteChain: prerequisiteChainSchema,
  probingHistory: [probingHistorySchema],
  currentState: {
    type: String,
    enum: [
      'INITIAL_ERROR_ANALYSIS',
      'STUDENT_REASONING_EXTRACTION',
      'MISCONCEPTION_TEST',
      'RULE_VERIFICATION',
      'PREREQUISITE_CHECK',
      'BOUNDARY_CASE_TEST',
      'ROOT_CAUSE_CONFIRMATION',
      'FAILURE_RECORDED'
    ],
    default: 'INITIAL_ERROR_ANALYSIS'
  },
  isComplete: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
failureSignalSchema.index({ sessionId: 1, category: 1 });
failureSignalSchema.index({ confirmedByProbing: 1 });

// Methods
failureSignalSchema.methods.addProbingEntry = function(state, question, studentResponse, aiAnalysis) {
  this.probingHistory.push({
    state,
    question,
    studentResponse,
    aiAnalysis
  });
  this.currentState = state;
  return this.save();
};

failureSignalSchema.methods.confirmFailure = function(rootCause, misconceptionDescription) {
  this.confirmedByProbing = true;
  this.rootCause = rootCause;
  this.misconceptionDescription = misconceptionDescription;
  this.currentState = 'FAILURE_RECORDED';
  this.isComplete = true;
  this.confidence = 1.0;
  return this.save();
};

failureSignalSchema.methods.updateState = function(newState) {
  this.currentState = newState;
  return this.save();
};

failureSignalSchema.methods.setPrerequisiteChain = function(currentTopic, immediatePrerequisite, gapLevel, testedPrerequisites = []) {
  this.prerequisiteChain = {
    currentTopic,
    immediatePrerequisite,
    gapLevel,
    testedPrerequisites
  };
  return this.save();
};

// Statics
failureSignalSchema.statics.getBySession = function(sessionId) {
  return this.find({ sessionId }).sort({ createdAt: 1 });
};

failureSignalSchema.statics.getUnconfirmed = function(sessionId) {
  return this.find({ sessionId, confirmedByProbing: false });
};

failureSignalSchema.statics.getConfirmed = function(sessionId) {
  return this.find({ sessionId, confirmedByProbing: true });
};

failureSignalSchema.statics.CATEGORIES = FAILURE_CATEGORIES;

const FailureSignal = mongoose.model('FailureSignal', failureSignalSchema);

module.exports = FailureSignal;
