const { lushCachify } = require('../dist/index');

const express = require('express');

const app = express();
const redisUrl = 'rediss://default:AZpcAAIjcDEzYzg2MGUzMDQxZGM0MTRlOWU2Mzc5MjI0YTkxN2Y5OHAxMA@settling-chimp-39516.upstash.io:6379'; // Change this if your Redis is elsewhere

app.use('/cachify', lushCachify({ redisUrl }));

app.get('/', (req, res) => {
  res.send('<h1>Welcome to the Example App</h1><p>Visit <a href="/cachify">/cachify</a> to manage Redis.</p>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Example app running at http://localhost:${PORT}`);
});