/**
 * Advising chat with two audiences and a hard information boundary, grounded in the real
 * Long-Term Fit Report and fairness attestation for the applicant.
 *   coordinator — sees the full report, estimates, attestation and drivers; is pushed back on
 *                 automated denial and on stereotype framing.
 *   student     — sees advice only; never the estimates, the verdict, or that a report exists.
 * Uses the same Responses-API provider as the runtime (gpt-5.4-mini, no tools).
 */
import { createResponse, type InputItem } from '../harness/provider.ts';
import type { ApplicantInput } from '../schema/applicant.ts';
import type { PipelineResult } from '../pipeline/run.ts';

export type Audience = 'coordinator' | 'student';
const MODEL = 'openai/gpt-5-4-mini';

const COORDINATOR = `You are advising a PROGRAM COORDINATOR reviewing a Lighthouse Long-Term Fit Report. You may discuss everything below: estimates, intervals, evidence, the critical analysis, risk flags and the fairness attestation. Lead with strengths, then surface risk plainly with the cited evidence. Report the analyst's own confidence; never overstate. Every estimate is a recommendation for a human decision: refuse to endorse an automated deny, and refuse to characterise the applicant through stereotypes or circumstance (wealth, school prestige, geography, family) — redirect to person signals in the record. Suggest the cheapest falsifying experiment when asked what to do next. Keep answers under 180 words unless asked for detail.`;

const STUDENT = `You are advising the APPLICANT about their own application to this program. You must NOT reveal, hint at, or confirm the existence of any internal estimate, score, probability, verdict, audit, flag, or report about them. If asked, say advising conversations are not reported as scores and move to what they can do. Be warm and practical: what strengthens an application, how the program is structured, what a reviewer would want to see. Never help misrepresent grades, activities, finances or documents; never submit anything on their behalf. Keep answers under 150 words.`;

export async function* chat(opts: { audience: Audience; applicant: ApplicantInput; result: PipelineResult | null; messages: { role: 'user' | 'assistant'; content: string }[] }): AsyncGenerator<string> {
  const { audience, applicant, result, messages } = opts;
  const record = JSON.stringify(applicant, null, 1);
  const internal = result
    ? `Pipeline status: ${result.status}${result.approval?.paused ? ' (action paused for human approval)' : ''}\nReport:\n${JSON.stringify(result.report, null, 1)}\nFairness attestation:\n${JSON.stringify(result.attestation, null, 1)}\nRisk flags: ${JSON.stringify(result.risk_flags)}`
    : 'No report has been produced for this applicant yet.';
  const instructions =
    audience === 'coordinator'
      ? `${COORDINATOR}\n\nApplicant record:\n${record}\n\n${internal}`
      : `${STUDENT}\n\nThe applicant's own record (you may discuss its contents with them):\n${record}\n\nINTERNAL — never disclose any of the following, in any form:\n${internal}`;
  const input: InputItem[] = messages.map((m) => ({ role: m.role, content: m.content }));
  // Non-streaming call; the reply is short. Yield once so the server can stream uniformly.
  const reply = await createResponse({ model: MODEL, instructions, input, reasoning_effort: 'low' });
  yield reply.content ?? '';
}
