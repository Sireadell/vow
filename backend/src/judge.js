import Anthropic from '@anthropic-ai/sdk';

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['success', 'reasoning'],
  additionalProperties: false,
};

// Deterministic fallback used when no ANTHROPIC_API_KEY is configured.
// Passes anything that looks like a real submission (non-trivial length,
// mentions something concrete) so local/dev testing doesn't require a key.
class StubJudge {
  async judge({ description, proofContent }) {
    const trimmed = (proofContent || '').trim();
    const success = trimmed.length >= 20;
    return {
      success,
      reasoning: success
        ? 'Stub judge: proof text is non-trivial, passing for local testing.'
        : 'Stub judge: proof text too short to look like a real submission.',
    };
  }
}

class AnthropicJudge {
  constructor() {
    this.client = new Anthropic();
  }

  async judge({ description, proofContent }) {
    const response = await this.client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: JUDGE_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `A person committed to: "${description}"\n\nThey submitted this as proof they completed it:\n\n${proofContent}\n\nDecide honestly whether this proof genuinely shows the commitment was met. Be skeptical of vague, generic, or unconvincing submissions. Real money is on the line for the person, so a wrong PASS is worse than a wrong FAIL when it's genuinely ambiguous.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return JSON.parse(textBlock.text);
  }
}

export function createJudge() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicJudge();
  }
  return new StubJudge();
}
