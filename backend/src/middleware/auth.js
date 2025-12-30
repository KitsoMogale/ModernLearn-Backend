const { verifyFirebaseToken } = require('../config/firebase');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'No token provided', status: 401 } });
    }

    const token = authHeader.split(' ')[1];
    const decodedToken = await verifyFirebaseToken(token);

    // Find or create user
    let user = await User.findOne({ firebaseUid: decodedToken.uid });

    if (!user) {
      user = await User.create({
        firebaseUid: decodedToken.uid,
        email: decodedToken.email,
        displayName: decodedToken.name,
        photoURL: decodedToken.picture,
        provider: decodedToken.firebase.sign_in_provider,
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: { message: 'Unauthorized', status: 401 } });
  }
};

module.exports = { authenticate };
