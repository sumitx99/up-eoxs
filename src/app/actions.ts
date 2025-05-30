
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

interface FetchedPdfDetails {
  dataUri: string;
  name: string;
  size: number;
}

// Function to fetch Sales Order PDF from Odoo (Report Download)
async function fetchSalesOrderPdfFromOdoo(
  soUserInputName: string,
  odooUrl: string,
  odooDb: string,
  odooUsername: string,
  odooPassword: string
): Promise<FetchedPdfDetails> {
  console.log(`Attempting to fetch Sales Order PDF for user input: ${soUserInputName}`);
  const commonClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/common`);
  const modelsClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);

  let uid: number;
  try {
    uid = await new Promise((resolve, reject) => {
      commonClient.methodCall('authenticate', [odooDb, odooUsername, odooPassword, {}], (error, value) => {
        if (error) return reject(new Error(`Odoo XML-RPC authentication failed: ${error.message}.`));
        if (!value || typeof value !== 'number' || value <= 0) return reject(new Error('Odoo XML-RPC authentication returned an invalid UID.'));
        resolve(value);
      });
    });
    console.log(`Odoo XML-RPC authentication successful for SO fetch. UID: ${uid}`);
  } catch (authError: any) {
    console.error('Odoo XML-RPC Authentication Error (SO Fetch):', authError.message);
    throw new Error(`Odoo Authentication Failed (XML-RPC for SO): ${authError.message}. Please check server credentials for Odoo.`);
  }

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
  const saleId = saleOrder.id;
  const actualSaleName = saleOrder.name; // Use the actual name found in Odoo
  console.log(`Found Sales Order: ${actualSaleName} (ID: ${saleId})`);

  const jar = new CookieJar();
  const axiosInstance = cookieJarSupport(axios.create({ jar, withCredentials: true }));

  const loginUrl = `${odooUrl}/web/session/authenticate`;
  try {
    const loginResponse = await axiosInstance.post(loginUrl, {
      jsonrpc: '2.0', method: 'call', params: { db: odooDb, login: odooUsername, password: odooPassword }
    }, { headers: { 'Content-Type': 'application/json' } });

    if (loginResponse.status !== 200 || !loginResponse.data.result) {
      console.error('Odoo HTTP Login Failed. Status:', loginResponse.status, 'Response Data:', loginResponse.data);
      const reason = loginResponse.data?.error?.message || 'Response format unexpected or error indicated by Odoo.';
      throw new Error(`Odoo HTTP login failed: ${reason}.`);
    }
    console.log('Odoo HTTP login successful for SO PDF download.');
  } catch (loginErr: any) {
    console.error('Odoo HTTP Login Request Error:', loginErr.response?.status, loginErr.response?.data, loginErr.message);
    const errorDetail = loginErr.response?.data?.error?.message || loginErr.message || 'Unknown HTTP login error';
    throw new Error(`Odoo HTTP login request failed: ${errorDetail}. Could not establish session for SO PDF download.`);
  }

  const reportUrl = `${odooUrl}/report/pdf/sale.report_saleorder/${saleId}`;
  console.log(`Attempting to download SO PDF from: ${reportUrl}`);
  const pdfResponse = await axiosInstance.get(reportUrl, { responseType: 'arraybuffer' });

  const contentType = pdfResponse.headers['content-type'] || pdfResponse.headers['Content-Type'];
  if (pdfResponse.status !== 200 || !contentType || !contentType.toLowerCase().includes('application/pdf') || !pdfResponse.data || !(pdfResponse.data.byteLength > 0)) {
    let errorDetails = `Odoo did not return a valid PDF for Sales Order '${actualSaleName}'. Status: ${pdfResponse.status}. Content-Type: ${contentType}.`;
    if (contentType && (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/json'))) {
      try { errorDetails += ` Response preview: ${Buffer.from(pdfResponse.data).toString('utf8').substring(0, 200)}`; } catch (decodeError) {}
    }
    console.error(errorDetails, 'Data length:', pdfResponse.data?.byteLength);
    throw new Error(errorDetails);
  }
  console.log(`Successfully fetched SO PDF: ${actualSaleName}.pdf, Size: ${pdfResponse.data.byteLength} bytes`);

  const pdfBuffer = Buffer.from(pdfResponse.data);
  const base64Pdf = pdfBuffer.toString('base64');
  return {
    dataUri: `data:application/pdf;base64,${base64Pdf}`,
    name: `${actualSaleName}.pdf`.replace(/[\/\s]+/g, '_'),
    size: pdfBuffer.length,
  };
}


// Function to fetch Purchase Order PDF from Odoo (Attachment)
async function fetchLinkedPurchaseOrderPdfFromOdoo(
  actualSaleName: string, // The name of the SO found, used to link POs
  odooUrl: string,
  odooDb: string,
  odooUsername: string,
  odooPassword: string,
  uid: number // XML-RPC UID from initial auth
): Promise<FetchedPdfDetails> {
  console.log(`Attempting to fetch linked Purchase Order PDF for SO: ${actualSaleName}`);
  const modelsClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);

  const purchaseOrders: any[] = await new Promise((resolve, reject) => {
    modelsClient.methodCall('execute_kw', [
      odooDb, uid, odooPassword,
      'purchase.order', 'search_read',
      [[['origin', 'ilike', actualSaleName]]], // Find POs whose origin contains the actual SO name
      { fields: ['id', 'name'], limit: 1 } // Fetching the first linked PO
    ], (error, value) => {
      if (error) return reject(new Error(`Error finding linked Purchase Orders for SO '${actualSaleName}': ${error.message}`));
      resolve(value as any[]);
    });
  });

  if (!purchaseOrders || purchaseOrders.length === 0) {
    throw new Error(`No Purchase Order found linked to Sales Order '${actualSaleName}'.`);
  }
  const purchaseOrder = purchaseOrders[0];
  const poId = purchaseOrder.id;
  const poName = purchaseOrder.name;
  console.log(`Found linked Purchase Order: ${poName} (ID: ${poId})`);

  const attachments: any[] = await new Promise((resolve, reject) => {
    modelsClient.methodCall('execute_kw', [
      odooDb, uid, odooPassword,
      'ir.attachment', 'search_read',
      [
        ['res_model', '=', 'purchase.order'],
        ['res_id', '=', poId],
        ['mimetype', '=', 'application/pdf']
      ],
      { fields: ['name', 'datas'], limit: 1 }
    ], (error, value) => {
      if (error) return reject(new Error(`Error finding PDF attachment for PO '${poName}': ${error.message}`));
      resolve(value as any[]);
    });
  });

  if (!attachments || attachments.length === 0 || !attachments[0].datas) {
    throw new Error(`No PDF attachment found or attachment data is empty for Purchase Order '${poName}' (ID: ${poId}).`);
  }
  const attachment = attachments[0];
  console.log(`Found PO PDF attachment: ${attachment.name}`);

  const pdfBuffer = Buffer.from(attachment.datas, 'base64');
  if (pdfBuffer.length === 0) {
    throw new Error(`Decoded PDF attachment for PO '${poName}' is empty.`);
  }

  return {
    dataUri: `data:application/pdf;base64,${attachment.datas}`,
    name: `${attachment.name}`.replace(/[\/\s]+/g, '_'),
    size: pdfBuffer.length,
  };
}


export async function compareOrdersAction(formData: FormData): Promise<CompareOrdersResult> {
  const salesOrderUserInputName = formData.get('salesOrderName') as string | null;

  if (!salesOrderUserInputName || salesOrderUserInputName.trim() === '') {
    return { error: 'Sales Order name/sequence is required.' };
  }

  const odooUrl = process.env.ODOO_URL;
  const odooDb = process.env.ODOO_DB;
  const odooUsername = process.env.ODOO_USERNAME;
  const odooPassword = process.env.ODOO_PASSWORD;

  if (!odooUrl || !odooDb || !odooUsername || !odooPassword) {
    return { error: 'Odoo ERP connection details are not configured on the server.' };
  }

  try {
    console.log(`Fetching Sales Order PDF for user input: ${salesOrderUserInputName.trim()}`);
    const salesOrderDetails = await fetchSalesOrderPdfFromOdoo(salesOrderUserInputName.trim(), odooUrl, odooDb, odooUsername, odooPassword);
    console.log(`Successfully fetched Sales Order PDF: ${salesOrderDetails.name}, Size: ${salesOrderDetails.size} bytes`);

    // Re-authenticate for PO fetching (or reuse UID if possible, but separate auth is safer for distinct operations)
    const commonClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/common`);
    let poFetchUid: number;
     try {
        poFetchUid = await new Promise((resolve, reject) => {
            commonClient.methodCall('authenticate', [odooDb, odooUsername, odooPassword, {}], (error, value) => {
                if (error) return reject(new Error(`Odoo XML-RPC authentication failed (PO Fetch): ${error.message}.`));
                if (!value || typeof value !== 'number' || value <= 0) return reject(new Error('Odoo XML-RPC authentication returned an invalid UID (PO Fetch).'));
                resolve(value);
            });
        });
        console.log(`Odoo XML-RPC authentication successful for PO fetch. UID: ${poFetchUid}`);
    } catch (authError: any) {
        console.error('Odoo XML-RPC Authentication Error (PO Fetch):', authError.message);
        throw new Error(`Odoo Authentication Failed (XML-RPC for PO): ${authError.message}. Please check server credentials for Odoo.`);
    }

    // Use the actual SO name returned by Odoo to find linked POs
    const actualSalesOrderName = salesOrderDetails.name.replace(/\.pdf$/i, '').replace(/_/g, ' '); // Attempt to get original name
    console.log(`Fetching linked Purchase Order PDF using actual SO name: ${actualSalesOrderName}`);
    const purchaseOrderDetails = await fetchLinkedPurchaseOrderPdfFromOdoo(actualSalesOrderName, odooUrl, odooDb, odooUsername, odooPassword, poFetchUid);
    console.log(`Successfully fetched linked Purchase Order PDF: ${purchaseOrderDetails.name}, Size: ${purchaseOrderDetails.size} bytes`);


    if (salesOrderDetails.size === 0 || purchaseOrderDetails.size === 0) {
        let warningMessage = "";
        if (salesOrderDetails.size === 0) warningMessage += `Fetched Sales Order PDF for '${salesOrderDetails.name}' is empty (0 bytes). `;
        if (purchaseOrderDetails.size === 0) warningMessage += `Fetched Purchase Order PDF for '${purchaseOrderDetails.name}' is empty (0 bytes). `;
        console.warn(warningMessage + "This will likely cause issues with AI comparison.");
        // Optionally, you could return an error here if 0-byte files are unacceptable
        // return { error: warningMessage.trim() + " Comparison aborted."};
    }

    const result = await compareOrderDetails({
      purchaseOrder: purchaseOrderDetails.dataUri, // PO PDF
      salesOrder: salesOrderDetails.dataUri,    // SO PDF
    });
    return { data: result };

  } catch (e: unknown) {
    let clientFacingMessage = "An unexpected error occurred on the server while fetching or comparing orders.";
    let logMessage = "SERVER_ACTION_CRITICAL_ERROR processing orders:";

    if (e instanceof Error) {
        clientFacingMessage = e.message;
        logMessage = `SERVER_ACTION_ERROR (${e.constructor.name}): ${e.message}`;

        if (e.message.toLowerCase().includes("authentication failed") ||
            e.message.toLowerCase().includes("login failed") ||
            e.message.toLowerCase().includes("returned an invalid uid")) {
            clientFacingMessage = `Odoo Authentication Failed: ${e.message}. Please check server credentials for Odoo.`;
        } else if (e.message.toLowerCase().includes("not found in odoo") || e.message.toLowerCase().includes("no purchase order found linked")) {
            clientFacingMessage = `Odoo Data Error: ${e.message}. Ensure the Sales Order name is correct and has linked Purchase Orders.`;
        } else if (e.message.toLowerCase().includes("no pdf attachment found") || e.message.toLowerCase().includes("attachment data is empty") || e.message.toLowerCase().includes("decoded pdf attachment for po is empty")) {
            clientFacingMessage = `Odoo Attachment Error: ${e.message}. A required PDF attachment might be missing or empty.`;
        } else if (e.message.toLowerCase().includes("failed to download pdf") ||
                   e.message.toLowerCase().includes("did not return a pdf document") ||
                   e.message.toLowerCase().includes("odoo returned content type")) {
            clientFacingMessage = `Odoo PDF Fetch Error: ${e.message}. Problem obtaining PDF from Odoo.`;
        } else if (e.message.toLowerCase().includes("model not found") || e.message.toLowerCase().includes("not found for api version")) {
            clientFacingMessage = `AI Model Error: The specified AI model is not accessible. Original error: ${e.message}`;
        } else if (e.message.toLowerCase().includes("consumer_suspended") || e.message.toLowerCase().includes("permission denied") || e.message.toLowerCase().includes("api key not valid")) {
            clientFacingMessage = `AI Service Error: Issue with API key or billing: ${e.message}. Check Google Cloud settings.`;
        } else if (e.message.toLowerCase().includes("schema validation failed") || e.message.toLowerCase().includes("invalid_argument")) {
           clientFacingMessage = `AI Data Error: The AI's response was not in the expected format, or a document was unprocessable. Original error: ${e.message}`;
        } else if (e.message.toLowerCase().includes("ai model encountered an issue during processing")) {
            clientFacingMessage = e.message;
        } else if (e.message.toLowerCase().includes("ai model failed to return valid comparison data")) {
            clientFacingMessage = e.message;
        }
    } else if (typeof e === 'string') {
        clientFacingMessage = e;
        logMessage = `SERVER_ACTION_ERROR (string): ${e}`;
    } else {
        logMessage = `SERVER_ACTION_ERROR (unknown type): ${String(e)}`;
    }

    console.error(logMessage, e);

    const finalClientMessage = `Comparison Failed: ${clientFacingMessage.replace(/[^\x20-\x7E]/g, '').substring(0, 500)}`;
    return {
        error: `${finalClientMessage} Please check server logs if the issue persists.`,
    };
  }
}
    