const mongoose = require('mongoose');

// Tracks every successfully validated IAP receipt.
// The transactionId is unique — prevents double-granting tokens if the
// client retries the validation request.

const purchaseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  productId: {
    type: String,
    required: true,
    enum: ['ml_token1', 'ml_2'],
  },
  platform: {
    type: String,
    required: true,
    enum: ['android', 'ios'],
  },
  transactionId: {
    type: String,
    required: true,
    unique: true,  // idempotency key
  },
  tokensGranted: {
    type: Number,
    required: true,
  },
  receiptData: {
    type: String,  // raw receipt / purchase token for audit
  },
  verifiedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('Purchase', purchaseSchema);
