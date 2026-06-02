const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

const defaultSettings = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  port: parseInt(process.env.PORT || '3000', 10),
  sourcePath: process.env.SOURCE_PATH || './raws',
  targetPath: process.env.TARGET_PATH || './translated'
};

function loadConfig() {
  let userSettings = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      userSettings = JSON.parse(data);
    } catch (e) {
      console.error('Error reading config.json:', e);
    }
  }

  // Combine default settings with user overrides
  const config = { ...defaultSettings, ...userSettings };

  // Resolve absolute paths
  config.resolvedSourcePath = path.isAbsolute(config.sourcePath)
    ? config.sourcePath
    : path.resolve(path.join(__dirname, '..'), config.sourcePath);

  config.resolvedTargetPath = path.isAbsolute(config.targetPath)
    ? config.targetPath
    : path.resolve(path.join(__dirname, '..'), config.targetPath);

  return config;
}

function saveConfig(newSettings) {
  try {
    const current = loadConfig();
    const updated = {
      geminiApiKey: newSettings.geminiApiKey !== undefined ? newSettings.geminiApiKey : current.geminiApiKey,
      geminiModel: newSettings.geminiModel !== undefined ? newSettings.geminiModel : current.geminiModel,
      port: newSettings.port !== undefined ? parseInt(newSettings.port, 10) : current.port,
      sourcePath: newSettings.sourcePath !== undefined ? newSettings.sourcePath : current.sourcePath,
      targetPath: newSettings.targetPath !== undefined ? newSettings.targetPath : current.targetPath,
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return loadConfig();
  } catch (e) {
    console.error('Error saving config.json:', e);
    throw e;
  }
}

module.exports = {
  loadConfig,
  saveConfig
};
