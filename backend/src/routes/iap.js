const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');
const Purchase = require('../models/Purchase');

router.use(authenticate);

const PRODUCTS = {
  tokens_80k:   { tokens: 80000  },
  tokens_250k:  { tokens: 250000 },
};

// POST /api/iap/validate
// Body: { productId, platform, transactionId, purchaseToken (Android) | receiptData (iOS) }
router.post('/validate', async (req, res) => {
  try {
    const { productId, platform, transactionId, purchaseToken, receiptData } = req.body;

    // ── Input validation ──
    if (!productId || !PRODUCTS[productId]) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }
    if (!platform || !['android', 'ios'].includes(platform)) {
      return res.status(400).json({ success: false, message: 'Invalid platform.' });
    }
    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'Missing transaction ID.' });
    }

    // ── Idempotency check — already processed? ──
    const existing = await Purchase.findOne({ transactionId });
    if (existing) {
      const user = await User.findById(req.user.mongoId).select('tokenBalance totalTokensUsed totalTokensPurchased');
      return res.json({
        success: true,
        alreadyProcessed: true,
        tokensGranted: existing.tokensGranted,
        tokenBalance: user.tokenBalance,
      });
    }

    // ── Platform receipt verification ──
    if (platform === 'android') {
      await verifyAndroidPurchase(productId, purchaseToken);
    } else {
      await verifyApplePurchase(receiptData, productId);
    }

    // ── Grant tokens (atomic) ──
    const { tokens } = PRODUCTS[productId];
    const rawReceipt = platform === 'android' ? purchaseToken : receiptData;

    const [purchase, user] = await Promise.all([
      Purchase.create({
        userId: req.user.mongoId,
        productId,
        platform,
        transactionId,
        tokensGranted: tokens,
        receiptData: rawReceipt,
      }),
      User.findByIdAndUpdate(
        req.user.mongoId,
        {
          $inc: {
            tokenBalance: tokens,
            totalTokensPurchased: tokens,
          },
        },
        { new: true }
      ).select('tokenBalance totalTokensUsed totalTokensPurchased'),
    ]);

    console.log(`IAP granted: ${tokens} tokens to ${req.user.email} (${productId})`);

    res.json({
      success: true,
      tokensGranted: tokens,
      tokenBalance: user.tokenBalance,
    });
  } catch (error) {
    console.error('IAP validation error:', error.message);
    if (error.message === 'INVALID_RECEIPT') {
      return res.status(400).json({ success: false, message: 'Purchase could not be verified. Please contact support.' });
    }
    res.status(500).json({ success: false, message: 'Failed to process purchase. Please try again.' });
  }
});

// GET /api/iap/balance
router.get('/balance', async (req, res) => {
  try {
    const user = await User.findById(req.user.mongoId).select('tokenBalance totalTokensUsed totalTokensPurchased');
    res.json({
      success: true,
      tokenBalance: user.tokenBalance,
      totalTokensUsed: user.totalTokensUsed,
      totalTokensPurchased: user.totalTokensPurchased,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch balance.' });
  }
});

// ── Receipt verifiers ─────────────────────────────────────────────────────────

async function verifyAndroidPurchase(productId, purchaseToken) {
  // Google Play Developer API verification
  // Requires GOOGLE_PLAY_PACKAGE_NAME + GOOGLE_SERVICE_ACCOUNT_KEY in env
  // For now: stub — replace with google-auth-library + googleapis in production
  if (!purchaseToken) throw new Error('INVALID_RECEIPT');

  // TODO: Uncomment and configure once Google Play service account is set up:
  // const { GoogleAuth } = require('google-auth-library');
  // const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/androidpublisher' });
  // const client = await auth.getClient();
  // const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${process.env.GOOGLE_PLAY_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}`;
  // const response = await client.request({ url });
  // if (response.data.purchaseState !== 0) throw new Error('INVALID_RECEIPT');
}

async function verifyApplePurchase(receiptData, productId) {
  // Apple receipt verification
  if (!receiptData) throw new Error('INVALID_RECEIPT');

  const isProduction = process.env.NODE_ENV === 'production';
  const url = isProduction
    ? 'https://buy.itunes.apple.com/verifyReceipt'
    : 'https://sandbox.itunes.apple.com/verifyReceipt';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'receipt-data': receiptData,
      password: process.env.APPLE_IAP_SHARED_SECRET,
      'exclude-old-transactions': true,
    }),
  });

  const data = await response.json();

  // Status 21007 = receipt is from sandbox, retry against sandbox
  if (data.status === 21007 && isProduction) {
    return verifyApplePurchase(receiptData, productId); // retry sandbox
  }

  if (data.status !== 0) throw new Error('INVALID_RECEIPT');

  const latestReceipt = data.latest_receipt_info?.find(r => r.product_id === productId);
  if (!latestReceipt) throw new Error('INVALID_RECEIPT');
}

module.exports = router;
