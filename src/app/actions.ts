// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';

interface CompareOrdersResult {
  data?: CompareOrderDetailsOutput;
  error?: string;
}

export async function compareOrdersAction(formData: FormData): Promise<CompareOrdersResult> {
  const purchaseOrderText = formData.get('purchaseOrder') as string;
  const salesOrderText = formData.get('salesOrder') as string;

  if (!purchaseOrderText || !salesOrderText) {
    return { error: 'Both purchase order and sales order text are required.' };
  }

  try {
    const result = await compareOrderDetails({
      purchaseOrder: purchaseOrderText,
      salesOrder: salesOrderText,
    });
    return { data: result };
  } catch (e) {
    console.error('Error comparing orders:', e);
    const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred during comparison.';
    return { error: `Failed to compare orders: ${errorMessage}` };
  }
}
