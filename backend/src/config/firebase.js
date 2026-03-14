const admin = require('firebase-admin');

let firebaseApp;

const initializeFirebase = () => {
  try {
    if (!firebaseApp) {
      // Initialize Firebase Admin SDK
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
      console.log('Firebase Admin initialized successfully');
    }
    return firebaseApp;
  } catch (error) {
    console.error('Error initializing Firebase:', error.message);
    // Don't exit process, allow server to run without Firebase for development
  }
};

const verifyFirebaseToken = async (token) => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

module.exports = {
  initializeFirebase,
  verifyFirebaseToken,
};
