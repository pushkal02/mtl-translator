document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const configForm = document.getElementById('config-form');
  const geminiKeyInput = document.getElementById('gemini-key');
  const geminiModelSelect = document.getElementById('gemini-model');
  const sourcePathInput = document.getElementById('source-path');
  const targetPathInput = document.getElementById('target-path');
  const btnUpdateSource = document.getElementById('btn-update-source');
  
  const novelSelector = document.getElementById('novel-selector');
  const btnRefreshLibrary = document.getElementById('btn-refresh-library');
  const novelStats = document.getElementById('novel-stats');
  const statTotal = document.getElementById('stat-total');
  const statTranslated = document.getElementById('stat-translated');
  const statPending = document.getElementById('stat-pending');
  
  const transActionsPanel = document.getElementById('trans-actions-panel');
  const progressContainer = document.getElementById('global-progress-bar');
  const progressChapterName = document.getElementById('progress-chapter-name');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressFill = document.getElementById('progress-fill');
  
  const btnTranslatePending = document.getElementById('btn-translate-pending');
  const btnTranslateAll = document.getElementById('btn-translate-all');
  const btnStopTranslation = document.getElementById('btn-stop-translation');
  const selectAllChapters = document.getElementById('select-all-chapters');
  const selectNoneChapters = document.getElementById('select-none-chapters');
  const chaptersList = document.getElementById('chapters-list');
  
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const consoleTerminal = document.getElementById('console-terminal');
  const btnClearConsole = document.getElementById('btn-clear-console');
  
  const rawReaderBody = document.getElementById('raw-reader-body');
  const rawFileExt = document.getElementById('raw-file-ext');
  const translatedReaderBody = document.getElementById('translated-reader-body');
  const translatedStatusPill = document.getElementById('translated-status-pill');
  
  const mdReaderTitle = document.getElementById('md-reader-title');
  const mdReaderSubtitle = document.getElementById('md-reader-subtitle');
  const mdReaderBody = document.getElementById('md-reader-body');
  
  const overallStatus = document.getElementById('overall-status');
  
  // --- Scraper DOM Elements ---
  const scraperForm = document.getElementById('scraper-form');
  const scrapeUrlInput = document.getElementById('scrape-url');
  const btnFetchIndex = document.getElementById('btn-fetch-index');
  const scrapeRangePanel = document.getElementById('scrape-range-panel');
  const scrapedNovelTitle = document.getElementById('scraped-novel-title');
  const scrapeStartInput = document.getElementById('scrape-start');
  const scrapeEndInput = document.getElementById('scrape-end');
  const btnStartScrapeTranslate = document.getElementById('btn-start-scrape-translate');
  
  // --- State Variables ---
  let libraryData = []; // Cached novel list
  let selectedNovel = null;
  let sseSource = null;
  let scrapedNovelData = null; // Cache for current web novel scrape data

  // --- Initialize Application ---
  initApp();

  function initApp() {
    loadConfiguration();
    loadLibrary();
    setupSSE();
    setupTabRouting();
    setupEventListeners();
  }

  // --- Configuration ---
  async function loadConfiguration() {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      
      if (data.hasApiKey) {
        geminiKeyInput.placeholder = data.obfuscatedApiKey;
      }
      geminiModelSelect.value = data.geminiModel || 'gemini-2.5-flash';
      sourcePathInput.value = data.sourcePath || '';
      targetPathInput.value = data.targetPath || '';
    } catch (err) {
      logToConsole('error', `Failed to load settings: ${err.message}`);
    }
  }

  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const configData = {
      geminiModel: geminiModelSelect.value,
      sourcePath: sourcePathInput.value,
      targetPath: targetPathInput.value
    };
    
    // Only send API Key if the user edited it
    const keyVal = geminiKeyInput.value.trim();
    if (keyVal) {
      configData.geminiApiKey = keyVal;
    }

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData)
      });
      const res = await response.json();
      if (res.success) {
        geminiKeyInput.value = '';
        geminiKeyInput.placeholder = res.config.geminiApiKey 
          ? `${res.config.geminiApiKey.substring(0, 6)}...${res.config.geminiApiKey.substring(res.config.geminiApiKey.length - 4)}` 
          : '';
        alert('Settings saved successfully!');
        loadLibrary();
      } else {
        alert(`Failed to save settings: ${res.error}`);
      }
    } catch (err) {
      alert(`Error saving settings: ${err.message}`);
    }
  });

  btnUpdateSource.addEventListener('click', async () => {
    const val = sourcePathInput.value.trim();
    if (!val) return alert('Please enter a source directory or Git repository link.');
    
    btnUpdateSource.disabled = true;
    btnUpdateSource.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
    
    try {
      const response = await fetch('/api/source/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrlOrPath: val })
      });
      const data = await response.json();
      btnUpdateSource.disabled = false;
      btnUpdateSource.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync';
      
      if (data.success) {
        alert('Novel source updated successfully!');
        loadLibrary();
      } else {
        alert(`Failed to sync source: ${data.error}`);
      }
    } catch (err) {
      btnUpdateSource.disabled = false;
      btnUpdateSource.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync';
      alert(`Error syncing source: ${err.message}`);
    }
  });

  // --- Library Management ---
  async function loadLibrary() {
    try {
      const response = await fetch('/api/novels');
      const data = await response.json();
      if (data.success) {
        libraryData = data.novels;
        updateNovelSelector();
      }
    } catch (err) {
      logToConsole('error', `Library scan failed: ${err.message}`);
    }
  }

  function updateNovelSelector() {
    const currentSelection = novelSelector.value;
    novelSelector.innerHTML = '<option value="" disabled selected>Select a novel to translate/read...</option>';
    
    libraryData.forEach(novel => {
      const opt = document.createElement('option');
      opt.value = novel.name;
      opt.textContent = `${novel.name} (${novel.chapterCount} chapters)`;
      novelSelector.appendChild(opt);
    });

    if (currentSelection && libraryData.find(n => n.name === currentSelection)) {
      novelSelector.value = currentSelection;
      selectNovel(currentSelection);
    } else {
      novelStats.classList.add('hidden');
      transActionsPanel.classList.add('hidden');
      chaptersList.innerHTML = '<li class="empty-list-msg">No novel selected. Please select a novel from the dropdown.</li>';
    }
  }

  function selectNovel(novelName) {
    selectedNovel = libraryData.find(n => n.name === novelName);
    if (!selectedNovel) return;

    // Update Stats Card
    statTotal.textContent = selectedNovel.chapterCount;
    statTranslated.textContent = selectedNovel.translatedCount;
    statPending.textContent = selectedNovel.chapterCount - selectedNovel.translatedCount;
    novelStats.classList.remove('hidden');
    transActionsPanel.classList.remove('hidden');

    renderChapters();
  }

  function renderChapters() {
    if (!selectedNovel || selectedNovel.chapters.length === 0) {
      chaptersList.innerHTML = '<li class="empty-list-msg">This folder contains no supported text files.</li>';
      return;
    }

    chaptersList.innerHTML = '';
    selectedNovel.chapters.forEach(ch => {
      const li = document.createElement('li');
      li.className = `chapter-item ${ch.isTranslated ? 'completed-item' : 'pending-item'}`;
      li.dataset.chapterName = ch.chapterName;

      const info = document.createElement('div');
      info.className = 'chapter-info';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'chapter-checkbox';
      cb.value = ch.chapterName;
      // Checked by default if pending, unchecked if completed (so they can translate pending immediately)
      cb.checked = !ch.isTranslated;

      const title = document.createElement('span');
      title.className = 'chapter-title';
      title.textContent = ch.chapterName;
      title.addEventListener('click', () => loadChapterForReading(selectedNovel.name, ch.chapterName));

      info.appendChild(cb);
      info.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'chapter-actions';

      const badge = document.createElement('span');
      badge.className = `status-pill ${ch.isTranslated ? 'completed' : 'pending'}`;
      badge.textContent = ch.isTranslated ? 'Translated' : 'Pending';

      const readBtn = document.createElement('button');
      readBtn.className = 'btn btn-secondary btn-read-chapter';
      readBtn.innerHTML = '<i class="fa-solid fa-book-open"></i> Read';
      readBtn.addEventListener('click', () => loadChapterForReading(selectedNovel.name, ch.chapterName));

      actions.appendChild(badge);
      actions.appendChild(readBtn);

      li.appendChild(info);
      li.appendChild(actions);

      // Support double-clicking the item to read
      li.addEventListener('dblclick', () => loadChapterForReading(selectedNovel.name, ch.chapterName));

      chaptersList.appendChild(li);
    });
  }

  // --- Translation Orchestrator Trigger ---
  async function triggerTranslation(forceAll = false) {
    if (!selectedNovel) return alert('Select a novel first.');
    
    // Check if user checked specific chapters
    const checkedCheckboxes = document.querySelectorAll('.chapter-checkbox:checked');
    let selectedChapters = null;

    if (checkedCheckboxes.length > 0 && !forceAll) {
      selectedChapters = Array.from(checkedCheckboxes).map(cb => cb.value);
    }

    try {
      const response = await fetch('/api/translate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelName: selectedNovel.name,
          forceAll,
          selectedChapters
        })
      });
      const data = await response.json();
      if (!data.success) {
        alert(data.error);
      }
    } catch (err) {
      alert(`Error starting translation: ${err.message}`);
    }
  }

  btnTranslatePending.addEventListener('click', () => triggerTranslation(false));
  btnTranslateAll.addEventListener('click', () => {
    if (confirm(`Are you sure you want to FORCE re-translate ALL chapters of "${selectedNovel.name}"? This will overwrite existing files and consume API tokens.`)) {
      triggerTranslation(true);
    }
  });

  btnStopTranslation.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/translate/stop', { method: 'POST' });
      const data = await res.json();
      logToConsole('system', data.message);
    } catch (err) {
      alert(`Error stopping translation: ${err.message}`);
    }
  });

  // --- Server Sent Events (SSE) Stream Listener ---
  function setupSSE() {
    if (sseSource) {
      sseSource.close();
    }

    sseSource = new EventSource('/api/translate/events');

    sseSource.addEventListener('message', (e) => {
      const event = JSON.parse(e.data);
      handleSSEEvent(event.type, event.data);
    });

    sseSource.onerror = (err) => {
      console.error('SSE Error:', err);
      logToConsole('error', 'EventStream connection lost. Reconnecting...');
    };
  }

  function handleSSEEvent(type, data) {
    switch (type) {
      case 'init':
      case 'start':
        updateTranslationStatus(data.isRunning, data.novelName, data.currentChapterName);
        if (data.isRunning) {
          showProgressPanel(data);
          // Load existing logs if starting
          if (data.logs && data.logs.length > 0) {
            consoleTerminal.innerHTML = '';
            data.logs.forEach(line => appendLogLine(line));
          }
        }
        break;
      
      case 'progress':
        updateProgressBar(data.currentChapterIndex, data.currentChapterName, data.percentage);
        break;

      case 'log':
        appendLogLine(data);
        break;

      case 'finish':
        updateTranslationStatus(false);
        hideProgressPanel();
        loadLibrary(); // Rescan files to update UI counts
        logToConsole('success', 'Translation completed or stopped.');
        break;
    }
  }

  function updateTranslationStatus(isRunning, novelName = '', chapterName = '') {
    const indicator = overallStatus.querySelector('.status-indicator');
    const text = overallStatus.querySelector('.status-text');

    overallStatus.querySelector('.status-indicator').className = isRunning 
      ? 'status-indicator translating' 
      : 'status-indicator idle';
      
    overallStatus.querySelector('.status-text').textContent = isRunning 
      ? `Translating: ${novelName}` 
      : 'System Idle';

    btnTranslatePending.disabled = isRunning;
    btnTranslateAll.disabled = isRunning;
    btnStartScrapeTranslate.disabled = isRunning;
    
    if (isRunning) {
      btnStopTranslation.classList.remove('hidden');
    } else {
      btnStopTranslation.classList.add('hidden');
    }
  }

  function showProgressPanel(data) {
    progressContainer.classList.remove('hidden');
    updateProgressBar(data.currentChapterIndex, data.currentChapterName || 'Initializing...', 0);
  }

  function hideProgressPanel() {
    progressContainer.classList.add('hidden');
  }

  function updateProgressBar(idx, name, percentage) {
    progressChapterName.textContent = name;
    progressPercentage.textContent = `${percentage}%`;
    progressFill.style.width = `${percentage}%`;
  }

  function appendLogLine(line) {
    const div = document.createElement('div');
    div.className = 'console-line';
    
    // Style lines based on symbol prefixes
    if (line.includes('❌') || line.includes('Error')) {
      div.className += ' error';
    } else if (line.includes('✓') || line.includes('successfully')) {
      div.className += ' success';
    } else if (line.includes('└') || line.includes('Translating chunk')) {
      div.className += ' info';
    } else if (line.includes('[System]') || line.includes('Starting')) {
      div.className += ' system';
    } else {
      div.className += ' log';
    }
    
    div.textContent = line;
    consoleTerminal.appendChild(div);
    consoleTerminal.scrollTop = consoleTerminal.scrollHeight;
  }

  function logToConsole(type, msg) {
    const timestamp = new Date().toLocaleTimeString();
    appendLogLine(`[${timestamp}] ${type === 'error' ? '❌ ' : type === 'success' ? '✓ ' : ''}${msg}`);
  }

  // --- Chapter Reader ---
  async function loadChapterForReading(novelName, chapterName) {
    // Select the chapter item in the list visually
    const items = document.querySelectorAll('.chapter-item');
    items.forEach(el => {
      if (el.dataset.chapterName === chapterName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    try {
      logToConsole('system', `Loading Chapter: ${chapterName}...`);
      
      const response = await fetch(`/api/chapter?novelName=${encodeURIComponent(novelName)}&chapterName=${encodeURIComponent(chapterName)}`);
      const data = await response.json();
      
      // Update Split Reader
      rawFileExt.textContent = (data.fileExtension || '.txt').toUpperCase().replace('.', '');
      rawReaderBody.innerHTML = formatRawText(data.rawContent);
      
      const isTranslated = !data.translatedContent.includes('Not translated yet.');
      
      if (isTranslated) {
        translatedStatusPill.classList.remove('hidden');
        translatedReaderBody.innerHTML = renderMarkdown(data.translatedContent);
        
        // Update Clean Reader Tab
        mdReaderTitle.textContent = chapterName;
        mdReaderSubtitle.textContent = novelName;
        mdReaderBody.innerHTML = renderMarkdown(data.translatedContent);
      } else {
        translatedStatusPill.classList.add('hidden');
        translatedReaderBody.innerHTML = '<p class="reader-placeholder">This chapter has not been translated yet. Run the translator to generate English prose.</p>';
        
        mdReaderTitle.textContent = chapterName;
        mdReaderSubtitle.textContent = `${novelName} (Not Translated)`;
        mdReaderBody.innerHTML = '<p class="reader-placeholder">This chapter has not been translated yet. Run the translator to generate English prose.</p>';
      }

      // Automatically switch to Split view if they loaded content
      document.getElementById('btn-tab-split').click();
      
    } catch (err) {
      alert(`Error loading chapter contents: ${err.message}`);
    }
  }

  // Helper formatting for raw text paragraphs
  function formatRawText(raw) {
    if (!raw) return '';
    const paragraphs = raw.split(/\r?\n/);
    return paragraphs
      .filter(p => p.trim().length > 0)
      .map(p => `<p>${escapeHTML(p)}</p>`)
      .join('\n');
  }

  // Lightweight Client-side Markdown Parser for Novel Prose
  function renderMarkdown(md) {
    if (!md) return '';
    
    let html = escapeHTML(md);
    
    // Headers (# title)
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    
    // Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Italics (*text* or _text_)
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');
    
    // Dividers (---)
    html = html.replace(/^---$/gm, '<hr />');
    
    // Split block into paragraphs by empty lines
    const blocks = html.split(/\r?\n\r?\n/);
    html = blocks.map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      
      // Skip wrapping block elements in <p> tags
      if (trimmed.startsWith('<h') || trimmed.startsWith('<hr') || trimmed.startsWith('<ul') || trimmed.startsWith('<li')) {
        return trimmed;
      }
      
      // Convert single line breaks to br tags, wrap in paragraph
      const formatted = trimmed.replace(/\n/g, '<br>');
      return `<p>${formatted}</p>`;
    }).join('\n');
    
    return html;
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- UI Interactions ---
  function setupTabRouting() {
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
      });
    });
  }

  function setupEventListeners() {
    novelSelector.addEventListener('change', (e) => {
      selectNovel(e.target.value);
    });

    btnRefreshLibrary.addEventListener('click', () => {
      logToConsole('system', 'Scanning library...');
      loadLibrary();
    });

    btnClearConsole.addEventListener('click', () => {
      consoleTerminal.innerHTML = '<div class="console-line system">[System] Console log cleared.</div>';
    });

    selectAllChapters.addEventListener('click', () => {
      document.querySelectorAll('.chapter-checkbox').forEach(cb => cb.checked = true);
    });

    selectNoneChapters.addEventListener('click', () => {
      document.querySelectorAll('.chapter-checkbox').forEach(cb => cb.checked = false);
    });

    // --- Web Scraper Event Listeners ---
    btnFetchIndex.addEventListener('click', async () => {
      const url = scrapeUrlInput.value.trim();
      if (!url) return alert('Please enter a web novel index URL.');

      btnFetchIndex.disabled = true;
      btnFetchIndex.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
      logToConsole('system', `Scrape request received. Analyzing novel index page: ${url}`);
      
      // Auto switch to console logs tab
      document.querySelector('.tab-btn[data-tab="tab-console"]').click();

      try {
        const response = await fetch('/api/scrape/index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indexUrl: url })
        });
        
        const data = await response.json();
        
        btnFetchIndex.disabled = false;
        btnFetchIndex.innerHTML = '<i class="fa-solid fa-binoculars"></i> Scan';

        if (data.success) {
          scrapedNovelData = {
            indexUrl: url,
            novelName: data.novelName,
            chapters: data.chapters,
            selectors: data.selectors
          };

          scrapedNovelTitle.textContent = data.novelName;
          scrapeStartInput.value = 1;
          scrapeStartInput.min = 1;
          scrapeStartInput.max = data.chapters.length;
          
          scrapeEndInput.value = data.chapters.length;
          scrapeEndInput.min = 1;
          scrapeEndInput.max = data.chapters.length;

          scrapeRangePanel.classList.remove('hidden');
          logToConsole('success', `Scanned novel index successfully! Found "${data.novelName}" with ${data.chapters.length} chapters.`);
        } else {
          logToConsole('error', `Failed to scrape website structure: ${data.error}`);
          alert(`Failed to scrape: ${data.error}`);
        }
      } catch (err) {
        btnFetchIndex.disabled = false;
        btnFetchIndex.innerHTML = '<i class="fa-solid fa-binoculars"></i> Scan';
        logToConsole('error', `Error scanning index page: ${err.message}`);
        alert(`Error: ${err.message}`);
      }
    });

    scraperForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!scrapedNovelData) return alert('Please scan a web novel index URL first.');

      const startVal = parseInt(scrapeStartInput.value, 10);
      const endVal = parseInt(scrapeEndInput.value, 10);

      if (isNaN(startVal) || isNaN(endVal) || startVal < 1 || endVal > scrapedNovelData.chapters.length || startVal > endVal) {
        return alert(`Invalid chapter range. Range must be between 1 and ${scrapedNovelData.chapters.length}.`);
      }

      // Slice selection subset
      const subset = scrapedNovelData.chapters.slice(startVal - 1, endVal);
      logToConsole('system', `Queueing web scraping & translation of chapters ${startVal} to ${endVal} (${subset.length} chapters)...`);

      try {
        const response = await fetch('/api/scrape/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            indexUrl: scrapedNovelData.indexUrl,
            novelName: scrapedNovelData.novelName,
            chapters: subset,
            selectors: scrapedNovelData.selectors
          })
        });

        const data = await response.json();
        if (data.success) {
          logToConsole('success', `Translation background task started for chapters ${startVal}-${endVal}.`);
        } else {
          logToConsole('error', `Failed to queue: ${data.error}`);
          alert(`Failed to start translation: ${data.error}`);
        }
      } catch (err) {
        logToConsole('error', `API error starting web translation: ${err.message}`);
        alert(`Error: ${err.message}`);
      }
    });
  }
});

// Global card accordion toggler
function toggleCardBody(headerEl) {
  const card = headerEl.closest('.glass-card');
  card.classList.toggle('collapsed');
}
