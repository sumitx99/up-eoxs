
// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';

interface CompareOrdersResult {
  data?: CompareOrderDetailsOutput;
  error?: string;
}

const ALLOWED_MIME_TYPES_UPLOAD = [
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
  if (ALLOWED_MIME_TYPES_UPLOAD.includes(file.type)) {
    return true;
  }
  // Fallback for browsers that might not report MIME type correctly for CSV/Excel
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

  // Attempt to infer MIME type from extension if browser provides a generic one
  if ((file.name.toLowerCase().endsWith('.csv') && !mimeType) || (mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.csv'))) {
    mimeType = 'text/csv';
  } else if ((file.name.toLowerCase().endsWith('.xls') && !mimeType) || (mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.xls'))) {
    mimeType = 'application/vnd.ms-excel';
  } else if ((file.name.toLowerCase().endsWith('.xlsx') && !mimeType) || (mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.xlsx'))) {
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

export async function compareOrdersAction(formData: FormData): Promise<CompareOrdersResult> {
  const purchaseOrderFile = formData.get('purchaseOrder') as File | null;
  const salesOrderFile = formData.get('salesOrder') as File | null;

  if (!purchaseOrderFile) {
    return { error: 'Purchase Order document is required.' };
  }
  if (!salesOrderFile) {
    return { error: 'Sales Order document is required.' };
  }

  if (!isValidFileType(purchaseOrderFile)) {
    let poType = purchaseOrderFile.type || 'unknown type';
    if (!ALLOWED_MIME_TYPES_UPLOAD.includes(poType) && (purchaseOrderFile.name.endsWith('.csv') || purchaseOrderFile.name.endsWith('.xls') || purchaseOrderFile.name.endsWith('.xlsx'))) {
        poType = `file with extension ${purchaseOrderFile.name.split('.').pop()}`;
    }
    return { error: `Invalid Purchase Order file type. Please upload supported document types (PDF, Image, CSV, Excel). PO: ${poType}` };
  }
  if (!isValidFileType(salesOrderFile)) {
    let soType = salesOrderFile.type || 'unknown type';
     if (!ALLOWED_MIME_TYPES_UPLOAD.includes(soType) && (salesOrderFile.name.endsWith('.csv') || salesOrderFile.name.endsWith('.xls') || salesOrderFile.name.endsWith('.xlsx'))) {
        soType = `file with extension ${salesOrderFile.name.split('.').pop()}`;
    }
    return { error: `Invalid Sales Order file type. Please upload supported document types (PDF, Image, CSV, Excel). SO: ${soType}` };
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
    console.error("SERVER_ACTION_CRITICAL_ERROR comparing orders:", e);

    let clientFacingMessage = "An unexpected error occurred on the server while comparing orders.";

    if (e instanceof Error) {
        clientFacingMessage = e.message; // Use the error message from the Genkit flow or other processing steps
        const lowerMessage = e.message.toLowerCase();
        if (lowerMessage.includes("model not found") || lowerMessage.includes("not found for api version") || lowerMessage.includes("could not parse model name")) {
            clientFacingMessage = `Comparison Failed: The specified AI model is not accessible or does not exist. Please check the model name and API key permissions. Original error: ${e.message}`;
        } else if (lowerMessage.includes("consumer_suspended") || lowerMessage.includes("permission denied") || lowerMessage.includes("api key not valid") || lowerMessage.includes("billing account")) {
            clientFacingMessage = `Comparison Failed: There's an issue with your API key or billing: ${e.message}. Please check your Google Cloud project settings.`;
        } else if (lowerMessage.includes("schema validation failed") || lowerMessage.includes("invalid_argument")) {
           clientFacingMessage = `Comparison Failed: The AI's response was not in the expected format, or a document was unprocessable. Original error: ${e.message}`;
        } else if (lowerMessage.includes("ai model failed to return valid comparison data")) {
            clientFacingMessage = `Comparison Failed: ${e.message}`; 
        } else if (lowerMessage.includes("ai model encountered an issue during processing")) { 
            clientFacingMessage = `Comparison Failed: ${e.message}`;
        }
    } else if (typeof e === 'string') {
        clientFacingMessage = e;
    }
    
    const finalClientMessage = `Failed to compare orders. ${clientFacingMessage}`.replace(/[^\x20-\x7E]/g, '').substring(0, 500);
    
    return {
        error: `${finalClientMessage} Please check server logs if the issue persists.`,
    };
  }
}
