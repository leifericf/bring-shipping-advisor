import { execSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DATA_DIR = join(ROOT_DIR, 'data');

function loadEnv() {
  const envPath = join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found. Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of envContent.split('\n')) {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  }
  return env;
}

function getOutputDir(customerNumber) {
  const now = new Date();
  const dateStr = now.toISOString().substring(0, 10);
  return join(DATA_DIR, `${dateStr}_${customerNumber}`);
}

const env = loadEnv();

const API_UID = env.BRING_API_UID;
const API_KEY = env.BRING_API_KEY;
const CUSTOMER_NUMBER = env.BRING_CUSTOMER_NUMBER;
const OUTPUT_DIR = getOutputDir(CUSTOMER_NUMBER);

const INVOICES_URL = 'https://www.mybring.com/invoicearchive/api/invoices';
const INVOICE_PDF_URL = 'https://www.mybring.com/invoicearchive/pdf';
const REPORTS_GENERATE_URL = 'https://www.mybring.com/reports/api/generate';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function curlJson(url) {
  const cmd = `curl -s '${url}' -H 'X-Mybring-API-Uid: ${API_UID}' -H 'X-Mybring-API-Key: ${API_KEY}' -H 'Accept: application/json'`;
  return JSON.parse(execSync(cmd, { encoding: 'utf8' }));
}

function curlXml(url) {
  const cmd = `curl -s '${url}' -H 'X-Mybring-API-Uid: ${API_UID}' -H 'X-Mybring-API-Key: ${API_KEY}' -H 'Accept: application/xml'`;
  return execSync(cmd, { encoding: 'utf8' });
}

function downloadPdf(invoiceNumber, outputPath) {
  const url = `${INVOICE_PDF_URL}/${CUSTOMER_NUMBER}/${invoiceNumber}.pdf`;
  const cmd = `curl -s '${url}' -H 'X-Mybring-API-Uid: ${API_UID}' -H 'X-Mybring-API-Key: ${API_KEY}' -o '${outputPath}'`;
  execSync(cmd, { encoding: 'utf8' });
}

async function getInvoices() {
  const data = curlJson(`${INVOICES_URL}/${CUSTOMER_NUMBER}.json`);
  return data.invoices || [];
}

async function generateInvoiceReport(invoiceNumber) {
  const data = curlJson(`${REPORTS_GENERATE_URL}/${CUSTOMER_NUMBER}/MASTER-SPECIFIED_INVOICE?invoiceNumber=${invoiceNumber}`);
  return data.statusUrl;
}

async function waitForReport(statusUrl) {
  for (let attempts = 0; attempts < 30; attempts++) {
    const data = curlJson(statusUrl);
    if (data.status === 'DONE') return { xmlUrl: data.xmlUrl, xlsUrl: data.xlsUrl };
    if (data.status === 'FAILED') throw new Error('Report generation failed');
    await sleep(2000);
  }
  throw new Error('Report generation timeout');
}

function parseXmlInvoice(xml) {
  const lines = [];
  for (const match of xml.matchAll(/<Line>([\s\S]*?)<\/Line>/g)) {
    const lineXml = match[1];
    const getText = (tag) => lineXml.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`))?.[1]?.trim() || '';
    lines.push({
      invoiceNumber: getText('InvoiceNumber'),
      invoiceDate: getText('InvoiceDate'),
      shipmentNumber: getText('ShipmentNumber'),
      packageNumber: getText('PackageNumber'),
      productCode: getText('ProductCode'),
      product: getText('Product'),
      description: getText('Description'),
      weightKg: parseFloat(getText('WeightKg')) || null,
      grossPrice: parseFloat(getText('GrossPrice')) || 0,
      discount: parseFloat(getText('Discount')) || 0,
      agreementPrice: parseFloat(getText('AgreementPrice')) || 0,
      currency: getText('CurrencyCode'),
      fromPostalCode: getText('SentFromPostalCode'),
      toPostalCode: getText('SentToPostalCode'),
      toCity: getText('SentToCity'),
      toCountry: getText('DELIVERY_COUNTRY'),
    });
  }
  return lines;
}

async function main() {
  fs.mkdirSync(join(OUTPUT_DIR, 'invoices'), { recursive: true });
  
  console.log('Fetching invoices...\n');
  console.log(`Customer Number: ${CUSTOMER_NUMBER}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);
  
  const invoices = await getInvoices();
  console.log(`Found ${invoices.length} invoices\n`);
  
  const allLineItems = [];
  
  for (const invoice of invoices) {
    console.log(`Processing invoice ${invoice.invoiceNumber} (${invoice.invoiceDate})...`);
    console.log(`  Amount: ${invoice.totalAmount} ${invoice.currency}`);
    
    // Download PDF
    console.log('  Downloading PDF...');
    const pdfPath = join(OUTPUT_DIR, 'invoices', `${invoice.invoiceNumber}.pdf`);
    try {
      downloadPdf(invoice.invoiceNumber, pdfPath);
      console.log(`  Saved to invoices/${invoice.invoiceNumber}.pdf`);
    } catch (error) {
      console.log(`  PDF download failed: ${error.message}`);
    }
    
    if (!invoice.invoiceSpecificationAvailable) {
      console.log('  No specification available, skipping line items...\n');
      continue;
    }
    
    try {
      console.log('  Generating report...');
      const statusUrl = await generateInvoiceReport(invoice.invoiceNumber);
      console.log('  Waiting for report...');
      const report = await waitForReport(statusUrl);
      console.log('  Fetching XML...');
      const xml = curlXml(report.xmlUrl);
      const lines = parseXmlInvoice(xml);
      console.log(`  Found ${lines.length} line items\n`);
      allLineItems.push(...lines);
    } catch (error) {
      console.log(`  Error: ${error.message}\n`);
    }
    await sleep(1000);
  }
  
  console.log('\n=== SUMMARY ===\n');
  
  const byProduct = {};
  for (const line of allLineItems) {
    const key = `${line.productCode} - ${line.product}`;
    if (!byProduct[key]) byProduct[key] = { count: 0, totalGross: 0, totalAgreement: 0, totalDiscount: 0, weights: [] };
    byProduct[key].count++;
    byProduct[key].totalGross += line.grossPrice;
    byProduct[key].totalAgreement += line.agreementPrice;
    byProduct[key].totalDiscount += line.discount;
    if (line.weightKg) byProduct[key].weights.push(line.weightKg);
  }
  
  for (const [product, stats] of Object.entries(byProduct).sort((a, b) => b[1].count - a[1].count)) {
    const avgPrice = stats.count > 0 ? (stats.totalAgreement / stats.count).toFixed(2) : 0;
    const avgWeight = stats.weights.length > 0 ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2) : 'N/A';
    console.log(`${product}`);
    console.log(`  Shipments: ${stats.count}`);
    console.log(`  Total paid: ${stats.totalAgreement.toFixed(2)} NOK`);
    console.log(`  Avg per shipment: ${avgPrice} NOK`);
    console.log(`  Avg weight: ${avgWeight} kg\n`);
  }
  
  const csvHeader = 'invoice_number,invoice_date,shipment_number,package_number,product_code,product,description,weight_kg,gross_price,discount,agreement_price,currency,from_postal_code,to_postal_code,to_city,to_country';
  const csvRows = allLineItems.map(l => 
    `${l.invoiceNumber},${l.invoiceDate},${l.shipmentNumber},${l.packageNumber},${l.productCode},"${l.product}","${l.description}",${l.weightKg || ''},${l.grossPrice},${l.discount},${l.agreementPrice},${l.currency},${l.fromPostalCode},${l.toPostalCode},"${l.toCity}",${l.toCountry}`
  );
  fs.writeFileSync(join(OUTPUT_DIR, 'invoice_line_items.csv'), [csvHeader, ...csvRows].join('\n'));
  
  console.log(`\nSaved ${allLineItems.length} line items to ${OUTPUT_DIR}/invoice_line_items.csv`);
}

main().catch(console.error);
