
// src/app/page.tsx
'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
// Removed: import { useActionState } from 'react';
// Removed: import { useFormStatus } from 'react-dom';
// Removed: import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
// Removed: import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, FileWarning, Scale, Search, Workflow, FileKey2, AlertCircle, PackageSearch, BadgeHelp, Info, MinusCircle, PackagePlus, HelpCircle } from 'lucide-react';
import type { CompareOrderDetailsOutput, MatchedItem, Discrepancy, ProductLineItemComparison } from '@/ai/flows/compare-order-details';
import { compareOrdersAction, type CompareActionState } from '@/app/actions';
import { ExportButton } from '@/components/export-button';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Removed SubmitButton component

// Define initialState for direct action call, though prevState might not be deeply used by the action in this scenario
const initialActionState: CompareActionState = {
  error: null,
  data: null,
};

function OrderComparatorClientContent() {
  const [salesOrderName, setSalesOrderName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<CompareOrderDetailsOutput | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentProcessedSOName, setCurrentProcessedSOName] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const raw = searchParams.get('so_name');
    const decodedSOName = raw ? decodeURIComponent(raw) : '';

    if (decodedSOName !== salesOrderName) {
      setSalesOrderName(decodedSOName);
      // Reset states when SO name changes to allow new auto-comparison
      setComparisonResult(null);
      setError(null);
      setCurrentProcessedSOName(null); 
      setIsLoading(false); // Ensure loading is reset
    }
  }, [searchParams, salesOrderName]);


  useEffect(() => {
    // Automatically trigger comparison when salesOrderName is set from URL and not yet processed
    if (salesOrderName && salesOrderName.trim() !== '' && salesOrderName !== currentProcessedSOName && !isLoading) {
      const triggerComparison = async () => {
        setIsLoading(true);
        setError(null);
        setComparisonResult(null); // Clear previous results

        const formData = new FormData();
        formData.append('salesOrderName', salesOrderName);

        try {
          // Directly call the server action
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
          setCurrentProcessedSOName(salesOrderName); // Mark this SO name as processed
        } catch (e: any) {
          const errorMessage = e.message || "An unexpected error occurred during comparison.";
          setError(errorMessage);
          toast({
              variant: "destructive",
              title: "Comparison Failed",
              description: errorMessage,
              duration: 9000,
          });
          setCurrentProcessedSOName(salesOrderName); // Mark as processed even on error to prevent loops
        } finally {
          setIsLoading(false);
        }
      };
      triggerComparison();
    }
  }, [salesOrderName, currentProcessedSOName, isLoading, toast]);

  const getProductStatusIcon = (status: ProductLineItemComparison['status']) => {
    switch (status) {
      case 'MATCHED':
        return <span>✅</span>;
      case 'MISMATCH_QUANTITY':
      case 'MISMATCH_UNIT_PRICE':
      case 'MISMATCH_TOTAL_PRICE':
      case 'MISMATCH_DESCRIPTION':
      case 'PARTIAL_MATCH_DETAILS_DIFFER':
        return <span>❌</span>;
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
        <div className="w-full flex justify-end px-4 pt-4 mb-2">
          <Image
            src="/eoxs-logo(1).svg" 
            alt="EOXS Logo"
            width={128} 
            height={62} 
            className="object-contain"
            priority 
          />
        </div>
        <header className="mb-8 text-center">
          <div className="flex items-center justify-center mb-2">
            <Scale className="h-12 w-12 text-primary mr-3" />
            <h1 className="text-4xl font-bold text-foreground">EOXS AI comparator</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            AI-powered tool to compare purchase orders with sales orders fetched from ERP.
          </p>
        </header>

        <div className="w-full max-w-6xl mx-auto grid grid-cols-1 gap-8">
          <Accordion type="single" collapsible className="w-full shadow-lg rounded-lg bg-card" defaultValue="input-documents">
            <AccordionItem value="input-documents" className="border-b-0">
               <AccordionTrigger className="text-left hover:no-underline p-6 data-[state=open]:border-b">
                <div>
                  <h2 className="text-2xl font-semibold flex items-center">
                    <Search className="mr-3 h-7 w-7 text-primary" />
                    Sales Order for Comparison
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5">
                    The system automatically fetches and compares the SO (and linked PO) based on the identifier from the URL.
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                <Card className="shadow-none border-0 rounded-t-none">
                    <CardContent className="space-y-6 pt-6">
                       <div className="space-y-2">
                        <Label htmlFor="salesOrderNameDisplay" className="text-lg font-medium">Comparing Sales Order:</Label>
                        {salesOrderName ? (
                           <p id="salesOrderNameDisplay" className="text-lg font-semibold text-primary py-2 px-3 border rounded-md bg-secondary/30">
                            {salesOrderName}
                          </p>
                        ) : (
                          <p id="salesOrderNameDisplay" className="text-lg text-muted-foreground py-2 px-3 border rounded-md">
                            No Sales Order specified in URL. Waiting for SO name...
                          </p>
                        )}
                      </div>
                    </CardContent>
                    {/* Removed CardFooter with submit button */}
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
                  <p className="text-lg">Fetching and comparing documents, please wait...</p>
                  <p className="text-sm">This may involve multiple calls to ERP and AI analysis.</p>
                </div>
              )}
              {error && !isLoading && (
                <Alert variant="destructive" className="mb-4">
                  <FileWarning className="h-5 w-5" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {!isLoading && !error && !comparisonResult && salesOrderName && !currentProcessedSOName && (
                 <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center pt-10">
                  <Loader2 className="h-16 w-16 animate-spin text-primary mb-4" />
                  <p className="text-lg">Preparing to compare Sales Order: {salesOrderName}...</p>
                </div>
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

                  <Accordion type="multiple" className="w-full" defaultValue={["discrepancies", "product-line-items"]}>
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
                                    <TableCell className="font-medium py-2 px-3 text-sm whitespace-pre-line">{item.field}</TableCell>
                                    <TableCell className="py-2 px-3 text-sm whitespace-pre-line">{item.value}</TableCell>
                                    <TableCell className="text-center py-2 px-3 text-sm whitespace-pre-line">
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
                            <AlertTitle className="text-base">No General Matched Fields Identified.</AlertTitle>
                            <AlertDescription>The AI did not find any general fields that match between the Sales Order and Purchase Order(s).</AlertDescription>
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
                                    <TableCell className="font-medium py-2 px-3 text-sm whitespace-pre-line">{d.field}</TableCell>
                                    <TableCell className="py-2 px-3 text-sm whitespace-pre-line">{d.purchaseOrderValue}</TableCell>
                                    <TableCell className="py-2 px-3 text-sm whitespace-pre-line">{d.salesOrderValue}</TableCell>
                                    <TableCell className="text-center py-2 px-3 text-sm whitespace-pre-line">
                                      <Tooltip delayDuration={100}>
                                        <TooltipTrigger asChild>
                                          <AlertCircle className="h-5 w-5 text-destructive inline-block cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-destructive text-destructive-foreground p-2 rounded-md shadow-lg max-w-xs">
                                          <p className="font-semibold">Discrepancy Reason:</p>
                                          <p className="text-sm whitespace-pre-line">{d.reason || 'No specific reason provided.'}</p>
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
                            <AlertTitle className="text-base">No General Discrepancies Found.</AlertTitle>
                            <AlertDescription>The AI did not find any general discrepancies between the Sales Order and Purchase Order(s).</AlertDescription>
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
                                  <TableHead className="font-semibold text-xs w-[7%] text-center">PO Qty</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%] text-right">PO Unit Price</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%] text-right">PO Total</TableHead>
                                  <TableHead className="font-semibold text-xs w-[15%]">SO Product</TableHead>
                                  <TableHead className="font-semibold text-xs w-[7%] text-center">SO Qty</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%] text-right">SO Unit Price</TableHead>
                                  <TableHead className="font-semibold text-xs w-[10%] text-right">SO Total</TableHead>
                                  <TableHead className="font-semibold text-xs w-[16%] text-center">Status / Notes</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {comparisonResult.productLineItemComparisons.map((item, index) => (
                                  <TableRow key={`prod-comp-${index}`} className={index % 2 === 0 ? 'bg-transparent' : 'bg-muted/30 hover:bg-muted/50'}>
                                    <TableCell className="py-1.5 px-2 text-xs whitespace-pre-line">{item.poProductDescription || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-xs text-center whitespace-pre-line">{item.poQuantity || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-xs text-right whitespace-pre-line">{item.poUnitPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-xs text-right whitespace-pre-line">{item.poTotalPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-xs whitespace-pre-line">{item.soProductDescription || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-xs text-center whitespace-pre-line">{item.soQuantity || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-xs text-right whitespace-pre-line">{item.soUnitPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-xs text-right whitespace-pre-line">{item.soTotalPrice || 'N/A'}</TableCell>
                                    <TableCell className="text-center py-1.5 px-2 text-xs">
                                      <Tooltip delayDuration={100}>
                                        <TooltipTrigger asChild>
                                          <span className="inline-block cursor-help">{getProductStatusIcon(item.status)}</span>
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-popover text-popover-foreground p-2 rounded-md shadow-lg max-w-xs">
                                          <p className="font-semibold capitalize">{item.status.replace(/_/g, ' ').toLowerCase()}:</p>
                                          <p className="text-sm whitespace-pre-line">{item.comparisonNotes || 'No specific notes.'}</p>
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
              {!isLoading && !error && !comparisonResult && (!salesOrderName || salesOrderName.trim() === '') && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center pt-10">
                  <Search className="h-16 w-16 text-gray-400 mb-4" />
                  <p className="text-lg">Waiting for Sales Order name from URL to begin comparison.</p>
                  <p className="text-sm">Please ensure 'so_name' parameter is in the URL.</p>
                </div>
              )}
            </CardContent>
            {comparisonResult && !isLoading && !error && (
              <CardFooter>
                <ExportButton data={comparisonResult} reportId="reportContentArea" variant="secondary" className="w-full text-lg py-3" />
              </CardFooter>
            )}
          </Card>
        </div>
        <footer className="mt-12 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} EOXS AI comparator. Powered by AI.</p>
        </footer>
      </div>
    </TooltipProvider>
  );
}

export default function OrderComparatorPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center min-h-screen"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Loading page...</p></div>}>
      <OrderComparatorClientContent />
    </Suspense>
  );
}
    

    