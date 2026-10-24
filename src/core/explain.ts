/**
 * Grounded explanation + number validator + structure + attribution checks (DESIGN.md section 8.3 & step 7).
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
  validateOptionAttribution,
  validateOutputStructure,
  validateYoruba,
  type ExplainOutput,
} from "../llm/explain.ts";
