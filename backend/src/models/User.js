const mongoose = require('mongoose');

const defaultLearningScopeSchema = new mongoose.Schema({
  grade: {
    type: String,
    trim: true
  },
  curriculum: {
    type: String,
    trim: true
  },
  country: {
    type: String,
    trim: true
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  displayName: {
    type: String,
    trim: true
  },
  defaultLearningScope: defaultLearningScopeSchema,
  sessions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date
  },
  deletionRequestedAt: {
    type: Date
  },
  tokenBalance: {
    type: Number,
    default: 20000,  // free starter tokens for new users
    min: 0,
  },
  totalTokensUsed: {
    type: Number,
    default: 0,
  },
  totalTokensPurchased: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true
});

// Indexes
userSchema.index({ firebaseUid: 1 });
userSchema.index({ email: 1 });

// Methods
userSchema.methods.updateDefaultLearningScope = function(learningScope) {
  this.defaultLearningScope = learningScope;
  return this.save();
};

userSchema.methods.addSession = function(sessionId) {
  this.sessions.push(sessionId);
  return this.save();
};

userSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  return this.save();
};

// Statics
userSchema.statics.findByFirebaseUid = function(firebaseUid) {
  return this.findOne({ firebaseUid });
};

userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

const User = mongoose.model('User', userSchema);

module.exports = User;
