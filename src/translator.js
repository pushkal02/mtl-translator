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

const BACKUP_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-flash-latest'
];

let activeModelIndex = 0;
let activeModelName = null;

function getNextModel(failedModel) {
  if (!activeModelName || activeModelName === failedModel) {
    const currentIndex = BACKUP_MODELS.indexOf(failedModel);
    activeModelIndex = (currentIndex + 1) % BACKUP_MODELS.length;
    activeModelName = BACKUP_MODELS[activeModelIndex];
  }
  return activeModelName;
}

/**
 * Translates a single text block using the Gemini API, with automatic retry for 429 Rate Limits and self-healing model rotation.
 */
async function translateBlock(text, modelName, apiKey, onProgress, attempt = 1) {
  if (!apiKey) {
    throw new Error('Gemini API Key is missing. Please configure it in your settings.');
  }

  if (!activeModelName) {
    activeModelName = modelName || 'gemini-2.5-flash-lite';
  }

  const modelToUse = activeModelName;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Set up model with system instructions
    const model = genAI.getGenerativeModel({
      model: modelToUse,
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

    if (onProgress && attempt === 1) {
      onProgress(`Sending request to Gemini API (Model: ${modelToUse})...`);
    }
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: text }] }],
      safetySettings,
      generationConfig
    });

    const response = result.response;
    return response.text();
  } catch (err) {
    const isRateLimit = err.status === 429 || 
                        err.message.includes('429') || 
                        err.message.includes('Quota exceeded') || 
                        err.message.includes('Too Many Requests');

    if (isRateLimit) {
      // If we hit 429 twice in a row, rotate the model and retry
      if (attempt >= 2) {
        const nextModel = getNextModel(modelToUse);
        const rotationMsg = `🔄 Daily quota likely exhausted for model "${modelToUse}". Rotating to backup model "${nextModel}"...`;
        if (onProgress) {
          onProgress(rotationMsg);
        } else {
          console.log(rotationMsg);
        }
        
        // Brief pause to clear connections, then retry with the new model
        await new Promise(resolve => setTimeout(resolve, 5000));
        return translateBlock(text, modelName, apiKey, onProgress, 1);
      }

      const waitSec = 60;
      const progressMsg = `⚠️ Rate limit hit (429) for "${modelToUse}". Cooling down for ${waitSec}s before retry (Attempt ${attempt}/2)...`;
      if (onProgress) {
        onProgress(progressMsg);
      } else {
        console.log(progressMsg);
      }

      await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
      return translateBlock(text, modelName, apiKey, onProgress, attempt + 1);
    }
    throw err;
  }
}

/**
 * Translates a full chapter using paragraph-level chunking and a robust safety fallback mechanism.
 */
async function translateChapter(rawText, onProgress) {
  const config = loadConfig();
  const apiKey = config.geminiApiKey;
  const modelName = config.geminiModel;

  if (onProgress) {
    onProgress(`Translating entire chapter in one go...`);
  }

  try {
    const result = await translateBlock(rawText, modelName, apiKey, onProgress);
    return result.trim();
  } catch (err) {
    if (err.message.includes('PROHIBITED_CONTENT') || err.message.includes('blocked') || err.message.includes('Text not available')) {
      if (onProgress) {
        onProgress(`⚠️ Safety filter triggered on chapter. Retrying with moderated instructions...`);
      }
      
      // Cooldown slightly before retry
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
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
        
        const moderatedModel = genAI.getGenerativeModel({
          model: activeModelName || modelName || 'gemini-2.5-flash-lite',
          systemInstruction: `You are a professional literary translator. Translate this novel passage using safe, clean, compliant, and non-explicit vocabulary to describe the actions and dialogue. Avoid any graphic anatomy or descriptions of non-consensual force, while maintaining the plot and emotional tension. Output only translation.`
        });
        
        const modResult = await moderatedModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: rawText }] }],
          safetySettings
        });
        
        return modResult.response.text().trim();
      } catch (modErr) {
        if (onProgress) {
          onProgress(`  ❌ Hard block on chapter content.`);
        }
        throw new Error(`Chapter translation blocked by content safety policies: ${modErr.message}`);
      }
    } else {
      throw err;
    }
  }
}

module.exports = {
  translateChapter,
  translateBlock
};
