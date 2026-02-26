import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const scripts = [
  { name: 'fetch_rates.mjs', desc: 'Fetching shipping rates' },
  { name: 'fetch_invoices.mjs', desc: 'Fetching invoices' },
  { name: 'analyze.mjs', desc: 'Analyzing data' },
];

console.log('Bring Shipping Rates - Full Pipeline\n');
console.log('=' .repeat(50) + '\n');

for (const script of scripts) {
  console.log(`\n▶ ${script.desc}...\n`);
  console.log('-'.repeat(50));
  
  try {
    execSync(`node ${join(__dirname, script.name)}`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`\nError running ${script.name}`);
    process.exit(1);
  }
  
  console.log('-'.repeat(50));
}

console.log('\n' + '='.repeat(50));
console.log('\n✓ Complete! Check the data/ folder for results.\n');
