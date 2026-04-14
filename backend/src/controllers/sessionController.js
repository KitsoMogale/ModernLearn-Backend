const Session = require('../models/Session');
const User = require('../models/User');
const ocrService = require('../services/ocrService');
const path = require('path');

/**
 * POST /api/sessions
 * Create new session
 */
exports.createSession = async (req, res) => {
  try {
    const { learningScope, title } = req.body;

    // Validate learningScope
    if (!learningScope || !learningScope.level || !learningScope.curriculum || !learningScope.country) {
      return res.status(400).json({
        success: false,
        message: 'Learning scope (level, curriculum, country) is required'
      });
    }

    // User already resolved by auth middleware
    const userId = req.user.mongoId;

    // Create session
    const session = await Session.create({
      userId,
      title: title || `Session ${new Date().toLocaleDateString()}`,
      learningScope,
      status: 'created'
    });

    // Add session to user (non-blocking — don't wait for it)
    User.findByIdAndUpdate(userId, { $push: { sessions: session._id } }).catch(() => {});

    res.status(201).json({
      success: true,
      session: {
        id: session._id,
        title: session.title,
        learningScope: session.learningScope,
        status: session.status,
        createdAt: session.createdAt
      }
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create session',
      error: error.message
    });
  }
};

/**
 * POST /api/sessions/:id/upload
 * Upload test images
 */
exports.uploadImages = async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    // Find session
    const session = await Session.findById(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Verify ownership
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Store uploaded images
    const uploadedImages = files.map((file, index) => ({
      url: `/uploads/${file.filename}`,
      pageNumber: session.uploadedImages.length + index + 1
    }));

    session.uploadedImages.push(...uploadedImages);
    await session.updateStatus('uploaded');

    res.json({
      success: true,
      images: uploadedImages,
      totalPages: session.uploadedImages.length
    });
  } catch (error) {
    console.error('Upload images error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload images',
      error: error.message
    });
  }
};

/**
 * POST /api/sessions/:id/extract
 * Extract questions from uploaded images using OCR
 */
exports.extractQuestions = async (req, res) => {
  try {
    const { id } = req.params;

    // Find session
    const session = await Session.findById(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Verify ownership
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Check if images uploaded
    if (!session.uploadedImages || session.uploadedImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    // Get image paths
    const imagePaths = session.uploadedImages.map(img => {
      return path.join(__dirname, '../../uploads', path.basename(img.url));
    });

    // Extract questions using OCR service
    const extractedQuestions = await ocrService.extractQuestions(
      imagePaths,
      session.learningScope,
      req.user.mongoId
    );

    // Update session
    session.extractedQuestions = extractedQuestions;
    await session.updateStatus('extracted');

    // Calculate metrics
    const overallConfidence = ocrService.calculateOverallConfidence(extractedQuestions);
    const lowConfidenceQuestions = ocrService.getLowConfidenceQuestions(extractedQuestions);

    res.json({
      success: true,
      questions: extractedQuestions,
      metrics: {
        totalQuestions: extractedQuestions.length,
        overallConfidence,
        lowConfidenceCount: lowConfidenceQuestions.length,
        needsReview: lowConfidenceQuestions.map(q => q.questionNumber)
      }
    });
  } catch (error) {
    console.error('Extract questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract questions',
      error: error.message
    });
  }
};

/**
 * PATCH /api/sessions/:id/questions
 * Update questions after user review
 */
exports.updateQuestions = async (req, res) => {
  try {
    const { id } = req.params;
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({
        success: false,
        message: 'Questions array is required'
      });
    }

    // Find session
    const session = await Session.findById(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Verify ownership
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Normalize and update questions
    session.extractedQuestions = ocrService.normalizeQuestions(questions);
    await session.save();

    res.json({
      success: true,
      questions: session.extractedQuestions
    });
  } catch (error) {
    console.error('Update questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update questions',
      error: error.message
    });
  }
};

/**
 * GET /api/sessions/:id
 * Get session details
 */
exports.getSession = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await Session.findById(id)
      .populate('detectedFailures')
      .populate('remediationPlan');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Verify ownership
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get session',
      error: error.message
    });
  }
};

/**
 * GET /api/sessions/user/all
 * Get all sessions for user (with counts for list rendering).
 * Optional ?status=in-progress|completed filter.
 */
exports.getUserSessions = async (req, res) => {
  try {
    const userId = req.user.mongoId;
    const { status } = req.query;

    const match = { userId };
    if (status === 'completed') {
      match.status = 'completed';
    } else if (status === 'in-progress') {
      match.status = { $ne: 'completed' };
    }

    const sessions = await Session.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $project: {
          title: 1,
          learningScope: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          pageCount: { $size: { $ifNull: ['$uploadedImages', []] } },
          failureCount: { $size: { $ifNull: ['$detectedFailures', []] } },
          remediationCount: { $size: { $ifNull: ['$remediationPlan', []] } },
        },
      },
    ]);

    // Aggregate returns _id; keep id convention consistent with other endpoints.
    const normalized = sessions.map((s) => ({
      id: s._id,
      title: s.title,
      learningScope: s.learningScope,
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      pageCount: s.pageCount,
      failureCount: s.failureCount,
      remediationCount: s.remediationCount,
    }));

    res.json({
      success: true,
      sessions: normalized,
    });
  } catch (error) {
    console.error('Get user sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get sessions',
      error: error.message
    });
  }
};

/**
 * DELETE /api/sessions/:id
 * Delete session
 */
exports.deleteSession = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await Session.findById(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Verify ownership
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await Session.deleteOne({ _id: id });

    res.json({
      success: true,
      message: 'Session deleted'
    });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete session',
      error: error.message
    });
  }
};
