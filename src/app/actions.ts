
// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import xmlrpc from 'xmlrpc';
import type { Client } from 'xmlrpc';

interface CompareOrdersResult {
  data?: CompareOrderDetailsOutput;
  error?: string;
}

interface FetchedSalesOrderResult {
  fileName?: string;
  dataUri?: string;
  error?: string;
  fileSize?: number;
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


// Odoo Connection Details from Environment Variables
const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUsername = process.env.ODOO_USERNAME;
const odooPassword = process.env.ODOO_PASSWORD;

function createOdooClient(path: string): Client {
  if (!odooUrl) throw new Error("ODOO_URL is not configured in environment variables.");
  const urlParts = new URL(odooUrl);
  return xmlrpc.createSecureClient({
    host: urlParts.hostname,
    port: urlParts.port || 443,
    path: path,
  });
}

async function odooRpcCall(client: Client, method: string, params: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (error, value) => {
      if (error) {
        console.error('Odoo XML-RPC Error:', error);
        reject(new Error(`Odoo API Error: ${error.message || 'Unknown error'}`));
      } else {
        resolve(value);
      }
    });
  });
}

export async function fetchSalesOrderAction(soSequence: string): Promise<FetchedSalesOrderResult> {
  if (!odooUrl || !odooDb || !odooUsername || !odooPassword) {
    return { error: 'Odoo connection details are not configured on the server.' };
  }
  if (!soSequence || soSequence.trim() === '') {
    return { error: 'Sales Order sequence number is required.' };
  }

  try {
    const common = createOdooClient('/xmlrpc/2/common');
    const uid = await odooRpcCall(common, 'authenticate', [odooDb, odooUsername, odooPassword, {}]);

    if (!uid) {
      return { error: 'Odoo authentication failed. Check server credentials.' };
    }

    const models = createOdooClient('/xmlrpc/2/object');

    // Find the sale.order record by name
    const salesOrderRecords = await odooRpcCall(models, 'execute_kw', [
      odooDb, uid, odooPassword,
      'sale.order', 'search_read',
      [[['name', 'ilike', soSequence]]],
      { 'fields': ['id', 'name'], 'limit': 1 }
    ]);

    if (!salesOrderRecords || salesOrderRecords.length === 0) {
      return { error: `No Sales Order found matching sequence '${soSequence}'.` };
    }
    const saleOrder = salesOrderRecords[0];
    const saleOrderId = saleOrder.id;

    // Find PDF attachment for the Sale Order
    const attachmentDomain = [
      ['res_model', '=', 'sale.order'],
      ['res_id', '=', saleOrderId],
      ['mimetype', '=', 'application/pdf'],
    ];
    const attachments = await odooRpcCall(models, 'execute_kw', [
      odooDb, uid, odooPassword,
      'ir.attachment', 'search_read',
      [attachmentDomain],
      { 'fields': ['id', 'name', 'datas', 'mimetype', 'file_size'], 'limit': 1 }
    ]);

    if (!attachments || attachments.length === 0) {
      return { error: `No PDF attachment found for Sales Order '${soSequence}'.` };
    }

    const attachment = attachments[0];
    const base64PdfData = attachment.datas;
    const fileName = attachment.name || `${soSequence.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    const mimeType = attachment.mimetype || 'application/pdf';
    const fileSize = attachment.file_size || Buffer.from(base64PdfData, 'base64').length;


    const dataUri = `data:${mimeType};base64,${base64PdfData}`;

    return { fileName, dataUri, fileSize };

  } catch (e: unknown) {
    console.error('SERVER_ACTION_CRITICAL_ERROR fetching Sales Order:', e);
    const errorMessage = e instanceof Error ? e.message : String(e);
    return { error: `Failed to fetch Sales Order PDF: ${errorMessage.substring(0, 300)}` };
  }
}


export async function compareOrdersAction(formData: FormData): Promise<CompareOrdersResult> {
  const purchaseOrderFile = formData.get('purchaseOrder') as File | null;
  const salesOrderDataUriFromForm = formData.get('salesOrderDataUri') as string | null; // SO is now a data URI string
  const salesOrderNameFromForm = formData.get('salesOrderName') as string | null; // And its name

  if (!purchaseOrderFile) {
    return { error: 'Purchase order document is required.' };
  }
  if (!salesOrderDataUriFromForm) {
    return { error: 'Sales order document (fetched or to be fetched) is required.'}
  }

  if (!isValidFileType(purchaseOrderFile)) {
     let poType = purchaseOrderFile.type || 'unknown type';
    if (!ALLOWED_MIME_TYPES_UPLOAD.includes(poType) && (purchaseOrderFile.name.endsWith('.csv') || purchaseOrderFile.name.endsWith('.xls') || purchaseOrderFile.name.endsWith('.xlsx'))) {
        poType = `file with extension ${purchaseOrderFile.name.split('.').pop()}`;
    }
    return { error: `Invalid Purchase Order file type. Please upload supported document types (PDF, Image, CSV, Excel). PO: ${poType}` };
  }

  try {
    const purchaseOrderDataUri = await fileToDataUri(purchaseOrderFile);
    
    // Sales Order Data URI is already provided from the form after fetching
    const salesOrderDataUri = salesOrderDataUriFromForm;

    const result = await compareOrderDetails({
      purchaseOrder: purchaseOrderDataUri,
      salesOrder: salesOrderDataUri,
    });
    return { data: result };

  } catch (e: unknown) {
    console.error('SERVER_ACTION_CRITICAL_ERROR comparing orders:', e);
    let detailedErrorMessage = 'An unknown error occurred on the server during comparison.';
    if (e instanceof Error) {
        detailedErrorMessage = e.message;
        const lowerMessage = e.message.toLowerCase();
        if (lowerMessage.includes('model not found') || lowerMessage.includes('not found for api version') || lowerMessage.includes('could not parse model name')) {
            detailedErrorMessage = `The specified AI model is not accessible or does not exist. Please check the model name and API key permissions. Original error: ${e.message}`;
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
            detailedErrorMessage = JSON.stringify(e);
        } catch (stringifyError) {
            detailedErrorMessage = 'Could not stringify server error object. Check server logs.';
        }
    }
    
    const clientFacingDetail = detailedErrorMessage.replace(/[^\x20-\x7E]/g, '').substring(0, 400);
    
    return {
        error: `Comparison Failed: ${clientFacingDetail}. Please check server logs if the issue persists.`,
    };
  }
}
