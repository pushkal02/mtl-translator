const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadConfig } = require('./config');

const SCRAPERS_FILE = path.join(__dirname, '..', 'scrapers.json');

// Common headers to bypass basic user-agent blockers
const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

/**
 * Loads the saved scraping selectors from scrapers.json
 */
function loadScraperRules() {
  if (fs.existsSync(SCRAPERS_FILE)) {
    try {
      const data = fs.readFileSync(SCRAPERS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error('Error reading scrapers.json:', e);
    }
  }
  return {};
}

/**
 * Saves scraping selectors to scrapers.json
 */
function saveScraperRules(rules) {
  try {
    fs.writeFileSync(SCRAPERS_FILE, JSON.stringify(rules, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving scrapers.json:', e);
  }
}

/**
 * Strips script tags, style sheets, SVGs, iframes, footers, headers, and navs
 * to reduce token count and leave only structural HTML.
 */
function cleanHtmlContent(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, header, footer, nav, link, meta').remove();
  
  // Remove ads if obvious
  $('.ads, .advertisement, .banner, #disqus_thread, .comments-container').remove();
  
  // Get body html or fallback to top level div
  const bodyHtml = $('body').html() || $.html();
  
  // Remove multiple empty lines and whitespaces
  return bodyHtml
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim()
    .substring(0, 100000); // Safe boundary for Gemini context limit
}

/**
 * Helper to extract domain name from a URL
 */
function getDomainName(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch (e) {
    return 'generic';
  }
}

/**
 * Safely parse JSON blocks that might contain markdown wrapping
 */
function parseGeminiJson(text) {
  let cleanText = text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```json/, '').replace(/^```/, '').trim();
  }
  return JSON.parse(cleanText);
}

/**
 * Uses Gemini to examine index HTML and identify chapter link selectors
 */
async function discoverIndexSelectors(domain, cleanedHtml, apiKey, modelName) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `You are a web scraping expert. Analyze this cleaned HTML of a web novel index page (Table of Contents) from the domain "${domain}".
We need to:
1. Identify the CSS selector that matches the list of chapter links (anchor tags <a> containing link URLs to individual chapters).
2. Extract the relative or absolute URL of the first chapter listed as a sample.

Return ONLY a JSON object with this exact structure:
{
  "chapterLinkSelector": "CSS Selector (e.g. '.chapter-list a' or '#chapters ul li a')",
  "sampleChapterUrl": "url string"
}
Do not write explanations, markdown code blocks, or extra text, just raw JSON.`;

  const result = await model.generateContent(prompt + '\n\nCleaned HTML:\n' + cleanedHtml);
  return parseGeminiJson(result.response.text());
}

/**
 * Uses Gemini to examine chapter HTML and identify text content selectors
 */
async function discoverChapterSelectors(domain, cleanedHtml, apiKey, modelName) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `You are a web scraping expert. Analyze this cleaned HTML of a web novel chapter reader page from the domain "${domain}".
We need to:
1. Identify the CSS selector that matches the main text container of the chapter/story content (excluding comments, headers, footers, sidebars).
2. Identify the CSS selector that matches the header containing the chapter title (usually h1, h2, or a specific class).

Return ONLY a JSON object with this exact structure:
{
  "chapterTextSelector": "CSS Selector (e.g. '.chapter-content' or '#chapter-inner' or '.entry-content')",
  "chapterTitleSelector": "CSS Selector (e.g. 'h1' or '.chapter-title')"
}
Do not write explanations, markdown code blocks, or extra text, just raw JSON.`;

  const result = await model.generateContent(prompt + '\n\nCleaned HTML:\n' + cleanedHtml);
  return parseGeminiJson(result.response.text());
}

/**
 * Resolves selectors for a given domain. If not cached, runs the AI-based discovery.
 */
async function resolveSelectors(indexUrl, onProgress) {
  const domain = getDomainName(indexUrl);
  const rules = loadScraperRules();

  if (rules[domain]) {
    if (onProgress) onProgress(`Using cached selector rules for ${domain}.`);
    return rules[domain];
  }

  if (onProgress) onProgress(`New domain detected: "${domain}". Scraping index for AI selector analysis...`);
  
  const config = loadConfig();
  const apiKey = config.geminiApiKey;
  const modelName = config.geminiModel;

  if (!apiKey) {
    throw new Error('Gemini API key is required to discover site selectors. Please configure it in settings.');
  }

  // Fetch Index page HTML
  const indexResponse = await axios.get(indexUrl, { headers: HTTP_HEADERS });
  const cleanedIndex = cleanHtmlContent(indexResponse.data);

  if (onProgress) onProgress(`Index page HTML fetched. Querying Gemini to find chapter links...`);
  const indexData = await discoverIndexSelectors(domain, cleanedIndex, apiKey, modelName);

  // Normalize sample url
  let sampleUrl = indexData.sampleChapterUrl;
  if (sampleUrl && !sampleUrl.startsWith('http')) {
    const base = new URL(indexUrl);
    sampleUrl = new URL(sampleUrl, base.origin + base.pathname).toString();
  }

  if (!sampleUrl) {
    throw new Error('AI could not locate a sample chapter link on the index page.');
  }

  if (onProgress) onProgress(`Sample chapter link found: ${sampleUrl}. Fetching page for content selector analysis...`);
  
  // Fetch Chapter page HTML
  const chapterResponse = await axios.get(sampleUrl, { headers: HTTP_HEADERS });
  const cleanedChapter = cleanHtmlContent(chapterResponse.data);

  if (onProgress) onProgress(`Chapter page HTML fetched. Querying Gemini to find story text selector...`);
  const chapterData = await discoverChapterSelectors(domain, cleanedChapter, apiKey, modelName);

  // Merge and save
  const newDomainRules = {
    chapterLinkSelector: indexData.chapterLinkSelector,
    chapterTextSelector: chapterData.chapterTextSelector,
    chapterTitleSelector: chapterData.chapterTitleSelector
  };

  rules[domain] = newDomainRules;
  saveScraperRules(rules);

  if (onProgress) onProgress(`✓ Scraper rules generated and saved for ${domain}:\n` + JSON.stringify(newDomainRules, null, 2));
  return newDomainRules;
}

/**
 * Scrapes the index page and returns list of chapters
 */
async function scrapeNovelIndex(indexUrl, onProgress) {
  const selectors = await resolveSelectors(indexUrl, onProgress);
  
  if (onProgress) onProgress(`Fetching table of contents from: ${indexUrl}`);
  const response = await axios.get(indexUrl, { headers: HTTP_HEADERS });
  const $ = cheerio.load(response.data);
  
  const base = new URL(indexUrl);
  const chapters = [];

  $(selectors.chapterLinkSelector).each((i, el) => {
    const title = $(el).text().trim();
    let href = $(el).attr('href');
    
    if (href) {
      if (!href.startsWith('http')) {
        href = new URL(href, base.origin + base.pathname).toString();
      }
      
      chapters.push({
        chapterIndex: i + 1,
        chapterName: title || `Chapter ${i + 1}`,
        chapterUrl: href
      });
    }
  });

  if (onProgress) onProgress(`Found ${chapters.length} chapters.`);
  return {
    novelName: $('title').text().replace(/table of contents|index|novel|read/gi, '').trim() || 'Scraped Novel',
    chapters,
    selectors
  };
}

/**
 * Scrapes a single chapter page text content
 */
async function scrapeChapterContent(chapterUrl, selectors) {
  const response = await axios.get(chapterUrl, { headers: HTTP_HEADERS });
  const $ = cheerio.load(response.data);
  
  const title = $(selectors.chapterTitleSelector).first().text().trim() || 'Untitled Chapter';
  
  // Extract paragraphs or divs containing text
  const contentElement = $(selectors.chapterTextSelector);
  
  let rawText = '';
  // Try to preserve paragraphs by iterating p tags if present
  if (contentElement.find('p').length > 0) {
    contentElement.find('p').each((i, el) => {
      rawText += $(el).text().trim() + '\n\n';
    });
  } else {
    // Or just grab text directly, replacing double lines
    rawText = contentElement.text().trim();
  }

  return {
    title,
    rawText: rawText.trim()
  };
}

module.exports = {
  scrapeNovelIndex,
  scrapeChapterContent,
  resolveSelectors
};
