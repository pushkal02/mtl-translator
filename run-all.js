const { execSync } = require('child_process');

function runTranslationQueue() {
  try {
    console.log('==================================================');
    console.log('Starting Unified MTL Translation Queue');
    console.log('==================================================');
    
    // Batch 1: Chapters 326 to 340
    console.log('\n--- Batch 1: Translating Chapters 326 to 340 ---');
    try {
      execSync('node scrape-clk.js 326 340', { stdio: 'inherit' });
    } catch (batch1Err) {
      console.error('❌ Batch 1 failed, but continuing to Batch 2:', batch1Err.message);
    }
    
    // Batch 2: Chapters 524 to 560
    console.log('\n--- Batch 2: Translating Chapters 524 to 560 ---');
    try {
      execSync('node scrape-clk.js 524 560', { stdio: 'inherit' });
    } catch (batch2Err) {
      console.error('❌ Batch 2 failed:', batch2Err.message);
    }
    
    console.log('\n==================================================');
    console.log('Unified Translation Queue Execution Complete!');
    console.log('All completed chapters have been saved locally as .md.');
    console.log('==================================================');
  } catch (err) {
    console.error('Queue runner fatal error:', err.message);
  }
}

runTranslationQueue();
