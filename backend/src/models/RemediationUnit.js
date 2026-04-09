const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════════
// Remediation Groups — each drives a different prompt + UI layout
// ═══════════════════════════════════════════════════════════════════
//
// understand-gap    → Conceptual/prerequisite gaps. Points student to what to study.
// fix-process       → Procedural/rule/execution errors. Quick rule reminder + targeted drill.
// rethink-approach  → Strategic/reasoning errors. Approach comparison + recognition exercises.
// quick-check       → Careless slips. Flags the slip + self-review checklist.

const REMEDIATION_GROUPS = [
  'understand-gap',
  'fix-process',
  'rethink-approach',
  'quick-check'
];

// Which failure categories map to which remediation group
const CATEGORY_TO_GROUP = {
  'conceptual-understanding': 'understand-gap',
  'prerequisite-gap':         'understand-gap',
  'representation-interpretation': 'understand-gap',
  'procedural-execution':     'fix-process',
  'rule-application':         'fix-process',
  'quantitative-execution':   'fix-process',
  'strategic-approach':       'rethink-approach',
  'problem-interpretation':   'rethink-approach',
  'logical-reasoning':        'rethink-approach',
  'careless-execution':       'quick-check',
};

// ── Shared sub-schemas ──

const learningStepSchema = new mongoose.Schema({
  stepNumber: { type: Number, required: true },
  description: { type: String, required: true },
  estimatedTimeMinutes: { type: Number, required: true },
  resources: [String],
  completed: { type: Boolean, default: false },
  completedAt: Date
}, { _id: false });

const practiceProblemSchema = new mongoose.Schema({
  problemNumber: { type: Number, required: true },
  question: { type: String, required: true },
  correctAnswer: String,
  hint: String,
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  mode: { type: String, enum: ['answer', 'suggestion'], default: 'answer' },
  completed: { type: Boolean, default: false },
  studentAnswer: String,
  isCorrect: Boolean,
  feedback: String
}, { _id: false });

const successCheckSchema = new mongoose.Schema({
  description: { type: String, required: true },
  verified: { type: Boolean, default: false },
  verifiedAt: Date
}, { _id: false });

// ── Group-specific sub-schemas ──

// understand-gap: what to study within the curriculum
const conceptGuidanceSchema = new mongoose.Schema({
  misconception: String,        // "You seem to think X..."
  correctConcept: String,       // "Actually, it works like Y..."
  topicsToReview: [String],     // curriculum topic names to revisit
  keyIdeas: [String],           // 2-3 bullet points of what to focus on
}, { _id: false });

// rethink-approach: compare approaches
const approachComparisonSchema = new mongoose.Schema({
  studentApproach: String,      // "What you tried"
  correctApproach: String,      // "What was needed"
  whenToUse: String,            // "Use this approach when..."
}, { _id: false });

// quick-check: self-review checklist
const checklistItemSchema = new mongoose.Schema({
  text: { type: String, required: true },
  checked: { type: Boolean, default: false },
}, { _id: false });

// fix-process: rule/procedure reminder
const ruleReminderSchema = new mongoose.Schema({
  rule: { type: String, required: true },  // the rule/procedure statement
  example: String,                          // quick worked example
}, { _id: false });

// ── Main schema ──

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
  priority: { type: Number, required: true, min: 1 },
  title: { type: String, required: true },
  diagnosis: { type: String, required: true },
  rootCause: { type: String, required: true },

  // New: which remediation group this unit belongs to
  remediationGroup: {
    type: String,
    enum: REMEDIATION_GROUPS,
    required: true
  },

  // Shared fields (used by all groups, but in different amounts)
  learningSteps: [learningStepSchema],
  practiceProblems: [practiceProblemSchema],
  successChecks: [successCheckSchema],

  // Group-specific fields
  conceptGuidance: conceptGuidanceSchema,             // understand-gap
  ruleReminder: ruleReminderSchema,                   // fix-process
  approachComparison: approachComparisonSchema,        // rethink-approach
  selfReviewChecklist: [checklistItemSchema],          // quick-check

  totalEstimatedTimeMinutes: { type: Number, required: true },
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
  const checklistCount = (this.selfReviewChecklist || []).length;
  const totalSteps = this.learningSteps.length + this.practiceProblems.length
    + this.successChecks.length + checklistCount;

  if (totalSteps === 0) {
    this.progressPercentage = 0;
    return this.save();
  }

  const completedSteps = this.learningSteps.filter(s => s.completed).length;
  const completedProblems = this.practiceProblems.filter(p => p.completed).length;
  const verifiedChecks = this.successChecks.filter(c => c.verified).length;
  const checkedItems = (this.selfReviewChecklist || []).filter(c => c.checked).length;

  const completedTotal = completedSteps + completedProblems + verifiedChecks + checkedItems;
  this.progressPercentage = Math.round((completedTotal / totalSteps) * 100);

  if (this.progressPercentage === 0) {
    this.status = 'not-started';
  } else if (this.progressPercentage === 100) {
    this.status = 'completed';
    if (!this.completedAt) this.completedAt = new Date();
  } else {
    this.status = 'in-progress';
    if (!this.startedAt) this.startedAt = new Date();
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

remediationUnitSchema.methods.completeProblem = function(problemNumber, studentAnswer, isCorrect, feedback) {
  const problem = this.practiceProblems.find(p => p.problemNumber === problemNumber);
  if (problem) {
    problem.completed = true;
    problem.studentAnswer = studentAnswer;
    problem.isCorrect = isCorrect;
    if (feedback) problem.feedback = feedback;
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

remediationUnitSchema.methods.toggleChecklistItem = function(itemIndex) {
  if (this.selfReviewChecklist?.[itemIndex]) {
    this.selfReviewChecklist[itemIndex].checked = !this.selfReviewChecklist[itemIndex].checked;
  }
  return this.updateProgress();
};

// Statics
remediationUnitSchema.statics.getBySession = function(sessionId) {
  return this.find({ sessionId })
    .populate('failureSignalId')
    .sort({ priority: 1 });
};

remediationUnitSchema.statics.GROUPS = REMEDIATION_GROUPS;
remediationUnitSchema.statics.CATEGORY_TO_GROUP = CATEGORY_TO_GROUP;

const RemediationUnit = mongoose.model('RemediationUnit', remediationUnitSchema);

module.exports = RemediationUnit;
