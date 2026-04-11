const { verifyFirebaseToken } = require('../config/firebase');
const User = require('../models/User');

// Real Firebase auth — every request must carry a valid ID token issued by
// the modernlearn26 Firebase project. Tokens are obtained by the mobile app
// via Google or Apple sign-in and refreshed automatically by the Firebase JS
// SDK on the client.
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Missing or malformed Authorization header', status: 401 } });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: { message: 'Empty bearer token', status: 401 } });
    }

    const decodedToken = await verifyFirebaseToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email || null;
    // Firebase puts the display name in `name` for some providers and in
    // `firebase.identities` for others — `name` is good enough as a default
    const name = decodedToken.name || decodedToken.firebase?.identities?.email?.[0] || null;

    // Find or create user (combine find + lastLogin update in one query)
    let user = await User.findOneAndUpdate(
      { firebaseUid: uid },
      { $set: { lastLoginAt: new Date() } },
      { new: true }
    );

    if (!user) {
      user = await User.create({
        firebaseUid: uid,
        email,
        displayName: name,
        lastLoginAt: new Date(),
      });
    }

    req.user = {
      uid,
      email,
      name,
      mongoId: user._id,
      defaultLearningScope: user.defaultLearningScope,
    };
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({ error: { message: 'Unauthorized', status: 401 } });
  }
};

module.exports = { authenticate };
