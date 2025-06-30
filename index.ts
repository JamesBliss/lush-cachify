import express, { Request, Response, Router, RequestHandler, NextFunction } from 'express';
import Redis from 'ioredis';
import type { ScanStream } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import rateLimit from 'express-rate-limit';

export interface LushCachifyLogger {
  error?: (msg: string) => void;
  info?: (msg: string) => void;
  success?: (msg: string) => void;
}

export interface LushCachifyOptions {
  redisUrl: string;
  logger?: LushCachifyLogger;
  basePath?: string; // Not used in middleware style, but kept for compatibility
}

async function batchDelete(redis: Redis, keys: string[], logger: any, batchSize = 500): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    try {
      deleted += await redis.del(batch);
    } catch (err: any) {
      logger.error(`[lush-cachify] Batch delete error: ${err.message}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return deleted;
}

export function lushCachify(options: LushCachifyOptions): Router {
  if (!options.redisUrl) throw new Error('redisUrl is required');
  const router: Router = express.Router();
  const redis = new Redis(options.redisUrl);
  const logger = {
    error: options.logger?.error || console.error,
    info: options.logger?.info || console.info,
    success: options.logger?.success || console.log,
  };

  // Track Redis connection health
  let redisHealthy = true;
  redis.on('error', (err) => {
    redisHealthy = false;
    logger.error(`[lush-cachify] Redis connection error: ${err.message}`);
  });
  redis.on('end', () => {
    redisHealthy = false;
    logger.error('[lush-cachify] Redis connection closed.');
  });
  redis.on('connect', () => {
    redisHealthy = true;
    logger.info('[lush-cachify] Connected to Redis.');
  });

  // Rate limiting middleware (30 requests/minute per IP)
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please try again later.'
  });
  router.use(limiter);

  // Redis status endpoint
  router.get('/status', async (_req, res) => {
    res.json({ status: redisHealthy ? 'ok' : 'unhealthy' });
  });

  // Search for keys (supports wildcards) using scan for pagination
  const searchHandler: RequestHandler = async (req, res): Promise<void> => {
    const pattern = req.query?.key ? `*${req.query?.key}*` : '*';
    const count = parseInt(req.query.count as string, 10) || 100;
    const cursor = (req.query.cursor as string) || '0';
    try {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      logger.info(`[lush-cachify] Search: pattern=${pattern}, cursor=${cursor}, count=${count}, found=${keys.length}`);
      res.json({ keys, nextCursor });
    } catch (err: any) {
      logger.error(`[lush-cachify] Search error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };
  router.get('/search', searchHandler);

  // View a record by key (supports RedisJSON)
  const viewHandler: RequestHandler = async (req, res): Promise<void> => {
    const { key } = req.params;
    try {
      const type = await redis.type(key);
      let value: any = null;
      if (type === 'string') {
        const raw = await redis.get(key);
        if (raw === null || raw === undefined) {
          value = null;
        } else {
          try {
            value = JSON.parse(raw);
          } catch {
            value = raw;
          }
        }
      } else if (type === 'ReJSON-RL' || type === 'json') {
        try {
          const raw = await redis.call('JSON.GET', key, '.');
          value = raw ? JSON.parse(raw as string) : null;
        } catch {
          value = null;
        }
      } else if (type === 'hash') {
        value = await redis.hgetall(key);
      } else if (type === 'list') {
        value = await redis.lrange(key, 0, -1);
      } else if (type === 'set') {
        value = await redis.smembers(key);
      } else if (type === 'zset') {
        value = await redis.zrange(key, 0, -1, 'WITHSCORES');
      } else {
        value = null;
      }
      logger.info(`[lush-cachify] View: key=${key}, type=${type}`);
      res.json({ key, type, value });
    } catch (err: any) {
      logger.error(`[lush-cachify] View error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };
  router.get('/view/:key', viewHandler);

  // Delete a single record
  const clearHandler: RequestHandler = async (req, res): Promise<void> => {
    const { key } = req.params;
    try {
      const result = await redis.del(key);
      logger.success(`[lush-cachify] Deleted key: ${key}, result=${result}`);
      res.json({ key, deleted: result });
    } catch (err: any) {
      logger.error(`[lush-cachify] Delete key error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };
  router.delete('/clear/:key', clearHandler);

  // Clear all cache (batched)
  const clearAllHandler: RequestHandler = async (_req, res): Promise<void> => {
    try {
      const keys = await redis.keys('*');
      if (keys.length === 0) {
        logger.info('[lush-cachify] Clear all: no keys to delete');
        res.json({ deleted: 0 });
        return;
      }
      const deleted = await batchDelete(redis, keys, logger);
      logger.success(`[lush-cachify] Cleared all keys: deleted=${deleted}`);
      res.json({ deleted });
    } catch (err: any) {
      logger.error(`[lush-cachify] Clear all error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };
  router.delete('/clear-all', clearAllHandler);

  // Clear all cache matching a pattern (batched)
  const clearPatternHandler: RequestHandler = async (req, res): Promise<void> => {
    const pattern = req.query?.key ? `*${req.query?.key}*` : '*';
    const keys: string[] = [];
    try {
      const stream: ScanStream = redis.scanStream({ match: pattern, count: 1000 });
      stream.on('data', (resultKeys: string[]) => {
        keys.push(...resultKeys);
      });
      stream.on('end', async () => {
        if (keys.length === 0) {
          logger.info(`[lush-cachify] Clear pattern: no keys for pattern=${pattern}`);
          res.json({ deleted: 0 });
          return;
        }
        const deleted = await batchDelete(redis, keys, logger);
        logger.success(`[lush-cachify] Cleared pattern: pattern=${pattern}, deleted=${deleted}`);
        res.json({ deleted, pattern });
      });
      stream.on('error', (err: Error) => {
        logger.error(`[lush-cachify] Clear pattern error: ${err.message}`);
        res.status(500).json({ error: err.message });
      });
    } catch (err: any) {
      logger.error(`[lush-cachify] Clear pattern error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };
  router.delete('/clear-pattern', clearPatternHandler);

  // Export all matching key-value pairs as JSON
  router.get('/export', async (req, res) => {
    const pattern = req.query?.key ? `*${req.query?.key}*` : '*';
    const keys: string[] = [];
    try {
      const stream: ScanStream = redis.scanStream({ match: pattern, count: 1000 });
      stream.on('data', (resultKeys: string[]) => {
        keys.push(...resultKeys);
      });
      stream.on('end', async () => {
        const result: Record<string, any> = {};
        for (const key of keys) {
          try {
            const type = await redis.type(key);
            let value: any = null;
            if (type === 'string') {
              const raw = await redis.get(key);
              if (raw === null || raw === undefined) {
                value = null;
              } else {
                try {
                  value = JSON.parse(raw);
                } catch {
                  value = raw;
                }
              }
            } else if (type === 'ReJSON-RL' || type === 'json') {
              try {
                const raw = await redis.call('JSON.GET', key, '.');
                value = raw ? JSON.parse(raw as string) : null;
              } catch {
                value = null;
              }
            } else if (type === 'hash') {
              value = await redis.hgetall(key);
            } else if (type === 'list') {
              value = await redis.lrange(key, 0, -1);
            } else if (type === 'set') {
              value = await redis.smembers(key);
            } else if (type === 'zset') {
              value = await redis.zrange(key, 0, -1, 'WITHSCORES');
            } else {
              value = null;
            }
            result[key] = value;
          } catch (e) {
            result[key] = null;
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="cachify-export.json"');
        res.send(JSON.stringify(result, null, 2));
      });
      stream.on('error', (err: Error) => {
        logger.error(`[lush-cachify] Export error: ${err.message}`);
        res.status(500).json({ error: err.message });
      });
    } catch (err: any) {
      logger.error(`[lush-cachify] Export error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Serve a basic HTML UI at the base path from an external file
  const uiHandler: RequestHandler = (_req, res): void => {
    const uiPath = path.join(__dirname, 'ui.html');
    fs.readFile(uiPath, 'utf8', (err: NodeJS.ErrnoException | null, data: string) => {
      if (err) {
        logger.error(`[lush-cachify] UI file error: ${err.message}`);
        res.status(500).send('UI file not found');
      } else {
        logger.info('[lush-cachify] UI served');
        res.type('html').send(data);
      }
    });
  };
  router.get('/', uiHandler);

  // Global error handler
  router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(`[lush-cachify] Uncaught error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}