
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

// New interface for the return type of fetchSalesOrderPdfFromOdoo
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
): Promise<FetchedSalesOrderPdfDetails> { // Updated return type
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
  const saleId = saleOrder.id as number; // Ensure saleId is treated as number
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
    saleOrderId: saleId, // Include saleOrderId in the return
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
    // 1) Fetch Sales Order PDF and its ID
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

    // ────────────────────────────────────────────────────────────────
    // 2) FETCH PURCHASE ORDER PDFs ATTACHED to this Sale Order
    // ────────────────────────────────────────────────────────────────
    const purchaseOrderDetails: FetchedPdfDetails[] = 
      await fetchPurchaseOrderPdfsFromOdoo(
        salesOrderDetails.saleOrderId, // Pass SO ID
        odooUrl,
        odooDb,
        odooUsername,
        odooPassword
      );

    // Log each PO result
    purchaseOrderDetails.forEach((po) => {
      console.log(
        `SERVER_ACTION: Successfully fetched PO PDF (attached to SO): ${po.originalName} (size: ${po.size} bytes)`
      );
    });
    
    // 3) Now pass SO data URI and array of PO data URIs into compareOrderDetails()
    const poDataUris = purchaseOrderDetails.map(po => po.dataUri);
    
    const comparisonResult = await compareOrderDetails({
      salesOrderPdfDataUri: salesOrderDetails.dataUri,
      purchaseOrderPdfDataUris: poDataUris,
    });

    return { data: comparisonResult };

  } catch (e: unknown) {
    let clientFacingMessage = "An unexpected error occurred on the server while fetching or processing the Sales Order.";
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

/**
 *  fetchPurchaseOrderPdfsFromOdoo
 *
 *  Finds PDF attachments directly linked to the given Sales Order ID,
 *  filters them by name to identify potential Purchase Order documents,
 *  and returns their details.
 */
async function fetchPurchaseOrderPdfsFromOdoo(
  saleOrderId: number, // Changed from soUserInputName
  odooUrl: string,
  odooDb: string,
  odooUsername: string,
  odooPassword: string
): Promise<FetchedPdfDetails[]> {
  console.log(
    `SERVER_ACTION: Attempting to fetch PO PDFs attached directly to Sales Order ID: ${saleOrderId}`
  );
  
  const commonClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/common`);
  let uid: number;
  try {
    uid = await new Promise((resolve, reject) => {
      commonClient.methodCall(
        "authenticate",
        [odooDb, odooUsername, odooPassword, {}],
        (err, value) => {
          if (err) {
            return reject(
              new Error(`Odoo authentication failed (fetching PO attachments for SO): ${err.message}`)
            );
          }
          if (!value || typeof value !== "number" || value <= 0) {
            return reject(
              new Error("Odoo returned invalid UID while authenticating (fetching PO attachments for SO).")
            );
          }
          resolve(value as number);
        }
      );
    });
  } catch (authErr) {
    console.error("SERVER_ACTION: Auth Error in fetchPurchaseOrderPdfsFromOdoo:", authErr);
    throw authErr;
  }

  const objectClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);

  // Search ir.attachment for PDFs linked to the Sales Order, filtered by name for POs
  const attSearchDomain = [
    ["res_model", "=", "sale.order"],
    ["res_id", "=", saleOrderId],
    ["mimetype", "=", "application/pdf"],
    ["name", "ilike", "Purchase%Order%"]
  ];

  let attachments: Array<{ id: number; name: string; datas: string; file_size: number }>;
  try {
    attachments = await new Promise((resolve, reject) => {
      objectClient.methodCall(
        "execute_kw",
        [
          odooDb,
          uid,
          odooPassword,
          "ir.attachment",
          "search_read",
          [attSearchDomain],
          { fields: ["id", "name", "datas", "file_size"], limit: 10 }, // Fetch file_size
        ],
        (err, value) => {
          if (err) {
            return reject(
              new Error(`Odoo IR.Attachment search (for POs on SO) failed: ${err.message}`)
            );
          }
          resolve(value as Array<{ id: number; name: string; datas: string; file_size: number }>);
        }
      );
    });
  } catch (searchErr) {
    console.error("SERVER_ACTION: Error searching attachments on SO for POs:", searchErr);
    throw searchErr;
  }

  if (!attachments || attachments.length === 0) {
    console.warn(
      `SERVER_ACTION: No PDF attachments matching PO-related keywords found directly on Sales Order ID '${saleOrderId}'.`
    );
    return [];
  }

  const results: FetchedPdfDetails[] = [];
  for (const att of attachments) {
    if (!att.datas) {
      console.warn(`SERVER_ACTION: Attachment '${att.name}' (id=${att.id}) for SO ID ${saleOrderId} has no 'datas'. Skipping.`);
      continue;
    }
    // Odoo's file_size is authoritative. 'datas' can sometimes be just a checksum if stored externally.
    // However, for direct PDF generation, 'datas' being non-empty is key.
    // If att.file_size is 0 but datas exists, it's odd. If datas is missing, file_size might still be there.
    // We rely on 'datas' for the data URI.

    const binary = Buffer.from(att.datas, "base64");
    if (binary.byteLength === 0) {
        console.warn(`SERVER_ACTION: Decoded PDF data for attachment '${att.name}' (id=${att.id}) on SO ID ${saleOrderId} is empty (0 bytes). Actual file_size from Odoo: ${att.file_size}. Skipping.`);
        continue;
    }

    const dataUri = `data:application/pdf;base64,${att.datas}`;
    results.push({
      dataUri,
      fileName: `${att.name.replace(/[\s/]/g, "_")}`, // Use actual attachment name for file
      originalName: att.name,
      size: binary.byteLength, // Size of the base64 decoded data
    });
  }

  if (results.length === 0) {
      console.warn(`SERVER_ACTION: After filtering, no valid PO PDF attachments found for SO ID ${saleOrderId}. Attachments considered: ${attachments.length}`);
  }
  return results;
}
