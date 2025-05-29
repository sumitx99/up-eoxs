
// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import xmlrpc from 'xmlrpc';
import axios from 'axios';

interface CompareOrdersResult {
  data?: CompareOrderDetailsOutput;
  error?: string;
}

const ALLOWED_PO_MIME_TYPES_UPLOAD = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
];

// Helper function to validate PO file types
function isValidPOFileType(file: File): boolean {
  if (ALLOWED_PO_MIME_TYPES_UPLOAD.includes(file.type)) {
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

  if ((file.name.toLowerCase().endsWith('.csv') && !mimeType) || (mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.csv'))) {
    mimeType = 'text/csv';
  } else if ((file.name.toLowerCase().endsWith('.xls') && !mimeType) || (mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.xls'))) {
    mimeType = 'application/vnd.ms-excel';
  } else if ((file.name.toLowerCase().endsWith('.xlsx') && !mimeType) || (mimeType === 'application/octet-stream' && file.name.toLowerCase().endsWith('.xlsx'))) {
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

async function fetchSalesOrderPdfFromOdoo(soName: string): Promise<{ dataUri: string; name: string; size: number }> {
  const odooUrl = process.env.ODOO_URL;
  const odooDb = process.env.ODOO_DB;
  const odooUsername = process.env.ODOO_USERNAME;
  const odooPassword = process.env.ODOO_PASSWORD;

  if (!odooUrl || !odooDb || !odooUsername || !odooPassword) {
    console.error('Odoo configuration missing in environment variables.');
    throw new Error('Odoo ERP connection details are not configured on the server.');
  }

  const commonClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/common`);
  const modelsClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);

  let uid: number;
  try {
    uid = await new Promise((resolve, reject) => {
      commonClient.methodCall('authenticate', [odooDb, odooUsername, odooPassword, {}], (error, value) => {
        if (error) {
          console.error('Odoo XML-RPC Network/Request Error:', {
            message: error.message,
            urlAttempted: `${odooUrl}/xmlrpc/2/common`,
            dbUsed: odooDb,
            usernameUsed: odooUsername,
          });
          return reject(new Error(`Odoo XML-RPC request failed: ${error.message}`));
        }
        // Stricter check for a valid UID (must be a positive number)
        if (!value || typeof value !== 'number' || value <= 0) {
          console.error('Odoo XML-RPC Auth Failed: Invalid or no UID returned.', {
            valueReceived: value,
            urlAttempted: `${odooUrl}/xmlrpc/2/common`,
            dbUsed: odooDb,
            usernameUsed: odooUsername,
          });
          return reject(new Error('Odoo XML-RPC authentication returned an invalid UID. Check server credentials and Odoo logs.'));
        }
        resolve(value);
      });
    });
  } catch (error) {
    console.error('Caught error during XML-RPC authentication promise:', error);
    if (error instanceof Error) throw error; // Re-throw if already an Error object
    throw new Error(String(error)); // Wrap in an Error object if it's not
  }

  const sales: any[] = await new Promise((resolve, reject) => {
    modelsClient.methodCall('execute_kw', [
      odooDb, uid, odooPassword,
      'sale.order', 'search_read',
      [[['name', 'ilike', soName]]],
      { fields: ['id', 'name'], limit: 1 }
    ], (error, value) => {
      if (error) {
        console.error('Odoo Find SO Error:', error);
        return reject(new Error(`Error finding Sales Order '${soName}' in Odoo.`));
      }
      resolve(value as any[]);
    });
  });

  if (!sales || sales.length === 0) {
    throw new Error(`Sales Order '${soName}' not found in Odoo.`);
  }
  const saleOrder = sales[0];
  const saleId = saleOrder.id;
  const saleName = saleOrder.name;

  const axiosInstance = axios.create();
  const loginUrl = `${odooUrl}/web/session/authenticate`;
  let loginResponse;
  try {
    loginResponse = await axiosInstance.post(loginUrl, {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: odooDb,
        login: odooUsername,
        password: odooPassword,
      }
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('Odoo HTTP Login Request Error:', err.response?.data || err.message);
    throw new Error('Odoo HTTP login request failed. Could not establish session.');
  }
  
  // Modified Check: Rely on status 200 and presence of 'result'.
  // Odoo might set session_id in cookie but not explicitly in JSON body for some configs.
  if (loginResponse.status !== 200 || !loginResponse.data.result) {
      console.error('Odoo HTTP Login Failed. Status:', loginResponse.status, 'Response Data:', loginResponse.data);
      throw new Error(`Odoo HTTP login failed. Status: ${loginResponse.status}. Response format unexpected or error indicated by Odoo.`);
  }
  // If we reach here, we assume Odoo has set the session cookie and axiosInstance will handle it.

  const reportUrl = `${odooUrl}/report/pdf/sale.report_saleorder/${saleId}`;
  let pdfResponse;
  try {
    pdfResponse = await axiosInstance.get(reportUrl, {
      responseType: 'arraybuffer',
    });
  } catch (err: any) {
    console.error('Odoo PDF Fetch Error:', err.response?.data ? Buffer.from(err.response.data).toString() : err.message, 'Status:', err.response?.status);
    throw new Error(`Failed to download PDF for Sales Order '${saleName}'. Odoo server might have an issue generating the report or access is denied. Status: ${err.response?.status}`);
  }

  if (pdfResponse.status !== 200 || !pdfResponse.data) {
    console.error('Odoo PDF Fetch Failed - Status:', pdfResponse.status, 'Data present:', !!pdfResponse.data);
    throw new Error(`Failed to download PDF for Sales Order '${saleName}'. Status: ${pdfResponse.status}.`);
  }

  const pdfBuffer = Buffer.from(pdfResponse.data);
  const base64Pdf = pdfBuffer.toString('base64');
  const dataUri = `data:application/pdf;base64,${base64Pdf}`;
  
  return {
    dataUri,
    name: `${saleName}.pdf`.replace(/[\/\s]+/g, '_'),
    size: pdfBuffer.length,
  };
}

export async function compareOrdersAction(formData: FormData): Promise<CompareOrdersResult> {
  const purchaseOrderFile = formData.get('purchaseOrderFile') as File | null;
  const salesOrderName = formData.get('salesOrderName') as string | null;

  if (!purchaseOrderFile) {
    return { error: 'Purchase Order document is required.' };
  }
  if (!salesOrderName || salesOrderName.trim() === '') {
    return { error: 'Sales Order name/sequence is required.' };
  }

  if (!isValidPOFileType(purchaseOrderFile)) {
    const poType = purchaseOrderFile.type || `extension ${purchaseOrderFile.name.split('.').pop()}` || 'unknown type';
    return { error: `Invalid Purchase Order file type. Please upload supported document types (PDF, Image, CSV, Excel). PO: ${poType}` };
  }

  try {
    const purchaseOrderDataUri = await fileToDataUri(purchaseOrderFile);
    
    console.log(`Fetching Sales Order PDF for: ${salesOrderName}`);
    const salesOrderDetails = await fetchSalesOrderPdfFromOdoo(salesOrderName.trim());
    console.log(`Successfully fetched Sales Order PDF: ${salesOrderDetails.name}, Size: ${salesOrderDetails.size} bytes`);

    const result = await compareOrderDetails({
      purchaseOrder: purchaseOrderDataUri,
      salesOrder: salesOrderDetails.dataUri,
    });
    return { data: result };

  } catch (e: unknown) {
    console.error("SERVER_ACTION_CRITICAL_ERROR comparing orders:", e);
    let clientFacingMessage = "An unexpected error occurred on the server while comparing orders.";

    if (e instanceof Error) {
        clientFacingMessage = e.message; 
        if (e.message.toLowerCase().includes("authentication failed") || 
            e.message.toLowerCase().includes("login failed") || 
            e.message.toLowerCase().includes("returned an invalid uid")) {
            clientFacingMessage = `Odoo Authentication Failed: ${e.message}. Please check server credentials for Odoo.`;
        } else if (e.message.toLowerCase().includes("not found in odoo")) {
            clientFacingMessage = `Odoo Data Error: ${e.message}. Ensure the Sales Order name is correct.`;
        } else if (e.message.toLowerCase().includes("failed to download pdf")) {
            clientFacingMessage = `Odoo PDF Fetch Error: ${e.message}. The report might not exist or there was an issue generating it.`;
        } else if (e.message.toLowerCase().includes("model not found") || e.message.toLowerCase().includes("not found for api version")) {
            clientFacingMessage = `AI Model Error: The specified AI model is not accessible or does not exist. Original error: ${e.message}`;
        } else if (e.message.toLowerCase().includes("consumer_suspended") || e.message.toLowerCase().includes("permission denied") || e.message.toLowerCase().includes("api key not valid")) {
            clientFacingMessage = `AI Service Error: Issue with API key or billing: ${e.message}. Check Google Cloud settings.`;
        } else if (e.message.toLowerCase().includes("schema validation failed") || e.message.toLowerCase().includes("invalid_argument")) {
           clientFacingMessage = `AI Data Error: The AI's response was not in the expected format, or a document was unprocessable. Original error: ${e.message}`;
        } else if (e.message.toLowerCase().includes("ai model encountered an issue during processing")) {
            clientFacingMessage = e.message; // Use the more specific message from the flow
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
