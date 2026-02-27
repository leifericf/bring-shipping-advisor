import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig } from './config.mjs';
import { createRun, updateRunStatus, closeDb } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_ENV_KEYS = ['BRING_API_UID', 'BRING_API_KEY', 'BRING_CUSTOMER_NUMBER'];

/**
 * Load credentials from process.env first, then fall back to .env file.
 * This allows the web server to pass credentials via environment variables
 * when spawning pipeline scripts for different accounts.
 */
function loadEnv() {
  const ROOT_DIR = join(__dirname, '..');
  const fromProcessEnv = REQUIRED_ENV_KEYS.every(k => process.env[k]);

  if (fromProcessEnv) {
    const env = {};
    for (const key of [...REQUIRED_ENV_KEYS, 'BRING_ORIGIN_POSTAL_CODE']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return env;
  }

  // Fall back to .env file
  const envPath = join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found. Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};

  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  const missing = REQUIRED_ENV_KEYS.filter(k => !env[k]);
  if (missing.length > 0) {
    console.error(`Error: Missing required .env variables: ${missing.join(', ')}`);
    console.error('Edit your .env file and fill in the missing values.');
    process.exit(1);
  }

  return env;
}

const env = loadEnv();
const config = loadConfig();

const ORIGIN_POSTAL_CODE = env.BRING_ORIGIN_POSTAL_CODE || '0174';

let runId;
if (process.env.RUN_ID) {
  runId = Number(process.env.RUN_ID);
} else {
  runId = createRun(env.BRING_CUSTOMER_NUMBER, ORIGIN_POSTAL_CODE, config);
}

const scripts = [
  { name: 'fetch_rates.mjs', desc: 'Fetching shipping rates', status: 'fetching_rates' },
  { name: 'fetch_invoices.mjs', desc: 'Fetching invoices', status: 'fetching_invoices' },
  { name: 'analyze.mjs', desc: 'Analyzing data', status: 'analyzing' },
];

console.log('Bring Shipping Analyzer - Full Pipeline\n');
console.log('='.repeat(50) + '\n');
console.log(`Run ID: ${runId}\n`);

for (const script of scripts) {
  console.log(`\n> ${script.desc}...\n`);
  console.log('-'.repeat(50));

  updateRunStatus(runId, script.status);

  try {
    execSync(`node ${join(__dirname, script.name)}`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        BRING_API_UID: env.BRING_API_UID,
        BRING_API_KEY: env.BRING_API_KEY,
        BRING_CUSTOMER_NUMBER: env.BRING_CUSTOMER_NUMBER,
        BRING_ORIGIN_POSTAL_CODE: ORIGIN_POSTAL_CODE,
        RUN_ID: String(runId),
      },
    });
  } catch (error) {
    updateRunStatus(runId, 'failed');
    closeDb();
    console.error(`\nError running ${script.name}`);
    process.exit(1);
  }

  console.log('-'.repeat(50));
}

updateRunStatus(runId, 'completed');
closeDb();

console.log('\n' + '='.repeat(50));
console.log('\nComplete! Results saved to database.\n');
