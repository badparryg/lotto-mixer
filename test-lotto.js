const https = require('https');
https.get('https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=1218', {
  headers: { 'User-Agent': 'Mozilla/5.0' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(res.statusCode, data.substring(0, 50)));
});
