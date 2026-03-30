const OpenAI = require('openai');
const FailureSignal = require('../models/FailureSignal');
const curriculumService = require('./curriculumService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class DiagnosticAnalysisService {
  /**
   * Analyze session questions and detect failures with full root cause diagnosis.
   * No conversation needed — produces confirmed failures in one pass.
   */
  async analyzeSession(session) {
    try {
      const { extractedQuestions, learningScope } = session;

      if (!extractedQuestions || extractedQuestions.length === 0) {
        throw new Error('No questions to analyze');
      }

      // Fetch structured curriculum context to ground the AI
      const conceptHints = curriculumService.extractConceptHints(extractedQuestions);
      const curriculumContext = await curriculumService.getDiagnosticContext(learningScope, conceptHints);

      const prompt = this.buildAnalysisPrompt(extractedQuestions, learningScope);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 12000,
        messages: [{
          role: 'system',
          content: this.buildSystemPrompt(learningScope, curriculumContext)
        }, {
          role: 'user',
          content: prompt
        }],
        response_format: { type: 'json_object' }
      });

      const analysisText = response.choices[0].message.content.trim();
      const analysis = JSON.parse(analysisText);

      // Create confirmed FailureSignal documents (no probing needed)
      const failureSignals = await this.createFailureSignals(session._id, analysis.failures);

      // Update session with analysis
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
   * System prompt that establishes the AI as a curriculum-aware examiner
   */
  buildSystemPrompt(learningScope, curriculumContext = null) {
    let prompt = `You are an expert educational diagnostician specializing in the ${learningScope.curriculum} curriculum for ${learningScope.grade} level in ${learningScope.country}.
${learningScope.subject ? `You are a subject specialist in ${learningScope.subject} at the ${learningScope.grade} level.` : ''}`;

    if (curriculumContext) {
      prompt += `\n\n${curriculumContext}

YOUR ANALYSIS PROCESS — follow this STRICTLY:

1. IDENTIFY: For each question, map it to a topic and subtopic from the TOPIC GRAPH above
2. COMPARE: Compare the student's steps against the EXPECTED STEPS listed for that subtopic
3. DETECT: Identify the root cause of each error — go deeper than "wrong answer"
4. Look for PATTERNS across questions that reveal underlying misconceptions

For CORRECT answers:
- Verify the student used an approved METHOD from the topic graph
- Check notation matches the NOTATION STANDARDS
- Flag if the correct answer was reached through flawed reasoning

IMPORTANT:
- Use the curriculum context above as GROUND TRUTH — do not guess curriculum-specific details
- Reference skill IDs (e.g., ALG-FAC-001) when identifying which skill is affected`;
    } else {
      prompt += `\n\nYOUR ANALYSIS APPROACH:
1. Determine the CORRECT answer for each question using ${learningScope.curriculum} methods
2. Compare the student's answer against curriculum expectations
3. Identify the ROOT CAUSE of each error — go deeper than "wrong answer"
4. Look for PATTERNS across questions that reveal underlying misconceptions
5. Check if correct answers were achieved through flawed reasoning
6. Identify PREREQUISITE GAPS from earlier grades
7. Distinguish between conceptual misunderstanding vs careless mistakes vs method errors`;
    }

    return prompt;
  }

  /**
   * Build the analysis prompt with questions and curriculum-aware instructions
   */
  buildAnalysisPrompt(questions, learningScope) {
    const questionsText = questions.map(q => {
      let text = `Question ${q.questionNumber}:
  Text: ${q.questionText}
  Student Answer: ${q.studentAnswer || '(No answer provided)'}`;

      if (q.structure?.hasMultipleChoice) text += '\n  Type: Multiple Choice';
      if (q.structure?.hasDiagram) text += '\n  Note: Contains diagram/visual';
      if (q.structure?.hasTable) text += '\n  Note: Contains table';
      if (q.structure?.hasEquations) text += '\n  Note: Contains equations';
      if (q.subQuestions?.length > 0) text += `\n  Sub-questions: ${q.subQuestions.join(', ')}`;

      return text;
    }).join('\n\n');

    return `STUDENT TEST ANALYSIS

LEARNING SCOPE:
- Grade: ${learningScope.grade}
- Curriculum: ${learningScope.curriculum}
- Country: ${learningScope.country}
${learningScope.subject ? `- Subject: ${learningScope.subject}` : ''}
${learningScope.topic ? `- Topic: ${learningScope.topic}` : ''}

QUESTIONS AND STUDENT ANSWERS:
${questionsText}

ANALYSIS INSTRUCTIONS:

For EACH question:
1. Work out the CORRECT answer using ${learningScope.curriculum}-approved methods for ${learningScope.grade}
2. Determine if the student's answer is correct, partially correct, or incorrect
3. If incorrect, determine exactly WHERE the student went wrong and WHY
4. Consider: did they use the right method? Is the notation correct for ${learningScope.curriculum}?

Then across ALL questions:
5. Identify PATTERNS — are multiple errors caused by the same misconception?
6. Group related errors into failures (max 2-5 failures, not one per question)
7. For each failure, determine the ROOT CAUSE with confidence
8. Check for PREREQUISITE GAPS from earlier grades
9. Flag any correct answers that show flawed reasoning

FAILURE CATEGORIES (use exactly):
1. conceptual-understanding — Doesn't understand the concept itself
2. rule-application — Knows the rule but applies it incorrectly
3. procedural-execution — Understands concept but makes execution errors
4. representation-interpretation — Can't interpret notation, diagrams, or graphs
5. problem-interpretation — Misreads or misunderstands the question
6. logical-reasoning — Makes illogical deductions or skips steps
7. quantitative-execution — Arithmetic/calculation errors
8. prerequisite-gap — Missing foundational knowledge from earlier levels
9. strategic-approach — Uses wrong problem-solving strategy entirely
10. careless-execution — Knows the material but makes careless slips

Return JSON:
{
  "failures": [
    {
      "category": "rule-application",
      "specificIssue": "Distributes the negative sign to the first term only, not both terms in the bracket",
      "rootCause": "Student treats the negative sign as only applying to the first term after the bracket, not understanding that distribution means multiplying EVERY term inside",
      "misconceptionDescription": "Believes -2(x - 3) means (-2)(x) - 3 instead of (-2)(x) + (-2)(-3)",
      "detectedConcepts": ["distribution", "negative multiplication", "brackets"],
      "skillIds": ["ALG-FAC-001"],
      "evidence": [
        {
          "questionNumber": "3",
          "studentAnswer": "-2x - 6",
          "correctAnswer": "-2x + 6",
          "expectedSteps": ["Identify common factor -2", "Distribute -2 to x: -2x", "Distribute -2 to -3: +6"],
          "studentSteps": ["Identified -2 as factor", "Got -2x correctly", "Wrote -6 instead of +6"],
          "reasoning": "Student correctly multiplied -2 × x = -2x but wrote -6 instead of +6, failing to apply sign rules to the second term"
        }
      ],
      "confidence": 0.9,
      "prerequisiteChain": {
        "currentTopic": "Algebraic distribution",
        "immediatePrerequisite": "Sign rules for multiplication",
        "gapLevel": null,
        "testedPrerequisites": ["negative number multiplication"]
      },
      "severity": "high",
      "affectedQuestions": ["3", "5a"]
    }
  ],
  "detectedConcepts": ["distribution", "negative multiplication", "like terms"],
  "questionAnalysis": [
    {
      "questionNumber": "1",
      "topic": "Algebra",
      "subtopic": "Factorisation",
      "skillId": "ALG-FAC-001",
      "isCorrect": true,
      "correctAnswer": "the correct answer",
      "conceptsTested": ["common factor", "difference of squares"],
      "notes": "Correct, method is sound"
    },
    {
      "questionNumber": "2",
      "topic": "Algebra",
      "subtopic": "Factorisation",
      "skillId": "ALG-FAC-001",
      "isCorrect": false,
      "correctAnswer": "the correct answer per ${learningScope.curriculum} standards",
      "conceptsTested": ["trinomial factorisation"],
      "notes": "What went wrong and why"
    }
  ],
  "summary": "Brief overall assessment of the student's performance, strengths, and key areas to work on"
}

IMPORTANT:
- Map EVERY question to a topic, subtopic, and skillId in questionAnalysis
- Compare student steps vs expected steps (from the topic graph) in evidence
- Provide the CORRECT ANSWER for every question
- Limit to 2-5 most significant failures that group related errors
- severity: "high" (fundamental gap), "medium" (specific misconception), "low" (careless)`;
  }

  /**
   * Create confirmed FailureSignal documents from analysis
   */
  async createFailureSignals(sessionId, failures) {
    const failureSignals = [];

    for (const failure of failures) {
      const signal = await FailureSignal.create({
        sessionId,
        category: failure.category,
        specificIssue: failure.specificIssue,
        rootCause: failure.rootCause,
        misconceptionDescription: failure.misconceptionDescription || null,
        detectedConcepts: failure.detectedConcepts || [],
        evidence: failure.evidence || [],
        confidence: failure.confidence || 0.8,
        confirmedByAnalysis: true,
        severity: failure.severity || 'medium',
        affectedQuestions: failure.affectedQuestions || [],
        prerequisiteChain: failure.prerequisiteChain || null
      });

      failureSignals.push(signal);
    }

    return failureSignals;
  }

  /**
   * Update session with analysis results
   */
  async updateSessionWithAnalysis(session, analysis) {
    // Update per-question analysis
    if (analysis.questionAnalysis) {
      for (const qa of analysis.questionAnalysis) {
        const question = session.extractedQuestions.find(
          q => q.questionNumber === qa.questionNumber
        );

        if (question) {
          question.correctAnswer = qa.correctAnswer || null;

          if (!question.aiAnalysis) {
            question.aiAnalysis = { detectedConcepts: [], detectedErrors: [], confidence: 1.0 };
          }

          question.aiAnalysis.detectedConcepts = qa.conceptsTested || [];
          question.aiAnalysis.isCorrect = qa.isCorrect;
        }
      }
    }

    // Update detected errors from failures
    if (analysis.failures) {
      for (const failure of analysis.failures) {
        for (const evidence of failure.evidence || []) {
          const question = session.extractedQuestions.find(
            q => q.questionNumber === evidence.questionNumber
          );

          if (question?.aiAnalysis) {
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
}

module.exports = new DiagnosticAnalysisService();
