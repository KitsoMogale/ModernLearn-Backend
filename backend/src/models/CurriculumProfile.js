const mongoose = require('mongoose');

// ─── Topic Graph ────────────────────────────────────────────────────
const subtopicSchema = new mongoose.Schema({
  name: { type: String, required: true },
  skillId: { type: String, required: true, trim: true },   // e.g. "ALG-FAC-001"
  skills: [String],                                         // what the student should be able to do
  methods: [String],                                        // approved solving methods
  commonSteps: [String],                                    // expected step-by-step solving process
  prerequisites: [{
    skillId: { type: String },
    name: { type: String },
    gradeLevel: { type: String }
  }],
  notation: [String],                                       // notation rules specific to this subtopic
  keyFormulae: [String]
}, { _id: false });

const topicSchema = new mongoose.Schema({
  topic: { type: String, required: true },                  // e.g. "Algebra"
  subtopics: [subtopicSchema]
}, { _id: false });

// ─── Layer 1: Meta Context ─────────────────────────────────────────
const metaSchema = new mongoose.Schema({
  country: { type: String, required: true },
  curriculum: { type: String, required: true },
  level: { type: String, required: true },
  subject: { type: String, required: true },
  notation: [String],                                       // curriculum-wide notation rules
  markingStandards: [String],                               // how answers are marked
  terminology: [{
    term: { type: String, required: true },
    note: { type: String }
  }],
  assessmentFormat: { type: String }
}, { _id: false });

// ─── Main Document ─────────────────────────────────────────────────
const curriculumProfileSchema = new mongoose.Schema({
  curriculumCode: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  meta: {
    type: metaSchema,
    required: true
  },
  topics: [topicSchema],
  version: { type: Number, default: 1 },
  lastUpdatedBy: { type: String },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

// One profile per curriculum + level + subject
curriculumProfileSchema.index(
  { curriculumCode: 1, 'meta.level': 1, 'meta.subject': 1 },
  { unique: true }
);

// ─── Curriculum name → code mapping ────────────────────────────────
const CURRICULUM_CODE_MAP = {
  'CAPS - South Africa': 'CAPS',
  'Common Core - USA': 'COMMON_CORE',
  'GCSE - UK': 'GCSE',
  'IB - International': 'IB',
  'CBSE - India': 'CBSE'
};

function mapCurriculumNameToCode(curriculumName) {
  return CURRICULUM_CODE_MAP[curriculumName] || curriculumName;
}

curriculumProfileSchema.statics.mapCurriculumNameToCode = mapCurriculumNameToCode;

curriculumProfileSchema.statics.findByLearningScope = function(learningScope) {
  const curriculumCode = mapCurriculumNameToCode(learningScope.curriculum);
  return this.findOne({
    curriculumCode,
    'meta.level': learningScope.level,
    'meta.subject': learningScope.subject || 'Mathematics',
    isActive: true
  });
};

const CurriculumProfile = mongoose.model('CurriculumProfile', curriculumProfileSchema);

module.exports = CurriculumProfile;
