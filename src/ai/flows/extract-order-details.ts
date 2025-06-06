'use server';
/**
 * @fileOverview An AI agent that extracts order details from purchase orders and sales orders.
 *
 * - extractOrderDetails - A function that extracts order details.
 * - ExtractOrderDetailsInput - The input type for the extractOrderDetails function.
 * - ExtractOrderDetailsOutput - The return type for the extractOrderDetails function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExtractOrderDetailsInputSchema = z.object({
  orderText: z
    .string()
    .describe('The text content of the purchase order or sales order.'),
  orderType: z.enum(['purchase', 'sales']).describe('The type of order.'),
});
export type ExtractOrderDetailsInput = z.infer<typeof ExtractOrderDetailsInputSchema>;

const ExtractOrderDetailsOutputSchema = z.object({
  products: z
    .array(
      z.object({
        name: z.string().describe('The name of the product.'),
        quantity: z.number().describe('The quantity of the product.'),
        discount: z.number().optional().describe('The discount applied to the product.'),
        tax: z.number().optional().describe('The tax applied to the product.'),
      })
    )
    .describe('The list of products in the order.'),
  totalDiscount: z.number().optional().describe('The total discount for the order.'),
  totalTax: z.number().optional().describe('The total tax for the order.'),
});
export type ExtractOrderDetailsOutput = z.infer<typeof ExtractOrderDetailsOutputSchema>;

export async function extractOrderDetails(input: ExtractOrderDetailsInput): Promise<ExtractOrderDetailsOutput> {
  return extractOrderDetailsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractOrderDetailsPrompt',
  input: {schema: ExtractOrderDetailsInputSchema},
  output: {schema: ExtractOrderDetailsOutputSchema},
  prompt: `You are an expert in extracting data from purchase orders and sales orders.

You will be given the text content of an order and the type of order. You will extract the product names, quantities, discounts, and taxes from the order.

Order Type: {{{orderType}}}
Order Text:
{{{orderText}}}

Return a JSON object with the following structure:
{
  "products": [
    {
      "name": "Product Name",
      "quantity": Quantity,
      "discount": Discount, // optional
      "tax": Tax // optional
    }
  ],
  "totalDiscount": Total Discount, // optional
  "totalTax": Total Tax // optional
}
`,
});

const extractOrderDetailsFlow = ai.defineFlow(
  {
    name: 'extractOrderDetailsFlow',
    inputSchema: ExtractOrderDetailsInputSchema,
    outputSchema: ExtractOrderDetailsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);