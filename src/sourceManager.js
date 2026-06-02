const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { loadConfig, saveConfig } = require('./config');

// Natural sort helper to properly sort filenames like "Chapter 2.txt" and "Chapter 10.txt"
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Scans the source directory and retrieves all novels and chapters,
 * matching them against the target directory to verify translation status.
 */
function scanNovels() {
  const config = loadConfig();
  const sourceDir = config.resolvedSourcePath;
  const targetDir = config.resolvedTargetPath;

  if (!fs.existsSync(sourceDir)) {
    try {
      fs.mkdirSync(sourceDir, { recursive: true });
    } catch (e) {
      console.error(`Failed to create source directory: ${sourceDir}`, e);
      return [];
    }
  }

  const novels = [];
  try {
    const items = fs.readdirSync(sourceDir);
    
    for (const item of items) {
      const novelPath = path.join(sourceDir, item);
      const stat = fs.statSync(novelPath);

      if (stat.isDirectory() && !item.startsWith('.')) {
        const novelName = item;
        const chapters = [];
        const chapterFiles = fs.readdirSync(novelPath);

        // Filter text files
        const supportedExtensions = ['.txt', '.md', '.html', '.htm'];
        const textFiles = chapterFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          return supportedExtensions.includes(ext) && !file.startsWith('.');
        });

        // Sort files naturally (Chapter 1, Chapter 2, ..., Chapter 10)
        textFiles.sort(naturalSort);

        for (const file of textFiles) {
          const chapterName = path.basename(file, path.extname(file));
          
          // Verify if translated version exists in target directory
          const targetSubdir = path.join(targetDir, novelName);
          const targetFile = path.join(targetSubdir, `${chapterName}.md`);
          const isTranslated = fs.existsSync(targetFile);

          chapters.push({
            filename: file,
            chapterName: chapterName,
            relativePath: path.join(novelName, file),
            isTranslated: isTranslated,
            targetPath: targetFile,
            sourcePath: path.join(novelPath, file)
          });
        }

        novels.push({
          name: novelName,
          folderPath: novelPath,
          chapterCount: chapters.length,
          translatedCount: chapters.filter(c => c.isTranslated).length,
          chapters: chapters
        });
      }
    }
  } catch (err) {
    console.error('Error scanning novels:', err);
  }

  return novels;
}

/**
 * Updates the source by cloning or pulling from a Git URL,
 * or simply updating the local path configuration.
 */
async function updateSource(sourceUrlOrPath) {
  const config = loadConfig();
  
  // Check if it's a Git remote URL
  const isGitUrl = sourceUrlOrPath.startsWith('http://') || 
                    sourceUrlOrPath.startsWith('https://') || 
                    sourceUrlOrPath.startsWith('git@') || 
                    sourceUrlOrPath.includes('.git');

  if (isGitUrl) {
    const localRawsPath = path.resolve(path.join(__dirname, '..'), 'raws');
    
    // Create folder if it doesn't exist
    if (!fs.existsSync(localRawsPath)) {
      fs.mkdirSync(localRawsPath, { recursive: true });
    }

    const git = simpleGit(localRawsPath);
    const isRepo = fs.existsSync(path.join(localRawsPath, '.git'));

    if (isRepo) {
      console.log(`Repository already exists in ${localRawsPath}. Pulling latest...`);
      try {
        await git.pull();
        console.log('Successfully pulled latest files from Git.');
      } catch (err) {
        console.error('Failed to pull from Git repository. Attempting to overwrite...', err);
        // Force reset and pull
        await git.fetch();
        await git.reset(['--hard', 'origin/main']);
      }
    } else {
      console.log(`Cloning repository from ${sourceUrlOrPath} into ${localRawsPath}...`);
      // Make sure directory is empty before cloning
      const files = fs.readdirSync(localRawsPath);
      if (files.length > 0) {
        // If there are files, clone into a clean subdirectory, or delete them?
        // Let's delete existing files in raws/ if they are not .git to allow clean clone
        for (const file of files) {
          const p = path.join(localRawsPath, file);
          if (fs.statSync(p).isDirectory()) {
            fs.rmSync(p, { recursive: true, force: true });
          } else {
            fs.unlinkSync(p);
          }
        }
      }
      await git.clone(sourceUrlOrPath, '.');
      console.log('Successfully cloned Git repository.');
    }

    // Update config to point to raws directory
    saveConfig({ sourcePath: './raws' });
    return { success: true, mode: 'git', path: './raws' };
  } else {
    // It's a local folder path
    if (!fs.existsSync(sourceUrlOrPath)) {
      throw new Error(`The specified local directory does not exist: ${sourceUrlOrPath}`);
    }
    
    saveConfig({ sourcePath: sourceUrlOrPath });
    return { success: true, mode: 'local', path: sourceUrlOrPath };
  }
}

module.exports = {
  scanNovels,
  updateSource
};
