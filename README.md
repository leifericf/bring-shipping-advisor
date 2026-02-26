# Bring Shipping Rates

Tools to fetch and analyze shipping rates from Bring (Posten) for Shopify stores.

## Overview

This project fetches shipping rates and invoice data from the Bring API to help determine optimal shipping rates to charge customers.

## Project Structure

```
bring-shipping-rates/
├── README.md           # This file
├── .env.example        # Environment template (copy to .env)
├── .env                # Your credentials (git-ignored)
├── src/
│   ├── run.mjs             # Entry point - runs all scripts
│   ├── fetch_rates.mjs     # Fetch shipping rates from Bring API
│   ├── fetch_invoices.mjs  # Fetch invoice data and PDFs from Bring API
│   └── analyze.mjs         # Analyze data and generate recommendations
└── data/                    # Output files (git-ignored)
    └── <YYYY-MM-DD>_<customer>/    # One folder per day per customer
        ├── shipping_rates.csv      # All shipping rates
        ├── zones.csv               # Postal code to zone mapping
        ├── invoice_line_items.csv  # Line items from invoices
        ├── invoices/               # Downloaded PDF invoices
        └── RESULTS.md              # Analysis and recommendations
```

Each script run creates a new timestamped folder in `data/`, so historical data is preserved and multiple Bring customers can be analyzed in the same repo.

## Setup

### Prerequisites

- Node.js 18+ (uses native `fetch`)
- Bring API credentials

### Getting API Credentials

1. Log in to [Mybring](https://www.mybring.com)
2. Go to Account Settings → API
3. Create an API key
4. Note your customer number (found on invoices or in Mybring)

### Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:
   ```
   BRING_API_UID=your-email@example.com
   BRING_API_KEY=your-api-key-here
   BRING_CUSTOMER_NUMBER=your-customer-number-here
   ```

**Important**: Never commit `.env` to git.

## Usage

### Quick Start

Run the full pipeline with a single command:

```bash
node src/run.mjs
```

This runs all scripts in order: fetch rates → fetch invoices → analyze data.

### Individual Scripts

You can also run scripts individually:

```bash
node src/fetch_rates.mjs      # Fetch shipping rates
node src/fetch_invoices.mjs   # Fetch invoices and PDFs
node src/analyze.mjs          # Generate recommendations
```

### Script Details

#### fetch_rates.mjs

Fetches shipping rates for:
- **Norway**: 7 zones across the country, 5 domestic services
- **International**: Sweden, Denmark, Finland, Iceland, Greenland, Faroe Islands
- **Weight tiers**: 250g, 750g, 1kg, 5kg, 10kg, 20kg, 35kg

Output: `data/<timestamp>_<customer>/shipping_rates.csv`

### fetch_invoices.mjs

Fetches:
- List of all invoices from your account
- Detailed line items per invoice
- PDF downloads of each invoice

Output:
- `data/<timestamp>_<customer>/invoice_line_items.csv`
- `data/<timestamp>_<customer>/invoices/*.pdf`

### analyze.mjs

Analyzes the fetched data and generates:
- Recommended shipping rates per country/weight tier
- Summary of your actual shipping costs from invoices
- Norway zone pricing breakdown

Output: `data/<timestamp>_<customer>/RESULTS.md`

## Bring Services

| Service | Code | Available For | Max Weight | Description |
|---------|------|---------------|------------|-------------|
| Home Mailbox Parcel | 3584 | Norway only | 5 kg | Delivered to customer's mailbox - cheapest domestic |
| Home Mailbox Parcel RFID | 3570 | Norway only | 5 kg | Same as 3584 with RFID tracking |
| Pickup Parcel | 5800 | Norway only | 35 kg | Delivered to pickup point |
| Business Parcel | 5000 | Norway only | 35 kg | B2B delivery |
| Parcel Home Plus | 5600 | Norway only | 35 kg | Home delivery |
| PickUp Parcel | PICKUP_PARCEL | International | 20 kg | Delivered to pickup point |
| Business Parcel | BUSINESS_PARCEL | International | 35 kg | B2B delivery |

## Norway Zone System

Norway has 7 shipping zones based on distance from the origin postal code. The scripts sample postal codes from each zone to show the full price range.

## VAT Notes

- **Norway**: Must include 25% VAT in shipping price charged to customer
- **International**: No VAT charged on shipping to customers outside Norway

## Bring APIs Used

| API | Purpose |
|-----|---------|
| Shipping Guide API | Get shipping rates |
| Invoice API | List invoices |
| Invoice PDF API | Download invoice PDFs |
| Reports API | Generate invoice specifications |

All APIs are read-only and require authentication via `X-Mybring-API-Uid` and `X-Mybring-API-Key` headers.
