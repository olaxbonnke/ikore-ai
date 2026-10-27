/**
 * Grounded explanation + number validator + structure + attribution + no-percentage checks (DESIGN.md section 8.3 & Day 4.2 Polish).
 */
export {
  ExplainOutputSchema,
  countSentences,
  countWords,
  explain,
  explainRecall,
  findInvalidNumbers,
  findNumericTokens,
  getAllowedNumericSet,
  getAllowedNumericSets,
  validateNoPercentages,
  validateOptionAttribution,
  validateOutputStructure,
  validateRecallLanguage,
  validateYoruba,
  validateRepetition,
  REPETITION_MIN_CLAUSE_WORDS,
  REPETITION_MAX_CLAUSE_REPETITIONS,
  REPETITION_NGRAM_SIZE,
  REPETITION_MAX_NGRAM_REPETITIONS,
  REPETITION_MIN_WORDS_FOR_RATIO,
  REPETITION_MIN_UNIQUE_RATIO,
  type ExplainOutput,
} from "../llm/explain.ts";
