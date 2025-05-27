
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
    // Log the full error on the server for debugging
    console.error('SERVER_ACTION_ERROR comparing orders:', e); 

    let detailedErrorMessage = 'An unexpected error occurred during the comparison process.';
    if (e instanceof Error) {
      detailedErrorMessage = e.message;
    } else if (typeof e === 'string') {
      detailedErrorMessage = e;
    } else {
      // Try to stringify if it's an object, otherwise use a generic message
      try {
        detailedErrorMessage = JSON.stringify(e);
      } catch (stringifyError) {
        console.error('SERVER_ACTION_ERROR: Could not stringify error object:', stringifyError);
        detailedErrorMessage = 'An unknown and unstringifyable error occurred.';
      }
    }
    
    // Sanitize the detailed error message to remove potentially problematic characters for client display
    const sanitizedDetailedErrorMessage = detailedErrorMessage.replace(/[^\x20-\x7E\n\r\t]/g, '');

    const userFacingError = `Failed to compare orders. The AI may have encountered an issue processing the documents. Please ensure they are clear and valid, or try again. Details: ${sanitizedDetailedErrorMessage}`;
    
    // Ensure the error message sent to client is not overly long if the detailed message is huge
    const maxErrorLength = 1000; // Cap the length of the error message sent to client
    return { error: userFacingError.substring(0, maxErrorLength) };
  }
}
