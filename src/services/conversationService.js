const OpenAI = require('openai');
const FailureSignal = require('../models/FailureSignal');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 8-State Diagnosis Machine
 *
 * 1. INITIAL_ERROR_ANALYSIS - Analyze wrong answer pattern
 * 2. STUDENT_REASONING_EXTRACTION - "How did you get this answer?"
 * 3. MISCONCEPTION_TEST - Test specific hypothesis
 * 4. RULE_VERIFICATION - Confirm misconception with targeted question
 * 5. PREREQUISITE_CHECK - Test foundational knowledge (conditional)
 * 6. BOUNDARY_CASE_TEST - Test edges of misconception
 * 7. ROOT_CAUSE_CONFIRMATION - Synthesize complete diagnosis
 * 8. FAILURE_RECORDED - Store confirmed failure
 */

const STATE_TRANSITIONS = {
  INITIAL_ERROR_ANALYSIS: 'STUDENT_REASONING_EXTRACTION',
  STUDENT_REASONING_EXTRACTION: 'MISCONCEPTION_TEST',
  MISCONCEPTION_TEST: 'RULE_VERIFICATION',
  RULE_VERIFICATION: 'PREREQUISITE_CHECK', // or BOUNDARY_CASE_TEST
  PREREQUISITE_CHECK: 'BOUNDARY_CASE_TEST',
  BOUNDARY_CASE_TEST: 'ROOT_CAUSE_CONFIRMATION',
  ROOT_CAUSE_CONFIRMATION: 'FAILURE_RECORDED'
};

class ConversationService {
  /**
   * Process student message and return AI response
   */
  async processMessage(session, failureSignal, studentMessage) {
    try {
      // Add student message to probing history
      const currentState = failureSignal.currentState;

      // Build context from conversation history
      const conversationHistory = this.buildConversationHistory(session, failureSignal);

      // Generate AI response based on current state
      const aiResponse = await this.generateResponse(
        session,
        failureSignal,
        studentMessage,
        currentState,
        conversationHistory
      );

      // Update failure signal with probing entry
      await failureSignal.addProbingEntry(
        currentState,
        aiResponse.question || null,
        studentMessage,
        aiResponse.analysis
      );

      // Determine next state
      const nextState = this.determineNextState(currentState, aiResponse);

      // Update state
      if (nextState === 'FAILURE_RECORDED') {
        // Diagnosis complete
        await failureSignal.confirmFailure(
          aiResponse.rootCause,
          aiResponse.misconceptionDescription
        );
      } else {
        await failureSignal.updateState(nextState);
      }

      // Add to session conversation history
      await session.addConversationMessage('student', studentMessage, currentState);
      await session.addConversationMessage('ai', aiResponse.message, nextState);

      return {
        message: aiResponse.message,
        currentState: nextState,
        isComplete: nextState === 'FAILURE_RECORDED',
        analysis: aiResponse.analysis
      };
    } catch (error) {
      console.error('Conversation processing error:', error);
      throw new Error(`Failed to process message: ${error.message}`);
    }
  }

  /**
   * Start diagnosis conversation for a failure
   */
  async startDiagnosis(session, failureSignal) {
    const currentState = failureSignal.currentState;

    if (currentState === 'INITIAL_ERROR_ANALYSIS') {
      // Generate first question
      const response = await this.generateInitialQuestion(session, failureSignal);

      await failureSignal.updateState('STUDENT_REASONING_EXTRACTION');
      await session.addConversationMessage('ai', response.message, 'STUDENT_REASONING_EXTRACTION');

      return {
        message: response.message,
        currentState: 'STUDENT_REASONING_EXTRACTION',
        isComplete: false
      };
    }

    throw new Error('Diagnosis already started');
  }

  /**
   * Generate AI response based on state
   */
  async generateResponse(session, failureSignal, studentMessage, currentState, conversationHistory) {
    const prompt = this.buildStatePrompt(
      session,
      failureSignal,
      studentMessage,
      currentState,
      conversationHistory
    );

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: prompt
      }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  }

  /**
   * Generate initial question (state 1 → 2)
   */
  async generateInitialQuestion(session, failureSignal) {
    const evidence = failureSignal.evidence[0]; // Use first evidence

    const prompt = `You are diagnosing a learning issue for a ${session.learningScope.grade} student.

DETECTED FAILURE:
Category: ${failureSignal.category}
Issue: ${failureSignal.specificIssue}
Evidence: Question ${evidence.questionNumber} - Student answered "${evidence.studentAnswer}"

YOUR TASK (State: STUDENT_REASONING_EXTRACTION):
Ask the student to explain their thinking. Be specific about which question.

Return JSON:
{
  "message": "Your question to the student (conversational, friendly)",
  "analysis": "What you're trying to learn from this question"
}

Example:
{
  "message": "I noticed in Question 3, you got -2x - 6. Can you walk me through how you solved -2(x - 3)?",
  "analysis": "Trying to understand if student knows distribution steps or if sign error is systematic"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  }

  /**
   * Build state-specific prompt
   */
  buildStatePrompt(session, failureSignal, studentMessage, currentState, conversationHistory) {
    const baseContext = `You are diagnosing a learning issue for a ${session.learningScope.grade} student in ${session.learningScope.country} (${session.learningScope.curriculum} curriculum).

DETECTED FAILURE:
Category: ${failureSignal.category}
Issue: ${failureSignal.specificIssue}
Possible Misconception: ${failureSignal.misconceptionDescription || 'Unknown'}

CONVERSATION SO FAR:
${conversationHistory}

STUDENT'S LATEST RESPONSE: "${studentMessage}"

CURRENT STATE: ${currentState}`;

    const stateInstructions = {
      STUDENT_REASONING_EXTRACTION: `
Ask the student to explain their thinking on the error.
`,
      MISCONCEPTION_TEST: `
Based on their reasoning, test your hypothesis about their misconception.
Ask a targeted question to confirm or refute the hypothesis.
`,
      RULE_VERIFICATION: `
Ask a direct question to verify if they know the correct rule.
Example: "What's -3 × -4?" to test negative multiplication.
`,
      PREREQUISITE_CHECK: `
Test if they have the foundational knowledge needed.
Ask about prerequisites only if their errors suggest a gap.
If no prerequisite issue detected, skip to BOUNDARY_CASE_TEST.
`,
      BOUNDARY_CASE_TEST: `
Test edge cases to confirm the scope of their misconception.
Example: "What about -5 × 3?" to see if they handle negative×positive correctly.
`,
      ROOT_CAUSE_CONFIRMATION: `
Synthesize the diagnosis. Explain what you found.
This is your final message before recording the failure.
`
    };

    const instruction = stateInstructions[currentState] || 'Continue the conversation.';

    return `${baseContext}

YOUR TASK:
${instruction}

Return JSON:
{
  "message": "Your response to the student (conversational, encouraging)",
  "question": "Next question to ask (if any)" or null,
  "analysis": "Your internal analysis of their response",
  "rootCause": "Final diagnosis" or null (only for ROOT_CAUSE_CONFIRMATION),
  "misconceptionDescription": "Clear description" or null (only for ROOT_CAUSE_CONFIRMATION),
  "skipPrerequisiteCheck": true/false (only for RULE_VERIFICATION state)
}

IMPORTANT:
- Keep responses conversational and encouraging
- Ask only ONE question at a time
- Be specific and targeted
- If student clearly understands, move forward quickly
- If state is ROOT_CAUSE_CONFIRMATION, provide clear summary`;
  }

  /**
   * Determine next state based on AI response
   */
  determineNextState(currentState, aiResponse) {
    // Check for conditional skips
    if (currentState === 'RULE_VERIFICATION' && aiResponse.skipPrerequisiteCheck) {
      return 'BOUNDARY_CASE_TEST';
    }

    // Standard transition
    return STATE_TRANSITIONS[currentState] || currentState;
  }

  /**
   * Build conversation history for context
   */
  buildConversationHistory(session, failureSignal) {
    const history = failureSignal.probingHistory.map(entry => {
      return `[${entry.state}]\nQ: ${entry.question || 'N/A'}\nStudent: ${entry.studentResponse || 'N/A'}`;
    }).join('\n\n');

    return history || 'No conversation yet';
  }

  /**
   * Check if prerequisite probing needed
   */
  async checkPrerequisiteNeed(session, failureSignal, studentMessage) {
    const prompt = `Based on this student's response: "${studentMessage}"

For the failure: ${failureSignal.specificIssue}

Do they seem to lack foundational/prerequisite knowledge, or is it just a misconception about this specific topic?

Return JSON:
{
  "needsPrerequisiteCheck": true/false,
  "reason": "explanation"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  }
}

module.exports = new ConversationService();
