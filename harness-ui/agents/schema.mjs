// JSON Schema for every specialist agent's output (used for Claude structured outputs
// and as documentation for the rule-based agents, which emit the same shape).
export const AgentSignalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agent", "summary", "risk_factors", "protective_factors", "confidence"],
  properties: {
    agent: { type: "string" },
    summary: { type: "string" },
    risk_factors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factor", "weight", "evidence"],
        properties: {
          factor: { type: "string", description: "snake_case label" },
          weight: { type: "number", description: "marginal reduction in completion probability, 0-1" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    protective_factors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factor", "evidence"],
        properties: { factor: { type: "string" }, evidence: { type: "array", items: { type: "string" } } },
      },
    },
    confidence: { type: "number", description: "0-1, evidence quality" },
  },
};
