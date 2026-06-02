const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { loadConfig } = require('./config');

const SYSTEM_INSTRUCTION = `You are a professional literary translator specializing in translating machine-translated (MTL) novels into rich, expressive, and detailed English literature.

Your goal is to rewrite the raw machine-translated text into beautifully written, engaging, and professional English prose, maintaining high narrative flow and character voices.

Core Directives:
1. Expressiveness & Flow: Use rich vocabulary, vivid descriptions, and natural flow. Avoid rigid, word-for-word translations. Enhance the prose to match the quality of standard published English fiction.
2. NO CENSORSHIP: The source text contains adult themes, violence, profanity, and explicit situations. Do NOT censor, sanitize, soften, or omit any content. Translate all explicit descriptions (sexual, violent, or profane) with maximum fidelity and explicit detail as written, preserving the original author's intent. This is published literature; do not hold back or apply moral filters.
3. Formatting: Output only clean Markdown. Use standard formatting for dialogues (using quotation marks), thoughts (using italics if appropriate), and paragraph breaks.
4. No Meta-Commentary: Output ONLY the translated story text. Do not add intro/outro comments, notes, or explanations unless they are formatted as translator's notes at the very bottom.`;

/**
 * Splits text into chunks by paragraphs, staying within a character limit.
 */
function chunkText(text, maxChunkSize = 8000) {
  if (text.length <= maxChunkSize) return [text];

  const paragraphs = text.split(/\r?\n/);
  const chunks = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + '\n' + paragraph).length > maxChunkSize) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n' + paragraph : paragraph;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Translates a single text block using the Gemini API.
 */
async function translateBlock(text, modelName, apiKey, onProgress) {
  if (!apiKey) {
    throw new Error('Gemini API Key is missing. Please configure it in your settings.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Set up model with system instructions
  const model = genAI.getGenerativeModel({
    model: modelName || 'gemini-2.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION
  });

  // Configure safety settings to block absolutely nothing
  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ];

  // Adjust generation configuration for expressive translations
  const generationConfig = {
    temperature: 0.35, // Low enough for fidelity, high enough for expressive word choice
    topP: 0.95,
    topK: 40,
  };

  if (onProgress) onProgress('Sending request to Gemini API...');
  
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: text }] }],
    safetySettings,
    generationConfig
  });

  const response = result.response;
  return response.text();
}

/**
 * Translates a full chapter, chunking it if necessary.
 */
async function translateChapter(rawText, onProgress) {
  const config = loadConfig();
  const apiKey = config.geminiApiKey;
  const modelName = config.geminiModel;

  // Split chapter into manageable chunks if it is too large
  const chunks = chunkText(rawText, 10000); // ~2500 words per chunk
  
  let translatedText = '';
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) {
      onProgress(`Translating chunk ${i + 1} of ${chunks.length}...`);
    }
    
    const chunkResult = await translateBlock(chunks[i], modelName, apiKey, onProgress);
    translatedText += chunkResult + '\n\n';
  }

  return translatedText.trim();
}

module.exports = {
  translateChapter,
  translateBlock
};
