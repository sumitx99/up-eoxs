// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';

interface CompareOrdersResult {
  data?: CompareOrderDetailsOutput;
  error?: string;
}

async function fileToDataUri(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${file.type};base64,${base64}`;
}

export async function compareOrdersAction(formData: FormData): Promise<CompareOrdersResult> {
  const purchaseOrderFile = formData.get('purchaseOrder') as File | null;
  const salesOrderFile = formData.get('salesOrder') as File | null;

  if (!purchaseOrderFile || !salesOrderFile) {
    return { error: 'Both purchase order and sales order PDF files are required.' };
  }

  if (purchaseOrderFile.type !== 'application/pdf' || salesOrderFile.type !== 'application/pdf') {
    return { error: 'Invalid file type. Please upload PDF files only.' };
  }

  try {
    const purchaseOrderDataUri = await fileToDataUri(purchaseOrderFile);
    const salesOrderDataUri = await fileToDataUri(salesOrderFile);

    const result = await compareOrderDetails({
      purchaseOrder: purchaseOrderDataUri,
      salesOrder: salesOrderDataUri,
    });
    return { data: result };
  } catch (e) {
    console.error('Error comparing orders:', e);
    const errorMessage = e instanceof Error ? e.message : String(e) || 'An unexpected error occurred during comparison.';
    
    if (errorMessage.includes('CLIENT_ERROR') || errorMessage.includes('format') || errorMessage.includes('mime type')) {
         return { error: `Failed to process PDF: The AI model could not read the provided PDF. Please ensure it is a valid and text-extractable PDF. Details: ${errorMessage}` };
    }
    return { error: `Failed to compare orders: ${errorMessage}` };
  }
}
