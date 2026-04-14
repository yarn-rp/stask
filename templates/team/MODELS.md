# Recommended Model Mapping

These are the optimal Ollama-based model assignments for each role. These choices balance reasoning depth, coding precision, and operational speed.

| Role | Recommended Model | Why This Model? |
|-------|-------------------|-----------------|
| **Lead** | `ollama/kimi-k2-thinking:cloud` | High reasoning capabilities, architectural planning, and complex task decomposition. |
| **Backend** | `ollama/qwen3-coder:480b-cloud` | State-of-the-art coding precision, strict type adherence, and system logic. |
| **Frontend** | `ollama/kimi-k2.5:cloud` | Strong balance of visual intuition, framework knowledge, and conversational clarity. |
| **QA** | `ollama/qwen3.5:cloud` | Extreme attention to detail, methodical verification, and high instruction following. |

## Model Fallbacks

If a primary model is unavailable or underperforming, use these as alternatives:
- **High Reasoning:** `ollama/kimi-k2-thinking:cloud`
- **Coding Heavy:** `ollama/qwen3-coder:480b-cloud`
- **General Purpose:** `ollama/qwen3.5:cloud` or `ollama/gemma4:31b-cloud`
- **Lightweight/Fast:** `ollama/qwen3.5:4b`