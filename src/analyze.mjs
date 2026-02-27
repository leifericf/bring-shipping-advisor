import fs from 'fs';
import { join } from 'path';
import { DATA_DIR, parseCsv } from './lib.mjs';
import { loadConfig } from './config.mjs';
import { getDb, getShippingRates, getInvoiceLineItems, insertAnalysisResult, closeDb } from './db.mjs';

const config = loadConfig();
const analysis = config.analysis;
const RUN_ID = process.env.RUN_ID ? Number(process.env.RUN_ID) : null;

/**
 * Round up to the next "nice" price ending in 9 (e.g. 59, 79, 149, 999).
 */
function nicePrice(value) {
  return Math.ceil((value - 9) / 10) * 10 + 9;
}

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

/**
 * Analyze invoice line items.
 * Excludes road toll and surcharge lines to count only actual shipments.
 */
function analyzeInvoices(lineItems) {
  const byProduct = {};
  const roadTolls = [];

  for (const item of lineItems) {
    const desc = item.description || '';

    // Collect road toll values separately
    if (desc.includes('Road toll')) {
      const price = parseFloat(item.agreement_price) || 0;
      if (price > 0) roadTolls.push(price);
      continue;
    }

    // Skip surcharge lines
    if (desc.includes('Surcharge')) continue;

    const key = `${item.product_code} - ${item.product}`;
    if (!byProduct[key]) {
      byProduct[key] = { count: 0, totalAgreement: 0, weights: [] };
    }

    byProduct[key].count++;
    byProduct[key].totalAgreement += parseFloat(item.agreement_price) || 0;
    if (item.weight_kg) {
      byProduct[key].weights.push(parseFloat(item.weight_kg));
    }
  }

  const avgRoadToll = roadTolls.length > 0
    ? roadTolls.reduce((a, b) => a + b, 0) / roadTolls.length
    : 0;

  return { byProduct, avgRoadToll };
}

/**
 * Group invoice line items into per-shipment profiles.
 * Sums all costs (parcel + road toll + surcharge) per shipment
 * and extracts weight from the parcel line.
 */
function buildShipmentProfiles(lineItems) {
  const shipments = new Map();

  for (const item of lineItems) {
    const key = item.shipment_number;
    if (!shipments.has(key)) {
      shipments.set(key, {
        productCode: item.product_code,
        toPostalCode: item.to_postal_code,
        toCity: item.to_city,
        weight: null,
        totalCost: 0,
      });
    }

    const s = shipments.get(key);
    s.totalCost += parseFloat(item.agreement_price) || 0;

    const desc = item.description || '';
    if (!desc.includes('Road toll') && !desc.includes('Surcharge') && item.weight_kg) {
      s.weight = parseFloat(item.weight_kg);
    }
  }

  return shipments;
}

/**
 * Generate a profitability analysis section for RESULTS.md.
 * Cross-references actual invoice costs against suggested Shopify rates.
 */
function generateProfitabilitySection(lineItems, rates, roadToll) {
  const primaryService = analysis.primaryDomesticService;
  const safeZone = analysis.safeDefaultZone;
  const vatMultiplier = analysis.vatMultiplier;

  const shipments = buildShipmentProfiles(lineItems);
  const domesticRates = rates.filter(r => r.country_code === config.originCountry && r.service_id === primaryService);

  const brackets = analysis.domesticShopifyBrackets.map(b => ({
    name: b.name,
    maxWeight: b.maxWeight ?? Infinity,
    rateWeight: b.rateWeight,
    shipments: [],
  }));

  // Compute suggested Shopify price for each bracket from safe default zone rates
  for (const bracket of brackets) {
    const rate = domesticRates.find(r => r.zone === safeZone && String(r.weight_g) === bracket.rateWeight);
    if (rate) {
      bracket.shopifyPrice = nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * vatMultiplier));
      bracket.revenueExVat = bracket.shopifyPrice / vatMultiplier;
    }
  }

  // Assign domestic shipments to brackets
  for (const [, s] of shipments) {
    if (s.productCode !== primaryService || s.weight === null) continue;
    const bracket = brackets.find(b => s.weight <= b.maxWeight);
    if (bracket) {
      bracket.shipments.push({
        weight: s.weight,
        totalCost: s.totalCost,
        toCity: s.toCity,
        toPostalCode: s.toPostalCode,
        revenueExVat: bracket.revenueExVat,
        margin: bracket.revenueExVat - s.totalCost,
      });
    }
  }

  const totalShipments = brackets.reduce((sum, b) => sum + b.shipments.length, 0);

  let md = `## Profitability Analysis\n\n`;
  md += `Based on ${totalShipments} domestic shipments (service ${primaryService}) from invoice data,\n`;
  md += `projected against suggested Shopify rates (Zone ${safeZone} pricing).\n`;
  md += `Cost = actual invoice cost per shipment (parcel + road toll + any surcharges).\n\n`;

  // Per-bracket summary table
  md += `### Per-Bracket Summary\n\n`;
  md += `| Bracket | Shipments | Avg Cost | Shopify Rate | Revenue ex VAT | Avg Margin | Total Margin |\n`;
  md += `|---------|-----------|----------|-------------|----------------|------------|-------------|\n`;

  let grandTotalMargin = 0;
  let grandTotalCost = 0;
  let grandTotalRevenue = 0;

  for (const bracket of brackets) {
    const n = bracket.shipments.length;
    if (n === 0) {
      md += `| ${bracket.name} | 0 | — | ${bracket.shopifyPrice} kr | ${bracket.revenueExVat.toFixed(2)} NOK | — | — |\n`;
      continue;
    }

    const totalCost = bracket.shipments.reduce((sum, s) => sum + s.totalCost, 0);
    const avgCost = totalCost / n;
    const totalMargin = bracket.shipments.reduce((sum, s) => sum + s.margin, 0);
    const avgMargin = totalMargin / n;
    const totalRevenue = bracket.revenueExVat * n;

    grandTotalMargin += totalMargin;
    grandTotalCost += totalCost;
    grandTotalRevenue += totalRevenue;

    const sign = avgMargin >= 0 ? '+' : '';
    const totalSign = totalMargin >= 0 ? '+' : '';

    md += `| ${bracket.name} | ${n} | ${avgCost.toFixed(2)} NOK | ${bracket.shopifyPrice} kr | ${bracket.revenueExVat.toFixed(2)} NOK | ${sign}${avgMargin.toFixed(2)} NOK | ${totalSign}${totalMargin.toFixed(2)} NOK |\n`;
  }

  // Total row
  const avgMarginAll = totalShipments > 0 ? grandTotalMargin / totalShipments : 0;
  const totalSign = grandTotalMargin >= 0 ? '+' : '';
  const avgSign = avgMarginAll >= 0 ? '+' : '';
  const marginPct = grandTotalRevenue > 0 ? ((grandTotalMargin / grandTotalRevenue) * 100).toFixed(1) : '0.0';
  md += `| **Total** | **${totalShipments}** | | | | **${avgSign}${avgMarginAll.toFixed(2)} NOK/parcel** | **${totalSign}${grandTotalMargin.toFixed(2)} NOK** |\n`;
  md += `\nOverall margin: ${marginPct}% of revenue ex VAT.\n\n`;

  // Loss-making shipments
  const lossMaking = [];
  for (const bracket of brackets) {
    for (const s of bracket.shipments) {
      if (s.margin < 0) {
        lossMaking.push({ ...s, bracket: bracket.name });
      }
    }
  }

  if (lossMaking.length > 0) {
    lossMaking.sort((a, b) => a.margin - b.margin); // worst first

    md += `### Loss-Making Shipments\n\n`;
    md += `${lossMaking.length} out of ${totalShipments} shipments would still lose money at Zone ${safeZone} pricing:\n\n`;
    md += `| Bracket | City | Postal Code | Weight | Cost | Revenue ex VAT | Loss |\n`;
    md += `|---------|------|------------|--------|------|----------------|------|\n`;

    for (const s of lossMaking) {
      md += `| ${s.bracket} | ${s.toCity} | ${s.toPostalCode} | ${s.weight} kg | ${s.totalCost.toFixed(2)} NOK | ${s.revenueExVat.toFixed(2)} NOK | ${s.margin.toFixed(2)} NOK |\n`;
    }

    md += `\nThese are shipments to remote zones where Zone ${safeZone} pricing doesn't fully cover costs.\n`;
    md += `Consider whether the volume to these areas justifies raising prices further.\n\n`;
  } else {
    md += `All ${totalShipments} shipments would be profitable at the suggested Zone ${safeZone} rates.\n\n`;
  }

  // Worst case per bracket
  md += `### Worst-Case Shipment per Bracket\n\n`;
  md += `The most expensive shipment in each bracket — your "floor" for margin evaluation:\n\n`;
  md += `| Bracket | City | Weight | Cost | Revenue ex VAT | Margin |\n`;
  md += `|---------|------|--------|------|----------------|--------|\n`;

  for (const bracket of brackets) {
    if (bracket.shipments.length === 0) continue;
    const worst = bracket.shipments.reduce((a, b) => a.totalCost > b.totalCost ? a : b);
    const sign = worst.margin >= 0 ? '+' : '';
    md += `| ${bracket.name} | ${worst.toCity} | ${worst.weight} kg | ${worst.totalCost.toFixed(2)} NOK | ${bracket.revenueExVat.toFixed(2)} NOK | ${sign}${worst.margin.toFixed(2)} NOK |\n`;
  }

  md += `\n`;

  return md;
}

/**
 * Generate the RESULTS.md markdown report.
 */
function generateResultsMd(rates, invoiceAnalysis, lineItems) {
  const { byProduct, avgRoadToll } = invoiceAnalysis;
  const roadToll = Math.round(avgRoadToll * 100) / 100;

  const primaryService = analysis.primaryDomesticService;
  const cheapestIntl = analysis.cheapestInternationalService;
  const vatMultiplier = analysis.vatMultiplier;
  const safeZone = analysis.safeDefaultZone;
  const zoneCount = analysis.domesticZoneCount;
  const countryNames = config.countryNames;
  const { nordic: nordicCodes, remote: remoteCodes } = analysis.countryGroupings;

  let md = `# Shipping Rate Analysis

Generated: ${new Date().toISOString()}

## Key Findings

1. **Main service used**: \`${primaryService}\` (Home Mailbox Parcel) - cheapest domestic option
2. **${primaryService} is Norway-only** - not available for international shipping
3. **International shipping** uses \`${cheapestIntl}\` - cheapest option
4. **Road toll**: ~${roadToll} NOK per shipment (Norway only, derived from invoice data)

`;

  // Invoice summary — show top products by shipment count
  const sortedProducts = Object.entries(byProduct)
    .filter(([, stats]) => stats.count > 0)
    .sort((a, b) => b[1].count - a[1].count);

  if (sortedProducts.length > 0) {
    md += `## Actual Shipment Data (from invoices)\n\n`;

    for (const [product, stats] of sortedProducts) {
      const avgPrice = (stats.totalAgreement / stats.count).toFixed(2);
      const avgWeight = stats.weights.length > 0
        ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2)
        : 'N/A';

      md += `### ${product}\n\n`;
      md += `- **Total shipments**: ${stats.count}\n`;
      md += `- **Total paid**: ${stats.totalAgreement.toFixed(2)} NOK\n`;
      md += `- **Average per shipment**: ${avgPrice} NOK\n`;
      md += `- **Average weight**: ${avgWeight} kg\n\n`;
    }
  }

  // Norway rate recommendations
  const domesticRates = rates.filter(r => r.country_code === config.originCountry && r.service_id === primaryService);
  const weightTiers = analysis.domesticWeightTiers;

  md += `## Recommended Shipping Rates

### Norway (includes ${Math.round((vatMultiplier - 1) * 100)}% VAT)

**Zone 1 (Oslo area) — optimistic pricing:**

| Weight Tier | Cost ex VAT | + Road Toll | With ${Math.round((vatMultiplier - 1) * 100)}% VAT |
|-------------|-------------|-------------|---------------|
`;

  for (const tier of weightTiers) {
    const zone1Rate = domesticRates.find(r => r.zone === '1' && String(r.weight_g) === tier.key);
    if (zone1Rate) {
      const price = parseFloat(zone1Rate.price_nok);
      const withToll = price + roadToll;
      const withVat = Math.ceil(withToll * vatMultiplier);
      md += `| ${tier.name} | ${price.toFixed(2)} NOK | ${withToll.toFixed(2)} NOK | ${withVat} NOK |\n`;
    }
  }

  md += `\n**Zone ${safeZone} (Bergen/mid-Norway) — safer, covers most of Norway:**

| Weight Tier | Cost ex VAT | + Road Toll | With ${Math.round((vatMultiplier - 1) * 100)}% VAT |
|-------------|-------------|-------------|---------------|
`;

  for (const tier of weightTiers) {
    const safeZoneRate = domesticRates.find(r => r.zone === safeZone && String(r.weight_g) === tier.key);
    if (safeZoneRate) {
      const price = parseFloat(safeZoneRate.price_nok);
      const withToll = price + roadToll;
      const withVat = Math.ceil(withToll * vatMultiplier);
      md += `| ${tier.name} | ${price.toFixed(2)} NOK | ${withToll.toFixed(2)} NOK | ${withVat} NOK |\n`;
    }
  }

  // International recommendations
  const intlWeightColumns = analysis.internationalWeightColumns;
  const intlWeightHeaders = intlWeightColumns.map(w => {
    const grams = parseInt(w, 10);
    return grams >= 1000 ? `${grams / 1000}kg` : `${grams}g`;
  });

  md += `\n### International (no VAT)

| Country | ${intlWeightHeaders.join(' | ')} |
|---------|${intlWeightHeaders.map(() => '------').join('|')}|
`;

  for (const [code, name] of Object.entries(countryNames)) {
    const cells = intlWeightColumns.map(w => {
      const rate = rates.find(r =>
        r.country_code === code &&
        r.service_id === cheapestIntl &&
        String(r.weight_g) === w
      );
      return rate ? `${Math.ceil(parseFloat(rate.price_nok))} NOK` : 'N/A';
    });
    md += `| ${name} | ${cells.join(' | ')} |\n`;
  }

  // Full zone pricing table for primary domestic service
  const zonePricingCols = analysis.zonePricingColumns;
  const zonePricingHeaders = zonePricingCols.map(w => {
    const grams = parseInt(w, 10);
    return grams >= 1000 ? `${grams / 1000}kg` : `${grams}g`;
  });

  md += `\n## Norway Zone Pricing (Service ${primaryService})

| Zone | ${zonePricingHeaders.join(' | ')} |
|------|${zonePricingHeaders.map(() => '------').join('|')}|
`;

  for (let zone = 1; zone <= zoneCount; zone++) {
    const zoneStr = String(zone);
    const cells = zonePricingCols.map(w => {
      const rate = domesticRates.find(r => r.zone === zoneStr && String(r.weight_g) === w);
      return rate ? `${parseFloat(rate.price_nok).toFixed(2)} NOK` : 'N/A';
    });
    md += `| ${zone} | ${cells.join(' | ')} |\n`;
  }

  // Suggested Shopify rates — simplified tiers
  const shopifyBrackets = analysis.domesticShopifyBrackets.map(b => ({
    name: b.name,
    weight: b.rateWeight,
  }));
  const zonesForTable = analysis.zonesForShopifyTable;
  const zoneLabels = { '1': 'Oslo', '3': 'Bergen', '7': 'Finnmark' };

  md += `\n## Suggested Shopify Rates

Prices rounded up to the next "nice" price ending in 9.

### Norway — Service ${primaryService} (incl. road toll + ${Math.round((vatMultiplier - 1) * 100)}% VAT)

| Weight | ${zonesForTable.map(z => `Zone ${z} (${zoneLabels[z] || z})`).join(' | ')} |
|--------|${zonesForTable.map(() => '-------------------').join('|')}|
`;

  for (const bracket of shopifyBrackets) {
    const cells = zonesForTable.map(zone => {
      const rate = domesticRates.find(r => r.zone === zone && String(r.weight_g) === bracket.weight);
      if (!rate) return 'N/A';
      return `${nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * vatMultiplier))} kr`;
    });
    md += `| ${bracket.name} | ${cells.join(' | ')} |\n`;
  }

  // International Shopify brackets
  const intlShopifyBrackets = analysis.internationalShopifyBrackets;

  md += `\n### International — ${cheapestIntl} (no VAT)

${cheapestIntl} has a minimum price that covers all packages up to 1 kg, so only two weight brackets are needed.

| Country | ${intlShopifyBrackets.map(b => b.name).join(' | ')} |
|---------|${intlShopifyBrackets.map(() => '-------').join('|')}|
`;

  for (const [code, name] of Object.entries(countryNames)) {
    const cells = intlShopifyBrackets.map(b => {
      const rate = rates.find(r =>
        r.country_code === code &&
        r.service_id === cheapestIntl &&
        String(r.weight_g) === b.weight
      );
      return rate ? `${nicePrice(Math.ceil(parseFloat(rate.price_nok)))} kr` : 'N/A';
    });
    md += `| ${name} | ${cells.join(' | ')} |\n`;
  }

  // Simplified recommendation
  // Group Nordics and remote — use the highest price in each group
  const intlBracketWeights = intlShopifyBrackets.map(b => b.weight);
  const nordicMax = {};
  const remoteMax = {};
  for (const w of intlBracketWeights) {
    const nordicPrices = nordicCodes.map(code => {
      const r = rates.find(r => r.country_code === code && r.service_id === cheapestIntl && String(r.weight_g) === w);
      return r ? Math.ceil(parseFloat(r.price_nok)) : 0;
    });
    nordicMax[w] = nicePrice(Math.max(...nordicPrices));

    const remotePrices = remoteCodes.map(code => {
      const r = rates.find(r => r.country_code === code && r.service_id === cheapestIntl && String(r.weight_g) === w);
      return r ? Math.ceil(parseFloat(r.price_nok)) : 0;
    });
    remoteMax[w] = nicePrice(Math.max(...remotePrices));
  }

  // Safe default zone pricing for Norway
  const norwaySimple = shopifyBrackets.map(b => {
    const rate = domesticRates.find(r => r.zone === safeZone && String(r.weight_g) === b.weight);
    return rate ? `${nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * vatMultiplier))} kr` : 'N/A';
  });

  const nordicCountryList = nordicCodes.map(c => countryNames[c]).filter(Boolean).join(' / ');
  const remoteCountryList = remoteCodes.map(c => countryNames[c]).filter(Boolean).join(' / ');

  md += `\n### Simplified recommendation

| Destination | ${shopifyBrackets.map(b => b.name).join(' | ')} |
|-------------|${shopifyBrackets.map(() => '----------').join('|')}|
| Norway | ${norwaySimple.join(' | ')} |
| ${nordicCountryList} | ${intlBracketWeights.map(w => `${nordicMax[w]} kr`).join(' | ')} |
| ${remoteCountryList} | ${intlBracketWeights.map(w => `${remoteMax[w]} kr`).join(' | ')} |

Norway uses Zone ${safeZone} pricing (covers most of the country). Nordic and remote groups use the highest price in each group so you never lose money.
International only needs two Shopify weight brackets (${intlShopifyBrackets.map(b => b.name).join(' and ')}) since ${cheapestIntl} pricing is flat up to 1 kg.

`;

  md += generateProfitabilitySection(lineItems, rates, roadToll);

  md += `## Notes

- **Zone risk**: Zone 1 prices are cheapest. Shipping to Zone ${zoneCount} (Finnmark) costs roughly 2x Zone 1.
- **Weight limits**: ${primaryService} max 5kg, ${cheapestIntl} max 20kg
- **Road toll**: ~${roadToll} NOK per Norway shipment (avg from invoices, included in recommendations above)
- **Zone numbers can differ per service** for the same postal code — the zone table above is for service ${primaryService} only
`;

  return md;
}

async function main() {
  const outputDir = process.env.OUTPUT_DIR || findLatestDataDir();
  console.log(`Analyzing data from: ${outputDir}\n`);

  let rates, lineItems;

  // Prefer reading from database when we have a run ID
  if (RUN_ID) {
    console.log(`Reading data from database (run ${RUN_ID})...`);
    rates = getShippingRates(RUN_ID).map(r => ({
      ...r,
      weight_g: String(r.weight_g),
      price_nok: String(r.price_nok),
    }));
    lineItems = getInvoiceLineItems(RUN_ID).map(r => ({
      ...r,
      weight_kg: r.weight_kg != null ? String(r.weight_kg) : '',
      agreement_price: String(r.agreement_price),
      gross_price: String(r.gross_price),
      discount: String(r.discount),
    }));
    console.log(`Loaded ${rates.length} shipping rates from DB`);
    console.log(`Loaded ${lineItems.length} invoice line items from DB\n`);
  } else {
    // Fall back to CSV files
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

    rates = parseCsv(fs.readFileSync(ratesPath, 'utf8'));
    lineItems = parseCsv(fs.readFileSync(invoicesPath, 'utf8'));
    console.log(`Loaded ${rates.length} shipping rates`);
    console.log(`Loaded ${lineItems.length} invoice line items\n`);
  }

  // Analyze
  const invoiceAnalysis = analyzeInvoices(lineItems);

  // Generate RESULTS.md
  const resultsMd = generateResultsMd(rates, invoiceAnalysis, lineItems);
  fs.writeFileSync(join(outputDir, 'RESULTS.md'), resultsMd);

  // Save to database if we have a run ID
  if (RUN_ID) {
    insertAnalysisResult(RUN_ID, resultsMd);
    closeDb();
  }

  console.log(`Generated ${outputDir}/RESULTS.md`);
}

main().catch(console.error);
