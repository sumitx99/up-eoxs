
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

// Helper function to validate file types more robustly
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
  } catch (e: unknown) {
    // Log the full error for server-side debugging
    console.error('SERVER_ACTION_CRITICAL_ERROR comparing orders:', e);

    let detailedErrorMessage = 'An unknown error occurred on the server.';
    if (e instanceof Error) {
      detailedErrorMessage = e.message;
      // Check for specific known error patterns from Google/Genkit
      const lowerMessage = e.message.toLowerCase();
      if (lowerMessage.includes('model not found') || lowerMessage.includes('not found for api version') || lowerMessage.includes('could not parse model name')) {
        detailedErrorMessage = `The specified AI model (${(e as any)?.config?.model || 'unknown model'}) is not accessible or does not exist. Please check the model name and API key permissions. Original error: ${e.message}`;
      } else if (lowerMessage.includes('consumer_suspended') || lowerMessage.includes('permission denied') || lowerMessage.includes('api key not valid') || lowerMessage.includes('billing account')) {
        detailedErrorMessage = `There's an issue with your API key or billing: ${e.message}. Please check your Google Cloud project settings.`;
      } else if (lowerMessage.includes('schema validation failed') || lowerMessage.includes('invalid_argument')) {
        detailedErrorMessage = `The AI's response was not in the expected format, or a document was unprocessable. Original error: ${e.message}`;
      } else if (lowerMessage.includes('ai model failed to return valid comparison data')) {
        detailedErrorMessage = `The AI model did not return any data for comparison. This could be due to very complex documents, or an issue with the AI service. Original error: ${e.message}`;
      }
    } else if (typeof e === 'string') {
      detailedErrorMessage = e;
    } else {
      try {
        // Attempt to stringify if it's an object, but be cautious
        detailedErrorMessage = JSON.stringify(e);
      } catch (stringifyError) {
        detailedErrorMessage = 'Could not stringify server error object. Check server logs.';
      }
    }

    // Sanitize and cap length for the client-facing message
    const clientFacingDetail = detailedErrorMessage.replace(/[^\x20-\x7E]/g, '').substring(0, 400); // Increased length slightly

    return {
      error: `Comparison Failed: ${clientFacingDetail}. Please check server logs if the issue persists.`,
    };
  }
}
