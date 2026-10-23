# Farm Records (Synthetic Demo Data)

The historical season records in `data/farm_records.csv` are **synthetic demo farm histories** created for hackathon simulation, seeding, and offline testing of the Ikore AI farm decision agent.

They do **not** represent real farmer records or actual confidential farm operations.

### Data Fields
- `farm_id`: Identifies the demo farm matching `data/farms_seed.csv`.
- `season_year`: Historical season year (e.g. 2024, 2025).
- `planting_date`: Simulated planting date for the season.
- `germination_ok`: Whether initial germination succeeded (`yes`/`no`).
- `yield_bags`: Number of 100kg bags harvested.
- `sale_month`: The month the crop was sold (e.g. `2024-09`).
- `sale_price_per_bag`: Sale price in Nigerian Naira (₦).

### Provenance Tracking
When seeded into H-MEM via `npm run seed` (`scripts/seed-farms.ts`), memories derived from this file are strictly marked with provenance `demo_seed` to ensure demo data is never presented as authentic historical field audits.
