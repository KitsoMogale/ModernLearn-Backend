const Session = require('../models/Session');
const FailureSignal = require('../models/FailureSignal');
const diagnosticAnalysisService = require('../services/diagnosticAnalysisService');
const conversationService = require('../services/conversationService');

/**
 * POST /api/sessions/:id/analyze
 * Analyze session and detect failures
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

    // Check if already analyzed
    if (session.status !== 'extracted') {
      return res.status(400).json({
        success: false,
        message: 'Session must be in extracted state'
      });
    }

    // Run diagnostic analysis
    await session.updateStatus('analyzing');

    const analysis = await diagnosticAnalysisService.analyzeSession(session);

    // Update session
    session.detectedFailures = analysis.failureSignals.map(f => f._id);
    await session.updateStatus('diagnosing');

    // Start diagnosis for first failure
    if (analysis.failureSignals.length > 0) {
      const firstFailure = analysis.failureSignals[0];
      const initialMessage = await conversationService.startDiagnosis(session, firstFailure);

      await session.updateDiagnosisState('STUDENT_REASONING_EXTRACTION', 0);

      return res.json({
        success: true,
        failures: analysis.failureSignals,
        detectedConcepts: analysis.detectedConcepts,
        summary: analysis.summary,
        conversationStarted: true,
        initialMessage: initialMessage.message,
        currentFailureIndex: 0,
        totalFailures: analysis.failureSignals.length
      });
    }

    // No failures detected
    return res.json({
      success: true,
      failures: [],
      detectedConcepts: analysis.detectedConcepts,
      summary: 'Great work! No significant issues detected.',
      conversationStarted: false
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
 * POST /api/sessions/:id/conversation
 * Process conversation turn
 */
exports.processConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    const session = await Session.findById(id).populate('detectedFailures');
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

    // Get current failure being diagnosed
    const currentFailureIndex = session.currentFailureIndex || 0;
    const currentFailure = session.detectedFailures[currentFailureIndex];

    if (!currentFailure) {
      return res.status(400).json({
        success: false,
        message: 'No active failure to diagnose'
      });
    }

    // Process message
    const response = await conversationService.processMessage(
      session,
      currentFailure,
      message
    );

    // Check if current failure diagnosis is complete
    if (response.isComplete) {
      // Move to next failure or complete
      const nextFailureIndex = currentFailureIndex + 1;

      if (nextFailureIndex < session.detectedFailures.length) {
        // Start next failure diagnosis
        const nextFailure = session.detectedFailures[nextFailureIndex];
        const nextMessage = await conversationService.startDiagnosis(session, nextFailure);

        await session.updateDiagnosisState('STUDENT_REASONING_EXTRACTION', nextFailureIndex);

        return res.json({
          success: true,
          aiMessage: response.message,
          currentState: response.currentState,
          currentFailureIndex,
          currentFailureComplete: true,
          nextMessage: nextMessage.message,
          nextFailureIndex,
          totalFailures: session.detectedFailures.length,
          allFailuresConfirmed: false
        });
      } else {
        // All failures confirmed
        session.allFailuresConfirmed = true;
        await session.save();

        return res.json({
          success: true,
          aiMessage: response.message,
          currentState: response.currentState,
          currentFailureIndex,
          currentFailureComplete: true,
          allFailuresConfirmed: true,
          totalFailures: session.detectedFailures.length
        });
      }
    }

    // Continue current failure diagnosis
    return res.json({
      success: true,
      aiMessage: response.message,
      currentState: response.currentState,
      currentFailureIndex,
      totalFailures: session.detectedFailures.length,
      allFailuresConfirmed: false
    });
  } catch (error) {
    console.error('Conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process conversation',
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

    // Verify ownership
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
      totalFailures: failures.length,
      confirmedFailures: failures.filter(f => f.confirmedByProbing).length
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

/**
 * GET /api/sessions/:id/conversation-history
 * Get full conversation history
 */
exports.getConversationHistory = async (req, res) => {
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

    res.json({
      success: true,
      conversationHistory: session.conversationHistory,
      currentState: session.currentDiagnosisState,
      currentFailureIndex: session.currentFailureIndex
    });
  } catch (error) {
    console.error('Get conversation history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversation history',
      error: error.message
    });
  }
};
