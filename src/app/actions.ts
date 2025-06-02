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

export interface CompareActionState {
  error?: string | null;
  data?: CompareOrderDetailsOutput | null;
}

// initialState removed from here

async function fetchSalesOrderPdfFromOdoo(
  soUserInputName: string,
  odooUrl: string,
  odooDb: string,
  odooUsername: string,
  odooPassword: string
): Promise<FetchedPdfDetails> {
  console.log(`SERVER_ACTION: Attempting to fetch Sales Order PDF for user input: ${soUserInputName}`);
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
    console.log(`SERVER_ACTION: Odoo XML-RPC authentication successful for SO fetch. UID: ${uid}`);
  } catch (authError: any) {
    console.error('SERVER_ACTION: Odoo XML-RPC Authentication Error (SO Fetch):', authError.message);
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
  };
}

async function fetchLinkedPurchaseOrderPdfFromOdoo(
  originalSoName: string,
  odooUrl: string,
  odooDb: string,
  odooUsername: string,
  odooPassword: string,
  uid: number
): Promise<FetchedPdfDetails> {
  console.log(`SERVER_ACTION: Attempting to fetch linked Purchase Order PDF for SO: ${originalSoName}`);
  const modelsClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);

  const purchaseOrders: any[] = await new Promise((resolve, reject) => {
    modelsClient.methodCall('execute_kw', [
      odooDb, uid, odooPassword,
      'purchase.order', 'search_read',
      [[['origin', 'ilike', originalSoName]]],
      { fields: ['id', 'name', 'message_main_attachment_id'], limit: 1 }
    ], (error, value) => {
      if (error) return reject(new Error(`Error finding linked Purchase Orders for SO '${originalSoName}': ${error.message}`));
      resolve(value as any[]);
    });
  });

  if (!purchaseOrders || purchaseOrders.length === 0) {
    throw new Error(`No Purchase Order found linked to Sales Order '${originalSoName}'.`);
  }
  const purchaseOrder = purchaseOrders[0];
  const poId = purchaseOrder.id;
  const poName = purchaseOrder.name;
  console.log(`SERVER_ACTION: Found linked Purchase Order: ${poName} (ID: ${poId})`);

  let attachmentData: string | false = false;
  let attachmentName = `${poName}_attachment.pdf`;

  if (purchaseOrder.message_main_attachment_id && purchaseOrder.message_main_attachment_id.length > 0) {
    const mainAttachmentId = purchaseOrder.message_main_attachment_id[0];
    console.log(`SERVER_ACTION: PO has message_main_attachment_id: ${mainAttachmentId}. Fetching it directly.`);
    const mainAttachment: any[] = await new Promise((resolve, reject) => {
        modelsClient.methodCall('execute_kw', [
            odooDb, uid, odooPassword,
            'ir.attachment', 'search_read',
            [['id', '=', mainAttachmentId], ['mimetype', '=', 'application/pdf']], // Corrected domain
            { fields: ['name', 'datas', 'mimetype'], limit: 1 }
        ], (error, value) => {
            if (error) {
                console.warn(`SERVER_ACTION: Error fetching attachment by message_main_attachment_id ${mainAttachmentId}: ${error.message}. Will fallback to name search.`);
                resolve([]);
                return;
            }
            resolve(value as any[]);
        });
    });
    if (mainAttachment && mainAttachment.length > 0 && mainAttachment[0].datas && mainAttachment[0].mimetype === 'application/pdf') {
        attachmentData = mainAttachment[0].datas;
        attachmentName = mainAttachment[0].name;
        console.log(`SERVER_ACTION: Successfully fetched PO PDF via message_main_attachment_id: ${attachmentName}`);
    } else {
        console.log(`SERVER_ACTION: PDF not found or not a PDF via message_main_attachment_id. Falling back to name-based search.`);
    }
  } else {
     console.log(`SERVER_ACTION: No message_main_attachment_id found for PO ${poName}. Using name-based attachment search.`);
  }

  if (!attachmentData) {
    console.log(`SERVER_ACTION: Searching for PO PDF attachments by name for PO ID ${poId}, Name: ${poName}`);
    const nameFilters = ['PO', 'Purchase Order', 'P0', poName];
    const orFilters = nameFilters.map(nf => ['name', 'ilike', nf] as ['name', 'ilike', string]);

    let combinedNameFilterDomain: any[] = [];
    if (orFilters.length > 0) {
        combinedNameFilterDomain = orFilters.pop()!;
        while(orFilters.length > 0) {
            combinedNameFilterDomain = ['|', orFilters.pop()!, combinedNameFilterDomain];
        }
    }

    const searchCriteria: any[] = [
        ['res_model', '=', 'purchase.order'],
        ['res_id', '=', poId],
        ['mimetype', '=', 'application/pdf'],
    ];

    if (combinedNameFilterDomain.length > 0) {
        searchCriteria.push(combinedNameFilterDomain);
    }

    const attachments: any[] = await new Promise((resolve, reject) => {
      modelsClient.methodCall('execute_kw', [
        odooDb, uid, odooPassword,
        'ir.attachment', 'search_read',
        searchCriteria,
        { fields: ['name', 'datas'], limit: 1, order: 'create_date DESC' }
      ], (error, value) => {
        if (error) return reject(new Error(`Error finding PDF attachment for PO '${poName}': ${error.message}`));
        resolve(value as any[]);
      });
    });

    if (attachments && attachments.length > 0 && attachments[0].datas) {
      attachmentData = attachments[0].datas;
      attachmentName = attachments[0].name;
      console.log(`SERVER_ACTION: Found PO PDF attachment by name: ${attachmentName}`);
    }
  }

  if (!attachmentData) {
    throw new Error(`No PDF attachment found (tried direct link and name search) for Purchase Order '${poName}' (ID: ${poId}).`);
  }

  const pdfBuffer = Buffer.from(attachmentData, 'base64');
  if (pdfBuffer.length === 0) {
    throw new Error(`Decoded PDF attachment for PO '${poName}' is empty.`);
  }

  return {
    dataUri: `data:application/pdf;base64,${attachmentData}`,
    fileName: `${attachmentName}`.replace(/[\/\s]+/g, '_'),
    originalName: poName,
    size: pdfBuffer.length,
  };
}

export async function compareOrdersAction(
  prevState: CompareActionState,
  formData: FormData
): Promise<CompareActionState> {
  console.log("SERVER_ACTION: compareOrdersAction invoked.");
  const salesOrderUserInputName = formData.get('salesOrderName') as string | null;

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
    let salesOrderDetails: FetchedPdfDetails;
    let purchaseOrderDetails: FetchedPdfDetails;

    salesOrderDetails = await fetchSalesOrderPdfFromOdoo(salesOrderUserInputName.trim(), odooUrl, odooDb, odooUsername, odooPassword);
    console.log(`SERVER_ACTION: Successfully fetched Sales Order PDF: ${salesOrderDetails.fileName}, Original SO Name: ${salesOrderDetails.originalName}, Size: ${salesOrderDetails.size} bytes`);

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
        console.log(`SERVER_ACTION: Odoo XML-RPC authentication successful for PO fetch. UID: ${poFetchUid}`);
    } catch (authError: any) {
        console.error('SERVER_ACTION: Odoo XML-RPC Authentication Error (PO Fetch):', authError.message);
        throw new Error(`Odoo Authentication Failed (XML-RPC for PO): ${authError.message}. Please check server credentials for Odoo.`);
    }

    purchaseOrderDetails = await fetchLinkedPurchaseOrderPdfFromOdoo(salesOrderDetails.originalName, odooUrl, odooDb, odooUsername, odooPassword, poFetchUid);
    console.log(`SERVER_ACTION: Successfully fetched linked Purchase Order PDF: ${purchaseOrderDetails.fileName}, Original PO Name: ${purchaseOrderDetails.originalName}, Size: ${purchaseOrderDetails.size} bytes`);

    if (salesOrderDetails.size === 0 || purchaseOrderDetails.size === 0) {
        let warningMessage = "";
        if (salesOrderDetails.size === 0) warningMessage += `Fetched Sales Order PDF for '${salesOrderDetails.fileName}' is empty (0 bytes). `;
        if (purchaseOrderDetails.size === 0) warningMessage += `Fetched Purchase Order PDF for '${purchaseOrderDetails.fileName}' is empty (0 bytes). `;
        console.warn("SERVER_ACTION: " + warningMessage + "This will likely cause issues with AI comparison.");
    }

    const result = await compareOrderDetails({
      purchaseOrder: purchaseOrderDetails.dataUri,
      salesOrder: salesOrderDetails.dataUri,
    });

    return { data: result };

  } catch (e: unknown) {
    let clientFacingMessage = "An unexpected error occurred on the server while fetching or comparing orders.";
    let logMessage = "SERVER_ACTION_CRITICAL_ERROR processing orders:";

    if (e instanceof Error) {
        clientFacingMessage = e.message;
        logMessage = `SERVER_ACTION_ERROR (${e.constructor.name}): ${e.message}`;
        const lowerCaseMessage = e.message.toLowerCase();
        if (lowerCaseMessage.includes("authentication failed") ||
            lowerCaseMessage.includes("login failed") ||
            lowerCaseMessage.includes("returned an invalid uid")) {
            clientFacingMessage = `Odoo Authentication Failed: ${e.message}. Please check server credentials for Odoo.`;
        } else if (lowerCaseMessage.includes("not found in odoo") || lowerCaseMessage.includes("no purchase order found linked")) {
            clientFacingMessage = `Odoo Data Error: ${e.message}. Ensure the Sales Order name is correct and has linked Purchase Orders.`;
        } else if (lowerCaseMessage.includes("no pdf attachment found") || lowerCaseMessage.includes("attachment data is empty") || lowerCaseMessage.includes("decoded pdf attachment for po is empty")) {
            clientFacingMessage = `Odoo Attachment Error: ${e.message}. A required PDF attachment might be missing or empty.`;
        } else if (lowerCaseMessage.includes("failed to download pdf") ||
                   lowerCaseMessage.includes("did not return a pdf document") ||
                   lowerCaseMessage.includes("odoo did not return a valid pdf") ||
                   lowerCaseMessage.includes("returned content type")) {
            clientFacingMessage = `Odoo PDF Fetch Error: ${e.message}. Problem obtaining PDF from Odoo.`;
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
    const finalClientMessage = `Comparison Failed: ${clientFacingMessage.replace(/[^\x20-\x7E]/g, '').substring(0, 500)}. Please check server logs if the issue persists.`;

    return { error: finalClientMessage };
  }
}
