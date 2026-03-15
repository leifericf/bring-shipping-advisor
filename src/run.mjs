import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig } from './config.mjs';
import { updateRunStatus, closeDb } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RUN_ID = Number(process.env.RUN_ID);
if (!RUN_ID) {
  console.error('Error: RUN_ID environment variable is required.');
  process.exit(1);
}

// Validate that the server passed credentials
for (const key of ['BRING_API_UID', 'BRING_API_KEY', 'BRING_CUSTOMER_NUMBER']) {
  if (!process.env[key]) {
    console.error(`Error: ${key} environment variable is required.`);
    process.exit(1);
  }
}

// Validate config is available
loadConfig();

const scripts = [
  { name: 'fetch_rates.mjs', desc: 'Fetching shipping rates', status: 'fetching_rates' },
  { name: 'fetch_invoices.mjs', desc: 'Fetching invoices', status: 'fetching_invoices' },
  { name: 'analyze.mjs', desc: 'Analyzing data', status: 'analyzing' },
];

console.log('Bring Shipping Advisor - Full Pipeline\n');
console.log('='.repeat(50) + '\n');
console.log(`Run ID: ${RUN_ID}\n`);

for (const script of scripts) {
  console.log(`\n> ${script.desc}...\n`);
  console.log('-'.repeat(50));

  updateRunStatus(RUN_ID, script.status);

  try {
    execSync(`node ${join(__dirname, script.name)}`, {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (error) {
    updateRunStatus(RUN_ID, 'failed');
    closeDb();
    console.error(`\nError running ${script.name}`);
    process.exit(1);
  }

  console.log('-'.repeat(50));
}

updateRunStatus(RUN_ID, 'completed');
closeDb();

console.log('\n' + '='.repeat(50));
console.log('\nComplete! Results saved to database.\n');
