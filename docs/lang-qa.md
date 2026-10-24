# Multilingual Explanation QA (Day 4.2)

Evaluated on **farm_bisi_ogbomoso** in **snapshot** mode with live Nemotron LLM (`nvidia/nemotron-3.5-lightning-30b-a3b` via Meterless Nightshift) with `chat_template_kwargs: { enable_thinking: false }`, grounded number validation, and Yoruba diacritic guards.

| # | Intent | Language | Prompt | Path | Latency | Fallback Reason | Advisor Reply | Native Speaker Check |
|---|---|---|---|---|---|---|---|---|
| 1 | plant_timing | en | "When should I plant my maize?" | **llm** | 1458ms | - | Wait a week. Plant around 17 April.<br>If you plant now, about 1 in 7 seasons needed replanting. If you wait a week, it almost never happened in 35 past seasons.<br>• 35 past seasons evaluated |  |
| 2 | plant_timing | pcm | "When I go plant my corn this season?" | **llm** | 1894ms | - | Wait small. Plant around 17 April.<br>If you plant now, about 1 for every 7 seasons, people don plant am again. If you wait one week, e no dey almost happen.<br>• We look 35 past seasons for this advice |  |
| 3 | plant_timing | yo | "Ìgbà wo ni kí n gbìn àgbàdo mi ní àsìkò yìí?" | **llm** | 2364ms | - | Dúró díẹ̀ kí o gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April.<br>Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ẹ̀ẹ̀kan nínú àsìkò méje. Tí o bá dúró, fẹ́rẹ́ kò ṣẹlẹ̀ rárá nínú àsìkò 35 sẹ́yìn.<br>• A wo àkọsílẹ̀ ọdún 35 sẹ́yìn |  |
| 4 | sell_or_store | en | "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?" | **llm** | 1452ms | - | Sell now for ₦900,000.<br>In 8 out of 9 past years, Ibadan maize price fell after August. Your 20 bags would also lose about half a bag every month in plain sacks.<br>• Plain sacks lose about half a bag every month |  |
| 5 | sell_or_store | pcm | "I get 20 bags, price na 45k per bag. Make I sell now or keep am?" | **llm** | 1125ms | - | Sell now, you go get ₦900,000.<br>For 8 out of 9 past years, Ibadan maize price fall after August. Your 20 bags go still lose about half bag every month inside ordinary sack.<br>• 20 bags go lose about half bag every month inside ordinary sack |  |
| 6 | sell_or_store | yo | "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí tàbí kí n tọ́jú rẹ̀?" | **llm** | 3645ms | - | Tà á báyìí fún ₦900,000 (àpò 20 ní ₦45,000 fún àpò kọ̀ọ̀kan).<br>Ní 8 nínú ọdún 9 sẹ́yìn, àgbàdo ní ọjà Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Àwọn àpò 20 rẹ yóò tún pàdánù ní nǹkan bí ààbọ̀ àpò lórí oṣù kọ̀ọ̀kan nínú àpò lásán.<br>• Àdánù ìtọ́jú jẹ́ nǹkan bí ààbọ̀ àpò lórí oṣù kọ̀ọ̀kan |  |


## Detailed Replies

### plant_en: plant_timing (en)

- **asOf:** `2026-04-10`
- **Prompt:** "When should I plant my maize?"
- **Path:** **llm**
- **Latency:** 1458ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Wait a week. Plant around 17 April.
> 
> If you plant now, about 1 in 7 seasons needed replanting. If you wait a week, it almost never happened in 35 past seasons.
> 
> • 35 past seasons evaluated

**Native speaker check:**


---

### plant_pcm: plant_timing (pcm)

- **asOf:** `2026-04-10`
- **Prompt:** "When I go plant my corn this season?"
- **Path:** **llm**
- **Latency:** 1894ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Wait small. Plant around 17 April.
> 
> If you plant now, about 1 for every 7 seasons, people don plant am again. If you wait one week, e no dey almost happen.
> 
> • We look 35 past seasons for this advice

**Native speaker check:**


---

### plant_yo: plant_timing (yo)

- **asOf:** `2026-04-10`
- **Prompt:** "Ìgbà wo ni kí n gbìn àgbàdo mi ní àsìkò yìí?"
- **Path:** **llm**
- **Latency:** 2364ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Dúró díẹ̀ kí o gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April.
> 
> Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ẹ̀ẹ̀kan nínú àsìkò méje. Tí o bá dúró, fẹ́rẹ́ kò ṣẹlẹ̀ rárá nínú àsìkò 35 sẹ́yìn.
> 
> • A wo àkọsílẹ̀ ọdún 35 sẹ́yìn

**Native speaker check:**


---

### sell_en: sell_or_store (en)

- **asOf:** `2026-08-20`
- **Prompt:** "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?"
- **Path:** **llm**
- **Latency:** 1452ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Sell now for ₦900,000.
> 
> In 8 out of 9 past years, Ibadan maize price fell after August. Your 20 bags would also lose about half a bag every month in plain sacks.
> 
> • Plain sacks lose about half a bag every month

**Native speaker check:**


---

### sell_pcm: sell_or_store (pcm)

- **asOf:** `2026-08-20`
- **Prompt:** "I get 20 bags, price na 45k per bag. Make I sell now or keep am?"
- **Path:** **llm**
- **Latency:** 1125ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Sell now, you go get ₦900,000.
> 
> For 8 out of 9 past years, Ibadan maize price fall after August. Your 20 bags go still lose about half bag every month inside ordinary sack.
> 
> • 20 bags go lose about half bag every month inside ordinary sack

**Native speaker check:**


---

### sell_yo: sell_or_store (yo)

- **asOf:** `2026-08-20`
- **Prompt:** "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí tàbí kí n tọ́jú rẹ̀?"
- **Path:** **llm**
- **Latency:** 3645ms
- **Fallback Reason:** None (Accepted LLM generation)

**Reply:**

> Tà á báyìí fún ₦900,000 (àpò 20 ní ₦45,000 fún àpò kọ̀ọ̀kan).
> 
> Ní 8 nínú ọdún 9 sẹ́yìn, àgbàdo ní ọjà Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Àwọn àpò 20 rẹ yóò tún pàdánù ní nǹkan bí ààbọ̀ àpò lórí oṣù kọ̀ọ̀kan nínú àpò lásán.
> 
> • Àdánù ìtọ́jú jẹ́ nǹkan bí ààbọ̀ àpò lórí oṣù kọ̀ọ̀kan

**Native speaker check:**


---

