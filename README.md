# lush-cachify

A plug-and-play Express middleware to manage your Redis cache via HTTP endpoints and a modern UI.

## Installation

```bash
npm install lush-cachify
```

## Usage

```js
const express = require('express');
const { lushCachify } = require('lush-cachify');

const app = express();
const redisUrl = 'redis://localhost:6379'; // Your Redis connection string

// Mount the middleware at your desired path
app.use('/cachify', lushCachify({ redisUrl }));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

## Endpoints

- `GET /cachify/search?key=pattern*` — Search for keys (wildcards supported)
- `GET /cachify/view/:key` — View a record by key (supports JSON, RedisJSON, and all Redis types)
- `DELETE /cachify/clear/:key` — Delete a single record
- `DELETE /cachify/clear-all` — Delete all records in Redis (batched, with confirmation)
- `DELETE /cachify/clear-pattern?key=pattern` — Delete all records matching a pattern (batched)
- `GET /cachify/status` — Check Redis connection health

## Options

- `redisUrl` (**required**): Your Redis connection string
- `logger`: Pass custom logger functions for error/info/success

## Features

- Modern, responsive UI (visit `/cachify` in your browser)
- Safe, batched deletes for large datasets
- Rate limiting for all endpoints
- Custom logger support
