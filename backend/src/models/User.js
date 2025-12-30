const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  displayName: {
    type: String,
  },
  photoURL: {
    type: String,
  },
  provider: {
    type: String,
    enum: ['google', 'apple', 'email'],
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', userSchema);
