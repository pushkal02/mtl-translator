# 🔮 Expressive MTL Translator

An AI-assisted, highly expressive, and high-fidelity translator for machine-translated (MTL) novels. It features a premium, glassmorphic dark-themed local web dashboard to manage, crawl, translate, and read web novels side-by-side.

---

## 🌟 Key Features

*   **High-Fidelity Translation**: Configures safety parameters to prevent unnecessary filtering of literature content and utilizes a dedicated prose-translation prompt to maintain original author intent, dialogue, and scene descriptions with full fidelity.
*   **AI-Assisted Web Scraper**: Exploring a new novel page will automatically trigger Gemini to analyze the site's HTML, discover CSS selectors for chapter lists, content wrappers, and titles, and remember them in `scrapers.json`.
*   **Incremental Updates**: Keeps track of translated chapters. When running the translator again, it only translates newly added/released chapters, saving time and API tokens.
*   **Git Repository Integration**: Directly clones or pulls raw novel sources from GitHub/GitLab links.
*   **Dual & Clean Reader Views**:
    *   **Split Reader**: Displays raw machine translation on the left and the translated English prose side-by-side.
    *   **Clean View**: Renders the translated Markdown into print-optimized typography (using Outfit for UI and Lora for prose).
*   **Live SSE Console Logs**: Streams server-side progress bars and detailed log files in real-time straight to your dashboard console.

---

## 🛠️ Technology Stack

*   **Backend**: Node.js, Express, Axios, Cheerio, Simple-Git
*   **Translation Engine**: Google Gemini API via the official `@google/generative-ai` SDK
*   **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism, custom typography, HSL layouts), Vanilla JS

---

## 🚀 Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or higher recommended)
*   A Google Gemini API key (Obtain one for free or pay-as-you-go from [Google AI Studio](https://aistudio.google.com/))

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/pushkal02/mtl-translator.git
    cd mtl-translator
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Configure your environment:
    Copy the example template and fill in your Gemini API key:
    ```bash
    cp .env.example .env
    ```
    Open `.env` and set your key:
    ```env
    GEMINI_API_KEY=your_gemini_api_key_here
    GEMINI_MODEL=gemini-2.5-flash
    ```

---

## 💻 Running the App

Start the translation dashboard server:
```bash
npm start
```

Open your browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📖 How It Works

### 1. Folder Scanning (Local Raws)
If you have raw machine-translated files locally, place them in subfolders inside the `raws` folder:
```
raws/
  ├── Novel Name A/
  │     ├── Chapter 1.txt
  │     └── Chapter 2.txt
  └── Novel Name B/
        ├── Chapter 1.txt
        └── ...
```
The app naturally sorts chapters numerically (e.g. "Chapter 2" comes before "Chapter 10") and checks the `translated` output folder to skip already processed chapters.

### 2. AI-Assisted Crawling (Web Links)
For web novel sites:
1.  Paste the table of contents URL (e.g., `https://royalroad.com/novel/...`) in the **Web Scraper** panel.
2.  Click **Scan**. If it's a new site, the server:
    *   Downloads the index and a sample chapter HTML.
    *   Asks Gemini to inspect the page structures.
    *   Saves the discovered CSS selectors (e.g., wrapper tag names) to `scrapers.json`.
3.  Once the scan completes, input your **Chapter Range** (e.g., Start: `10`, End: `25`) and click **Scrape & Translate Range**.
4.  The server fetches pages one-by-one, parses out raw story text locally, translates it using the Gemini API, and saves the result as a `.md` markdown file in your target output directory.

---

## ⚙️ Configuration File (`config.json`)

Your settings are persisted in `config.json` at the root of the project. You can change these options directly in the file or through the Configuration drawer in the Web UI:

```json
{
  "geminiApiKey": "your-gemini-api-key",
  "geminiModel": "gemini-2.5-flash",
  "port": 3000,
  "sourcePath": "./raws",
  "targetPath": "./translated"
}
```

---

## 🔒 Safety & High-Fidelity Settings

To support authentic translation of complex literary works and avoid false filtering of text containing dialogue or conflicts, the application disables safety filters:

```javascript
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  // ...other categories set to BLOCK_NONE
];
```
Additionally, the system instruction directs the LLM to prioritize accuracy and translation completeness to preserve the original prose, character speech, and style.
