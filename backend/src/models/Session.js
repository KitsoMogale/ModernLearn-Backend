const mongoose = require('mongoose');

const learningScopeSchema = new mongoose.Schema({
  level: {
    type: String,
    required: true,
    trim: true
  },
  curriculum: {
    type: String,
    required: true,
    trim: true
  },
  country: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    trim: true
  },
  topic: {
    type: String,
    trim: true
  }
}, { _id: false });

const questionStructureSchema = new mongoose.Schema({
  hasMultipleChoice: { type: Boolean, default: false },
  hasDiagram: { type: Boolean, default: false },
  hasTable: { type: Boolean, default: false },
  hasEquations: { type: Boolean, default: false },
  questionHierarchy: {
    type: String,
    enum: ['main', 'subpart'],
    default: 'main'
  }
}, { _id: false });

const detectedErrorSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
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
    ],
    required: true
  },
  description: {
    type: String,
    required: true
  }
}, { _id: false });

const aiAnalysisSchema = new mongoose.Schema({
  detectedConcepts: [String],
  detectedErrors: [detectedErrorSchema],
  confidence: {
    type: Number,
    min: 0,
    max: 1
  },
  isCorrect: Boolean,
  questionRequires: String,
  expectedApproach: String
}, { _id: false });

const extractedQuestionSchema = new mongoose.Schema({
  questionNumber: {
    type: String,
    required: true
  },
  questionText: {
    type: String,
    required: true
  },
  studentAnswer: {
    type: String,
    default: ''
  },
  correctAnswer: {
    type: String
  },
  parentQuestion: {
    type: String
  },
  subQuestions: [String],
  structure: questionStructureSchema,
  aiAnalysis: aiAnalysisSchema,
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 1
  },
  userReviewed: {
    type: Boolean,
    default: false
  },
  skipped: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const uploadedImageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  pageNumber: {
    type: Number,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    trim: true
  },
  learningScope: {
    type: learningScopeSchema,
    required: true
  },
  uploadedImages: [uploadedImageSchema],
  extractedQuestions: [extractedQuestionSchema],
  detectedFailures: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FailureSignal'
  }],
  remediationPlan: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RemediationUnit'
  }],
  status: {
    type: String,
    enum: ['created', 'uploaded', 'extracted', 'analyzing', 'analyzed', 'remediation-generated', 'completed'],
    default: 'created',
    index: true
  },
  analysisSummary: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
sessionSchema.index({ userId: 1, createdAt: -1 });
sessionSchema.index({ status: 1 });

// Methods
sessionSchema.methods.updateStatus = function(newStatus) {
  this.status = newStatus;
  return this.save();
};

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;
