const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig } = require('../config');
const { scanNovels, updateSource } = require('../sourceManager');
const { translateChapter } = require('../translator');
const { scrapeNovelIndex, scrapeChapterContent } = require('../scraper');

const app = express();
const config = loadConfig();
const PORT = config.port || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve static UI files
app.use(express.static(path.join(__dirname, 'public')));

// Global state for tracking translation progress
let activeTranslation = {
  isRunning: false,
  shouldAbort: false,
  novelName: '',
  totalChapters: 0,
  currentChapterIndex: 0,
  currentChapterName: '',
  logs: []
};

// SSE Client connections
let sseClients = [];

function sendSSEEvent(type, data) {
  const payload = JSON.stringify({ type, data });
  sseClients.forEach(client => {
    client.res.write(`data: ${payload}\n\n`);
  });
}

function logAndBroadcast(message) {
  const timestamp = new Date().toLocaleTimeString();
  const logLine = `[${timestamp}] ${message}`;
  activeTranslation.logs.push(logLine);
  if (activeTranslation.logs.length > 500) {
    activeTranslation.logs.shift(); // Cap logs buffer
  }
  sendSSEEvent('log', logLine);
  console.log(logLine);
}

// REST API Endpoints

// 1. Get current configuration
app.get('/api/config', (req, res) => {
  const currentConfig = loadConfig();
  // Return configuration (API key partially obfuscated for security)
  const obfuscatedKey = currentConfig.geminiApiKey 
    ? `${currentConfig.geminiApiKey.substring(0, 6)}...${currentConfig.geminiApiKey.substring(currentConfig.geminiApiKey.length - 4)}` 
    : '';
  
  res.json({
    geminiModel: currentConfig.geminiModel,
    port: currentConfig.port,
    sourcePath: currentConfig.sourcePath,
    targetPath: currentConfig.targetPath,
    hasApiKey: !!currentConfig.geminiApiKey,
    obfuscatedApiKey: obfuscatedKey
  });
});

// 2. Save configuration
app.post('/api/config', (req, res) => {
  try {
    const { geminiApiKey, geminiModel, sourcePath, targetPath } = req.body;
    const updateObj = {};
    
    // Only update API key if a new one (not obfuscated placeholders) is provided
    if (geminiApiKey && !geminiApiKey.includes('...')) {
      updateObj.geminiApiKey = geminiApiKey;
    }
    if (geminiModel) updateObj.geminiModel = geminiModel;
    if (sourcePath) updateObj.sourcePath = sourcePath;
    if (targetPath) updateObj.targetPath = targetPath;

    const newConfig = saveConfig(updateObj);
    logAndBroadcast('Configuration updated.');
    res.json({ success: true, config: newConfig });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Scan & list all novels
app.get('/api/novels', (req, res) => {
  try {
    const novels = scanNovels();
    res.json({ success: true, novels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update the source (local folder path or remote Git repository link)
app.post('/api/source/update', async (req, res) => {
  try {
    const { sourceUrlOrPath } = req.body;
    if (!sourceUrlOrPath) {
      return res.status(400).json({ success: false, error: 'Source URL or path is required' });
    }
    logAndBroadcast(`Updating novel source to: ${sourceUrlOrPath}`);
    const result = await updateSource(sourceUrlOrPath);
    logAndBroadcast(`Source updated successfully (${result.mode} mode). Path: ${result.path}`);
    res.json({ success: true, result });
  } catch (err) {
    logAndBroadcast(`Error updating source: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Get side-by-side reader content
app.get('/api/chapter', (req, res) => {
  const { novelName, chapterName } = req.query;
  if (!novelName || !chapterName) {
    return res.status(400).json({ error: 'novelName and chapterName are required' });
  }

  const currentConfig = loadConfig();
  
  // Find raw file
  const novelSourceDir = path.join(currentConfig.resolvedSourcePath, novelName);
  let rawContent = 'Raw file not found.';
  let fileExtension = '';

  if (fs.existsSync(novelSourceDir)) {
    const files = fs.readdirSync(novelSourceDir);
    const rawFile = files.find(f => path.basename(f, path.extname(f)) === chapterName);
    if (rawFile) {
      rawContent = fs.readFileSync(path.join(novelSourceDir, rawFile), 'utf8');
      fileExtension = path.extname(rawFile);
    }
  }

  // Find translated markdown file
  const translatedFile = path.join(currentConfig.resolvedTargetPath, novelName, `${chapterName}.md`);
  let translatedContent = 'Not translated yet.';
  if (fs.existsSync(translatedFile)) {
    translatedContent = fs.readFileSync(translatedFile, 'utf8');
  }

  res.json({
    novelName,
    chapterName,
    rawContent,
    fileExtension,
    translatedContent
  });
});

// 6. Connect to Realtime Event Stream (SSE)
app.get('/api/translate/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  sseClients.push({ id: clientId, res });

  // Send initial state
  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });

  // Welcome event containing initial progress stats
  const payload = JSON.stringify({ type: 'init', data: activeTranslation });
  res.write(`data: ${payload}\n\n`);
});

// 7. Start translation task
app.post('/api/translate/start', async (req, res) => {
  const { novelName, forceAll = false, selectedChapters = null } = req.body;
  
  if (!novelName) {
    return res.status(400).json({ success: false, error: 'novelName is required' });
  }

  if (activeTranslation.isRunning) {
    return res.status(400).json({ success: false, error: 'A translation is already running.' });
  }

  const novels = scanNovels();
  const novel = novels.find(n => n.name === novelName);
  
  if (!novel) {
    return res.status(404).json({ success: false, error: `Novel '${novelName}' not found.` });
  }

  // Filter chapters to process
  let chaptersToTranslate = [];
  if (selectedChapters && Array.isArray(selectedChapters)) {
    chaptersToTranslate = novel.chapters.filter(c => selectedChapters.includes(c.chapterName));
  } else {
    // Translate all or only untranslated ones
    chaptersToTranslate = forceAll ? novel.chapters : novel.chapters.filter(c => !c.isTranslated);
  }

  if (chaptersToTranslate.length === 0) {
    return res.json({ success: true, message: 'All selected chapters are already translated.' });
  }

  // Set active translation state
  activeTranslation.isRunning = true;
  activeTranslation.shouldAbort = false;
  activeTranslation.novelName = novelName;
  activeTranslation.totalChapters = chaptersToTranslate.length;
  activeTranslation.currentChapterIndex = 0;
  activeTranslation.currentChapterName = '';
  activeTranslation.logs = [];

  sendSSEEvent('start', activeTranslation);
  logAndBroadcast(`Starting translation for novel: "${novelName}" (${chaptersToTranslate.length} chapters)...`);

  // Run translation loop in background
  runTranslationQueue(chaptersToTranslate, novelName);

  res.json({ success: true, message: 'Translation queued.' });
});

// 8. Stop active translation
app.post('/api/translate/stop', (req, res) => {
  if (!activeTranslation.isRunning) {
    return res.json({ success: true, message: 'No translation running.' });
  }
  
  activeTranslation.shouldAbort = true;
  logAndBroadcast('Abort signal received. Finishing current chapter translation and stopping...');
  res.json({ success: true, message: 'Stop signal sent.' });
});

// Helper background loop
async function runTranslationQueue(chapters, novelName) {
  const config = loadConfig();
  const targetDir = config.resolvedTargetPath;

  try {
    for (let i = 0; i < chapters.length; i++) {
      if (activeTranslation.shouldAbort) {
        logAndBroadcast('Translation stopped by user.');
        break;
      }

      const chapter = chapters[i];
      activeTranslation.currentChapterIndex = i + 1;
      activeTranslation.currentChapterName = chapter.chapterName;
      
      sendSSEEvent('progress', {
        currentChapterIndex: i + 1,
        currentChapterName: chapter.chapterName,
        percentage: Math.round(((i) / chapters.length) * 100)
      });

      logAndBroadcast(`[${i + 1}/${chapters.length}] Translating: ${chapter.chapterName}...`);

      try {
        const rawText = fs.readFileSync(chapter.sourcePath, 'utf8');
        
        if (!rawText.trim()) {
          logAndBroadcast(`Warning: Chapter ${chapter.chapterName} is empty. Skipping.`);
          continue;
        }

        // Call Gemini Translation
        const translatedContent = await translateChapter(rawText, (msg) => {
          logAndBroadcast(`  └ ${msg}`);
        });

        // Ensure target directory exists for this novel
        const novelTargetDir = path.join(targetDir, novelName);
        if (!fs.existsSync(novelTargetDir)) {
          fs.mkdirSync(novelTargetDir, { recursive: true });
        }

        // Save translated markdown
        const mdOutput = `# ${chapter.chapterName}\n\n${translatedContent}`;
        fs.writeFileSync(chapter.targetPath, mdOutput, 'utf8');

        logAndBroadcast(`✓ Chapter "${chapter.chapterName}" successfully translated and saved.`);
      } catch (err) {
        logAndBroadcast(`❌ Error translating Chapter "${chapter.chapterName}": ${err.message}`);
        console.error(err);
      }
    }
    
    logAndBroadcast('Translation batch process complete!');
  } catch (globalErr) {
    logAndBroadcast(`❌ Unexpected translation queue failure: ${globalErr.message}`);
  } finally {
    activeTranslation.isRunning = false;
    activeTranslation.shouldAbort = false;
    activeTranslation.currentChapterName = '';
    sendSSEEvent('finish', activeTranslation);
  }
}

// 9. Scrape novel index links
app.post('/api/scrape/index', async (req, res) => {
  const { indexUrl } = req.body;
  if (!indexUrl) {
    return res.status(400).json({ success: false, error: 'indexUrl is required' });
  }

  logAndBroadcast(`Scanning web novel index URL: ${indexUrl}`);
  try {
    const result = await scrapeNovelIndex(indexUrl, (msg) => logAndBroadcast(msg));
    res.json({ success: true, ...result });
  } catch (err) {
    logAndBroadcast(`❌ Scrape Index Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Start web scrape & translation task
app.post('/api/scrape/translate', async (req, res) => {
  const { indexUrl, novelName, chapters, selectors } = req.body;

  if (!indexUrl || !novelName || !chapters || !selectors) {
    return res.status(400).json({ success: false, error: 'indexUrl, novelName, chapters, and selectors are required' });
  }

  if (activeTranslation.isRunning) {
    return res.status(400).json({ success: false, error: 'A translation is already running.' });
  }

  activeTranslation.isRunning = true;
  activeTranslation.shouldAbort = false;
  activeTranslation.novelName = novelName;
  activeTranslation.totalChapters = chapters.length;
  activeTranslation.currentChapterIndex = 0;
  activeTranslation.currentChapterName = '';
  activeTranslation.logs = [];

  sendSSEEvent('start', activeTranslation);
  logAndBroadcast(`Starting web scrape + translate for: "${novelName}" (${chapters.length} chapters)...`);

  runWebScrapeTranslationQueue(chapters, novelName, selectors);

  res.json({ success: true, message: 'Web scraping and translation queued.' });
});

// Helper background loop for scraping web pages & translating them
async function runWebScrapeTranslationQueue(chapters, novelName, selectors) {
  const config = loadConfig();
  const targetDir = config.resolvedTargetPath;

  try {
    for (let i = 0; i < chapters.length; i++) {
      if (activeTranslation.shouldAbort) {
        logAndBroadcast('Translation stopped by user.');
        break;
      }

      const chapter = chapters[i];
      activeTranslation.currentChapterIndex = i + 1;
      activeTranslation.currentChapterName = chapter.chapterName;

      sendSSEEvent('progress', {
        currentChapterIndex: i + 1,
        currentChapterName: chapter.chapterName,
        percentage: Math.round(((i) / chapters.length) * 100)
      });

      logAndBroadcast(`[${i + 1}/${chapters.length}] Scraping & Translating: ${chapter.chapterName}...`);

      try {
        logAndBroadcast(`  └ Scraping HTML content from ${chapter.chapterUrl}...`);
        const { title, rawText } = await scrapeChapterContent(chapter.chapterUrl, selectors);

        if (!rawText || !rawText.trim()) {
          logAndBroadcast(`Warning: Chapter page is empty or content selector failed. Skipping.`);
          continue;
        }

        logAndBroadcast(`  └ Successfully scraped raw text (${rawText.length} characters).`);

        // Call Gemini Translation
        const translatedContent = await translateChapter(rawText, (msg) => {
          logAndBroadcast(`  └ ${msg}`);
        });

        // Ensure target directory exists for this novel
        const novelTargetDir = path.join(targetDir, novelName);
        if (!fs.existsSync(novelTargetDir)) {
          fs.mkdirSync(novelTargetDir, { recursive: true });
        }

        // Save translated markdown (sanitize filename)
        const safeChapterName = chapter.chapterName.replace(/[\\\/:\*\?"<>\|]/g, '_').trim();
        const chapterFilePath = path.join(novelTargetDir, `${safeChapterName}.md`);
        
        const mdOutput = `# ${chapter.chapterName}\n\n${translatedContent}`;
        fs.writeFileSync(chapterFilePath, mdOutput, 'utf8');

        logAndBroadcast(`✓ Chapter "${chapter.chapterName}" successfully translated and saved.`);
      } catch (err) {
        logAndBroadcast(`❌ Error translating Chapter "${chapter.chapterName}": ${err.message}`);
        console.error(err);
      }
    }

    logAndBroadcast('Scraping and translation batch process complete!');
  } catch (globalErr) {
    logAndBroadcast(`❌ Unexpected scraper/translator queue failure: ${globalErr.message}`);
  } finally {
    activeTranslation.isRunning = false;
    activeTranslation.shouldAbort = false;
    activeTranslation.currentChapterName = '';
    sendSSEEvent('finish', activeTranslation);
  }
}

// Start local server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Expressive MTL Translator running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`==================================================`);
});
