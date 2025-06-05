
// Summarize discrepancies between purchase order and sales order.
'use server';

/**
 * @fileOverview Summarizes the discrepancies between a purchase order and a sales order.
 *
 * - summarizeDiscrepancies - A function that generates a concise summary of discrepancies.
 * - SummarizeDiscrepanciesInput - The input type for the summarizeDiscrepancies function.
 * - SummarizeDiscrepanciesOutput - The return type for the summarizeDiscrepancies function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeDiscrepanciesInputSchema = z.object({
  purchaseOrder: z.string().describe('The purchase order data.'),
  salesOrder: z.string().describe('The sales order data.'),
});
export type SummarizeDiscrepanciesInput = z.infer<typeof SummarizeDiscrepanciesInputSchema>;

const SummarizeDiscrepanciesOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the discrepancies between the purchase order and sales order.'),
});
export type SummarizeDiscrepanciesOutput = z.infer<typeof SummarizeDiscrepanciesOutputSchema>;

export async function summarizeDiscrepancies(input: SummarizeDiscrepanciesInput): Promise<SummarizeDiscrepanciesOutput> {
  return summarizeDiscrepanciesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeDiscrepanciesPrompt',
  input: {schema: SummarizeDiscrepanciesInputSchema},
  output: {schema: SummarizeDiscrepanciesOutputSchema},
  prompt: `You are an expert in analyzing purchase orders and sales orders.

  Your task is to compare the provided purchase order and sales order data and generate a concise summary of any discrepancies found between them, focusing on products, discounts, and taxes.

  Purchase Order:
  {{purchaseOrder}}

  Sales Order:
  {{salesOrder}}

  Summary:`,
});

const summarizeDiscrepanciesFlow = ai.defineFlow(
  {
    name: 'summarizeDiscrepanciesFlow',
    inputSchema: SummarizeDiscrepanciesInputSchema,
    outputSchema: SummarizeDiscrepanciesOutputSchema, // This schema expects a summary string.
  },
  async (input): Promise<SummarizeDiscrepanciesOutput> => {
    try {
      const { output } = await prompt(input);
      // Genkit's `prompt` function, when an output schema is defined,
      // will parse the LLM response against that schema.
      // If `output` is null/undefined, or if `output.summary` is not a string,
      // Zod parsing by Genkit should throw an error, which will be caught by the catch block.
      // Thus, if we reach this point, `output` and `output.summary` should be valid as per the schema.
      if (output && typeof output.summary === 'string') {
          return output;
      }
      // This case should ideally not be reached if Zod parsing and schema enforcement are robust.
      // It's a fallback for unexpected scenarios post-parsing or if the schema were more permissive.
      console.warn('SummarizeDiscrepanciesFlow: AI output was not as expected after Zod parsing. Output:', output);
      return { summary: 'The AI returned an unexpected data structure for the summary.' };

    } catch (error) {
      console.error('Error in summarizeDiscrepanciesFlow (AI call or output parsing):', error);
      // Provide a user-friendly default summary in case of any error.
      return { summary: 'An error occurred while generating the discrepancy summary.' };
    }
  }
);
