
// src/app/page.tsx
'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, FileWarning, Info, UploadCloud, FileText, XCircle, CheckCircle } from 'lucide-react';
import type { CompareOrderDetailsOutput, Discrepancy, ProductLineItemComparison } from '@/ai/flows/compare-order-details';
import { compareOrdersAction, type CompareActionState } from '@/app/actions';
import { ExportButton } from '@/components/export-button';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const initialActionState: CompareActionState = {
  error: null,
  data: null,
};

function OrderComparatorClientContent() {
  const [salesOrderName, setSalesOrderName] = useState<string>('');
  const [purchaseOrderFile, setPurchaseOrderFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<CompareOrderDetailsOutput | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentProcessedSOName, setCurrentProcessedSOName] = useState<string | null>(null);
  const [currentProcessedPOFileSignature, setCurrentProcessedPOFileSignature] = useState<string | null>(null);
  const [poFileSelectedText, setPoFileSelectedText] = useState<string>("Upload a Document");

  const searchParams = useSearchParams();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raw = searchParams.get('so_name');
    const decodedSOName = raw ? decodeURIComponent(raw) : '';

    if (decodedSOName !== salesOrderName) {
      setSalesOrderName(decodedSOName);
      setComparisonResult(null);
      setError(null);
      setCurrentProcessedSOName(null);
      setPurchaseOrderFile(null);
      setCurrentProcessedPOFileSignature(null);
      setPoFileSelectedText("Upload a Document");
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [searchParams, salesOrderName]);


  const handlePOFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setPurchaseOrderFile(event.target.files[0]);
      setComparisonResult(null);
      setError(null);
      setPoFileSelectedText("Uploaded Document");
    } else {
      setPurchaseOrderFile(null);
      setPoFileSelectedText("Upload a Document");
    }
  };

  const removePOFile = () => {
    setPurchaseOrderFile(null);
    setCurrentProcessedPOFileSignature(null);
    setPoFileSelectedText("Upload a Document");
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleSubmit = useCallback(async () => {
    const salesOrderNameValid = salesOrderName && salesOrderName.trim() !== '';
    if (!salesOrderNameValid || !purchaseOrderFile) {
      return;
    }

    const poFileSignature = purchaseOrderFile.name + purchaseOrderFile.size;

    if (salesOrderName === currentProcessedSOName &&
        poFileSignature === currentProcessedPOFileSignature &&
        (comparisonResult || error)
        ) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setComparisonResult(null);

    const formData = new FormData();
    formData.append('salesOrderName', salesOrderName);
    formData.append('purchaseOrderFile', purchaseOrderFile);

    try {
      const resultState = await compareOrdersAction(initialActionState, formData);

      if (resultState.error) {
        setError(resultState.error);
        toast({
          variant: "destructive",
          title: "Comparison Failed",
          description: resultState.error,
          duration: 9000,
        });
      }
      if (resultState.data) {
        setComparisonResult(resultState.data);
        toast({
          title: "Comparison Complete",
          description: "The order documents have been compared successfully.",
        });
      }
      setCurrentProcessedSOName(salesOrderName);
      setCurrentProcessedPOFileSignature(poFileSignature);
    } catch (e: any) {
      const errorMessage = e.message || "An unexpected error occurred during comparison.";
      setError(errorMessage);
      toast({
          variant: "destructive",
          title: "Comparison Failed",
          description: errorMessage,
          duration: 9000,
      });
      setCurrentProcessedSOName(salesOrderName);
      setCurrentProcessedPOFileSignature(poFileSignature);
    } finally {
      setIsLoading(false);
    }
  }, [salesOrderName, purchaseOrderFile, currentProcessedSOName, currentProcessedPOFileSignature, comparisonResult, error, toast]);

  useEffect(() => {
    const salesOrderNameValid = salesOrderName && salesOrderName.trim() !== '';
    if (salesOrderNameValid && purchaseOrderFile) {
      const poFileSignature = purchaseOrderFile.name + purchaseOrderFile.size;
      const alreadyProcessedThisCombination = (
        salesOrderName === currentProcessedSOName &&
        poFileSignature === currentProcessedPOFileSignature &&
        (comparisonResult || error)
      );

      if (!isLoading && !alreadyProcessedThisCombination) {
         handleSubmit();
      }
    }
  }, [salesOrderName, purchaseOrderFile, isLoading, currentProcessedSOName, currentProcessedPOFileSignature, comparisonResult, error, handleSubmit]);

  const salesOrderNameValid = salesOrderName && salesOrderName.trim() !== '';
  const poFileSignatureForCheck = purchaseOrderFile ? purchaseOrderFile.name + purchaseOrderFile.size : null;
  const alreadyProcessedThisCombination =
    salesOrderName === currentProcessedSOName &&
    poFileSignatureForCheck === currentProcessedPOFileSignature &&
    (comparisonResult || error);

  const getItemStatusIconAndTooltip = (item: ProductLineItemComparison) => {
    let icon;
    let statusText = item.status.replace(/_/g, ' ').toLowerCase();
    let iconColorClass = 'text-red-600 dark:text-red-400'; // Default to red

    switch (item.status) {
      case 'MATCHED':
        icon = <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />;
        iconColorClass = 'text-green-600 dark:text-green-400';
        break;
      case 'PARTIAL_MATCH_DETAILS_DIFFER':
        icon = <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />;
        iconColorClass = 'text-green-600 dark:text-green-400';
        statusText = 'partial match, details differ';
        break;
      default: // Covers MISMATCH_*, PO_ONLY, SO_ONLY
        icon = <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />;
        break;
    }

    const tooltipContent = (
      <>
        <p className={`font-semibold capitalize ${iconColorClass}`}>{statusText}:</p>
        <p className="text-base whitespace-pre-line">{item.comparisonNotes || 'No specific notes.'}</p>
      </>
    );
    return { icon, tooltipContent };
  };


  return (
    <TooltipProvider>
      <div className="min-h-screen p-4 md:p-8 bg-background">
        <header className="mb-8 text-center pt-4">
          <div className="flex items-center justify-center mb-2">
            <h1 className="text-5xl font-bold text-foreground">Contract Review AI</h1>
          </div>
        </header>

        <div className="w-full max-w-6xl mx-auto grid grid-cols-1 gap-8">
          <Accordion type="single" collapsible className="w-full shadow-lg rounded-lg bg-card" defaultValue="input-documents">
            <AccordionItem value="input-documents" className="border-b-0">
               <AccordionTrigger className="text-left hover:no-underline p-6 data-[state=open]:border-b">
                <div>
                  <h2 className="text-3xl font-semibold flex items-center">
                    Upload PO
                  </h2>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                <Card className="shadow-none border-0 rounded-t-none">
                    <CardContent className="space-y-6 pt-6 p-6">
                      <div className="space-y-2">
                        <Input
                          id="purchaseOrderFile"
                          name="purchaseOrderFile"
                          type="file"
                          onChange={handlePOFileChange}
                          ref={fileInputRef}
                          className="block w-full text-base text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-0.5 file:text-base file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                          accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx"
                        />
                        {poFileSelectedText === "Uploaded Document" ? (
                            <p className="text-sm text-green-600 dark:text-green-500 flex items-center">
                                <CheckCircle className="h-4 w-4 mr-1 inline-block" /> {poFileSelectedText}
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground">{poFileSelectedText}</p>
                        )}
                        {purchaseOrderFile && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-base text-muted-foreground p-2 border rounded-md">
                              <span className="truncate" title={purchaseOrderFile.name}>
                                {purchaseOrderFile.name} ({(purchaseOrderFile.size / 1024).toFixed(1)} KB)
                              </span>
                              <Button variant="ghost" size="icon" onClick={removePOFile} className="h-6 w-6 ml-2">
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

          <Card className="shadow-lg mt-8">
            <CardHeader>
              <CardTitle className="text-3xl">Response</CardTitle>
            </CardHeader>
            <CardContent id="reportContentArea" className="min-h-[300px] flex flex-col space-y-6">
              {isLoading && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <p className="text-xl">Fetching and comparing documents, please wait...</p>
                </div>
              )}
              {error && !isLoading && (
                <Alert variant="destructive" className="mb-4">
                  <FileWarning className="h-5 w-5" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {!isLoading && !error && !comparisonResult && !salesOrderNameValid && !purchaseOrderFile && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center pt-10">
                  <FileText className="h-16 w-16 text-gray-400 mb-4" />
                  <p className="text-xl">Ready for Comparison</p>
                  <p className="text-base">Comparison will being shortly after You upload the Purchase Order.</p>
                </div>
              )}

              {!isLoading && !error && !comparisonResult && salesOrderNameValid && !purchaseOrderFile && (
                 <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center pt-10">
                  <FileText className="h-16 w-16 text-gray-400 mb-4" />
                  <p className="text-xl">System ready.</p>
                  <p className="text-base mt-2">Please upload a Purchase Order document to begin analysis.</p>
                </div>
              )}

              {!isLoading && !error && !comparisonResult && !salesOrderNameValid && purchaseOrderFile && (
                 <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center pt-10">
                  <FileText className="h-16 w-16 text-gray-400 mb-4" />
                  <p className="text-xl">Purchase Order: <span className="font-semibold text-primary">{purchaseOrderFile.name}</span> selected.</p>
                  <p className="text-base mt-2">Waiting for Sales Order identifier (via URL) to begin analysis.</p>
                </div>
              )}
               {!isLoading && !error && !comparisonResult && salesOrderNameValid && purchaseOrderFile && !alreadyProcessedThisCombination && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center pt-10">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <p className="text-xl">Preparing to compare...</p>
                    <p className="text-base">Purchase Order: {purchaseOrderFile.name}</p>
                </div>
              )}


              {!isLoading && !error && comparisonResult && (
                <>
                  <Accordion type="multiple" className="w-full" defaultValue={["item-comparison", "discrepancies"]}>
                    <AccordionItem value="item-comparison">
                      <AccordionTrigger className="text-2xl font-semibold text-foreground hover:no-underline">
                        Item Comparison ({comparisonResult.productLineItemComparisons?.length || 0})
                      </AccordionTrigger>
                      <AccordionContent>
                        {(comparisonResult.productLineItemComparisons && comparisonResult.productLineItemComparisons.length > 0) ? (
                          <div className="border rounded-md overflow-hidden max-h-[400px] overflow-y-auto">
                            <Table>
                              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                <TableRow>
                                  <TableHead className="font-semibold text-base w-[8%] text-center">Status</TableHead>
                                  <TableHead className="font-semibold text-base w-[15%]">PO Product</TableHead>
                                  <TableHead className="font-semibold text-base w-[6%] text-center">Qty</TableHead>
                                  <TableHead className="font-semibold text-base w-[9%] text-right">Unit Price</TableHead>
                                  <TableHead className="font-semibold text-base w-[9%] text-right">Total</TableHead>
                                  <TableHead className="font-semibold text-base w-[15%]">SO Product</TableHead>
                                  <TableHead className="font-semibold text-base w-[6%] text-center">Qty</TableHead>
                                  <TableHead className="font-semibold text-base w-[9%] text-right">Unit Price</TableHead>
                                  <TableHead className="font-semibold text-base w-[9%] text-right">Total</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {comparisonResult.productLineItemComparisons.map((item, index) => {
                                  const { icon, tooltipContent } = getItemStatusIconAndTooltip(item);
                                  return (
                                    <TableRow key={`prod-comp-${index}`} className={index % 2 === 0 ? 'bg-transparent' : 'bg-muted/30 hover:bg-muted/50 dark:bg-muted/10 dark:hover:bg-muted/20'}>
                                      <TableCell className="text-center py-1.5 px-2 text-base">
                                        <Tooltip delayDuration={100}>
                                          <TooltipTrigger asChild>
                                            <span className="inline-block cursor-help">{icon}</span>
                                          </TooltipTrigger>
                                          <TooltipContent className="bg-popover text-popover-foreground p-2 rounded-md shadow-lg max-w-xs">
                                            {tooltipContent}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TableCell>
                                      <TableCell className="py-1.5 px-2 text-base whitespace-pre-line">{item.poProductDescription || 'N/A'}</TableCell>
                                      <TableCell className="py-1.5 px-2 text-base text-center whitespace-pre-line">{item.poQuantity || 'N/A'}</TableCell>
                                      <TableCell className="py-1.5 px-2 text-base text-right whitespace-pre-line">{item.poUnitPrice || 'N/A'}</TableCell>
                                      <TableCell className="py-1.5 px-2 text-base text-right whitespace-pre-line">{item.poTotalPrice || 'N/A'}</TableCell>
                                      <TableCell className="py-1.5 px-2 text-base whitespace-pre-line">{item.soProductDescription || 'N/A'}</TableCell>
                                      <TableCell className="py-1.5 px-2 text-base text-center whitespace-pre-line">{item.soQuantity || 'N/A'}</TableCell>
                                      <TableCell className="py-1.5 px-2 text-base text-right whitespace-pre-line">{item.soUnitPrice || 'N/A'}</TableCell>
                                      <TableCell className="py-1.5 px-2 text-base text-right whitespace-pre-line">{item.soTotalPrice || 'N/A'}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <Alert variant="default" className="mt-2 text-base">
                            <Info className="h-4 w-4" />
                            <AlertTitle className="text-lg">No Items Compared</AlertTitle>
                            <AlertDescription>The AI did not identify or compare specific items from the documents.</AlertDescription>
                          </Alert>
                        )}
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="discrepancies">
                      <AccordionTrigger className="text-2xl font-semibold text-foreground hover:no-underline">
                        <div className="flex items-center">
                           General Discrepancies ({comparisonResult.discrepancies?.length || 0})
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {(comparisonResult.discrepancies && comparisonResult.discrepancies.length > 0) ? (
                          <div className="border rounded-md overflow-hidden max-h-[200px] overflow-y-auto">
                            <Table>
                              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                <TableRow>
                                  <TableHead className="font-semibold text-base w-[10%] text-center">Reasons</TableHead>
                                  <TableHead className="font-semibold text-base w-[30%]">Buyer's Info</TableHead>
                                  <TableHead className="font-semibold text-base w-[30%]">PO</TableHead>
                                  <TableHead className="font-semibold text-base w-[30%]">SO</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {comparisonResult.discrepancies.map((d, index) => {
                                  let displayField = d.field;
                                  if (d.field === "Buyer Name") {
                                    displayField = "Name";
                                  } else if (d.field === "Buyer Address") {
                                    displayField = "Address";
                                  }
                                  return (
                                  <TableRow key={`disc-${index}-${d.field.replace(/\s+/g, '-')}`} className={index % 2 === 0 ? 'bg-transparent' : 'bg-destructive/5 hover:bg-destructive/10 dark:bg-destructive/10 dark:hover:bg-destructive/20'}>
                                    <TableCell className="text-center py-2 px-3 text-base whitespace-pre-line">
                                      <Tooltip delayDuration={100}>
                                        <TooltipTrigger asChild>
                                            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 inline-block cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-popover text-popover-foreground p-2 rounded-md shadow-lg max-w-xs">
                                          <p className="font-semibold text-red-600 dark:text-red-400">Discrepancy Reason:</p>
                                          <p className="text-base whitespace-pre-line">{d.reason || 'No specific reason provided.'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TableCell>
                                    <TableCell className="font-medium py-2 px-3 text-base whitespace-pre-line">{displayField}</TableCell>
                                    <TableCell className="py-2 px-3 text-base whitespace-pre-line">{d.purchaseOrderValue}</TableCell>
                                    <TableCell className="py-2 px-3 text-base whitespace-pre-line">{d.salesOrderValue}</TableCell>
                                  </TableRow>
                                )})}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                           <Alert variant="default" className="mt-2 text-base">
                            <Info className="h-4 w-4" />
                            <AlertTitle className="text-lg">No General Discrepancies Found.</AlertTitle>
                            <AlertDescription>The AI did not find any general discrepancies between the Sales Order and Purchase Order(s).</AlertDescription>
                          </Alert>
                        )}
                      </AccordionContent>
                    </AccordionItem>

                  </Accordion>
                </>
              )}
            </CardContent>
            {comparisonResult && !isLoading && !error && (
              <CardFooter>
                <ExportButton data={comparisonResult} reportId="reportContentArea" variant="secondary" className="w-full text-xl py-3" />
              </CardFooter>
            )}
          </Card>
      </div>
    </TooltipProvider>
  );
}

export default function OrderComparatorPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center min-h-screen"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-xl">Loading page...</p></div>}>
      <OrderComparatorClientContent />
    </Suspense>
  );
}
    

    

    















