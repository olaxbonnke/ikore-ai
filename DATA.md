# DATA.md: data sources, status and schemas

Status key: ✅ checked working on 2026-10-21 · ⚠️ believed to work, check on Day 1 · ❌ known problem.
Every source reaches the agent **through Zetaris** (see DESIGN.md section 7).

---

## 1. NASA POWER: daily rainfall history ✅
- What: satellite and model-based daily climate data, global, about 0.5° grid, from 1981 to near-present (a few days' lag).
- Endpoint (checked live): `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M_MAX,T2M_MIN&community=AG&longitude={lon}&latitude={lat}&start=19850101&end={YYYYMMDD}&format=JSON`
- Response shape: `properties.parameter.PRECTOTCORR` = `{ "YYYYMMDD": mm, ... }` (missing = -999).
- Use: analog-year simulation and recent 21-day rain.
- Zetaris: a REST table per farm, then a SCHEMASTORE VIEW to flatten the date→value map into rows. If flattening a keyed map is awkward, use the CSV format (`format=CSV`) and register it as a file table instead.
- Licence: free, no key. Cite "NASA Langley Research Center (LaRC) POWER Project".

## 2. Open-Meteo: 16-day forecast and recent past ⚠️
- Forecast: `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration&forecast_days=16&past_days=14&timezone=Africa%2FLagos`
- Historical forecast (for the time-travel demo date): Open-Meteo has a historical forecast API (`historical-forecast-api.open-meteo.com`). Check the parameters on Day 1.
- Note: our sandbox hit "Daily API request limit exceeded" from a shared IP. The free tier is about 10,000 calls a day for non-commercial use, so this is fine from your own machine. **Cache results** (snapshot) so the demo doesn't depend on rate limits.
- Licence: CC BY 4.0, free for non-commercial use. Credit "Weather data by Open-Meteo.com".

## 3. WFP VAM: Nigeria food prices ✅ (with an important gap)
- CSV (checked live; 88,390 rows; last date 2026-10-15):
  `https://data.humdata.org/dataset/42db041f-7aaf-4ab4-961f-2a12096861e7/resource/12b51155-0cd3-4806-9924-61ede4077591/download/wfp_food_prices_nga.csv`
- Markets CSV: `https://data.humdata.org/dataset/42db041f-7aaf-4ab4-961f-2a12096861e7/resource/5329e772-0b74-4f65-8cc0-37a0915cc7e4/download/wfp_markets_nga.csv`
- Columns: `date, admin1, admin2, market, market_id, latitude, longitude, category, commodity, commodity_id, unit, priceflag, pricetype, currency, price, usdprice` (row 2 is an HXL tag row; skip it).
- **Findings for maize (checked):**
  - Oyo: market **Ibadan**, commodities `Maize (white)` and `Maize (yellow)`, unit KG, Retail, **316 rows, last date 2023-01-15**.
  - Kaduna (569 rows), Kano, Katsina, Jigawa, Lagos, Zamfara, Gombe, Kebbi: maize also **stops at 2023-01-15**.
  - Only **Borno and Yobe** have 2026 data, and it's **Maize flour (2.1 KG, Retail)**, not grain. Adamawa maize data runs to 2025-11.
- **Design decision:** use Ibadan (and Kaduna for the Hausa farm) 20XX to 2023 for **seasonal shape only**. Today's price level comes from the farmer. Optionally show the Borno/Yobe 2026 maize flour trend as a labelled sense check.
- Store a copy in your S3/Blob bucket and register it as a Zetaris FILESTORE table `wfp_prices_nga`.
- Licence: CC BY (HDX/WFP). Cite "WFP VAM, via HDX".

## 4. Current market price ⚠️ (optional extra)
- NBS "Selected Food Prices Watch" (monthly, by state; includes maize grain). It's usually published as Excel/PDF on nigerianstat.gov.ng. If you can get a recent file, convert it to CSV and register it as `nbs_food_prices`. Use it to sense-check the farmer's stated price ("Your price ₦52,000/bag ≈ ₦520/kg; NBS Oyo average Sep 2026: ₦X/kg").
- If it isn't easy to get on Day 1–2, **skip it**. The farmer's price is enough.

## 5. Soil ⚠️ (optional; useful but not on the critical path)
- iSDAsoil (Africa, 30 m): API needs a free account and token. Properties: pH, N, organic carbon, texture classes, etc.
- ISRIC SoilGrids REST (`rest.isric.org`): global 250 m. The service has been unstable in the past; check it.
- Use in MVP: a **texture or water-holding proxy** that scales the drought sensitivity of the replant risk (sandy soil means higher risk from a dry spell), plus a fertiliser note (stretch goal). If both APIs fail, hand-code soil classes for the 3 demo farms from a published map and label them as an assumption.

## 6. Crop calendar (create it yourself) → `data/crop_calendar_maize_ng.csv`
Build it from published sources (FAO GIEWS crop calendar for Nigeria, IITA maize production guides, Oyo/Kaduna ADP guides). Cite each row in a `source` column. Starting values to verify (don't ship without checking against a source):

```csv
crop,zone,season,plant_start_mmdd,plant_opt_end_mmdd,plant_last_mmdd,days_to_maturity,water_need_min_mm,water_need_max_mm,source
maize,derived_savanna,main,03-15,04-30,05-31,100,500,800,VERIFY
maize,derived_savanna,second,08-01,08-31,09-15,90,450,700,VERIFY
maize,northern_guinea,main,05-15,06-15,07-10,110,500,800,VERIFY
```
Ogbomoso is in the derived savanna; Kaduna is in the northern Guinea savanna.

## 7. Storage loss → `data/storage_loss.csv` (assumptions, labelled)
```csv
storage,monthly_loss_pct,source
sack,2.5,ASSUMPTION - verify vs APHLIS
sack_treated,1.0,ASSUMPTION - verify vs APHLIS
pics,0.3,ASSUMPTION - Purdue PICS hermetic storage literature
silo,0.3,ASSUMPTION
```

## 8. Seeded farms → `data/farms_seed.csv`
```csv
id,owner_name,lat,lon,state,lga,crop,hectares,storage,preferred_lang,risk_aversion,zone
farm_bisi_ogbomoso,Mama Bisi,8.13,4.24,Oyo,Ogbomoso North,maize,2,sack,pcm,normal,derived_savanna
farm_musa_kaduna,Musa Abdullahi,10.52,7.44,Kaduna,Chikun,maize,3,sack_treated,ha,high,northern_guinea
farm_ade_iseyin,Baba Ade,7.97,3.60,Oyo,Iseyin,maize,1.5,pics,yo,low,derived_savanna
```
(Coordinates are approximate town centres. Fine at NASA POWER resolution.)

## 9. Farm records (demo) → `data/farm_records.csv`
Past seasons per farm (planting date, germination ok yes/no, yield bags, sale month, sale price per bag) for 2 or 3 seasons. These are **made-up demo records**; label them as such in the UI and README. Used to show memory and learning.

## 10. Data-quality rules
- NASA POWER: treat -999 as missing. Drop a season if more than 5% of its days are missing.
- WFP: skip the HXL row. Convert price to ₦/kg. Ignore rows where `priceflag` is a forecast. Keep `actual` and `aggregate`.
- Always record `executedAt` and `rowCount` for evidence.
