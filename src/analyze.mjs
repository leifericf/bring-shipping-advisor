import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DATA_DIR = join(ROOT_DIR, 'data');

function findLatestDataDir() {
  const dirs = fs.readdirSync(DATA_DIR)
    .filter(name => fs.statSync(join(DATA_DIR, name)).isDirectory())
    .sort()
    .reverse();
  
  if (dirs.length === 0) {
    console.error('No data directories found. Run fetch_rates.mjs and fetch_invoices.mjs first.');
    process.exit(1);
  }
  
  return join(DATA_DIR, dirs[0]);
}

function parseCsv(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.match(/(?:^|,)("(?:[^"]*(?:""[^"]*)*)"|[^,]*)/g);
    if (!values) return null;
    const obj = {};
    headers.forEach((h, i) => {
      let val = values[i] || '';
      val = val.replace(/^,?"?|"?$/g, '').replace(/""/g, '"');
      obj[h.trim()] = val;
    });
    return obj;
  }).filter(r => r);
}

function analyzeShippingRates(rates) {
  const norway3584 = rates.filter(r => r.country_code === 'NO' && r.service_id === '3584');
  
  const zonePrices = {};
  for (let zone = 1; zone <= 7; zone++) {
    const zoneRates = norway3584.filter(r => r.zone === String(zone) && r.weight_g === '250');
    if (zoneRates.length > 0) {
      zonePrices[zone] = parseFloat(zoneRates[0].price_nok);
    }
  }
  
  const intlPickup = {};
  const countries = ['SE', 'DK', 'FI', 'IS', 'GL', 'FO'];
  const weights = ['250', '750', '5000'];
  
  for (const country of countries) {
    intlPickup[country] = {};
    for (const weight of weights) {
      const rate = rates.find(r => 
        r.country_code === country && 
        r.service_id === 'PICKUP_PARCEL' && 
        r.weight_g === weight
      );
      if (rate) {
        intlPickup[country][weight] = parseFloat(rate.price_nok);
      }
    }
  }
  
  return { zonePrices, intlPickup };
}

function analyzeInvoices(lineItems) {
  const byProduct = {};
  
  for (const item of lineItems) {
    const key = `${item.product_code} - ${item.product}`;
    if (!byProduct[key]) {
      byProduct[key] = { count: 0, totalAgreement: 0, weights: [] };
    }
    
    // Only count main product lines (not road toll, surcharges, etc.)
    if (item.description && item.description.includes(item.product_code) && 
        (item.description.includes('Mailbox parcel') || 
         item.description.includes('Letter parcel') ||
         item.description.includes('parcel'))) {
      byProduct[key].count++;
      byProduct[key].totalAgreement += parseFloat(item.agreement_price) || 0;
      if (item.weight_kg) {
        byProduct[key].weights.push(parseFloat(item.weight_kg));
      }
    }
  }
  
  return byProduct;
}

function generateResultsMd(ratesAnalysis, invoiceAnalysis, outputDir) {
  const { zonePrices, intlPickup } = ratesAnalysis;
  const roadToll = 2.65;
  
  let md = `# Shipping Rate Analysis

Generated: ${new Date().toISOString()}

## Key Findings

1. **Main service used**: \`3584\` (Home Mailbox Parcel) - cheapest domestic option
2. **3584 is Norway-only** - not available for international shipping
3. **International shipping** uses \`PICKUP_PARCEL\` - cheapest option
4. **Road toll**: ~${roadToll} NOK per shipment (Norway only)

`;

  // Invoice summary
  const mainProduct = Object.entries(invoiceAnalysis)
    .sort((a, b) => b[1].count - a[1].count)[0];
  
  if (mainProduct && mainProduct[1].count > 0) {
    const stats = mainProduct[1];
    const avgPrice = (stats.totalAgreement / stats.count).toFixed(2);
    const avgWeight = stats.weights.length > 0 
      ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2) 
      : 'N/A';
    
    md += `## Actual Shipment Data (from invoices)

- **Service**: ${mainProduct[0]}
- **Total shipments**: ${stats.count}
- **Total paid**: ${stats.totalAgreement.toFixed(2)} NOK
- **Average per shipment**: ${avgPrice} NOK
- **Average weight**: ${avgWeight} kg

`;
  }

  // Norway recommendations
  md += `## Recommended Shipping Rates

### Norway (includes 25% VAT)

Using Zone 1 (Oslo area) prices:

| Weight Tier | Cost ex VAT | With VAT | Charge Customer |
|-------------|-------------|----------|-----------------|
`;

  const tiers = [
    { name: '0-500g', weight: '250' },
    { name: '500g-1kg', weight: '750' },
    { name: '1kg+', weight: '5000' },
  ];

  for (const tier of tiers) {
    const basePrice = zonePrices[1] || 0;
    // Get price for this weight tier from Zone 1
    const zone1Rates = tier.weight === '250' ? zonePrices[1] : 
                       tier.weight === '750' ? (zonePrices[1] * 1.2) : 
                       (zonePrices[1] * 2.2);
    
    // Actually, let me get the real prices from the data
  }

  // Get actual prices from the CSV data
  const ratesCsv = fs.readFileSync(join(outputDir, 'shipping_rates.csv'), 'utf8');
  const rates = parseCsv(ratesCsv);
  
  const norway3584 = rates.filter(r => r.country_code === 'NO' && r.service_id === '3584');
  
  md = `# Shipping Rate Analysis

Generated: ${new Date().toISOString()}

## Key Findings

1. **Main service used**: \`3584\` (Home Mailbox Parcel) - cheapest domestic option
2. **3584 is Norway-only** - not available for international shipping
3. **International shipping** uses \`PICKUP_PARCEL\` - cheapest option
4. **Road toll**: ~${roadToll} NOK per shipment (Norway only)

`;

  // Invoice summary
  if (mainProduct && mainProduct[1].count > 0) {
    const stats = mainProduct[1];
    const avgPrice = (stats.totalAgreement / stats.count).toFixed(2);
    const avgWeight = stats.weights.length > 0 
      ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2) 
      : 'N/A';
    
    md += `## Actual Shipment Data (from invoices)

- **Service**: ${mainProduct[0]}
- **Total shipments**: ${stats.count}
- **Total paid**: ${stats.totalAgreement.toFixed(2)} NOK
- **Average per shipment**: ${avgPrice} NOK
- **Average weight**: ${avgWeight} kg

`;
  }

  md += `## Recommended Shipping Rates

### Norway (includes 25% VAT)

Using Zone 1 (Oslo area) prices:

| Weight Tier | Charge |
|-------------|--------|
`;

  for (const tier of tiers) {
    const zone1Rate = norway3584.find(r => r.zone === '1' && r.weight_g === tier.weight);
    if (zone1Rate) {
      const price = parseFloat(zone1Rate.price_nok);
      const withToll = price + roadToll;
      const withVat = Math.ceil(withToll * 1.25);
      md += `| ${tier.name} | ${withVat} NOK |\n`;
    }
  }

  md += `\n**Alternative (Zone 3 - safer, covers more of Norway):**

| Weight Tier | Charge |
|-------------|--------|
`;

  for (const tier of tiers) {
    const zone3Rate = norway3584.find(r => r.zone === '3' && r.weight_g === tier.weight);
    if (zone3Rate) {
      const price = parseFloat(zone3Rate.price_nok);
      const withToll = price + roadToll;
      const withVat = Math.ceil(withToll * 1.25);
      md += `| ${tier.name} | ${withVat} NOK |\n`;
    }
  }

  md += `
### International (no VAT)

| Country | 0-500g | 500g-1kg | 1kg+ |
|---------|--------|----------|------|
`;

  const countryNames = {
    'SE': 'Sweden',
    'DK': 'Denmark',
    'FI': 'Finland',
    'IS': 'Iceland',
    'GL': 'Greenland',
    'FO': 'Faroe Islands'
  };

  for (const [code, name] of Object.entries(countryNames)) {
    const p250 = rates.find(r => r.country_code === code && r.service_id === 'PICKUP_PARCEL' && r.weight_g === '250');
    const p750 = rates.find(r => r.country_code === code && r.service_id === 'PICKUP_PARCEL' && r.weight_g === '750');
    const p5000 = rates.find(r => r.country_code === code && r.service_id === 'PICKUP_PARCEL' && r.weight_g === '5000');
    
    const v250 = p250 ? Math.ceil(parseFloat(p250.price_nok)) : 'N/A';
    const v750 = p750 ? Math.ceil(parseFloat(p750.price_nok)) : 'N/A';
    const v5000 = p5000 ? Math.ceil(parseFloat(p5000.price_nok)) : 'N/A';
    
    md += `| ${name} | ${v250} NOK | ${v750} NOK | ${v5000} NOK |\n`;
  }

  md += `
## Norway Zone Pricing (Service 3584)

| Zone | 250g Price |
|------|------------|
`;

  for (let zone = 1; zone <= 7; zone++) {
    const rate = norway3584.find(r => r.zone === String(zone) && r.weight_g === '250');
    if (rate) {
      md += `| ${zone} | ${parseFloat(rate.price_nok).toFixed(2)} NOK |\n`;
    }
  }

  md += `
## Notes

- **Zone risk**: Using Zone 1 prices. Shipping to Zone 7 (Finnmark) costs more per package.
- **Weight limits**: 3584 max 5kg, PickUp Parcel max 20kg
- **Road toll**: ~${roadToll} NOK per Norway shipment (included in recommendations above)
`;

  return md;
}

async function main() {
  const outputDir = findLatestDataDir();
  console.log(`Analyzing data from: ${outputDir}\n`);
  
  // Check for required files
  const ratesPath = join(outputDir, 'shipping_rates.csv');
  const invoicesPath = join(outputDir, 'invoice_line_items.csv');
  
  if (!fs.existsSync(ratesPath)) {
    console.error('shipping_rates.csv not found. Run fetch_rates.mjs first.');
    process.exit(1);
  }
  
  if (!fs.existsSync(invoicesPath)) {
    console.error('invoice_line_items.csv not found. Run fetch_invoices.mjs first.');
    process.exit(1);
  }
  
  // Read and parse data
  const rates = parseCsv(fs.readFileSync(ratesPath, 'utf8'));
  const lineItems = parseCsv(fs.readFileSync(invoicesPath, 'utf8'));
  
  console.log(`Loaded ${rates.length} shipping rates`);
  console.log(`Loaded ${lineItems.length} invoice line items\n`);
  
  // Analyze
  const ratesAnalysis = analyzeShippingRates(rates);
  const invoiceAnalysis = analyzeInvoices(lineItems);
  
  // Generate RESULTS.md
  const resultsMd = generateResultsMd(ratesAnalysis, invoiceAnalysis, outputDir);
  fs.writeFileSync(join(outputDir, 'RESULTS.md'), resultsMd);
  
  console.log(`Generated ${outputDir}/RESULTS.md`);
}

main().catch(console.error);
