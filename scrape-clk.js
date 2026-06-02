const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { translateChapter } = require('./src/translator');
const { loadConfig } = require('./src/config');
const simpleGit = require('simple-git');

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

async function scrapeAndTranslateCLK() {
  const args = process.argv.slice(2);
  const startChapter = args[0] ? parseInt(args[0], 10) : 326;
  const endChapter = args[1] ? parseInt(args[1], 10) : 340;
  const startUrl = args[2] || `https://www.fanmtl.com/novel/city-lady-killer_${startChapter}.html`;
  
  const novelName = 'City Lady-Killer';
  const config = loadConfig();
  const targetDir = path.join(config.resolvedTargetPath, novelName);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log(`==================================================`);
  console.log(`Starting sequential crawl & translation for CLK`);
  console.log(`Target: Chapters ${startChapter} to ${endChapter}`);
  console.log(`==================================================\n`);

  let currentUrl = startUrl;

  for (let chNum = startChapter; chNum <= endChapter; chNum++) {
    console.log(`\n--------------------------------------------------`);
    console.log(`[${chNum - startChapter + 1}/${endChapter - startChapter + 1}] Processing Chapter ${chNum}...`);

    try {
      let html = '';
      const localHtmlDir = path.join(__dirname, 'raws', novelName);
      const localHtmlPath = path.join(localHtmlDir, `Chapter_${chNum}.html`);

      if (fs.existsSync(localHtmlPath)) {
        html = fs.readFileSync(localHtmlPath, 'utf8');
        console.log(`✓ Read HTML from local file: ${localHtmlPath}`);
      } else {
        console.log(`Fetching URL: ${currentUrl}`);
        // 1. Fetch HTML Page
        const response = await axios.get(currentUrl, { headers: HTTP_HEADERS });
        html = response.data;
        
        // Cache it for future runs
        if (!fs.existsSync(localHtmlDir)) {
          fs.mkdirSync(localHtmlDir, { recursive: true });
        }
        fs.writeFileSync(localHtmlPath, html, 'utf8');
        console.log(`✓ Fetched and cached HTML locally.`);
      }

      const $ = cheerio.load(html);

      // 2. Extract Title and Content
      const titleText = $('.titles h2').text().trim() || `Chapter ${chNum}`;
      
      let rawText = '';
      const contentEl = $('.chapter-content');
      if (contentEl.find('p').length > 0) {
        contentEl.find('p').each((i, el) => {
          rawText += $(el).text().trim() + '\n\n';
        });
      } else {
        rawText = contentEl.text().trim();
      }

      if (!rawText.trim()) {
        console.error(`❌ Error: Main story text not found for Chapter ${chNum}.`);
        break;
      }

      console.log(`✓ Scraped raw text successfully (${rawText.length} characters).`);
      console.log(`Title: "${titleText}"`);

      // 3. Translate using Gemini API
      console.log(`Translating via Gemini API (High-Fidelity mode)...`);
      const translatedText = await translateChapter(rawText, (progressMsg) => {
        console.log(`  └ ${progressMsg}`);
      });

      // 4. Save to Markdown File
      const sanitizedTitle = titleText.replace(/[\\\/:\*\?"<>\|]/g, '_').trim();
      const outputFilePath = path.join(targetDir, `${sanitizedTitle}.md`);
      
      const mdContent = `# ${titleText}\n\n${translatedText}`;
      fs.writeFileSync(outputFilePath, mdContent, 'utf8');
      console.log(`✓ Saved translation to: ${outputFilePath}`);

      // Git commit and push inside the novel target folder
      try {
        const { execSync } = require('child_process');
        if (!fs.existsSync(path.join(targetDir, '.git'))) {
          console.log(`Initializing local Git repository for "${novelName}"...`);
          execSync('git init && git branch -M main', { cwd: targetDir });
        }
        
        console.log('Staging and committing chapter to local repository...');
        execSync('git add .', { cwd: targetDir });
        try {
          execSync(`git commit -m "Add Chapter ${chNum}: ${sanitizedTitle}"`, { cwd: targetDir, stdio: 'ignore' });
          console.log(`✓ Committed Chapter ${chNum} locally.`);
          
          let hasRemote = false;
          try {
            const remotes = execSync('git remote', { cwd: targetDir }).toString().trim();
            if (remotes.includes('origin')) {
              hasRemote = true;
            }
          } catch (remoteErr) {
            // No remote configured
          }

          if (hasRemote) {
            console.log('Pushing updates to remote repository...');
            execSync('git push origin main', { cwd: targetDir });
            console.log('✓ Successfully pushed to remote private repository.');
          } else {
            console.log('ℹ No remote "origin" set. Skipping remote push. Run "git remote add origin <URL>" in the translated novel folder to enable auto-push.');
          }
        } catch (commitErr) {
          console.log('ℹ No changes to commit or commit failed.');
        }
      } catch (gitErr) {
        console.warn(`⚠️ Git operation failed: ${gitErr.message}`);
      }

      // 5. Get Next Link URL
      let nextLink = $('a.chnav.next').attr('href');
      
      // Fallback selector check
      if (!nextLink) {
        $('a').each((i, el) => {
          const text = $(el).text().toLowerCase().trim();
          if (text === 'next' || text.includes('next >') || text === 'next chapter') {
            nextLink = $(el).attr('href');
            return false;
          }
        });
      }

      if (chNum < endChapter) {
        if (!nextLink) {
          console.error(`❌ Warning: No "Next" link found. Sequential crawl stopped.`);
          break;
        }

        // Normalize URL if relative
        if (!nextLink.startsWith('http')) {
          const base = new URL(currentUrl);
          currentUrl = new URL(nextLink, base.origin + base.pathname).toString();
        } else {
          currentUrl = nextLink;
        }

        console.log('Cooling down (20s) before starting next chapter to respect API request limits...');
        await new Promise(resolve => setTimeout(resolve, 20000));
      }

    } catch (err) {
      console.error(`❌ Failed to process Chapter ${chNum}:`, err.message);
      break;
    }
  }

  console.log(`\n==================================================`);
  console.log(`Scraping & Translation finished successfully!`);
  console.log(`Saved as local .md files. Git push omitted as requested.`);
  console.log(`==================================================`);
}

scrapeAndTranslateCLK();
