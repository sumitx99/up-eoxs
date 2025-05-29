
// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import xmlrpc from 'xmlrpc';
import axios from 'axios';
import { wrapper as cookieJarSupport } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';


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
          return reject(new Error(`Odoo XML-RPC authentication failed: ${error.message}. Please check server credentials for Odoo.`));
        }
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
    if (error instanceof Error && error.message.startsWith('Odoo XML-RPC authentication failed:')) throw error;
    if (error instanceof Error && error.message.startsWith('Odoo XML-RPC authentication returned an invalid UID')) throw error;

    throw new Error(`Odoo XML-RPC authentication failed. Original error: ${error instanceof Error ? error.message : String(error)}`);
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
        return reject(new Error(`Error finding Sales Order '${soName}' in Odoo. Original error: ${error instanceof Error ? error.message : String(error)}`));
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

  // Use axios with cookie jar support for session management
  const jar = new CookieJar();
  const axiosInstance = cookieJarSupport(axios.create({ jar, withCredentials: true }));

  const loginUrl = `${odooUrl}/web/session/authenticate`;
  let loginResponse;
  try {
    console.log(`Attempting HTTP login to Odoo: ${loginUrl} for user: ${odooUsername}`);
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
    console.log('Odoo HTTP Login Response Status:', loginResponse.status);
    // console.log('Odoo HTTP Login Response Data:', loginResponse.data); // Be careful logging sensitive data
  } catch (err: any) {
    console.error('Odoo HTTP Login Request Error - Status:', err.response?.status, 'Data:', err.response?.data);
    const errorDetail = err.response?.data?.error?.message || err.message || 'Unknown login error';
    throw new Error(`Odoo HTTP login request failed: ${errorDetail}. Could not establish session.`);
  }
  
  if (loginResponse.status !== 200 || !loginResponse.data.result) {
      console.error('Odoo HTTP Login Failed. Status:', loginResponse.status, 'Response Data:', loginResponse.data);
      const reason = loginResponse.data?.error?.message || 'Response format unexpected or error indicated by Odoo.';
      throw new Error(`Odoo HTTP login failed: ${reason}. This can happen if credentials are correct for XML-RPC but not for HTTP web login, or if the /web/session/authenticate endpoint behaves differently.`);
  }
  console.log('Odoo HTTP login successful.');

  const reportUrl = `${odooUrl}/report/pdf/sale.report_saleorder/${saleId}`;
  let pdfResponse;
  try {
    console.log(`Attempting to download PDF from: ${reportUrl}`);
    pdfResponse = await axiosInstance.get(reportUrl, {
      responseType: 'arraybuffer', // Crucial for binary data like PDF
    });
  } catch (err: any)    {
    console.error('Odoo PDF Fetch Request Error - Status:', err.response?.status, 'Data (if text):', err.response?.data ? Buffer.from(err.response.data).toString('utf-8').substring(0, 500) : 'N/A');
    const errorDetail = err.response?.data?.error?.message || err.message || 'Unknown PDF fetch error';
    throw new Error(`Failed to download PDF for Sales Order '${saleName}'. Odoo server request for report failed. Status: ${err.response?.status}. Detail: ${errorDetail}.`);
  }

  const contentType = pdfResponse.headers['content-type'] || pdfResponse.headers['Content-Type'];
  console.log(`Odoo PDF Fetch Response - Status: ${pdfResponse.status}, Content-Type: ${contentType}, Data Length: ${pdfResponse.data?.byteLength}`);

  if (pdfResponse.status !== 200 || !pdfResponse.data || !(pdfResponse.data.byteLength > 0)) {
    console.error('Odoo PDF Fetch Failed - Status:', pdfResponse.status, 'Data present & non-empty:', !!pdfResponse.data && pdfResponse.data.byteLength > 0);
    throw new Error(`Failed to download PDF data for Sales Order '${saleName}'. Status: ${pdfResponse.status}. Response might be empty or not successful.`);
  }
  
  if (!contentType || !contentType.toLowerCase().includes('application/pdf')) {
    let errorDetails = `Odoo did not return a PDF document. Odoo returned content type '${contentType}'.`;
    if (contentType && (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/json') || contentType.toLowerCase().includes('text/plain'))) {
        try {
            const textResponse = Buffer.from(pdfResponse.data).toString('utf8');
            errorDetails += ` Response preview: ${textResponse.substring(0, 200)}`;
        } catch (decodeError) {
            errorDetails += ` Its content could not be decoded as text.`;
        }
    }
    console.error(errorDetails);
    throw new Error(errorDetails);
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

    if (salesOrderDetails.size === 0) {
        console.warn(`Fetched Sales Order PDF for '${salesOrderName}' is empty (0 bytes). This will likely cause issues with AI comparison.`);
    }

    const result = await compareOrderDetails({
      purchaseOrder: purchaseOrderDataUri,
      salesOrder: salesOrderDetails.dataUri,
    });
    return { data: result };

  } catch (e: unknown) {
    let clientFacingMessage = "An unexpected error occurred on the server while comparing orders.";
    let logMessage = "SERVER_ACTION_CRITICAL_ERROR comparing orders:";

    if (e instanceof Error) {
        clientFacingMessage = e.message; 
        logMessage = `SERVER_ACTION_ERROR (${e.constructor.name}) in compareOrdersAction: ${e.message}`;
        
        // Specific error message enhancements
        if (e.message.toLowerCase().includes("authentication failed") || 
            e.message.toLowerCase().includes("login failed") || 
            e.message.toLowerCase().includes("returned an invalid uid")) {
            clientFacingMessage = `Odoo Authentication Failed: ${e.message}. Please check server credentials for Odoo.`;
        } else if (e.message.toLowerCase().includes("not found in odoo")) {
            clientFacingMessage = `Odoo Data Error: ${e.message}. Ensure the Sales Order name is correct.`;
        } else if (e.message.toLowerCase().includes("failed to download pdf") || 
                   e.message.toLowerCase().includes("did not return a pdf document") ||
                   e.message.toLowerCase().includes("odoo returned content type")) {
            clientFacingMessage = `Odoo PDF Fetch Error: ${e.message}. The report might not exist, or there was an issue generating it, or the response was not a PDF.`;
        } else if (e.message.toLowerCase().includes("model not found") || e.message.toLowerCase().includes("not found for api version")) {
            clientFacingMessage = `AI Model Error: The specified AI model is not accessible or does not exist. Original error: ${e.message}`;
        } else if (e.message.toLowerCase().includes("consumer_suspended") || e.message.toLowerCase().includes("permission denied") || e.message.toLowerCase().includes("api key not valid")) {
            clientFacingMessage = `AI Service Error: Issue with API key or billing: ${e.message}. Check Google Cloud settings.`;
        } else if (e.message.toLowerCase().includes("schema validation failed") || e.message.toLowerCase().includes("invalid_argument")) {
           clientFacingMessage = `AI Data Error: The AI's response was not in the expected format, or a document was unprocessable. Original error: ${e.message}`;
        } else if (e.message.toLowerCase().includes("ai model encountered an issue during processing")) {
            clientFacingMessage = e.message; 
        }
    } else if (typeof e === 'string') {
        clientFacingMessage = e;
        logMessage = `SERVER_ACTION_ERROR (string) in compareOrdersAction: ${e}`;
    } else {
        logMessage = `SERVER_ACTION_ERROR (unknown type) in compareOrdersAction: ${String(e)}`;
    }
    
    console.error(logMessage, e); 

    // Sanitize and cap length for client-facing message
    const finalClientMessage = `Failed to compare orders. ${clientFacingMessage.replace(/[^\x20-\x7E]/g, '').substring(0, 500)}`;
    
    return {
        error: `${finalClientMessage} Please check server logs if the issue persists.`,
    };
  }
}
