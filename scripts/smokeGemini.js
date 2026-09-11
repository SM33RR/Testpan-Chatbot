import { GoogleGenerativeAI } from '@google/generative-ai';
import { processAIQuery } from '../handlers/aiHandler.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY missing');
  process.exit(1);
}

const modelId = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const probeApi = process.env.SMOKE_PROBE === '1';

if (probeApi) {
  const genAI = new GoogleGenerativeAI(apiKey);
  async function probe(label, generationConfig) {
    const model = genAI.getGenerativeModel({
      model: modelId,
      ...(generationConfig ? { generationConfig } : {})
    });
    try {
      const result = await model.generateContent('Reply with the single word: pong');
      const text = result.response.text().trim();
      console.log(`[OK] ${label} -> ${text.slice(0, 80)}`);
      return true;
    } catch (error) {
      console.log(`[FAIL] ${label} -> ${error.status || ''} ${error.message}`);
      return false;
    }
  }

  await probe('thinkingLevel=minimal', { thinkingConfig: { thinkingLevel: 'minimal' } });
  await probe('thinkingLevel=low', { thinkingConfig: { thinkingLevel: 'low' } });
  await probe('no thinkingConfig', undefined);
}

const ai = await processAIQuery('Who is the CEO of Testpan India?', 'testpan');
if (!ai.success) {
  console.error('[FAIL] processAIQuery:', ai.response);
  process.exit(1);
}

// The AI handler now returns a complete text response, not a stream.
// This test verifies the successful return and content.
console.log(`[OK] processAIQuery (source: ${ai.source}): ${(ai.text || '').slice(0, 200).replace(/\s+/g, ' ')}...`);
if (ai.source === 'fastpath' && !/rajesh setia/i.test(ai.text || '')) {
  console.error('[FAIL] CEO fast-path query did not return the expected answer about Rajesh Setia.');
  process.exit(1);
}
