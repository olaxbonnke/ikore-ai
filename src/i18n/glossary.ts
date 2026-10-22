import type { Lang } from "../core/types.ts";

/** Fixed terms per language (DESIGN.md section 8.4). */
export const GLOSSARY: Record<string, Record<Lang, string>> = {
  plant: { en: "plant", pcm: "plant", yo: "gbìn", ha: "shuka" },
  wait: { en: "wait", pcm: "wait small", yo: "dúró díẹ̀", ha: "jira" },
  sell: { en: "sell", pcm: "sell", yo: "tà", ha: "sayar" },
  store: { en: "store", pcm: "keep am", yo: "tọ́jú", ha: "ajiye" },
  rain: { en: "rain", pcm: "rain", yo: "òjò", ha: "ruwan sama" },
  dryDays: { en: "dry days", pcm: "dry days", yo: "ọjọ́ ọ̀gbẹlẹ̀", ha: "kwanakin fari" },
  maize: { en: "maize", pcm: "corn", yo: "àgbàdo", ha: "masara" },
  bag: { en: "bag", pcm: "bag", yo: "àpò", ha: "buhu" },
  risk: { en: "risk", pcm: "danger", yo: "ewu", ha: "haɗari" },
  goodMorning: { en: "Good morning", pcm: "Good morning", yo: "Ẹ káàárọ̀", ha: "Ina kwana" },
};
