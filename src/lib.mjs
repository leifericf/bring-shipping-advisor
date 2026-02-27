import https from 'https';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(__dirname, '..');
export const DATA_DIR = join(ROOT_DIR, 'data');

/**
 * Returns the common authentication headers for Bring APIs.
 */
export function getAuthHeaders(env) {
  return {
    'X-Mybring-API-Uid': env.BRING_API_UID,
    'X-Mybring-API-Key': env.BRING_API_KEY,
  };
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff.
 * Retries on 5xx errors and network failures, not 4xx.
 */
export async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      // Retry server errors (5xx)
      if (!response.ok && attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`  Server error ${response.status}, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      if (attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`  Network error, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Make an HTTPS GET request using node:https.
 * Some Mybring API endpoints (e.g. XML report downloads) reject Node.js
 * fetch()/undici requests with 406, but work fine with node:https.
 * This helper provides a compatible alternative for those endpoints.
 */
export function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
