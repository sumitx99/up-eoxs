
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
  // Removed: const objectClient = xmlrpc.createSecureClient(`${odooUrl}/xmlrpc/2/object`); // This client is created locally in functions

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
            try {
                const reportBytes: string | false = await new Promise((resolveReport, rejectReport) => {
                    objectClient.methodCall(
                        'execute_kw',
                        [
                            odooDb,
                            uid,
                            odooPassword,
                            'ir.actions.report',
                            'report_action', // Odoo 13 style, then _render_qweb_pdf
                            [so.id, 'sale.report_saleorder'], // docids, report_name
                            {},
                        ],
                         (reportActionErr: any, reportActionRes: any) => {
                            if (reportActionErr) return rejectReport(reportActionErr);
                            if (!reportActionRes || !reportActionRes.id) {
                                // Fallback for Odoo 15+ style if 'report_action' doesn't directly give PDF or if it's simpler to call _render_qweb_pdf
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
                                return;
                            }
                            // If report_action returned something, assume it might be a direct way or older Odoo.
                            // This path might need more Odoo version-specific handling if 'report_action' is used.
                            // For simplicity and broader compatibility, direct call to _render_qweb_pdf is often preferred.
                            // Let's proceed with the direct _render_qweb_pdf call as the primary method.
                            // This part is a bit complex as Odoo API for reports can vary.
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
  
  // Reverted search domain to only look for "Purchase%Order%"
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
        { fields: ['id', 'name', 'datas', 'mimetype', 'file_size'], limit: 10 }, // Limit to 10 POs for sanity
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
          .filter(att => att.datas && att.mimetype === 'application/pdf') // Ensure 'datas' field is not false or empty and mimetype is PDF
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
    return { error: 'Sales Order Name is required.', data: null };
  }

  console.log(`Starting comparison for Sales Order: ${salesOrderName}`);

  try {
    if (!uid) {
      await getOdooClient();
    }
    if (!uid) {
      return { error: 'Failed to authenticate with Odoo. Cannot proceed.', data: null };
    }
    
    const salesOrderData = await fetchSalesOrderFromOdoo(salesOrderName);
    if (!salesOrderData.pdfDataUri) {
      console.warn(`Sales Order '${salesOrderName}' PDF data URI is missing. Comparison quality may be affected if the AI relies heavily on it.`);
    }

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
    console.error('Error in compareOrdersAction:', e);
    if (e.message && (e.message.includes('Odoo authentication failed') || e.message.includes('Error fetching') || e.message.includes('ECONNREFUSED'))) {
        return { error: `Odoo Connection/Data Error: ${e.message}. Please check Odoo connectivity and data for '${salesOrderName}'.`, data: null };
    }
    return { error: e.message || 'An unexpected error occurred during order comparison.', data: null };
  }
}
