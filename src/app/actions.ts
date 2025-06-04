
'use server';

import {ai} from '@/ai/genkit';
import { compareOrderDetails, type CompareOrderDetailsInput, type CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import axios, { AxiosInstance } from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper as axiosCookieJarSupport } from 'axios-cookiejar-support';
import xmlrpc from 'xmlrpc';

// Types
export type CompareActionState = {
  error: string | null;
  data: CompareOrderDetailsOutput | null;
};

interface SalesOrderOdooData {
  id: number;
  name: string;
  pdfDataUri: string | null; // Base64 data URI for the SO PDF
}

interface OdooAttachment {
  id: number;
  name: string;
  datas: string; // Base64 encoded file content
  file_size: number;
  mimetype: string;
}

// Odoo Configuration from environment variables
const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUsername = process.env.ODOO_USERNAME;
const odooPassword = process.env.ODOO_PASSWORD;

let odooClient: AxiosInstance | null = null;
let uid: number | null = null;

async function getOdooClient(): Promise<{ client: AxiosInstance; uid: number }> {
  if (odooClient && uid !== null) {
    return { client: odooClient, uid };
  }

  if (!odooUrl || !odooDb || !odooUsername || !odooPassword) {
    throw new Error('Odoo environment variables (ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD) are not properly configured.');
  }

  const jar = new CookieJar();
  const client = axiosCookieJarSupport(axios.create({ jar }));

  const commonClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/common`);
  const objectClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);

  return new Promise((resolve, reject) => {
    commonClient.methodCall('authenticate', [odooDb, odooUsername, odooPassword, {}], async (error: any, userId: number | false) => {
      if (error) {
        console.error('Odoo authentication failed:', error);
        return reject(new Error(`Odoo authentication failed: ${error.message}`));
      }
      if (userId === false) {
        console.error('Odoo authentication failed: Invalid credentials.');
        return reject(new Error('Odoo authentication failed: Invalid credentials.'));
      }
      
      uid = userId;
      // Store the objectClient for further calls if needed, or adapt as necessary
      // For simplicity, this example assumes direct use or re-creation for object calls.
      // For now, we'll just use the clients directly in the functions.
      // If you plan to reuse 'objectClient' extensively, you might want to manage its session/cookie handling with axios.
      // However, node-xmlrpc handles its own http requests. If using axios for XMLRPC, it's more complex.
      // Sticking to node-xmlrpc client for XMLRPC calls.

      // This simple setup doesn't use the axios client for XMLRPC, so odooClient isn't strictly needed for XMLRPC.
      // If you were to make REST calls to Odoo, then the axios client would be used.
      // For this app, only XMLRPC is used.
      
      console.log('Successfully authenticated to Odoo. UID:', uid);
      resolve({ client, uid }); // client is illustrative if REST API was used. uid is critical.
    });
  });
}


async function fetchSalesOrderFromOdoo(salesOrderName: string): Promise<SalesOrderOdooData> {
  if (!uid) {
    await getOdooClient(); // Ensure login
  }
  if (!uid) throw new Error("Odoo login failed, UID not available.");

  const objectClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);

  return new Promise((resolve, reject) => {
    const domain = [['name', '=', salesOrderName]];
    objectClient.methodCall(
      'execute_kw',
      [
        odooDb,
        uid,
        odooPassword,
        'sale.order',
        'search_read',
        [domain],
        { fields: ['id', 'name', 'message_main_attachment_id'], limit: 1 },
      ],
      async (err: any, res: Array<{ id: number; name: string; message_main_attachment_id: [number, string] | false }>) => {
        if (err) {
          console.error(`Error fetching Sales Order '${salesOrderName}' from Odoo:`, err);
          return reject(new Error(`Error fetching Sales Order from Odoo: ${err.message}`));
        }
        if (!res || res.length === 0) {
          return reject(new Error(`Sales Order '${salesOrderName}' not found in Odoo.`));
        }

        const so = res[0];
        let pdfDataUri: string | null = null;

        if (so.message_main_attachment_id && so.message_main_attachment_id[0]) {
          const attachmentId = so.message_main_attachment_id[0];
          try {
            const attachments: OdooAttachment[] = await new Promise((resolveAtt, rejectAtt) => {
              objectClient.methodCall(
                'execute_kw',
                [
                  odooDb,
                  uid,
                  odooPassword,
                  'ir.attachment',
                  'search_read',
                  [[['id', '=', attachmentId]]],
                  { fields: ['id', 'name', 'datas', 'mimetype', 'file_size'], limit: 1 },
                ],
                (attErr: any, attRes: OdooAttachment[]) => {
                  if (attErr) return rejectAtt(attErr);
                  resolveAtt(attRes);
                }
              );
            });

            if (attachments && attachments.length > 0 && attachments[0].mimetype === 'application/pdf' && attachments[0].datas) {
              pdfDataUri = `data:application/pdf;base64,${attachments[0].datas}`;
              console.log(`Successfully fetched PDF attachment for SO '${salesOrderName}' (Attachment ID: ${attachmentId}, Name: ${attachments[0].name}, Size: ${attachments[0].file_size})`);
            } else {
               console.warn(`Main attachment for SO '${salesOrderName}' (ID: ${attachmentId}) is not a PDF or has no data.`);
            }
          } catch (attError: any) {
            console.error(`Error fetching attachment (ID: ${attachmentId}) for SO '${salesOrderName}':`, attError);
          }
        } else {
            console.warn(`No main attachment found for Sales Order '${salesOrderName}'. An SO PDF might need to be generated or explicitly attached if required by the AI.`);
            // Fallback: Try to get the report PDF for the SO if no attachment
            try {
                const reportBytes: string | false = await new Promise((resolveReport, rejectReport) => {
                    objectClient.methodCall(
                        'execute_kw',
                        [
                            odooDb,
                            uid,
                            odooPassword,
                            'ir.actions.report',
                            '_render_qweb_pdf', // Odoo 15+
                            ['sale.report_saleorder', [so.id]], // report_name, docids
                            {},
                        ],
                        (reportErr: any, reportRes: [string | false, string] | string | false ) => { // Response can vary
                            if (reportErr) return rejectReport(reportErr);
                            // Odoo 13 might return [data, 'pdf']. Odoo 15+ just data.
                            if (Array.isArray(reportRes) && reportRes.length > 0 && typeof reportRes[0] === 'string') {
                                resolveReport(reportRes[0]);
                            } else if (typeof reportRes === 'string') {
                                resolveReport(reportRes);
                            }
                            else {
                                resolveReport(false);
                            }
                        }
                    );
                });

                if (reportBytes) {
                    pdfDataUri = `data:application/pdf;base64,${reportBytes}`;
                    console.log(`Successfully generated and fetched report PDF for SO '${salesOrderName}'.`);
                } else {
                    console.warn(`Could not generate report PDF for SO '${salesOrderName}'. The AI comparison will proceed without an SO PDF if no attachment was found either.`);
                }
            } catch (reportError: any) {
                console.error(`Error generating report PDF for SO '${salesOrderName}':`, reportError);
            }
        }
        
        resolve({ id: so.id, name: so.name, pdfDataUri });
      }
    );
  });
}

async function fetchPurchaseOrderPdfsFromOdoo(salesOrderId: number, salesOrderName: string): Promise<string[]> {
  if (!uid) {
    await getOdooClient(); // Ensure login
  }
  if (!uid) throw new Error("Odoo login failed, UID not available.");

  const objectClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);
  
  const poNamePatterns = [
    "Purchase%Order%", // Original
    "PO#%", 
    "PO_%",
    "PO,%", // PO, (comma)
    "PO No%",
    "Request for Quotation%"
  ];

  const orConditions = poNamePatterns.map(pattern => ['name', 'ilike', pattern]);
  
  // Odoo's 'OR' logic: for 'n' conditions, you need 'n-1' '|' operators.
  // e.g., ['|', cond1, '|', cond2, cond3] for (cond1 OR cond2 OR cond3)
  let attSearchDomain: (string | string[])[] = [
    ["res_model", "=", "sale.order"],
    ["res_id", "=", salesOrderId],
    ["mimetype", "=", "application/pdf"],
  ];

  if (orConditions.length > 0) {
      let currentDomain = orConditions[0];
      for (let i = 1; i < orConditions.length; i++) {
          currentDomain = ['|', currentDomain, orConditions[i]];
      }
      attSearchDomain = attSearchDomain.concat(currentDomain as any); // Add the OR'd name conditions
  } else {
      // If no patterns, this would fetch all PDFs for the SO, which might be too broad.
      // For now, assume patterns are always provided. Or add a default restrictive pattern.
      console.warn("No PO name patterns provided for filtering attachments.");
      return [];
  }


  return new Promise((resolve, reject) => {
    objectClient.methodCall(
      'execute_kw',
      [
        odooDb,
        uid,
        odooPassword,
        'ir.attachment',
        'search_read',
        [attSearchDomain],
        { fields: ['id', 'name', 'datas', 'file_size'], limit: 10 }, // Limit to 10 POs for sanity
      ],
      (err: any, attachments: OdooAttachment[]) => {
        if (err) {
          console.error(`Error fetching PO attachments for SO '${salesOrderName}' (ID: ${salesOrderId}) from Odoo:`, err);
          return reject(new Error(`Error fetching PO attachments from Odoo: ${err.message}`));
        }

        if (!attachments || attachments.length === 0) {
          console.log(`No attachments matching PO criteria found for Sales Order '${salesOrderName}'.`);
          return resolve([]);
        }
        
        const poPdfDataUris = attachments
          .filter(att => att.datas) // Ensure 'datas' field is not false or empty
          .map(att => {
            console.log(`Found PO attachment: ${att.name} (Size: ${att.file_size}) for SO ${salesOrderName}`);
            return `data:${att.mimetype};base64,${att.datas}`;
          });
        
        console.log(`Found ${poPdfDataUris.length} PO PDF(s) for Sales Order '${salesOrderName}'.`);
        resolve(poPdfDataUris);
      }
    );
  });
}


export async function compareOrdersAction(
  prevState: CompareActionState, // Not deeply used if form is removed, but kept for potential future use
  formData: FormData
): Promise<CompareActionState> {
  const salesOrderName = formData.get('salesOrderName') as string;

  if (!salesOrderName || salesOrderName.trim() === '') {
    return { error: 'Sales Order Name is required.', data: null };
  }

  console.log(`Starting comparison for Sales Order: ${salesOrderName}`);

  try {
    // Step 1: Ensure Odoo login and get UID
    if (!uid) {
      await getOdooClient();
    }
    if (!uid) {
      return { error: 'Failed to authenticate with Odoo. Cannot proceed.', data: null };
    }
    
    // Step 2: Fetch Sales Order details from Odoo (including its PDF)
    const salesOrderData = await fetchSalesOrderFromOdoo(salesOrderName);
    if (!salesOrderData.pdfDataUri) {
      // Log warning but proceed, AI flow might handle SOs without explicit PDFs based on other extracted data if designed to.
      // Or, decide to return an error if SO PDF is critical.
      // For now, let's assume the AI flow can handle cases where SO PDF might be missing, but it's highly recommended.
      console.warn(`Sales Order '${salesOrderName}' PDF data URI is missing. Comparison quality may be affected if the AI relies heavily on it.`);
      // If SO PDF is mandatory for the AI:
      // return { error: `Could not retrieve PDF for Sales Order '${salesOrderName}'. Comparison cannot proceed without it.`, data: null };
    }

    // Step 3: Fetch linked Purchase Order PDFs from Odoo
    const purchaseOrderPdfDataUris = await fetchPurchaseOrderPdfsFromOdoo(salesOrderData.id, salesOrderData.name);
    
    if (purchaseOrderPdfDataUris.length === 0) {
      console.log(`No Purchase Order PDFs found attached to Sales Order '${salesOrderName}'. Proceeding with comparison against SO only (if possible).`);
    }

    // Step 4: Prepare input for the AI comparison flow
    const comparisonInput: CompareOrderDetailsInput = {
      salesOrderPdfDataUri: salesOrderData.pdfDataUri || '', // Pass empty string if null, flow needs to handle this.
      purchaseOrderPdfDataUris: purchaseOrderPdfDataUris,
    };

    // Step 5: Call the AI flow
    console.log('Calling compareOrderDetails AI flow...');
    const comparisonOutput = await compareOrderDetails(comparisonInput);
    console.log('AI flow completed.');

    return { error: null, data: comparisonOutput };

  } catch (e: any) {
    console.error('Error in compareOrdersAction:', e);
    // Check for specific Odoo connection errors vs. other errors
    if (e.message && (e.message.includes('Odoo authentication failed') || e.message.includes('Error fetching') || e.message.includes('ECONNREFUSED'))) {
        return { error: `Odoo Connection/Data Error: ${e.message}. Please check Odoo connectivity and data for '${salesOrderName}'.`, data: null };
    }
    return { error: e.message || 'An unexpected error occurred during order comparison.', data: null };
  }
}

    