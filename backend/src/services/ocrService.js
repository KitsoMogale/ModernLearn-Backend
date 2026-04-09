const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const curriculumService = require('./curriculumService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 9-Stage OCR Pipeline
 * 1. Image Upload (handled by controller)
 * 2. OCR Extraction
 * 3. Document Structure Detection
 * 4. Question Segmentation
 * 5. Answer Extraction
 * 6. Confidence Scoring
 * 7. User Review (handled by frontend)
 * 8. Normalization
 * 9. AI Analysis Prep (returns structured data)
 */

class OCRService {
  /**
   * Stage 2: OCR Extraction - Extract raw text from image
   */
  async extractRawText(imagePath) {
    try {
      const imageData = await fs.readFile(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = this.getMimeType(imagePath);

      const response = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        max_completion_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            },
            {
              type: 'text',
              text: 'Extract all text from this test/exam image. Include:\n- Question numbers\n- Question text\n- Any diagrams or tables (describe them)\n- Student answers (handwritten or printed)\n- Multiple choice options if present\n\nReturn the raw extracted text exactly as it appears.\n\nCRITICAL RULES:\n- ONLY extract text that is ACTUALLY VISIBLE in the image. Do NOT invent, guess, or generate any questions or answers.\n- If part of the image is unclear, blurry, or cut off, note it as "[unclear]" or "[cut off]" — do NOT fill in what you think it might say.\n- If no student answer is visible for a question, leave it blank — do NOT generate a sample answer.\n- If you cannot read something, say so. Never fabricate content to fill gaps.'
            }
          ]
        }]
      });

      const usage = response.usage;
      if (usage) {
        console.log(`  [tokens] OCR-extract: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`);
      }

      return response.choices[0].message.content;
    } catch (error) {
      console.error('OCR extraction error:', error);
      throw new Error(`OCR extraction failed: ${error.message}`);
    }
  }

  /**
   * Stage 3-6: Process extracted text into structured questions
   */
  async processExtractedText(rawText, learningScope) {
    try {
      // Fetch minimal curriculum context for notation awareness
      const ocrContext = await curriculumService.getOCRContext(learningScope);
      const notationNote = ocrContext
        ? `\n\nNOTATION CONTEXT FOR THIS CURRICULUM: ${ocrContext}`
        : '';

      const response = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        max_completion_tokens: 8192,
        messages: [{
          role: 'user',
          content: `You are analyzing a test/exam for a ${learningScope.level} student in ${learningScope.country} following ${learningScope.curriculum} curriculum.${notationNote}

RAW EXTRACTED TEXT:
${rawText}

Your task:
1. DOCUMENT STRUCTURE DETECTION: Identify the overall structure
2. QUESTION SEGMENTATION: Separate into individual questions
3. ANSWER EXTRACTION: Extract student answers
4. CONFIDENCE SCORING: Score extraction confidence (0-1)

Return a JSON object with this structure:
{
  "questions": [
    {
      "questionNumber": "1" or "3a" or "3b" etc,
      "questionText": "full question text",
      "studentAnswer": "student's answer",
      "correctAnswer": null,
      "parentQuestion": null or "3" (for sub-questions),
      "subQuestions": [] or ["3a", "3b"],
      "structure": {
        "hasMultipleChoice": boolean,
        "hasDiagram": boolean,
        "hasTable": boolean,
        "hasEquations": boolean,
        "questionHierarchy": "main" or "subpart"
      },
      "aiAnalysis": {
        "detectedConcepts": [],
        "detectedErrors": [],
        "confidence": 0.0-1.0
      },
      "confidence": 0.0-1.0,
      "userReviewed": false,
      "skipped": false
    }
  ]
}

IMPORTANT:
- Use "confidence" to indicate how certain you are about the extraction (0.0-1.0)
- Low confidence (<0.7) means unclear handwriting, ambiguous structure, or uncertain parsing
- Detect sub-questions (3a, 3b, 3c) and group them under parent question
- Mark hasMultipleChoice if options A, B, C, D are present
- Mark hasDiagram if there's a graph, chart, diagram, or visual element
- Mark hasTable if there's tabular data
- Mark hasEquations if mathematical expressions are present
- Leave detectedConcepts and detectedErrors empty for now (filled in analysis stage)
- Leave correctAnswer as null — do NOT fill it in or guess it
- Return ONLY valid JSON, no additional text

ABSOLUTELY DO NOT:
- Invent or generate questions that are not in the extracted text
- Fabricate or guess student answers — if no answer is visible, set studentAnswer to ""
- Create sample/example content to "fill in" missing data
- Add questions you think "should" be on the test
- Guess what cut-off or illegible text says — use "" and give low confidence instead
- You are an EXTRACTOR, not a GENERATOR. Only return what was actually in the image.

MATH/SCIENCE FORMATTING:
- Wrap ALL mathematical expressions, equations, formulae, and scientific notation in LaTeX $ delimiters
- Examples: $x^2 + 3x - 5 = 0$, $\\frac{1}{2}$, $\\sqrt{16}$, $2^3 = 8$, $\\sin(30°)$
- Use $...$ for inline math within question text and student answers
- This applies to question text, student answers, and any extracted working/steps
- Do NOT use $ delimiters for plain numbers (e.g. "Question 3" stays plain) — only for mathematical expressions
- For non-math subjects (languages, history, etc.), just use plain text`
        }],
        response_format: { type: 'json_object' }
      });

      const usage = response.usage;
      if (usage) {
        console.log(`  [tokens] OCR-process: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`);
      }

      const jsonText = response.choices[0].message.content.trim();
      const parsed = JSON.parse(jsonText);
      return parsed.questions;
    } catch (error) {
      console.error('Text processing error:', error);
      throw new Error(`Text processing failed: ${error.message}`);
    }
  }

  /**
   * Stage 8: Normalize questions after user review
   */
  normalizeQuestions(questions) {
    return questions.map(q => {
      // Trim whitespace
      q.questionText = q.questionText?.trim() || '';
      q.studentAnswer = q.studentAnswer?.trim() || '';
      q.correctAnswer = q.correctAnswer?.trim() || null;

      // Ensure structure exists
      if (!q.structure) {
        q.structure = {
          hasMultipleChoice: false,
          hasDiagram: false,
          hasTable: false,
          hasEquations: false,
          questionHierarchy: 'main'
        };
      }

      // Ensure aiAnalysis exists
      if (!q.aiAnalysis) {
        q.aiAnalysis = {
          detectedConcepts: [],
          detectedErrors: [],
          confidence: q.confidence || 1.0
        };
      }

      // Set defaults
      q.userReviewed = q.userReviewed !== undefined ? q.userReviewed : false;
      q.skipped = q.skipped !== undefined ? q.skipped : false;
      q.confidence = q.confidence !== undefined ? q.confidence : 1.0;

      return q;
    });
  }

  /**
   * Merge questions extracted from different pages.
   * Handles cases where questions and answers are on separate pages:
   * - Page 1 might have question text only (studentAnswer = "")
   * - Page 2 might have answers only (questionText = "")
   * - Or both pages have partial info for the same question number
   *
   * Matching is done by questionNumber — this is the anchor.
   */
  mergeQuestions(allQuestions) {
    const byNumber = new Map();

    for (const q of allQuestions) {
      const key = String(q.questionNumber).trim();
      if (!byNumber.has(key)) {
        byNumber.set(key, q);
        continue;
      }

      // Merge into existing entry
      const existing = byNumber.get(key);

      // questionText: prefer the longer / non-empty version
      if (!existing.questionText && q.questionText) {
        existing.questionText = q.questionText;
      } else if (q.questionText && q.questionText.length > (existing.questionText || '').length) {
        existing.questionText = q.questionText;
      }

      // studentAnswer: prefer the non-empty version
      if (!existing.studentAnswer && q.studentAnswer) {
        existing.studentAnswer = q.studentAnswer;
      } else if (q.studentAnswer && !existing.studentAnswer) {
        existing.studentAnswer = q.studentAnswer;
      }

      // structure: merge flags (if either page detected it, keep it)
      if (q.structure) {
        existing.structure = existing.structure || {};
        existing.structure.hasMultipleChoice = existing.structure.hasMultipleChoice || q.structure.hasMultipleChoice;
        existing.structure.hasDiagram = existing.structure.hasDiagram || q.structure.hasDiagram;
        existing.structure.hasTable = existing.structure.hasTable || q.structure.hasTable;
        existing.structure.hasEquations = existing.structure.hasEquations || q.structure.hasEquations;
      }

      // confidence: take the higher confidence
      if ((q.confidence || 0) > (existing.confidence || 0)) {
        existing.confidence = q.confidence;
      }

      // Track all pages this question appeared on
      if (q.pageNumber && existing.pageNumber !== q.pageNumber) {
        existing.sourcePages = existing.sourcePages || [existing.pageNumber];
        if (!existing.sourcePages.includes(q.pageNumber)) {
          existing.sourcePages.push(q.pageNumber);
        }
      }
    }

    // Sort by question number (natural sort: 1, 2, 3a, 3b, 10)
    return Array.from(byNumber.values()).sort((a, b) => {
      const aNum = parseInt(a.questionNumber) || 0;
      const bNum = parseInt(b.questionNumber) || 0;
      if (aNum !== bNum) return aNum - bNum;
      return String(a.questionNumber).localeCompare(String(b.questionNumber));
    });
  }

  /**
   * Complete OCR pipeline: Extract, merge across pages, and normalize
   */
  async extractQuestions(imagePaths, learningScope) {
    const allQuestions = [];

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];

      // Stage 2: Extract raw text
      const rawText = await this.extractRawText(imagePath);

      // Stages 3-6: Process into structured questions
      const questions = await this.processExtractedText(rawText, learningScope);

      // Add page information
      questions.forEach(q => {
        q.pageNumber = i + 1;
      });

      allQuestions.push(...questions);
    }

    // Stage 7: Merge questions across pages (handles separate question/answer sheets)
    const merged = this.mergeQuestions(allQuestions);

    // Stage 8: Normalize
    return this.normalizeQuestions(merged);
  }

  /**
   * Re-extract single question (if user wants to retry OCR for specific question)
   */
  async reExtractQuestion(imagePath, questionNumber, learningScope) {
    const rawText = await this.extractRawText(imagePath);
    const questions = await this.processExtractedText(rawText, learningScope);

    // Find the specific question
    const question = questions.find(q => q.questionNumber === questionNumber);
    if (!question) {
      throw new Error(`Question ${questionNumber} not found in re-extraction`);
    }

    return this.normalizeQuestions([question])[0];
  }

  /**
   * Helper: Get MIME type from file extension
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    return mimeTypes[ext] || 'image/jpeg';
  }

  /**
   * Calculate overall extraction confidence
   */
  calculateOverallConfidence(questions) {
    if (!questions || questions.length === 0) return 0;
    const sum = questions.reduce((acc, q) => acc + (q.confidence || 0), 0);
    return sum / questions.length;
  }

  /**
   * Get low confidence questions (need user review)
   */
  getLowConfidenceQuestions(questions, threshold = 0.7) {
    return questions.filter(q => (q.confidence || 0) < threshold);
  }
}

module.exports = new OCRService();
