/**
 * Grounded explanation + number validator + structure + attribution + no-percentage checks (DESIGN.md section 8.3 & Day 4.2 Polish).
 */
export {
  ExplainOutputSchema,
  countSentences,
  countWords,
  explain,
  findInvalidNumbers,
  findNumericTokens,
  getAllowedNumericSet,
  getAllowedNumericSets,
  validateNoPercentages,
  validateOptionAttribution,
  validateOutputStructure,
  validateYoruba,
  type ExplainOutput,
} from "../llm/explain.ts";
