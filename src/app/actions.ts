
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
    console.error('Odoo environment variables (ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD) are not properly configured.');
    throw new Error('Odoo environment variables are not properly configured.');
  }

  const jar = new CookieJar();
  const client = axiosCookieJarSupport(axios.create({ jar }));

  const commonClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/common`);

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
      
      console.log('Successfully authenticated to Odoo. UID:', uid);
      resolve({ client, uid }); 
    });
  });
}


async function fetchSalesOrderFromOdoo(salesOrderName: string): Promise<SalesOrderOdooData> {
  if (!uid) {
    await getOdooClient(); 
  }
  if (!uid) throw new Error("Odoo login failed, UID not available.");
  if (!odooUrl || !odooDb || !odooPassword) throw new Error("Odoo configuration is incomplete for fetching sales order.");


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
            console.warn(`No main attachment found for Sales Order '${salesOrderName}'. Attempting to generate report PDF.`);
            try {
                const reportBytes: string | false = await new Promise((resolveReport, rejectReport) => {
                    objectClient.methodCall(
                        'execute_kw',
                        [
                            odooDb,
                            uid,
                            odooPassword,
                            'ir.actions.report',
                            '_render_qweb_pdf', 
                            ['sale.report_saleorder', [so.id]], 
                            {},
                        ],
                        (renderErr: any, renderRes: [string | false, string] | string | false ) => {
                            if (renderErr) return rejectReport(renderErr);
                            if (Array.isArray(renderRes) && renderRes.length > 0 && typeof renderRes[0] === 'string') {
                                resolveReport(renderRes[0]);
                            } else if (typeof renderRes === 'string') {
                                resolveReport(renderRes);
                            } else {
                                resolveReport(false);
                            }
                        }
                    );
                });

                if (reportBytes) {
                    pdfDataUri = `data:application/pdf;base64,${reportBytes}`;
                    console.log(`Successfully generated and fetched report PDF for SO '${salesOrderName}'.`);
                } else {
                    console.warn(`Could not generate report PDF for SO '${salesOrderName}'. Comparison will proceed without an SO PDF if no attachment was found either.`);
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
    await getOdooClient(); 
  }
  if (!uid) throw new Error("Odoo login failed, UID not available.");
  if (!odooUrl || !odooDb || !odooPassword) throw new Error("Odoo configuration is incomplete for fetching purchase orders.");

  const objectClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`);
  
  const attSearchDomain: (string | string[])[] = [
    ["res_model", "=", "sale.order"],
    ["res_id", "=", salesOrderId],
    ["mimetype", "=", "application/pdf"],
    ["name", "ilike", "Purchase%Order%"], 
  ];

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
        { fields: ['id', 'name', 'datas', 'mimetype', 'file_size'], limit: 10 }, 
      ],
      (err: any, attachments: OdooAttachment[]) => {
        if (err) {
          console.error(`Error fetching PO attachments for SO '${salesOrderName}' (ID: ${salesOrderId}) from Odoo:`, err);
          return reject(new Error(`Error fetching PO attachments from Odoo: ${err.message}`));
        }

        if (!attachments || attachments.length === 0) {
          console.log(`No attachments matching "Purchase%Order%" found for Sales Order '${salesOrderName}'.`);
          return resolve([]);
        }
        
        const poPdfDataUris = attachments
          .filter(att => att.datas && att.mimetype === 'application/pdf') 
          .map(att => {
            console.log(`Found PO attachment: ${att.name} (Size: ${att.file_size}) for SO ${salesOrderName}`);
            return `data:${att.mimetype};base64,${att.datas}`;
          });
        
        console.log(`Found ${poPdfDataUris.length} PO PDF(s) matching "Purchase%Order%" for Sales Order '${salesOrderName}'.`);
        resolve(poPdfDataUris);
      }
    );
  });
}


export async function compareOrdersAction(
  prevState: CompareActionState, 
  formData: FormData
): Promise<CompareActionState> {
  const salesOrderName = formData.get('salesOrderName') as string;

  if (!salesOrderName || salesOrderName.trim() === '') {
    return { error: 'Please provide a Sales Order Name to start the comparison.', data: null };
  }

  console.log(`Starting comparison for Sales Order: ${salesOrderName}`);

  try {
    // Ensure Odoo environment variables are checked by getOdooClient or throw early
    if (!odooUrl || !odooDb || !odooUsername || !odooPassword) {
        console.error('Odoo environment variables are not configured.');
        // This specific error is for server-side, user gets a generic one below.
        throw new Error('Odoo configuration error.'); 
    }

    if (!uid) {
      await getOdooClient(); // This can throw if ODOO_ env vars are missing or auth fails
    }
    // Double check uid after attempt, as getOdooClient might not throw if client setup fails before auth
    if (!uid) {
      // This state should ideally be caught by getOdooClient's throw, but as a safeguard:
      console.error('Odoo authentication failed or UID not set after getOdooClient call.');
      return { error: 'Could not connect to the order system due to an authentication issue. Please contact support.', data: null };
    }
    
    const salesOrderData = await fetchSalesOrderFromOdoo(salesOrderName);
    // fetchSalesOrderFromOdoo can throw errors like "Sales Order ... not found" or "Error fetching Sales Order..."

    const purchaseOrderPdfDataUris = await fetchPurchaseOrderPdfsFromOdoo(salesOrderData.id, salesOrderData.name);
    
    if (purchaseOrderPdfDataUris.length === 0) {
      console.log(`No Purchase Order PDFs found attached to Sales Order '${salesOrderName}' matching "Purchase%Order%". Proceeding with comparison (AI will note lack of POs).`);
    }

    const comparisonInput: CompareOrderDetailsInput = {
      salesOrderPdfDataUri: salesOrderData.pdfDataUri || '', 
      purchaseOrderPdfDataUris: purchaseOrderPdfDataUris,
    };

    console.log('Calling compareOrderDetails AI flow...');
    const comparisonOutput = await compareOrderDetails(comparisonInput);
    console.log('AI flow completed.');

    return { error: null, data: comparisonOutput };

  } catch (e: any) {
    console.error('Technical Error in compareOrdersAction:', e); // Log the detailed technical error server-side

    let userFriendlyError = 'An unexpected error occurred while comparing orders. Please try again. If the problem persists, contact support.';

    if (e.message) {
      if (e.message.includes('Odoo authentication failed') || e.message.includes('Failed to authenticate with Odoo') || e.message.includes('Invalid credentials')) {
        userFriendlyError = 'Authentication with the order system failed. Please check system credentials or contact support.';
      } else if (e.message.includes('ECONNREFUSED')) {
        userFriendlyError = `Unable to connect to the order system. Please check network connectivity or contact support.`;
      } else if (e.message.includes('Odoo configuration error') || e.message.includes('Odoo environment variables are not properly configured')) {
        userFriendlyError = 'The order system is not configured correctly. Please contact support.';
      } else if (e.message.includes('not found in Odoo')) {
        userFriendlyError = `The Sales Order '${salesOrderName}' could not be found. Please verify the name and try again.`;
      } else if (e.message.includes('Error fetching Sales Order from Odoo') || e.message.includes('Error fetching PO attachments from Odoo')) {
        userFriendlyError = 'There was a problem retrieving documents from the order system. Please try again later.';
      } else if (e.message.includes('AI Model/API Key Error') || e.message.includes('AI model failed') || e.message.includes('Genkit')) {
        userFriendlyError = 'The AI comparison service encountered an issue. Please try again. If it continues, contact support.';
      }
      // For other generic errors, the default userFriendlyError will be used.
    }
    return { error: userFriendlyError, data: null };
  }
}
