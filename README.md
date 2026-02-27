# Bring Shipping Analyzer

Fetch and analyze shipping rates from Bring (Posten) for Shopify stores.

## Overview

This project fetches shipping rates and invoice data from the Bring API to help determine optimal shipping rates to charge customers. It runs as a local web application with all data stored in a SQLite database.

## Project Structure

```
bring-shipping-analyzer/
├── README.md               # This file
├── package.json            # Project metadata and npm scripts
├── config.json             # Default business configuration (destinations, services, weights)
├── src/
│   ├── lib.mjs             # Shared utilities (fetch helpers, auth headers)
│   ├── config.mjs          # Config loader and validation
│   ├── db.mjs              # SQLite database layer
│   ├── server.mjs          # Web UI (Express server)
│   ├── run.mjs             # Pipeline orchestrator (spawned by server)
│   ├── fetch_rates.mjs     # Fetch shipping rates from Bring API
│   ├── fetch_invoices.mjs  # Fetch invoice data from Bring API
│   ├── analyze.mjs         # Analyze data and generate recommendations
│   ├── views/              # EJS templates for the web UI
│   └── public/             # Static CSS for the web UI
└── data/                   # SQLite database (git-ignored)
    └── bring.db            # All accounts, runs, rates, invoices, and analysis
```

## Setup

### Prerequisites

- Node.js 18+ (uses native `fetch`)
- Bring API credentials

### Getting API Credentials

1. Log in to [Mybring](https://www.mybring.com)
2. Go to Account Settings → API
3. Create an API key
4. Note your customer number (found on invoices or in Mybring)

### Installation

```bash
npm install
```

## Usage

Start the web server:

```bash
npm start
```

Open http://localhost:3000 in your browser. From the web UI you can:

1. **Create accounts** — add API credentials for one or more Bring/Mybring users
2. **Edit configuration** — customize destinations, services, weight tiers, and analysis settings per account
3. **Start runs** — fetch rates and invoices with one click (runs in background)
4. **View results** — see the analysis report with recommended Shopify rates
5. **Browse invoices** — list all invoices for a run and download individual PDFs on demand

### Configuration

Each account has its own configuration (editable from the web UI) that controls:

- **Destinations** — which countries and postal codes to check rates for
- **Weight tiers** — which weight brackets to query from the API
- **Shipping services** — domestic and international service definitions
- **Analysis settings** — VAT rate, zone strategy, Shopify bracket definitions, country groupings

New accounts start with the defaults from `config.json`.

## Database

All data is stored in a SQLite database at `data/bring.db`:

| Table | Purpose |
|-------|---------|
| `accounts` | Bring API credentials and per-account config |
| `runs` | Run metadata (date, account, config snapshot, status) |
| `shipping_rates` | All fetched shipping rates per run |
| `zones` | Postal code to zone mappings per run |
| `invoices` | Invoice metadata (number, date, amount) per run |
| `invoice_line_items` | Invoice line items per run |
| `analysis_results` | Generated analysis report per run |

You can query it directly:

```bash
sqlite3 data/bring.db "SELECT id, created_at, status FROM runs"
```

## Bring Services

| Service | Code | Available For | Max Weight |
|---------|------|---------------|------------|
| Home Mailbox Parcel | 3584 | Norway only | 5 kg |
| Home Mailbox Parcel RFID | 3570 | Norway only | 5 kg |
| Pickup Parcel | 5800 | Norway only | 35 kg |
| Business Parcel | 5000 | Norway only | 35 kg |
| Parcel Home Plus | 5600 | Norway only | 35 kg |
| PickUp Parcel | PICKUP_PARCEL | International | 20 kg |
| Business Parcel | BUSINESS_PARCEL | International | 35 kg |

## Notes

- **Norway zone system**: 7 zones based on distance from origin. Zone numbers can differ per service for the same postal code.
- **VAT**: Norway requires 25% VAT on shipping. International shipping has no VAT.
- All Bring APIs are read-only and require authentication via `X-Mybring-API-Uid` and `X-Mybring-API-Key` headers.
