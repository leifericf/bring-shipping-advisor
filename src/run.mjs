import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnv, getOutputDir } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Compute the output directory once so all scripts use the same one,
// even if the pipeline runs across midnight.
const env = loadEnv();
const OUTPUT_DIR = getOutputDir(env.BRING_CUSTOMER_NUMBER);

const scripts = [
  { name: 'fetch_rates.mjs', desc: 'Fetching shipping rates' },
  { name: 'fetch_invoices.mjs', desc: 'Fetching invoices' },
  { name: 'analyze.mjs', desc: 'Analyzing data' },
];

console.log('Bring Shipping Rates - Full Pipeline\n');
console.log('='.repeat(50) + '\n');
console.log(`Output directory: ${OUTPUT_DIR}\n`);

for (const script of scripts) {
  console.log(`\n> ${script.desc}...\n`);
  console.log('-'.repeat(50));

  try {
    execSync(`node ${join(__dirname, script.name)}`, {
      stdio: 'inherit',
      env: { ...process.env, OUTPUT_DIR },
    });
  } catch (error) {
    console.error(`\nError running ${script.name}`);
    process.exit(1);
  }

  console.log('-'.repeat(50));
}

console.log('\n' + '='.repeat(50));
console.log('\nComplete! Check the data/ folder for results.\n');
