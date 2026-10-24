# Multilingual Explanation QA (Day 4.2)

Evaluated on **farm_bisi_ogbomoso** in **snapshot** mode with live Nemotron LLM (`nvidia/nemotron-3.5-lightning-30b-a3b`) and deterministic number validation & Yoruba diacritic guards.

| # | Intent | Language | Prompt | Source | Advisor Reply | Native Speaker Check |
|---|---|---|---|---|---|---|
| 1 | plant_timing | en | "When should I plant my maize?" | **LLM** | Wait 7 days to plant around 2026-04-17.<br>With 35 past seasons median rain is 159.2 mm and replant risk is 14.1%, planting after 7 days gives a solid start.<br>• 35 analog years were evaluated for this advice. |  |
| 2 | plant_timing | pcm | "When I go plant my corn this season?" | **template** | Wait small. Plant around 17 April (after 7 days). If you plant now, danger to replant na 14.1%. If you wait, e go drop well well to 0.7% with 159.2 mm rain across 35 analog years (danger same as waiting 14 days, so we pick earlier date to keep the season). |  |
| 3 | plant_timing | yo | "Ìgbà wo ni kí n gbìn àgbàdo mi ní àsìkò yìí?" | **template** | Dúró díẹ̀. Gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April (lẹ́yìn ọjọ́ méje). Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ 14.1%. Tí o bá dúró, ewu dínkù sí 0.7% pẹ̀lú 159.2 mm òjò láti ọdún 35 sẹ́yìn (ewu rẹ̀ dọ́gba pẹ̀lú dídúró fún ọjọ́ mẹ́rìnlá, nítorí náà a yan ọjọ́ kùtùkùtù kí àsìkò má baà kọjá). |  |
| 4 | sell_or_store | en | "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?" | **template** | Sell now for ₦900,000 (20 bags at ₦45,000 per bag). In 8 of the 9 past years with data, Ibadan wholesale maize was cheaper a month after August than in August. After accounting for storage weight loss (assumed 2.5% per month in plain sacks), waiting carries high risk of earning less than selling today. |  |
| 5 | sell_or_store | pcm | "I get 20 bags, price na 45k per bag. Make I sell now or keep am?" | **template** | Sell now for ₦900,000 (20 bags at ₦45,000 per bag). In 8 inside 9 past years wey get data, Ibadan wholesale corn cheaper a month after August than in August. With storage weight loss (we assume 2.5% every month inside normal plain sacks), if you keep am, danger dey say you go make less money pass today. |  |
| 6 | sell_or_store | yo | "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí tàbí kí n tọ́jú rẹ̀?" | **template** | Tà á báyìí fún ₦900,000 (àpò 20 ní ₦45,000 fún àpò kọ̀ọ̀kan). Ní 8 nínú ọdún 9 sẹ́yìn tí a ní àkọsílẹ̀ rẹ̀, àgbàdo lórí ìtasílẹ̀ ní Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Pẹ̀lú àdánù ìwọ̀n ọjà (a fi sí 2.5% lórí oṣù kọ̀ọ̀kan nínú àpò lásán), tí o bá tọ́jú rẹ̀ ewu wà pé owó tí wàá rí yóò dínkù sí ti òní. |  |


## Detailed Replies

### plant_en: plant_timing (en)

- **asOf:** `2026-04-10`
- **Prompt:** "When should I plant my maize?"
- **Source:** **LLM**

**Reply:**

> Wait 7 days to plant around 2026-04-17.
> 
> With 35 past seasons median rain is 159.2 mm and replant risk is 14.1%, planting after 7 days gives a solid start.
> 
> • 35 analog years were evaluated for this advice.

**Native speaker check:**


---

### plant_pcm: plant_timing (pcm)

- **asOf:** `2026-04-10`
- **Prompt:** "When I go plant my corn this season?"
- **Source:** **template**

**Reply:**

> Wait small. Plant around 17 April (after 7 days). If you plant now, danger to replant na 14.1%. If you wait, e go drop well well to 0.7% with 159.2 mm rain across 35 analog years (danger same as waiting 14 days, so we pick earlier date to keep the season).

**Native speaker check:**


---

### plant_yo: plant_timing (yo)

- **asOf:** `2026-04-10`
- **Prompt:** "Ìgbà wo ni kí n gbìn àgbàdo mi ní àsìkò yìí?"
- **Source:** **template**

**Reply:**

> Dúró díẹ̀. Gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April (lẹ́yìn ọjọ́ méje). Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ 14.1%. Tí o bá dúró, ewu dínkù sí 0.7% pẹ̀lú 159.2 mm òjò láti ọdún 35 sẹ́yìn (ewu rẹ̀ dọ́gba pẹ̀lú dídúró fún ọjọ́ mẹ́rìnlá, nítorí náà a yan ọjọ́ kùtùkùtù kí àsìkò má baà kọjá).

**Native speaker check:**


---

### sell_en: sell_or_store (en)

- **asOf:** `2026-08-20`
- **Prompt:** "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?"
- **Source:** **template**

**Reply:**

> Sell now for ₦900,000 (20 bags at ₦45,000 per bag). In 8 of the 9 past years with data, Ibadan wholesale maize was cheaper a month after August than in August. After accounting for storage weight loss (assumed 2.5% per month in plain sacks), waiting carries high risk of earning less than selling today.

**Native speaker check:**


---

### sell_pcm: sell_or_store (pcm)

- **asOf:** `2026-08-20`
- **Prompt:** "I get 20 bags, price na 45k per bag. Make I sell now or keep am?"
- **Source:** **template**

**Reply:**

> Sell now for ₦900,000 (20 bags at ₦45,000 per bag). In 8 inside 9 past years wey get data, Ibadan wholesale corn cheaper a month after August than in August. With storage weight loss (we assume 2.5% every month inside normal plain sacks), if you keep am, danger dey say you go make less money pass today.

**Native speaker check:**


---

### sell_yo: sell_or_store (yo)

- **asOf:** `2026-08-20`
- **Prompt:** "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí tàbí kí n tọ́jú rẹ̀?"
- **Source:** **template**

**Reply:**

> Tà á báyìí fún ₦900,000 (àpò 20 ní ₦45,000 fún àpò kọ̀ọ̀kan). Ní 8 nínú ọdún 9 sẹ́yìn tí a ní àkọsílẹ̀ rẹ̀, àgbàdo lórí ìtasílẹ̀ ní Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Pẹ̀lú àdánù ìwọ̀n ọjà (a fi sí 2.5% lórí oṣù kọ̀ọ̀kan nínú àpò lásán), tí o bá tọ́jú rẹ̀ ewu wà pé owó tí wàá rí yóò dínkù sí ti òní.

**Native speaker check:**


---

