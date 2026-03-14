# Setup AI Diagnosis - Quick Start

## 1. Install Dependencies

```bash
cd backend
npm install @anthropic-ai/sdk
```

## 2. Set Environment Variable

Add to your `.env` file (create if it doesn't exist):

```bash
# AI Diagnosis
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
```

Or export in your shell:

```bash
export ANTHROPIC_API_KEY=sk-ant-your-api-key-here
```

## 3. Start the Server

```bash
npm start
```

## 4. Test the AI Diagnosis

### Test with correct answer:
```bash
curl -X POST http://localhost:3000/api/diagnostic/test-user/questions/q_test/submit \
  -H "Content-Type: application/json" \
  -d '{
    "answer": "-2x + 6",
    "workShown": "Distributed -2 to both terms: -2×x = -2x and -2×(-3) = +6"
  }'
```

### Test with incorrect answer (sign error):
```bash
curl -X POST http://localhost:3000/api/diagnostic/test-user/questions/q_test/submit \
  -H "Content-Type: application/json" \
  -d '{
    "answer": "-2x - 6",
    "workShown": "I did -2 times x = -2x, then -2 times -3 = -6"
  }'
```

Expected: AI should detect `fs_intro_c1_n6_2` (Sign errors in distribution) with confidence ~0.95

## 5. Verify Response

You should see a response like:

```json
{
  "isCorrect": false,
  "feedback": "You made a sign error when multiplying -2 × (-3). Remember: negative times negative equals positive, so -2 × (-3) = +6, not -6.",
  "detectedFailures": [
    {
      "failureSignalId": "fs_intro_c1_n6_2",
      "confidence": 0.95,
      "evidence": "Student distributed correctly but computed -2 × (-3) = -6 instead of +6",
      "specificMistake": "Computed -2 × (-3) = -6",
      "understands": ["Distribution to both terms", "Multiplying -2 × x"],
      "misunderstands": ["Negative × negative = positive"]
    }
  ],
  "activatedFailures": [...],
  "nodeState": {...},
  "metadata": {
    "model": "claude-haiku-4-20250514",
    "tokensUsed": 450
  }
}
```

## Troubleshooting

### Error: "ANTHROPIC_API_KEY is not set"
- Make sure you added it to `.env` file
- Or export it in your current shell session
- Restart the server after adding

### Error: "Cannot find module '@anthropic-ai/sdk'"
- Run `npm install @anthropic-ai/sdk`
- Make sure you're in the `backend` directory

### Error: "AI diagnosis failed"
- Check your API key is valid
- Check your internet connection
- Check Anthropic API status
- Review server logs for detailed error

### Response: "No failure signals found"
- Make sure Cluster 1 failure signals are loaded in database
- Check that node and level IDs match the test data
- Run data seeding script if needed

## Next Steps

1. Create actual test questions in database
2. Test with various student answers
3. Monitor API costs (check Anthropic dashboard)
4. Review AI diagnoses for accuracy
5. Adjust prompts if needed for better results

## Cost Monitoring

- Check usage at: https://console.anthropic.com
- Typical cost: $0.01-0.02 per question (Haiku)
- For 1000 questions: ~$10-20
- Set up billing alerts if needed
