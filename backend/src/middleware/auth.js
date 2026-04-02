const { verifyFirebaseToken } = require('../config/firebase');
const User = require('../models/User');

const TEMP_USER_UID = 'temp-dev-user';
const TEMP_USER_EMAIL = 'dev@modernlearn.local';
const TEMP_USER_NAME = 'Dev User';

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Allow temp user for development (no auth required)
    const useTempUser = !authHeader || authHeader === 'Bearer temp-token';

    let uid, email, name;

    if (useTempUser) {
      uid = TEMP_USER_UID;
      email = TEMP_USER_EMAIL;
      name = TEMP_USER_NAME;
    } else {
      const token = authHeader.split(' ')[1];
      const decodedToken = await verifyFirebaseToken(token);
      uid = decodedToken.uid;
      email = decodedToken.email;
      name = decodedToken.name;
    }

    // Find or create user (use findOneAndUpdate to combine find + lastLogin in one query)
    let user = await User.findOneAndUpdate(
      { firebaseUid: uid },
      { $set: { lastLoginAt: new Date() } },
      { new: true }
    );

    if (!user) {
      user = await User.create({
        firebaseUid: uid,
        email: email,
        displayName: name,
        lastLoginAt: new Date()
      });
    }

    // Attach user info to request
    req.user = {
      uid: uid,
      email: email,
      name: name,
      mongoId: user._id,
      defaultLearningScope: user.defaultLearningScope
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: { message: 'Unauthorized', status: 401 } });
  }
};

module.exports = { authenticate };
