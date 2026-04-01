const Session = require('../models/Session');
const FailureSignal = require('../models/FailureSignal');
const diagnosticAnalysisService = require('../services/diagnosticAnalysisService');

/**
 * POST /api/sessions/:id/analyze
 * Analyze session — produces confirmed failures with root causes in one pass.
 * Skips conversation/probing entirely.
 */
exports.analyzeSession = async (req, res) => {
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

    if (session.status !== 'extracted') {
      return res.status(400).json({
        success: false,
        message: 'Session must be in extracted state'
      });
    }

    await session.updateStatus('analyzing');

    const analysis = await diagnosticAnalysisService.analyzeSession(session);

    // Update session — failures are already confirmed
    session.detectedFailures = analysis.failureSignals.map(f => f._id);
    session.analysisSummary = analysis.summary;
    await session.updateStatus('analyzed');

    return res.json({
      success: true,
      failures: analysis.failureSignals,
      detectedConcepts: analysis.detectedConcepts,
      strengths: analysis.strengths || [],
      summary: analysis.summary,
      totalFailures: analysis.failureSignals.length
    });
  } catch (error) {
    console.error('Analyze session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze session',
      error: error.message
    });
  }
};

/**
 * GET /api/sessions/:id/failures
 * Get all detected failures for session
 */
exports.getFailures = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await Session.findById(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const failures = await FailureSignal.getBySession(id);

    res.json({
      success: true,
      failures,
      totalFailures: failures.length
    });
  } catch (error) {
    console.error('Get failures error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get failures',
      error: error.message
    });
  }
};
