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
        model: 'gpt-4o',
        max_tokens: 4096,
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
              text: 'Extract all text from this test/exam image. Include:\n- Question numbers\n- Question text\n- Any diagrams or tables (describe them)\n- Student answers (handwritten or printed)\n- Multiple choice options if present\n\nReturn the raw extracted text exactly as it appears.'
            }
          ]
        }]
      });

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
        model: 'gpt-4o',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `You are analyzing a test/exam for a ${learningScope.grade} student in ${learningScope.country} following ${learningScope.curriculum} curriculum.${notationNote}

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
- Return ONLY valid JSON, no additional text`
        }],
        response_format: { type: 'json_object' }
      });

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
   * Complete OCR pipeline: Extract and process
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

    // Stage 8: Normalize
    return this.normalizeQuestions(allQuestions);
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
