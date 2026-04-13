const Session = require('../models/Session');
const RemediationUnit = require('../models/RemediationUnit');
const remediationGeneratorService = require('../services/remediationGeneratorService');

/**
 * POST /api/sessions/:id/generate-remediation
 * Generate remediation plan from confirmed failures
 */
exports.generateRemediation = async (req, res) => {
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

    // Check if session has been analyzed
    if (!['analyzed', 'remediation-generated'].includes(session.status)) {
      return res.status(400).json({
        success: false,
        message: 'Session must be analyzed before generating remediation'
      });
    }

    // Check if there are failures to remediate
    const FailureSignal = require('../models/FailureSignal');
    const failures = await FailureSignal.getConfirmed(session._id);

    if (!failures || failures.length === 0) {
      // No failures — student aced it
      await session.updateStatus('remediation-generated');
      return res.json({
        success: true,
        noFailures: true,
        remediationUnits: [],
        totalUnits: 0,
        totalEstimatedTime: 0,
        summary: session.analysisSummary || 'Great work! No issues found.'
      });
    }

    // Generate remediation plan
    await remediationGeneratorService.generateRemediationPlan(session);

    // Re-fetch with populated failureSignalId so frontend has evidence data
    const remediationUnits = await RemediationUnit.getBySession(session._id);

    res.json({
      success: true,
      noFailures: false,
      remediationUnits,
      totalUnits: remediationUnits.length,
      totalEstimatedTime: remediationUnits.reduce((sum, u) => sum + u.totalEstimatedTimeMinutes, 0)
    });
  } catch (error) {
    console.error('Generate remediation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate remediation',
      error: error.message
    });
  }
};

/**
 * GET /api/sessions/:id/remediation
 * Get remediation plan for session
 */
exports.getRemediation = async (req, res) => {
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

    const remediationUnits = await RemediationUnit.getBySession(id);

    res.json({
      success: true,
      remediationUnits,
      strengths: session.strengths || [],
      totalUnits: remediationUnits.length,
      totalEstimatedTime: remediationUnits.reduce((sum, u) => sum + u.totalEstimatedTimeMinutes, 0),
      overallProgress: remediationUnits.length > 0
        ? Math.round(remediationUnits.reduce((sum, u) => sum + u.progressPercentage, 0) / remediationUnits.length)
        : 0
    });
  } catch (error) {
    console.error('Get remediation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get remediation',
      error: error.message
    });
  }
};

/**
 * PATCH /api/remediation/:unitId/step/:stepNumber
 * Mark a learning step as complete
 */
exports.completeStep = async (req, res) => {
  try {
    const { unitId, stepNumber } = req.params;

    const unit = await RemediationUnit.findById(unitId);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Remediation unit not found'
      });
    }

    // Verify ownership via session
    const session = await Session.findById(unit.sessionId);
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await unit.completeStep(parseInt(stepNumber));
    await unit.populate('failureSignalId');

    res.json({
      success: true,
      unit,
      progressPercentage: unit.progressPercentage,
      status: unit.status
    });
  } catch (error) {
    console.error('Complete step error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete step',
      error: error.message
    });
  }
};

/**
 * POST /api/remediation/:unitId/problem/:problemNumber/submit
 * Submit answer for practice problem
 */
exports.submitProblemAnswer = async (req, res) => {
  try {
    const { unitId, problemNumber } = req.params;
    const { answer } = req.body;

    if (!answer) {
      return res.status(400).json({
        success: false,
        message: 'Answer is required'
      });
    }

    const unit = await RemediationUnit.findById(unitId);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Remediation unit not found'
      });
    }

    // Verify ownership
    const session = await Session.findById(unit.sessionId);
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const problem = unit.practiceProblems.find(p => p.problemNumber === parseInt(problemNumber));
    if (!problem) {
      return res.status(404).json({
        success: false,
        message: 'Problem not found'
      });
    }

    // Check answer with AI
    const result = await remediationGeneratorService.checkAnswer(problem, answer);

    // Update problem
    await unit.completeProblem(parseInt(problemNumber), answer, result.isCorrect, result.feedback);
    await unit.populate('failureSignalId');

    res.json({
      success: true,
      unit,
      isCorrect: result.isCorrect,
      feedback: result.feedback,
      partialCredit: result.partialCredit,
      progressPercentage: unit.progressPercentage,
      status: unit.status
    });
  } catch (error) {
    console.error('Submit problem answer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit answer',
      error: error.message
    });
  }
};

/**
 * POST /api/remediation/:unitId/problem/:problemNumber/hint
 * Get hint for practice problem
 */
exports.getProblemHint = async (req, res) => {
  try {
    const { unitId, problemNumber } = req.params;
    const { attemptNumber } = req.body;

    const unit = await RemediationUnit.findById(unitId);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Remediation unit not found'
      });
    }

    const problem = unit.practiceProblems.find(p => p.problemNumber === parseInt(problemNumber));
    if (!problem) {
      return res.status(404).json({
        success: false,
        message: 'Problem not found'
      });
    }

    const hintData = await remediationGeneratorService.getHint(problem, attemptNumber || 1);

    res.json({
      success: true,
      hint: hintData.hint
    });
  } catch (error) {
    console.error('Get problem hint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get hint',
      error: error.message
    });
  }
};

/**
 * PATCH /api/remediation/:unitId/success-check/:checkIndex
 * Verify a success check
 */
exports.verifySuccessCheck = async (req, res) => {
  try {
    const { unitId, checkIndex } = req.params;

    const unit = await RemediationUnit.findById(unitId);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Remediation unit not found'
      });
    }

    // Verify ownership
    const session = await Session.findById(unit.sessionId);
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await unit.verifySuccessCheck(parseInt(checkIndex));
    await unit.populate('failureSignalId');

    res.json({
      success: true,
      unit,
      progressPercentage: unit.progressPercentage,
      status: unit.status
    });
  } catch (error) {
    console.error('Verify success check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify success check',
      error: error.message
    });
  }
};

/**
 * PATCH /api/remediation/:unitId/checklist/:itemIndex
 * Toggle a self-review checklist item
 */
exports.toggleChecklistItem = async (req, res) => {
  try {
    const { unitId, itemIndex } = req.params;

    const unit = await RemediationUnit.findById(unitId);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Remediation unit not found'
      });
    }

    const session = await Session.findById(unit.sessionId);
    if (session.userId.toString() !== req.user.mongoId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await unit.toggleChecklistItem(parseInt(itemIndex));
    await unit.populate('failureSignalId');

    res.json({
      success: true,
      unit,
      progressPercentage: unit.progressPercentage,
      status: unit.status
    });
  } catch (error) {
    console.error('Toggle checklist item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle checklist item',
      error: error.message
    });
  }
};

/**
 * POST /api/remediation/:unitId/more-problems
 * Generate more practice problems
 */
exports.generateMoreProblems = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { count } = req.body;

    const unit = await RemediationUnit.findById(unitId);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Remediation unit not found'
      });
    }

    const newProblems = await remediationGeneratorService.generateMoreProblems(unit, count || 5);

    res.json({
      success: true,
      newProblems,
      totalProblems: unit.practiceProblems.length
    });
  } catch (error) {
    console.error('Generate more problems error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate more problems',
      error: error.message
    });
  }
};
