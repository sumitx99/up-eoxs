
// src/app/actions.ts
'use server';

import { compareOrderDetails, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import xmlrpc from 'xmlrpc';
import axios from 'axios';
import { wrapper as cookieJarSupport } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

interface FetchedPdfDetails {
  dataUri: string;
  fileName: string;
  originalName: string;
  size: number;
}

interface FetchedSalesOrderPdfDetails extends FetchedPdfDetails {
  saleOrderId: number;
}

export interface CompareActionState {
  error?: string | null;
  data?: CompareOrderDetailsOutput | null;
}

async function fetchSalesOrderPdfFromOdoo(
  soUserInputName: string,
  odooUrl: string,
  odooDb: string,
  odooUsername: string,
  odooPassword: string
): Promise<FetchedSalesOrderPdfDetails> {
  console.log(`SERVER_ACTION: Attempting to fetch Sales Order PDF for user input: ${soUserInputName}`);
  const commonClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/common`);
  
  let uid: number;
  try {
    uid = await new Promise((resolve, reject) => {
      commonClient.methodCall('authenticate', [odooDb, odooUsername, odooPassword, {}], (error, value) => {
        if (error) return reject(new Error(`Odoo XML-RPC authentication failed: ${error.message}.`));
        if (!value || typeof value !== 'number' || value <= 0) return reject(new Error('Odoo XML-RPC authentication returned an invalid UID.'));
        resolve(value);
      });
    });
    console.log(`SERVER_ACTION: Odoo XML-RPC authentication successful for SO fetch. UID: ${uid}`);
  } catch (authError: any) {
    console.error('SERVER_ACTION: Odoo XML-RPC Authentication Error (SO Fetch):', authError.message);
    throw new Error(`Odoo Authentication Failed (XML-RPC for SO): ${authError.message}. Please check server credentials for Odoo.`);
  }

  const modelsClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);
  const sales: any[] = await new Promise((resolve, reject) => {
    modelsClient.methodCall('execute_kw', [
      odooDb, uid, odooPassword,
      'sale.order', 'search_read',
      [[['name', 'ilike', soUserInputName]]],
      { fields: ['id', 'name'], limit: 1 }
    ], (error, value) => {
      if (error) return reject(new Error(`Error finding Sales Order '${soUserInputName}' in Odoo: ${error.message}`));
      resolve(value as any[]);
    });
  });

  if (!sales || sales.length === 0) {
    throw new Error(`Sales Order '${soUserInputName}' not found in Odoo.`);
  }
  const saleOrder = sales[0];
  const saleId = saleOrder.id as number;
  const actualSaleOrderName = saleOrder.name;
  console.log(`SERVER_ACTION: Found Sales Order: ${actualSaleOrderName} (ID: ${saleId})`);

  const jar = new CookieJar();
  const axiosInstance = cookieJarSupport(axios.create({ jar, withCredentials: true }));

  const loginUrl = `${odooUrl}/web/session/authenticate`;
  try {
    console.log('SERVER_ACTION: Attempting Odoo HTTP login for SO PDF download...');
    const loginResponse = await axiosInstance.post(loginUrl, {
      jsonrpc: '2.0', method: 'call', params: { db: odooDb, login: odooUsername, password: odooPassword }
    }, { headers: { 'Content-Type': 'application/json' } });

    if (loginResponse.status !== 200 || !loginResponse.data.result) {
      console.error('SERVER_ACTION: Odoo HTTP Login Failed. Status:', loginResponse.status, 'Response Data:', loginResponse.data);
      const reason = loginResponse.data?.error?.data?.message || loginResponse.data?.error?.message || 'Response format unexpected or error indicated by Odoo.';
      throw new Error(`Odoo HTTP login failed: ${reason}.`);
    }
    console.log('SERVER_ACTION: Odoo HTTP login successful for SO PDF download.');
  } catch (loginErr: any) {
    console.error('SERVER_ACTION: Odoo HTTP Login Request Error:', loginErr.response?.status, loginErr.response?.data, loginErr.message);
    const errorDetail = loginErr.response?.data?.error?.data?.message || loginErr.response?.data?.error?.message || loginErr.message || 'Unknown HTTP login error';
    throw new Error(`Odoo HTTP login request failed: ${errorDetail}. Could not establish session for SO PDF download.`);
  }

  const reportUrl = `${odooUrl}/report/pdf/sale.report_saleorder/${saleId}`;
  console.log(`SERVER_ACTION: Attempting to download SO PDF from: ${reportUrl}`);
  const pdfResponse = await axiosInstance.get(reportUrl, { responseType: 'arraybuffer' });

  const contentType = pdfResponse.headers['content-type'] || pdfResponse.headers['Content-Type'];
  console.log(`SERVER_ACTION: SO PDF Download Response Status: ${pdfResponse.status}, Content-Type: ${contentType}`);

  if (pdfResponse.status !== 200 || !contentType || !contentType.toLowerCase().includes('application/pdf') || !pdfResponse.data || !(pdfResponse.data.byteLength > 0)) {
    let errorDetails = `Odoo did not return a valid PDF for Sales Order '${actualSaleOrderName}'. Status: ${pdfResponse.status}. Content-Type: ${contentType}.`;
    if (contentType && (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/json'))) {
      try { errorDetails += ` Response preview: ${Buffer.from(pdfResponse.data).toString('utf8').substring(0, 200)}`; } catch (decodeError) { /* ignore */ }
    }
    console.error('SERVER_ACTION:', errorDetails, 'Data length:', pdfResponse.data?.byteLength);
    throw new Error(errorDetails);
  }
  console.log(`SERVER_ACTION: Successfully fetched SO PDF: ${actualSaleOrderName}.pdf, Size: ${pdfResponse.data.byteLength} bytes`);

  const pdfBuffer = Buffer.from(pdfResponse.data);
  const base64Pdf = pdfBuffer.toString('base64');
  return {
    dataUri: `data:application/pdf;base64,${base64Pdf}`,
    fileName: `${actualSaleOrderName}.pdf`.replace(/[\/\s]+/g, '_'),
    originalName: actualSaleOrderName,
    size: pdfBuffer.length,
    saleOrderId: saleId,
  };
}

export async function compareOrdersAction(
  prevState: CompareActionState,
  formData: FormData
): Promise<CompareActionState> {
  console.log("SERVER_ACTION: compareOrdersAction invoked.");
  const salesOrderUserInputName = formData.get('salesOrderName') as string | null;
  const purchaseOrderFile = formData.get('purchaseOrderFile') as File | null; // Changed to single file

  if (!salesOrderUserInputName || salesOrderUserInputName.trim() === '') {
    return { error: 'Sales Order name/sequence is required.' };
  }

  const odooUrl = process.env.ODOO_URL;
  const odooDb = process.env.ODOO_DB;
  const odooUsername = process.env.ODOO_USERNAME;
  const odooPassword = process.env.ODOO_PASSWORD;

  if (!odooUrl || !odooDb || !odooUsername || !odooPassword) {
    console.error("SERVER_ACTION: Odoo ERP connection details are not configured on the server.");
    return { error: 'Odoo ERP connection details are not configured on the server.' };
  }

  try {
    // 1) Fetch Sales Order PDF
    const salesOrderDetails = await fetchSalesOrderPdfFromOdoo(
      salesOrderUserInputName.trim(),
      odooUrl,
      odooDb,
      odooUsername,
      odooPassword
    );
    console.log(
      `SERVER_ACTION: Successfully fetched Sales Order PDF: ${salesOrderDetails.originalName} (ID: ${salesOrderDetails.saleOrderId}, Size: ${salesOrderDetails.size} bytes)`
    );

    // 2) Process manually uploaded Purchase Order file
    const purchaseOrderDataUris: string[] = [];
    if (purchaseOrderFile && purchaseOrderFile.size > 0) {
      console.log(`SERVER_ACTION: Processing manually uploaded Purchase Order file: ${purchaseOrderFile.name}`);
      try {
          const buffer = await purchaseOrderFile.arrayBuffer();
          const base64String = Buffer.from(buffer).toString('base64');
          const dataUri = `data:${purchaseOrderFile.type || 'application/octet-stream'};base64,${base64String}`;
          purchaseOrderDataUris.push(dataUri);
          console.log(`SERVER_ACTION: Converted uploaded PO file ${purchaseOrderFile.name} (Type: ${purchaseOrderFile.type}, Size: ${purchaseOrderFile.size} bytes) to data URI.`);
      } catch (fileReadError: any) {
          console.error(`SERVER_ACTION: Error reading or converting uploaded file ${purchaseOrderFile.name}: ${fileReadError.message}`);
          return { error: `Failed to read uploaded Purchase Order file: ${purchaseOrderFile.name}. Error: ${fileReadError.message}` };
      }
    } else {
      console.log("SERVER_ACTION: No Purchase Order file was uploaded by the user or file is empty.");
    }
    
    // 3) Call AI to compare
    const comparisonResult = await compareOrderDetails({
      salesOrderPdfDataUri: salesOrderDetails.dataUri,
      purchaseOrderPdfDataUris: purchaseOrderDataUris, 
    });

    return { data: comparisonResult };

  } catch (e: unknown) {
    let clientFacingMessage = "An unexpected error occurred on the server while fetching or processing the order documents.";
    let logMessage = "SERVER_ACTION_CRITICAL_ERROR processing order:";

    if (e instanceof Error) {
        clientFacingMessage = e.message;
        logMessage = `SERVER_ACTION_ERROR (${e.constructor.name}): ${e.message}`;
        const lowerCaseMessage = e.message.toLowerCase();
        
        if (lowerCaseMessage.includes("authentication failed") ||
            lowerCaseMessage.includes("login failed") ||
            lowerCaseMessage.includes("returned an invalid uid")) {
            clientFacingMessage = `Odoo Authentication Failed: ${e.message}. Please check server credentials for Odoo.`;
        } else if (lowerCaseMessage.includes("not found in odoo")) {
            clientFacingMessage = `Odoo Data Error: ${e.message}. Ensure the Sales Order name is correct.`;
        } else if (lowerCaseMessage.includes("failed to download pdf") ||
                   lowerCaseMessage.includes("did not return a pdf document") ||
                   lowerCaseMessage.includes("odoo did not return a valid pdf") ||
                   lowerCaseMessage.includes("returned content type")) {
            clientFacingMessage = `Odoo PDF Fetch Error: ${e.message}. Problem obtaining SO PDF from Odoo.`;
        } else if (lowerCaseMessage.includes("model not found") || lowerCaseMessage.includes("not found for api version") || (e.cause as any)?.message?.includes("NOT_FOUND")) {
             clientFacingMessage = `AI Model Error: The specified AI model is not accessible. Original error: ${e.message}`;
        } else if (lowerCaseMessage.includes("consumer_suspended") || lowerCaseMessage.includes("permission denied") || lowerCaseMessage.includes("api key not valid")) {
            clientFacingMessage = `AI Service Error: Issue with API key or billing: ${e.message}. Check Google Cloud settings.`;
        } else if (lowerCaseMessage.includes("schema validation failed") || lowerCaseMessage.includes("invalid_argument")) {
           clientFacingMessage = `AI Data Error: The AI's response was not in the expected format, or a document was unprocessable. Original error: ${e.message}`;
        } else if (lowerCaseMessage.includes("ai model encountered an issue during processing") || lowerCaseMessage.includes("ai model failed to return valid comparison data")) {
            clientFacingMessage = e.message;
        }
    } else if (typeof e === 'string') {
        clientFacingMessage = e;
        logMessage = `SERVER_ACTION_ERROR (string): ${e}`;
    } else {
        logMessage = `SERVER_ACTION_ERROR (unknown type): ${String(e)}`;
    }

    console.error(logMessage, e); 
    const finalClientMessage = `Processing Failed: ${clientFacingMessage.replace(/[^\x20-\x7E]/g, '').substring(0, 500)}. Please check server logs if the issue persists.`;

    return { error: finalClientMessage };
  }
}
