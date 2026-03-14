const mongoose = require('mongoose');

const REMEDIATION_TYPES = [
  'concept-review',      // Re-learn misunderstood concept
  'practice-problems',   // Apply learning with exercises
  'prerequisite-work',   // Fill foundational gaps
  'boundary-testing'     // Master edge cases
];

const learningStepSchema = new mongoose.Schema({
  stepNumber: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  estimatedTimeMinutes: {
    type: Number,
    required: true
  },
  resources: [String],
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: Date
}, { _id: false });

const practiceProblemSchema = new mongoose.Schema({
  problemNumber: {
    type: Number,
    required: true
  },
  question: {
    type: String,
    required: true
  },
  correctAnswer: String,
  hint: String,
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  completed: {
    type: Boolean,
    default: false
  },
  studentAnswer: String,
  isCorrect: Boolean
}, { _id: false });

const successCheckSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  verifiedAt: Date
}, { _id: false });

const remediationUnitSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true
  },
  failureSignalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FailureSignal',
    required: true
  },
  priority: {
    type: Number,
    required: true,
    min: 1
  },
  title: {
    type: String,
    required: true
  },
  diagnosis: {
    type: String,
    required: true
  },
  rootCause: {
    type: String,
    required: true
  },
  remediationType: {
    type: String,
    enum: REMEDIATION_TYPES,
    required: true
  },
  learningSteps: [learningStepSchema],
  practiceProblems: [practiceProblemSchema],
  successChecks: [successCheckSchema],
  totalEstimatedTimeMinutes: {
    type: Number,
    required: true
  },
  prerequisiteChain: {
    currentTopic: String,
    missingPrerequisites: [String]
  },
  status: {
    type: String,
    enum: ['not-started', 'in-progress', 'completed'],
    default: 'not-started'
  },
  startedAt: Date,
  completedAt: Date,
  progressPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
remediationUnitSchema.index({ sessionId: 1, priority: 1 });
remediationUnitSchema.index({ status: 1 });

// Methods
remediationUnitSchema.methods.updateProgress = function() {
  const totalSteps = this.learningSteps.length + this.practiceProblems.length + this.successChecks.length;

  if (totalSteps === 0) {
    this.progressPercentage = 0;
    return this.save();
  }

  const completedSteps = this.learningSteps.filter(s => s.completed).length;
  const completedProblems = this.practiceProblems.filter(p => p.completed).length;
  const verifiedChecks = this.successChecks.filter(c => c.verified).length;

  const completedTotal = completedSteps + completedProblems + verifiedChecks;
  this.progressPercentage = Math.round((completedTotal / totalSteps) * 100);

  // Update status
  if (this.progressPercentage === 0) {
    this.status = 'not-started';
  } else if (this.progressPercentage === 100) {
    this.status = 'completed';
    if (!this.completedAt) {
      this.completedAt = new Date();
    }
  } else {
    this.status = 'in-progress';
    if (!this.startedAt) {
      this.startedAt = new Date();
    }
  }

  return this.save();
};

remediationUnitSchema.methods.completeStep = function(stepNumber) {
  const step = this.learningSteps.find(s => s.stepNumber === stepNumber);
  if (step) {
    step.completed = true;
    step.completedAt = new Date();
  }
  return this.updateProgress();
};

remediationUnitSchema.methods.completeProblem = function(problemNumber, studentAnswer, isCorrect) {
  const problem = this.practiceProblems.find(p => p.problemNumber === problemNumber);
  if (problem) {
    problem.completed = true;
    problem.studentAnswer = studentAnswer;
    problem.isCorrect = isCorrect;
  }
  return this.updateProgress();
};

remediationUnitSchema.methods.verifySuccessCheck = function(checkIndex) {
  if (this.successChecks[checkIndex]) {
    this.successChecks[checkIndex].verified = true;
    this.successChecks[checkIndex].verifiedAt = new Date();
  }
  return this.updateProgress();
};

// Statics
remediationUnitSchema.statics.getBySession = function(sessionId) {
  return this.find({ sessionId })
    .populate('failureSignalId')
    .sort({ priority: 1 });
};

remediationUnitSchema.statics.TYPES = REMEDIATION_TYPES;

const RemediationUnit = mongoose.model('RemediationUnit', remediationUnitSchema);

module.exports = RemediationUnit;
