
// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';

interface CompareOrdersResult {
  data?: CompareOrderDetailsOutput;
  error?: string;
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
];

// Helper function to validate file types more robustly, considering .csv, .xls, .xlsx extensions
// as their MIME types can sometimes be generic (e.g., application/octet-stream).
function isValidFileType(file: File): boolean {
  if (ALLOWED_MIME_TYPES.includes(file.type)) {
    return true;
  }
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.csv') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
    return true;
  }
  return false;
}


async function fileToDataUri(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  // Ensure the MIME type used in the data URI is one that the AI model can likely handle or is standard.
  // For CSV/Excel, text/plain or application/octet-stream might be what's passed if original type isn't specific.
  // The model will rely on prompt instructions for these.
  let mimeType = file.type;
  if ((file.name.toLowerCase().endsWith('.csv') && !mimeType) || mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.csv')) {
    mimeType = 'text/csv';
  } else if ((file.name.toLowerCase().endsWith('.xls') && !mimeType) || mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.xls')) {
    mimeType = 'application/vnd.ms-excel';
  } else if ((file.name.toLowerCase().endsWith('.xlsx') && !mimeType) || mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.xlsx')) {
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }


  return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

export async function compareOrdersAction(formData: FormData): Promise<CompareOrdersResult> {
  const purchaseOrderFile = formData.get('purchaseOrder') as File | null;
  const salesOrderFile = formData.get('salesOrder') as File | null;

  if (!purchaseOrderFile || !salesOrderFile) {
    return { error: 'Both purchase order and sales order documents are required.' };
  }

  if (!isValidFileType(purchaseOrderFile) || !isValidFileType(salesOrderFile)) {
    let poType = purchaseOrderFile.type || 'unknown type';
    if (!ALLOWED_MIME_TYPES.includes(poType) && (purchaseOrderFile.name.endsWith('.csv') || purchaseOrderFile.name.endsWith('.xls') || purchaseOrderFile.name.endsWith('.xlsx'))) {
        poType = `file with extension ${purchaseOrderFile.name.split('.').pop()}`;
    }
    let soType = salesOrderFile.type || 'unknown type';
    if (!ALLOWED_MIME_TYPES.includes(soType) && (salesOrderFile.name.endsWith('.csv') || salesOrderFile.name.endsWith('.xls') || salesOrderFile.name.endsWith('.xlsx'))) {
        soType = `file with extension ${salesOrderFile.name.split('.').pop()}`;
    }

    return { error: `Invalid file type. Please upload supported document types (PDF, Image, CSV, Excel). PO: ${poType}, SO: ${soType}` };
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
    
    // Generalize error for document processing
    if (errorMessage.includes('CLIENT_ERROR') || 
        errorMessage.toLowerCase().includes('unsupported mime type') || 
        errorMessage.toLowerCase().includes('failed to parse content') || 
        errorMessage.toLowerCase().includes('format error') ||
        errorMessage.toLowerCase().includes('consumer_suspended') ||
        errorMessage.toLowerCase().includes('permission denied')
        ) {
         return { error: `Failed to process document: The AI model could not read or interpret one or both of the provided files, or there's an API access issue. Please ensure documents are valid, well-formatted (PDF, Image, CSV, Excel), and API key permissions are correct. Details: ${errorMessage}` };
    }
    return { error: `Failed to compare orders. The AI may have encountered an issue processing the documents. Please ensure they are clear and valid, or try again. Details: ${errorMessage}` };
  }
}

    
