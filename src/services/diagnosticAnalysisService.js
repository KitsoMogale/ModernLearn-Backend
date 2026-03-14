const OpenAI = require('openai');
const FailureSignal = require('../models/FailureSignal');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class DiagnosticAnalysisService {
  /**
   * Analyze session questions and detect failures
   * Analyzes BOTH wrong and correct answers for misconceptions
   */
  async analyzeSession(session) {
    try {
      const { extractedQuestions, learningScope } = session;

      if (!extractedQuestions || extractedQuestions.length === 0) {
        throw new Error('No questions to analyze');
      }

      // Build analysis prompt
      const prompt = this.buildAnalysisPrompt(extractedQuestions, learningScope);

      // Call OpenAI for analysis
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: prompt
        }],
        response_format: { type: 'json_object' }
      });

      const analysisText = response.choices[0].message.content.trim();
      const analysis = JSON.parse(analysisText);

      // Create FailureSignal documents
      const failureSignals = await this.createFailureSignals(session._id, analysis.failures);

      // Update session with detected concepts
      await this.updateSessionWithAnalysis(session, analysis);

      return {
        failureSignals,
        detectedConcepts: analysis.detectedConcepts || [],
        summary: analysis.summary || ''
      };
    } catch (error) {
      console.error('Diagnostic analysis error:', error);
      throw new Error(`Diagnostic analysis failed: ${error.message}`);
    }
  }

  /**
   * Build comprehensive analysis prompt
   */
  buildAnalysisPrompt(questions, learningScope) {
    const questionsText = questions.map((q, i) => {
      return `
Question ${q.questionNumber}:
- Text: ${q.questionText}
- Student Answer: ${q.studentAnswer || '(No answer)'}
- Structure: ${JSON.stringify(q.structure || {})}
- Detected Concepts: ${(q.aiAnalysis?.detectedConcepts || []).join(', ') || 'None'}
      `.trim();
    }).join('\n\n');

    return `You are analyzing a test/exam for a ${learningScope.grade} student in ${learningScope.country} following ${learningScope.curriculum} curriculum.
${learningScope.subject ? `Subject: ${learningScope.subject}` : ''}
${learningScope.topic ? `Topic: ${learningScope.topic}` : ''}

QUESTIONS AND STUDENT ANSWERS:
${questionsText}

YOUR TASK:
1. Analyze ALL answers (wrong AND correct)
2. Detect patterns and misconceptions
3. Identify specific failures using the 10 categories below
4. Detect concepts being tested
5. Flag possible misconceptions even in correct answers

FAILURE CATEGORIES (use these exactly):
1. conceptual-understanding - Doesn't understand the concept
2. rule-application - Knows rule but applies incorrectly
3. procedural-execution - Understands but executes wrong
4. representation-interpretation - Can't interpret notation/diagrams
5. problem-interpretation - Misunderstands the question
6. logical-reasoning - Makes illogical leaps
7. quantitative-execution - Arithmetic/calculation errors
8. prerequisite-gap - Missing foundational knowledge
9. strategic-approach - Wrong problem-solving strategy
10. careless-execution - Knows it but makes careless mistakes

IMPORTANT ANALYSIS GUIDELINES:
- Look for PATTERNS across multiple questions
- A single error might indicate a deeper misconception
- Correct answers with flawed reasoning should be flagged
- Consider grade-level expectations for ${learningScope.grade}
- Consider curriculum standards for ${learningScope.curriculum}
- Limit to 2-4 most significant failures (not every small error)

Return valid JSON in this format:
{
  "failures": [
    {
      "category": "rule-application",
      "specificIssue": "Applying incorrect sign rule when multiplying negatives",
      "detectedConcepts": ["negative multiplication", "distribution"],
      "evidence": [
        {
          "questionNumber": "3",
          "studentAnswer": "-2x - 6",
          "correctAnswer": "-2x + 6",
          "reasoning": "Used negative × negative = negative instead of positive"
        }
      ],
      "confidence": 0.85,
      "possibleMisconception": "Believes negative × negative = negative",
      "needsProbing": true
    }
  ],
  "detectedConcepts": ["distribution", "negative multiplication", "like terms", "algebraic expressions"],
  "summary": "Student shows strong algebra skills but has consistent sign rule error with negative multiplication"
}`;
  }

  /**
   * Create FailureSignal documents from analysis
   */
  async createFailureSignals(sessionId, failures) {
    const failureSignals = [];

    for (const failure of failures) {
      const signal = await FailureSignal.create({
        sessionId,
        category: failure.category,
        specificIssue: failure.specificIssue,
        detectedConcepts: failure.detectedConcepts || [],
        evidence: failure.evidence || [],
        confidence: failure.confidence || 0.5,
        misconceptionDescription: failure.possibleMisconception || null,
        currentState: 'INITIAL_ERROR_ANALYSIS'
      });

      failureSignals.push(signal);
    }

    return failureSignals;
  }

  /**
   * Update session with analysis results
   */
  async updateSessionWithAnalysis(session, analysis) {
    // Update detected concepts in questions
    if (analysis.failures) {
      for (const failure of analysis.failures) {
        for (const evidence of failure.evidence || []) {
          const question = session.extractedQuestions.find(
            q => q.questionNumber === evidence.questionNumber
          );

          if (question && question.aiAnalysis) {
            // Add detected concepts
            const newConcepts = failure.detectedConcepts || [];
            question.aiAnalysis.detectedConcepts = [
              ...new Set([...(question.aiAnalysis.detectedConcepts || []), ...newConcepts])
            ];

            // Add detected error
            if (!question.aiAnalysis.detectedErrors) {
              question.aiAnalysis.detectedErrors = [];
            }

            question.aiAnalysis.detectedErrors.push({
              type: failure.category,
              description: failure.specificIssue
            });
          }
        }
      }
    }

    await session.save();
  }

  /**
   * Re-analyze specific question (if user requests)
   */
  async reAnalyzeQuestion(session, questionNumber) {
    const question = session.extractedQuestions.find(q => q.questionNumber === questionNumber);

    if (!question) {
      throw new Error(`Question ${questionNumber} not found`);
    }

    const prompt = `Analyze this single question for a ${session.learningScope.grade} student:

Question: ${question.questionText}
Student Answer: ${question.studentAnswer || '(No answer)'}

Identify:
1. Is the answer correct or incorrect?
2. What concepts are being tested?
3. If incorrect, what type of error? (use the 10 failure categories)
4. What is the likely misconception?

Return JSON:
{
  "isCorrect": boolean,
  "concepts": ["concept1", "concept2"],
  "errorType": "category-name" or null,
  "misconception": "description" or null
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  }
}

module.exports = new DiagnosticAnalysisService();
