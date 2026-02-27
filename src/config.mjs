import fs from 'fs';
import { join } from 'path';
import { ROOT_DIR } from './lib.mjs';

const CONFIG_PATH = join(ROOT_DIR, 'config.json');

/**
 * Load and validate config.json.
 * Returns the parsed configuration object.
 */
export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('Error: config.json not found in project root.');
    console.error('This file contains destination, service, and weight configuration.');
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`Error: config.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  // Validate required top-level fields
  const required = ['originCountry', 'destinations', 'weightTiersGrams', 'domesticServices', 'internationalServices', 'analysis'];
  const missing = required.filter(k => !(k in raw));
  if (missing.length > 0) {
    console.error(`Error: config.json missing required fields: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Validate destinations
  if (!Array.isArray(raw.destinations) || raw.destinations.length === 0) {
    console.error('Error: config.json "destinations" must be a non-empty array.');
    process.exit(1);
  }
  for (const dest of raw.destinations) {
    if (!dest.country || !dest.code || !dest.postalCode) {
      console.error(`Error: Each destination needs country, code, and postalCode. Got: ${JSON.stringify(dest)}`);
      process.exit(1);
    }
  }

  // Validate weight tiers
  if (!Array.isArray(raw.weightTiersGrams) || raw.weightTiersGrams.length === 0) {
    console.error('Error: config.json "weightTiersGrams" must be a non-empty array of numbers.');
    process.exit(1);
  }

  // Validate services
  for (const key of ['domesticServices', 'internationalServices']) {
    if (!Array.isArray(raw[key]) || raw[key].length === 0) {
      console.error(`Error: config.json "${key}" must be a non-empty array.`);
      process.exit(1);
    }
    for (const svc of raw[key]) {
      if (!svc.id || !svc.name || !svc.maxWeight) {
        console.error(`Error: Each service needs id, name, and maxWeight. Got: ${JSON.stringify(svc)}`);
        process.exit(1);
      }
    }
  }

  // Validate analysis section
  const analysis = raw.analysis;
  if (!analysis) {
    console.error('Error: config.json "analysis" section is required.');
    process.exit(1);
  }

  const analysisRequired = ['vatMultiplier', 'safeDefaultZone', 'primaryDomesticService', 'cheapestInternationalService', 'countryGroupings'];
  const analysisMissing = analysisRequired.filter(k => !(k in analysis));
  if (analysisMissing.length > 0) {
    console.error(`Error: config.json "analysis" missing fields: ${analysisMissing.join(', ')}`);
    process.exit(1);
  }

  // Build derived helper: country code -> country name map from destinations
  const countryNames = {};
  for (const dest of raw.destinations) {
    if (dest.code !== raw.originCountry) {
      countryNames[dest.code] = dest.country;
    }
  }

  return {
    ...raw,
    // Derived helpers
    countryNames,
  };
}
