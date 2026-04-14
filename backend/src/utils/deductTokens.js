// deductTokens — atomically deducts actual OpenAI token usage from a user's balance.
// Called after every OpenAI API response that has usage data.
//
// Returns the updated tokenBalance (or null if userId not provided).

const User = require('../models/User');

/**
 * @param {string|ObjectId} userId  — MongoDB user _id
 * @param {number}          tokens  — actual tokens used (from response.usage.total_tokens)
 */
const deductTokens = async (userId, tokens) => {
  if (!userId || !tokens || tokens <= 0) return null;

  try {
    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          tokenBalance: -tokens,
          totalTokensUsed: tokens,
        },
      },
      { new: true }
    ).select('tokenBalance');

    // Clamp to 0 if we somehow went negative (e.g. concurrent requests)
    if (updated && updated.tokenBalance < 0) {
      await User.findByIdAndUpdate(userId, { $set: { tokenBalance: 0 } });
      return 0;
    }

    return updated?.tokenBalance ?? null;
  } catch (err) {
    // Non-fatal — log but don't break the user's session
    console.error('[deductTokens] error:', err.message);
    return null;
  }
};

module.exports = deductTokens;
