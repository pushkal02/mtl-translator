const axios = require('axios');

async function testTranslation() {
  try {
    console.log('1. Connecting to local server...');
    const configRes = await axios.get('http://localhost:3000/api/config');
    console.log('Config loaded:', configRes.data);

    console.log('\n2. Requesting translation of "The Legend of the Antigravity Mage"...');
    const transRes = await axios.post('http://localhost:3000/api/translate/start', {
      novelName: 'The Legend of the Antigravity Mage',
      forceAll: true
    });
    console.log('API Response:', transRes.data);

    console.log('\n3. Waiting 10 seconds for translation process to run...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log('\n4. Checking novels list to see if chapter statuses updated...');
    const novelsRes = await axios.get('http://localhost:3000/api/novels');
    const mageNovel = novelsRes.data.novels.find(n => n.name === 'The Legend of the Antigravity Mage');
    console.log('Novel Stats:', {
      name: mageNovel.name,
      chapterCount: mageNovel.chapterCount,
      translatedCount: mageNovel.translatedCount
    });

    console.log('\nChapters Details:');
    mageNovel.chapters.forEach(ch => {
      console.log(`- ${ch.chapterName}: Translated? ${ch.isTranslated}`);
    });

  } catch (err) {
    console.error('Test Failed:', err.response ? err.response.data : err.message);
  }
}

testTranslation();
