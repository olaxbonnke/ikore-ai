# PROJECT.md: Oko, a Farm Decision Agent

> **Oko** means "farm" in Yoruba.
> Entry for the **Open Agent Hackathon 2026** (GenAI Works), **Track 3: Reasoning Architecture**.
> Also going for the **Best use of NVIDIA Nemotron** prize (NVIDIA DGX Spark, $4,699).
> Builder: Bonnke Temiloluwa Olaitan (solo). Built in **Cursor**. Integrates **Zetaris** and **Meterless**, both required.

---

## 1. One-sentence pitch

Oko is an AI farm advisor for Nigerian smallholder farmers. It works out two decisions that decide a season's income: **when to plant** and **when to sell**. It runs simulations against decades of real weather and market data, remembers every farm across seasons, and explains its verdict, the risk and the naira at stake in **English, Pidgin, Yoruba or Hausa**.

## 2. The problem (use this wording in the deck)

- Smallholder farmers grow most of Nigeria's food. Most of them decide when to plant and when to sell based on rumour, the first big rain, or urgent cash needs.
- **False-start rains**: an early heavy shower followed by a dry spell of more than 7 days kills seedlings, and the farmer has to buy seed and replant. That's lost money and lost weeks.
- **Selling at harvest**: prices are usually lowest just after harvest and rise towards the lean season. Farmers who sell immediately leave money on the table. Farmers who store badly lose grain to weevils and moisture.
- The data to make better decisions exists: rainfall records, satellite climate data, soil maps, market price series. But it's scattered across agencies, formats and websites, and no farmer (or extension worker) can put it together in the field.
- Extension workers are badly outnumbered by farmers, so most farmers never get personal advice.

## 3. The solution

A chat-first agent (with a web interface that looks like WhatsApp) that:

1. **Brings scattered data together** (via **Zetaris**): weather forecasts, 40 years of daily rainfall, soil properties, market price history and the farm's own records. All of it is queried in place through one SQL layer.
2. **Remembers each farm** (via **Meterless H-MEM**): location, crop, field size, storage method, past advice, whether the farmer followed it, and what happened. Memory stays local and every recalled fact can be traced back.
3. **Reasons with a clear, step-by-step decision loop**: Observe, then generate options, simulate, decide, explain, and later learn. The simulation and scoring are **deterministic code**. The language model **parses** the question and **explains** the result. It never makes up numbers.
4. **Works overnight** (via **Meterless Nightshift**, or a scheduled job registered as a Meterless overnight agent): re-runs scenarios with fresh forecasts every night and writes each farmer a short morning briefing.
5. **Speaks the farmer's language** (via **NVIDIA Nemotron**): replies in Pidgin, Yoruba, Hausa or English, plain and short.

## 4. Who it's for

| Persona | Description | What they need from Oko |
|---|---|---|
| **Mama Bisi** (main demo persona) | 45, grows 2 hectares of maize near Ogbomoso, Oyo State. Has a basic Android phone. Speaks Yoruba and Pidgin. Stores grain in sacks at home. | "Should I plant now?" "Should I sell now or wait?" A plain answer with a reason she trusts. |
| **Musa** (second persona) | Maize and sorghum farmer in Kaduna State. Speaks Hausa. | Same decisions, in Hausa. Used to show it works in other languages and places. |
| **Tunde, extension worker** | Covers 300+ farmers for a cooperative or ADP. | Batch morning briefings for many farms, with clear reasons he can pass on. |

## 5. Scope for the hackathon (MVP); keep it narrow

**In scope:**
- One crop: **maize**.
- One main region: **Oyo State** (Ogbomoso / Ibadan area), with a second demo farm in Kaduna for the Hausa demo.
- Two decisions:
  1. **Plant timing**: plant now, wait 7 days, or wait 14 days, with risk of replanting and expected season water adequacy.
  2. **Sell or store**: sell now, or store 4, 8 or 12 weeks, with expected net naira, downside risk and storage loss.
- Overnight re-planning and morning briefings.
- Four languages for replies: English, Nigerian Pidgin, Yoruba, Hausa.
- A web chat interface plus an **evidence panel** showing the numbers, charts and sources behind each verdict.
- Farm memory across sessions, with an audit trail ("why did you tell me this?").

**Out of scope (say so in the deck as future work):**
- Real WhatsApp/USSD delivery (mock it in a WhatsApp-style interface; mention the Twilio/WhatsApp Business API as next step).
- Voice notes (stretch goal only).
- Pest/disease photo diagnosis.
- Fertiliser recommendations (stretch: a simple note based on soil N and pH).
- Crops other than maize.
- Real farmer accounts and authentication (demo with seeded farms).

## 6. Hackathon facts (from the official rules, read 2026-10-21)

| Item | Value |
|---|---|
| Build window | 22 Oct 2026 00:00 UTC to 27 Oct 2026 23:45 UTC (**01:00 WAT Thu 22 Oct** to **00:45 WAT Wed 28 Oct**) |
| Registration closes | 22 Oct 2026 23:59 UTC (**00:59 WAT Fri 23 Oct**), hard deadline |
| Results | 6 Nov 2026 16:00 UTC (17:00 WAT) |
| Required | Integrate **Zetaris** and **Meterless**, develop in **Cursor**. NVIDIA tech encouraged. |
| Pre-existing code | Must be declared. Code from before 22 Oct doesn't count. |
| Track prizes (Track 3) | $1,500 / $1,200 / $900 |
| Nemotron prize | NVIDIA DGX Spark ($4,699) for best use of Nemotron |
| Judging (100) | Impact 30 · Technical 20 · Innovation 15 · Demo 15 · Product & UX 10 · Sponsor tech 10 |
| Questions | hackathons@genai.works |

### Submission checklist (all required)
- [ ] Demo video, 1 to 4 minutes: main workflow, how the agent solves the challenge, key features, **how Zetaris and Meterless are integrated**.
- [ ] Slide deck: problem and users, solution, agent workflow and architecture, tech stack, how Zetaris and Meterless were used, what was unique about using them, product visuals, future improvements.
- [ ] GitHub repo with all source code and a README (setup, usage, dependencies).
- [ ] Written explanation: how Zetaris and Meterless were integrated, **how Cursor was used**, where NVIDIA tech contributes, what was unique about the sponsor tech use.
- [ ] Pre-existing components declared on the submission form (the Meterless starter template and any vendored engine code count as declared third-party open-source).

## 7. How each scoring criterion is met

| Criterion (weight) | How Oko scores |
|---|---|
| **Impact (30)** | Food security plus farmer income. Every verdict shows naira saved or earned and replanting risk avoided. Opening line: "One false start costs a 2-hectare farmer about ₦X in seed and labour" (compute X from real seed prices, cite the source). |
| **Technical (20)** | A real decision loop with weather analog simulations (40 years of NASA POWER data), price seasonality from WFP data, risk-adjusted scoring, a read-only federated data layer, persistent auditable memory, and an overnight replanner. Numbers come from code, not the language model. |
| **Innovation (15)** | Local-first farm memory that compounds over seasons. An explanation contract where every claim links to a data row. Overnight scenario runs on free local compute. Native Pidgin, Yoruba and Hausa. |
| **Demo (15)** | A short story (see DEMO section): two decisions, one overnight briefing, one "why" audit, all in Pidgin/Yoruba, with live evidence charts. |
| **Product & UX (10)** | A WhatsApp-style chat where the answer comes first, three evidence cards, a big naira number, a traffic-light risk badge and a language toggle. |
| **Sponsor tech (10)** | Zetaris is the only way the agent reads data (with the SQL shown in the evidence panel). Meterless H-MEM is the farm memory, and the TrustLedger audit powers "why". SleepCycle consolidates memory nightly. Meterless Runtime is a model provider. Nemotron does the reasoning and language. Cursor plus the Zetaris MCP was used during the build. |

## 8. Demo script (target 3:00, max 4:00)

| Time | Scene | What's on screen | Voiceover (short) |
|---|---|---|---|
| 0:00 to 0:20 | Hook | Photo or illustration of a Nigerian maize field. Text: "One wrong planting date. One season lost." | "Millions of Nigerian farmers bet their season on one decision: when to plant." |
| 0:20 to 0:40 | Problem | Three logos or stats: scattered rainfall data, soil maps, market prices | "The data exists, but it's scattered. Oko puts it together." |
| 0:40 to 1:30 | Decision 1: plant | Chat: Mama Bisi types in Pidgin "Rain don start for Ogbomoso. Make I plant maize now?" Oko answers: **"Wait. Plant around 2 Nov."** Evidence cards: 16-day forecast shows a dry gap; in 31 of 40 past years a similar start was followed by a dry spell over 7 days; replanting risk 42% now vs 11% in 10 days. | "Oko compares planting today with waiting, using 40 years of rainfall and the latest forecast. Every number comes from real data through Zetaris." |
| 1:30 to 2:10 | Decision 2: sell | "I get 20 bags. Price na ₦52,000 per bag. Make I sell?" Oko answers: **"Store 8 weeks in PICS bags. Likely +₦118,000 after losses."** Chart: seasonal price curve, downside band, storage loss. | "It weighs the usual pre-lean-season price rise against storage losses and her cash needs." |
| 2:10 to 2:35 | Memory and why | Next day: "Why you talk say make I wait?" Oko shows the audit trail: memory IDs, data rows, the decision trace. | "Oko remembers every farm, and every claim can be traced. That's Meterless H-MEM." |
| 2:35 to 2:55 | Overnight | Morning briefing card: "Ẹ káàárọ̀ Mama Bisi. Rain go steady from Thursday. Plant Friday." Plus Hausa for Musa. | "Every night, Oko re-runs the scenarios for every farm, on local compute." |
| 2:55 to 3:20 | Architecture | Architecture diagram: Zetaris, Meterless, Nemotron, Cursor | "Zetaris for data, Meterless for memory and overnight runs, Nemotron for reasoning and language, built in Cursor." |
| 3:20 to 3:40 | Close | "Oko: the right decision, in your language." Repo URL. | |

**Demo date:** late October is outside Oyo's main maize planting window, so the planting scene runs with `OKO_DEMO_DATE` set inside the main season (e.g. 10 Apr 2026). Show the date chip on screen and say it in the voiceover (see DESIGN.md section 12).

**Note:** The figures above are placeholders for the script. Use the real outputs your engine produces with the real data on demo day. Don't hard-code figures for the video.

## 9. Success criteria (definition of done)

- A judge can clone the repo, set up `.env` and run `npm run demo` to get a working local app with seeded farms (using a cached data snapshot if they don't have Zetaris credentials, clearly labelled).
- Both decisions return a verdict in under 10 seconds with live data (under 3 seconds with cache).
- Every number in an explanation links to an evidence record (source, query, row or statistic).
- Pidgin, Yoruba and Hausa replies are tested with at least 5 prompts each and read naturally (get a native speaker to check 2 or 3 if possible).
- The overnight job runs from the command line and produces briefings for 3 or more seeded farms.
- README, architecture diagram, deck and video are done and submitted before **Tue 27 Oct, 22:00 WAT**, leaving almost 3 hours of buffer before the 00:45 WAT cutoff.

## 10. Repository and naming

- Repo: `github.com/<bonnke>/oko-farm-agent` (public, MIT licence; Meterless parts are Apache 2.0 and that is declared).
- App name: **Oko**. Tagline: **"The right decision, in your language."**
- Pre-existing code to declare: the Meterless `agentathon-starter` template and the vendored H-MEM reference (Apache 2.0). Zetaris getting-started helper scripts if copied. Nothing else.
