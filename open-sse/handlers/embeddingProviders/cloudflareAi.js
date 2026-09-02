// Cloudflare Workers AI — OpenAI-compatible embeddings under the account-scoped base
// https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/embeddings
import createOpenAIEmbeddingAdapter from './openai.js';

const baseAdapter = createOpenAIEmbeddingAdapter('cloudflare-ai');

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const accountId = creds?.providerSpecificData?.accountId;
    if (!accountId) throw new Error('cloudflare-ai requires accountId in providerSpecificData');
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/embeddings`;
  },
};
