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

  // Weekdays with correct Yoruba tone marks and underdots (DESIGN.md 8.4)
  sunday: { en: "Sunday", pcm: "Sunday", yo: "Ọjọ́ Àìkú", ha: "Lahadi" },
  monday: { en: "Monday", pcm: "Monday", yo: "Ọjọ́ Ajé", ha: "Litinin" },
  tuesday: { en: "Tuesday", pcm: "Tuesday", yo: "Ọjọ́ Ìsẹ́gun", ha: "Talata" },
  wednesday: { en: "Wednesday", pcm: "Wednesday", yo: "Ọjọ́rú", ha: "Laraba" },
  thursday: { en: "Thursday", pcm: "Thursday", yo: "Ọjọ́bọ̀", ha: "Alhamis" },
  friday: { en: "Friday", pcm: "Friday", yo: "Ọjọ́ Ẹtì", ha: "Juma'a" },
  saturday: { en: "Saturday", pcm: "Saturday", yo: "Ọjọ́ Àbámẹ́ta", ha: "Asabar" },
};

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const YORUBA_MONTHS = [
  "Oṣù Kíní",
  "Oṣù Kejì",
  "Oṣù Kẹta",
  "Oṣù Kẹrin",
  "Oṣù Kàrún",
  "Oṣù Kẹfà",
  "Oṣù Keje",
  "Oṣù Kẹjọ",
  "Oṣù Kẹsàn-án",
  "Oṣù Kẹwàá",
  "Oṣù Kọkànlá",
  "Oṣù Kejìlá",
];

/**
 * Format a calendar date string (YYYY-MM-DD) according to DESIGN.md 8.4:
 * "Dates: '2 Nov' / '2 November' in en/pcm; for yo/ha use the same numeric date,
 * plus the weekday name in that language from the glossary."
 */
export function formatGroundedDate(dateIso: string, lang: Lang = "en"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return dateIso;
  }
  const [yStr, mStr, dStr] = dateIso.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const monthName = MONTH_NAMES[month - 1] || mStr;

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = dateObj.getUTCDay();
  const weekdayKey = WEEKDAY_KEYS[dayOfWeek] || "friday";
  const weekday = GLOSSARY[weekdayKey]?.[lang] || GLOSSARY[weekdayKey]?.en || "";

  if (lang === "yo") {
    const yoMonth = YORUBA_MONTHS[month - 1] || monthName;
    return weekday ? `${weekday}, ${day} ${yoMonth}` : `${day} ${yoMonth}`;
  }
  return `${day} ${monthName}`;
}
