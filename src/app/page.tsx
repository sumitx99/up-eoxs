
// src/app/page.tsx
'use client';

import React, { useState, type FormEvent, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, Scale, FileWarning, UploadCloud, FileText, FileImage, FileSpreadsheet, CheckCircle2, AlertCircle, HelpCircle, Info, PackageSearch, MinusCircle, PackagePlus, FileKey2, BadgeHelp } from 'lucide-react';
import { compareOrdersAction } from './actions';
import type { CompareOrderDetailsOutput, MatchedItem, Discrepancy, ProductLineItemComparison } from '@/ai/flows/compare-order-details';
import { ExportButton } from '@/components/export-button';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" // .xlsx
];

const ACCEPTED_EXTENSIONS_STRING = ".pdf, image/jpeg, image/png, image/webp, .csv, .xls, .xlsx";

export default function OrderComparatorPage() {
  const [purchaseOrderFile, setPurchaseOrderFile] = useState<File | null>(null);
  const [salesOrderFile, setSalesOrderFile] = useState<File | null>(null);
  const [comparisonResult, setComparisonResult] = useState<CompareOrderDetailsOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const purchaseOrderRef = useRef<HTMLInputElement>(null);
  const salesOrderRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const getFileIcon = (file: File | null) => {
    if (!file) return <UploadCloud className="h-4 w-4 mr-2 text-muted-foreground" />;
    if (file.type.startsWith("image/")) return <FileImage className="h-4 w-4 mr-2 text-primary" />;
    if (file.type === "application/pdf") return <FileText className="h-4 w-4 mr-2 text-red-600" />;
    if (file.type === "text/csv" || file.name.endsWith(".csv")) return <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />;
    if (file.type.includes("excel") || file.type.includes("spreadsheetml") || file.name.endsWith(".xls") || file.name.endsWith(".xlsx")) return <FileSpreadsheet className="h-4 w-4 mr-2 text-green-700" />;
    return <FileText className="h-4 w-4 mr-2 text-gray-500" />;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, setFile: React.Dispatch<React.SetStateAction<File | null>>) => {
    const file = event.target.files?.[0];
    if (file) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      const isValidExtension = fileExtension && ['pdf', 'jpeg', 'jpg', 'png', 'webp', 'csv', 'xls', 'xlsx'].includes(fileExtension);
      const isValidMime = ALLOWED_FILE_TYPES.includes(file.type);
      
      if (isValidMime || isValidExtension) {
        setFile(file);
        setError(null); 
      } else {
        toast({
          variant: "destructive",
          title: "Invalid File Type",
          description: `Unsupported file: ${file.name}. Please upload PDF, Image (JPEG, PNG, WebP), CSV, or Excel (.xls, .xlsx). Type detected: ${file.type || `.${fileExtension}` || 'unknown'}.`,
        });
        setFile(null);
        if (event.target) {
          event.target.value = ""; 
        }
      }
    } else {
      setFile(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setComparisonResult(null);

    if (!purchaseOrderFile || !salesOrderFile) {
      setError("Please upload both purchase order and sales order documents.");
      setIsLoading(false);
      toast({
        variant: "destructive",
        title: "Missing Files",
        description: "Please upload both documents to compare.",
      });
      return;
    }

    const formData = new FormData();
    formData.append('purchaseOrder', purchaseOrderFile);
    formData.append('salesOrder', salesOrderFile);

    const result = await compareOrdersAction(formData);

    if (result.data) {
      setComparisonResult(result.data);
       toast({
        title: "Comparison Complete",
        description: "The order documents have been compared successfully.",
      });
    } else if (result.error) {
      setError(result.error);
      toast({
        variant: "destructive",
        title: "Comparison Error",
        description: result.error,
      });
    }
    setIsLoading(false);
  };

  const getProductStatusIcon = (status: ProductLineItemComparison['status']) => {
    switch (status) {
      case 'MATCHED':
        return <CheckCircle2 className="h-5 w-5 text-accent" />;
      case 'MISMATCH_QUANTITY':
      case 'MISMATCH_UNIT_PRICE':
      case 'MISMATCH_TOTAL_PRICE':
      case 'MISMATCH_DESCRIPTION':
      case 'PARTIAL_MATCH_DETAILS_DIFFER':
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case 'PO_ONLY':
        return <MinusCircle className="h-5 w-5 text-orange-500" />; 
      case 'SO_ONLY':
        return <PackagePlus className="h-5 w-5 text-blue-500" />; 
      default:
        return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
    }
  };


  return (
    <TooltipProvider>
      <div className="min-h-screen p-4 md:p-8 bg-background">
        <header className="mb-8 text-center">
          <div className="flex items-center justify-center mb-2">
            <Scale className="h-12 w-12 text-primary mr-3" />
            <h1 className="text-4xl font-bold text-foreground">Order Comparator</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            AI-powered tool to compare purchase and sales orders from various document types.
          </p>
        </header>

        <div className="w-full max-w-6xl mx-auto grid grid-cols-1 gap-8">
          
          <Accordion type="single" collapsible className="w-full shadow-lg rounded-lg bg-card" defaultValue="input-documents">
            <AccordionItem value="input-documents" className="border-b-0">
              <AccordionTrigger className="text-left hover:no-underline p-6 data-[state=open]:border-b">
                <div>
                  <h2 className="text-2xl font-semibold flex items-center">
                    <UploadCloud className="mr-3 h-7 w-7 text-primary" />
                    Input Order Documents
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5">
                    Upload your purchase order and sales order documents (PDF, Image, CSV, Excel).
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                <Card className="shadow-none border-0 rounded-t-none">
                  <form onSubmit={handleSubmit}>
                    <CardContent className="space-y-6 pt-6">
                      <div className="space-y-2">
                        <Label htmlFor="purchaseOrder" className="text-lg font-medium">Purchase Order Document</Label>
                            <Input
                              id="purchaseOrder"
                              type="file"
                              accept={ACCEPTED_EXTENSIONS_STRING}
                              ref={purchaseOrderRef}
                              onChange={(e) => handleFileChange(e, setPurchaseOrderFile)}
                              className="w-full focus:ring-primary focus:border-primary file:mr-4 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                              required
                              disabled={isLoading}
                            />
                        {purchaseOrderFile && (
                          <p className="text-sm text-muted-foreground flex items-center mt-2">
                            {getFileIcon(purchaseOrderFile)} Selected: {purchaseOrderFile.name} ({Math.round(purchaseOrderFile.size / 1024)} KB)
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="salesOrder" className="text-lg font-medium">Sales Order Document</Label>
                            <Input
                              id="salesOrder"
                              type="file"
                              accept={ACCEPTED_EXTENSIONS_STRING}
                              ref={salesOrderRef}
                              onChange={(e) => handleFileChange(e, setSalesOrderFile)}
                              className="w-full focus:ring-primary focus:border-primary file:mr-4 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                              required
                              disabled={isLoading}
                            />
                        {salesOrderFile && (
                          <p className="text-sm text-muted-foreground flex items-center mt-2">
                            {getFileIcon(salesOrderFile)} Selected: {salesOrderFile.name} ({Math.round(salesOrderFile.size / 1024)} KB)
                          </p>
                        )}
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button type="submit" className="w-full text-lg py-3" disabled={isLoading || !purchaseOrderFile || !salesOrderFile}>
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Comparing Documents...
                          </>
                        ) : (
                          <>
                            <UploadCloud className="mr-2 h-5 w-5" />
                            Compare Order Documents
                          </>
                        )}
                      </Button>
                    </CardFooter>
                  </form>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>


          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Comparison Report</CardTitle>
              <CardDescription>
                Review the comparison summary, general matches, discrepancies, and product line item details.
              </CardDescription>
            </CardHeader>
            <CardContent id="reportContentArea" className="min-h-[300px] flex flex-col space-y-6">
              {isLoading && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <p className="text-lg">Comparing documents, please wait...</p>
                  <p className="text-sm">This may take a moment depending on file size and complexity.</p>
                </div>
              )}
              {error && !isLoading && (
                <Alert variant="destructive" className="mb-4">
                  <FileWarning className="h-5 w-5" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {!isLoading && !error && comparisonResult && (
                <>
                  <div>
                    <h3 className="text-xl font-semibold mb-2 text-foreground flex items-center">
                      <BadgeHelp className="mr-2 h-6 w-6 text-primary" /> AI Summary
                    </h3>
                    <p className="text-sm text-muted-foreground bg-secondary p-3 rounded-md whitespace-pre-wrap">
                      {comparisonResult.summary || 'No summary provided.'}
                    </p>
                  </div>

                  <Accordion type="multiple" className="w-full" defaultValue={["matched-items", "discrepancies", "product-line-items"]}>
                    <AccordionItem value="matched-items">
                      <AccordionTrigger className="text-xl font-semibold text-foreground hover:no-underline">
                        <div className="flex items-center">
                          <FileKey2 className="mr-2 h-6 w-6 text-blue-600" /> 
                          General Matched Fields ({comparisonResult.matchedItems?.length || 0})
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {(comparisonResult.matchedItems && comparisonResult.matchedItems.length > 0) ? (
                          <div className="border rounded-md overflow-hidden max-h-[200px] overflow-y-auto">
                            <Table>
                              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                <TableRow>
                                  <TableHead className="font-semibold w-[45%]">Field</TableHead>
                                  <TableHead className="font-semibold w-[35%]">Matched Value</TableHead>
                                  <TableHead className="font-semibold w-[20%] text-center">Quality</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {comparisonResult.matchedItems.map((item, index) => (
                                  <TableRow key={`match-${index}-${item.field.replace(/\s+/g, '-')}`} className={index % 2 === 0 ? 'bg-transparent' : 'bg-accent/5 hover:bg-accent/10'}>
                                    <TableCell className="font-medium py-2 px-3 text-sm">{item.field}</TableCell>
                                    <TableCell className="py-2 px-3 text-sm">{item.value}</TableCell>
                                    <TableCell className="text-center py-2 px-3 text-sm">
                                      <span className="capitalize">{item.matchQuality || 'Exact'}</span>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <Alert variant="default" className="mt-2 text-sm">
                            <Info className="h-4 w-4" />
                            <AlertTitle className="text-base">No General Matched Fields</AlertTitle>
                            <AlertDescription>The AI did not find any general fields that match between the two documents.</AlertDescription>
                          </Alert>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                    
                    <AccordionItem value="discrepancies">
                      <AccordionTrigger className="text-xl font-semibold text-foreground hover:no-underline">
                        <div className="flex items-center">
                          <AlertCircle className="mr-2 h-6 w-6 text-destructive" /> 
                          General Discrepancies ({comparisonResult.discrepancies?.length || 0})
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {(comparisonResult.discrepancies && comparisonResult.discrepancies.length > 0) ? (
                          <div className="border rounded-md overflow-hidden max-h-[200px] overflow-y-auto">
                            <Table>
                              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                <TableRow>
                                  <TableHead className="font-semibold w-[30%]">Field</TableHead>
                                  <TableHead className="font-semibold w-[27%]">PO Value</TableHead>
                                  <TableHead className="font-semibold w-[27%]">SO Value</TableHead>
                                  <TableHead className="font-semibold w-[16%] text-center">Reason</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {comparisonResult.discrepancies.map((d, index) => (
                                  <TableRow key={`disc-${index}-${d.field.replace(/\s+/g, '-')}`} className={index % 2 === 0 ? 'bg-transparent' : 'bg-destructive/5 hover:bg-destructive/10'}>
                                    <TableCell className="font-medium py-2 px-3 text-sm">{d.field}</TableCell>
                                    <TableCell className="py-2 px-3 text-sm">{d.purchaseOrderValue}</TableCell>
                                    <TableCell className="py-2 px-3 text-sm">{d.salesOrderValue}</TableCell>
                                    <TableCell className="text-center py-2 px-3 text-sm">
                                      <Tooltip delayDuration={100}>
                                        <TooltipTrigger asChild>
                                          <AlertCircle className="h-5 w-5 text-destructive inline-block cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-destructive text-destructive-foreground p-2 rounded-md shadow-lg max-w-xs">
                                          <p className="font-semibold">Discrepancy Reason:</p>
                                          <p className="text-sm">{d.reason || 'No specific reason provided.'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <Alert variant="default" className="mt-2 text-sm">
                            <Info className="h-4 w-4" />
                            <AlertTitle className="text-base">No General Discrepancies Found</AlertTitle>
                            <AlertDescription>The AI did not find any general discrepancies between the two documents.</AlertDescription>
                          </Alert>
                        )}
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="product-line-items">
                      <AccordionTrigger className="text-xl font-semibold text-foreground hover:no-underline">
                        <div className="flex items-center">
                          <PackageSearch className="mr-2 h-6 w-6 text-purple-600" /> 
                          Product Line Item Comparison ({comparisonResult.productLineItemComparisons?.length || 0})
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {(comparisonResult.productLineItemComparisons && comparisonResult.productLineItemComparisons.length > 0) ? (
                          <div className="border rounded-md overflow-hidden max-h-[400px] overflow-y-auto">
                            <Table>
                              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                <TableRow>
                                  <TableHead className="font-semibold text-xs w-[15%]">PO Product</TableHead>
                                  <TableHead className="font-semibold text-xs w-[7%]">PO Qty</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%]">PO Unit Price</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%]">PO Total</TableHead>
                                  <TableHead className="font-semibold text-xs w-[15%]">SO Product</TableHead>
                                  <TableHead className="font-semibold text-xs w-[7%]">SO Qty</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%]">SO Unit Price</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%]">SO Total</TableHead>
                                  <TableHead className="font-semibold text-xs w-[16%] text-center">Status / Notes</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {comparisonResult.productLineItemComparisons.map((item, index) => (
                                  <TableRow key={`prod-comp-${index}`} className={index % 2 === 0 ? 'bg-transparent' : 'bg-muted/30 hover:bg-muted/50'}>
                                    <TableCell className="py-2 px-2 text-xs">{item.poProductDescription || 'N/A'}</TableCell>
                                    <TableCell className="py-2 px-2 text-xs text-center">{item.poQuantity || 'N/A'}</TableCell>
                                    <TableCell className="py-2 px-2 text-xs text-right">{item.poUnitPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-2 px-2 text-xs text-right">{item.poTotalPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-2 px-2 text-xs">{item.soProductDescription || 'N/A'}</TableCell>
                                    <TableCell className="py-2 px-2 text-xs text-center">{item.soQuantity || 'N/A'}</TableCell>
                                    <TableCell className="py-2 px-2 text-xs text-right">{item.soUnitPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-2 px-2 text-xs text-right">{item.soTotalPrice || 'N/A'}</TableCell>
                                    <TableCell className="text-center py-2 px-2 text-xs">
                                      <Tooltip delayDuration={100}>
                                        <TooltipTrigger asChild>
                                          <span className="inline-block cursor-help">{getProductStatusIcon(item.status)}</span>
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-popover text-popover-foreground p-2 rounded-md shadow-lg max-w-xs">
                                          <p className="font-semibold capitalize">{item.status.replace(/_/g, ' ').toLowerCase()}:</p>
                                          <p className="text-sm">{item.comparisonNotes || 'No specific notes.'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <Alert variant="default" className="mt-2 text-sm">
                            <Info className="h-4 w-4" />
                            <AlertTitle className="text-base">No Product Line Items Compared</AlertTitle>
                            <AlertDescription>The AI did not identify or compare specific product line items from the documents.</AlertDescription>
                          </Alert>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </>
              )}
              {!isLoading && !error && !comparisonResult && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center pt-10">
                  <UploadCloud className="h-16 w-16 text-gray-400 mb-4" />
                  <p className="text-lg">Upload documents to see the comparison results.</p>
                  <p className="text-sm">The AI will analyze their content to find discrepancies and matching details.</p>
                </div>
              )}
            </CardContent>
            {comparisonResult && !isLoading && !error && (
              <CardFooter>
                <ExportButton data={comparisonResult} reportId="reportContentArea" className="w-full text-lg py-3" />
              </CardFooter>
            )}
          </Card>
        </div>
        <footer className="mt-12 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Order Comparator. Powered by AI.</p>
        </footer>
      </div>
    </TooltipProvider>
  );
}

    
