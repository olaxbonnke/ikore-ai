# Multilingual Explanation QA (Day 4.2)

Evaluated on **farm_bisi_ogbomoso** in **snapshot** mode with live Nemotron LLM (`nvidia/nemotron-3.5-lightning-30b-a3b` via build.nvidia.com) with `chat_template_kwargs: { enable_thinking: false }`, grounded number validation, and Yoruba diacritic guards.

| # | Intent | Language | Prompt | Path | Latency | Fallback Reason | Advisor Reply | Native Speaker Check |
|---|---|---|---|---|---|---|---|---|
| 1 | plant_timing | en | "When should I plant my maize?" | **llm** | 1493ms | - | Wait 7 days to plant around 17 April.<br>If you plant now, danger to replant is 14.1%. Waiting drops danger to 0.7% with enough rain across 35 past seasons.<br>• 35 past seasons evaluated |  |
| 2 | plant_timing | pcm | "When I go plant my corn this season?" | **template** | 1246ms | Structure check failed: Reason has 4 numbers (max 3 allowed: 14.1%, 7, 0.7%, 35) | Wait small to plant around 17 April.<br>If you plant now, danger to replant na 14.1%. If you wait, e go drop well well to 0.7% with enough rain across 35 past seasons. |  |
| 3 | plant_timing | yo | "Ìgbà wo ni kí n gbìn àgbàdo mi ní àsìkò yìí?" | **llm** | 1557ms | - | Dúró díẹ̀ kí o gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April.<br>Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ 14.1%. Tí o bá dúró, ewu dínkù sí 0.7% pẹ̀lú òjò tó tó láti ọdún 35 sẹ́yìn.<br>• A wo àkọsílẹ̀ ọdún 35 sẹ́yìn |  |
| 4 | sell_or_store | en | "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?" | **llm** | 1616ms | - | Sell now for ₦900,000 (20 bags at ₦45,000 per bag).<br>For 8 out of 9 past years with data, Ibadan wholesale maize was cheaper a month after August than in August. With plain sacks losing 2.5% weight monthly, waiting carries high risk of earning less than selling today.<br>• Assumed 2.5% monthly weight loss in plain sacks |  |
| 5 | sell_or_store | pcm | "I get 20 bags, price na 45k per bag. Make I sell now or keep am?" | **llm** | 1425ms | - | Sell now for ₦900,000 (20 bags at ₦45,000 per bag).<br>For 8 out of 9 past years with data, Ibadan wholesale corn cheaper pass a month after August than in August. With plain sacks losing 2.5% weight monthly, danger say you go make less money pass today.<br>• We assume 2.5% weight loss every month inside plain sacks |  |
| 6 | sell_or_store | yo | "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí tàbí kí n tọ́jú rẹ̀?" | **llm** | 2895ms | - | Tà á báyìí fún ₦900,000 (àpò 20 ní ₦45,000 fún àpò kọ̀ọ̀kan).<br>Ní 8 nínú ọdún 9 sẹ́yìn tí a ní àkọsílẹ̀ rẹ̀, àgbàdo lórí Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Pẹ̀lú àdánù ìwọ̀n 2.5% lórí oṣù kọ̀ọ̀kan nínú àpò lásán, tí o bá tọ́jú rẹ̀ ewu wà pé owó tí wàá rí yóò dínkù.<br>• A fi sí 2.5% àdánù ìwọ̀n oṣooṣù fún àpò lásán |  |


## Detailed Replies

### plant_en: plant_timing (en)

- **asOf:** `2026-04-10`
- **Prompt:** "When should I plant my maize?"
- **Path:** **llm**
- **Latency:** 1493ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Wait 7 days to plant around 17 April.
> 
> If you plant now, danger to replant is 14.1%. Waiting drops danger to 0.7% with enough rain across 35 past seasons.
> 
> • 35 past seasons evaluated

**Native speaker check:**


---

### plant_pcm: plant_timing (pcm)

- **asOf:** `2026-04-10`
- **Prompt:** "When I go plant my corn this season?"
- **Path:** **template**
- **Latency:** 1246ms
- **Fallback Reason:** `Structure check failed: Reason has 4 numbers (max 3 allowed: 14.1%, 7, 0.7%, 35)`

**Reply:**

> Wait small to plant around 17 April.
> 
> If you plant now, danger to replant na 14.1%. If you wait, e go drop well well to 0.7% with enough rain across 35 past seasons.

**Native speaker check:**


---

### plant_yo: plant_timing (yo)

- **asOf:** `2026-04-10`
- **Prompt:** "Ìgbà wo ni kí n gbìn àgbàdo mi ní àsìkò yìí?"
- **Path:** **llm**
- **Latency:** 1557ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Dúró díẹ̀ kí o gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April.
> 
> Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ 14.1%. Tí o bá dúró, ewu dínkù sí 0.7% pẹ̀lú òjò tó tó láti ọdún 35 sẹ́yìn.
> 
> • A wo àkọsílẹ̀ ọdún 35 sẹ́yìn

**Native speaker check:**


---

### sell_en: sell_or_store (en)

- **asOf:** `2026-08-20`
- **Prompt:** "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?"
- **Path:** **llm**
- **Latency:** 1616ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Sell now for ₦900,000 (20 bags at ₦45,000 per bag).
> 
> For 8 out of 9 past years with data, Ibadan wholesale maize was cheaper a month after August than in August. With plain sacks losing 2.5% weight monthly, waiting carries high risk of earning less than selling today.
> 
> • Assumed 2.5% monthly weight loss in plain sacks

**Native speaker check:**


---

### sell_pcm: sell_or_store (pcm)

- **asOf:** `2026-08-20`
- **Prompt:** "I get 20 bags, price na 45k per bag. Make I sell now or keep am?"
- **Path:** **llm**
- **Latency:** 1425ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Sell now for ₦900,000 (20 bags at ₦45,000 per bag).
> 
> For 8 out of 9 past years with data, Ibadan wholesale corn cheaper pass a month after August than in August. With plain sacks losing 2.5% weight monthly, danger say you go make less money pass today.
> 
> • We assume 2.5% weight loss every month inside plain sacks

**Native speaker check:**


---

### sell_yo: sell_or_store (yo)

- **asOf:** `2026-08-20`
- **Prompt:** "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí tàbí kí n tọ́jú rẹ̀?"
- **Path:** **llm**
- **Latency:** 2895ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Tà á báyìí fún ₦900,000 (àpò 20 ní ₦45,000 fún àpò kọ̀ọ̀kan).
> 
> Ní 8 nínú ọdún 9 sẹ́yìn tí a ní àkọsílẹ̀ rẹ̀, àgbàdo lórí Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Pẹ̀lú àdánù ìwọ̀n 2.5% lórí oṣù kọ̀ọ̀kan nínú àpò lásán, tí o bá tọ́jú rẹ̀ ewu wà pé owó tí wàá rí yóò dínkù.
> 
> • A fi sí 2.5% àdánù ìwọ̀n oṣooṣù fún àpò lásán

**Native speaker check:**


---

