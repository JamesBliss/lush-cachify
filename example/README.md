# Example: Using npm-lush-cachify

This is a simple example Express app that demonstrates how to use the `npm-lush-cachify` package.

## Prerequisites

- Node.js installed
- Redis server running (default: `redis://localhost:6379`)

## How to Run

1. Install dependencies in the root project (if you haven't already):

   ```bash
   npm install
   ```

2. Start the example app:

   ```bash
   node example/app.js
   ```

3. Open your browser and visit:
   - [http://localhost:3000/cachify](http://localhost:3000/cachify) — Redis UI
   - [http://localhost:3000/](http://localhost:3000/) — Example app home

## Customizing

- To use a different Redis server, edit the `redisUrl` in `app.js`.
