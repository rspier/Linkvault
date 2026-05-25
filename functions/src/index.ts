import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { GoogleGenAI } from '@google/genai';
import { defineSecret } from 'firebase-functions/params';

// Define the GEMINI_API_KEY secret which will be configured via Secret Manager in Firebase
const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const analyzeLink = onCall({ secrets: [geminiApiKey] }, async (request) => {
  // 1. Verify authentication
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  // 2. Validate parameters
  const url = request.data.url;
  if (!url || typeof url !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      'The function must be called with a string "url" argument.'
    );
  }

  const keyVal = geminiApiKey.value();
  if (!keyVal) {
    throw new HttpsError(
      'failed-precondition',
      'GEMINI_API_KEY secret is not configured in Firebase.'
    );
  }

  // 3. Initialize Gemini client
  const ai = new GoogleGenAI({
    apiKey: keyVal,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });

  try {
    console.log('Analyzing URL via Cloud Function:', url);

    // 4. Generate URL metadata
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Analyze this URL and provide metadata for a link-saving app.
URL: ${url}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'A concise, clear title for the link.' },
            description: { type: 'STRING', description: 'A search-friendly description (1-2 sentences).' },
            tags: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: '3-5 relevant tags for categorization.'
            }
          },
          required: ['title', 'description', 'tags']
        }
      }
    });

    const text = response.text || '{}';
    const analysis = JSON.parse(text);

    return {
      title: analysis.title || url,
      description: analysis.description || '',
      tags: analysis.tags || [],
      created_at: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    throw new HttpsError(
      'internal',
      error.message || 'Failed to analyze link using Gemini.'
    );
  }
});
