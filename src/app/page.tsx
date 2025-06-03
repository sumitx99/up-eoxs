
// src/app/page.tsx
'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Image from 'next/image'; // Import next/image
import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, FileWarning, Scale, Search, Workflow, FileKey2, AlertCircle, PackageSearch, Info, MinusCircle, PackagePlus, HelpCircle, ListChecks, FileText, CheckCircle2, XCircle } from 'lucide-react';
import type { CompareOrderDetailsOutput, MatchedItem, Discrepancy, ProductLineItemComparison } from '@/ai/flows/compare-order-details';
import { compareOrdersAction, type CompareActionState } from '@/app/actions';
import { ExportButton } from '@/components/export-button';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SubmitButtonProps {
  isSalesOrderNameEmpty: boolean;
}

function SubmitButton({ isSalesOrderNameEmpty }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full text-md py-2.5" disabled={pending || isSalesOrderNameEmpty}>
      {pending ? (
        <>
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Comparing Documents...
        </>
      ) : (
        <>
          <Workflow className="mr-2 h-5 w-5" />
          Compare Order Documents
        </>
      )}
    </Button>
  );
}

const initialState: CompareActionState = {
  error: null,
  data: null,
};

function OrderComparatorClientContent() {
  const [salesOrderName, setSalesOrderName] = useState<string>('');
  const [formState, formAction] = useActionState<CompareActionState, FormData>(compareOrdersAction, initialState);
  
  const [error, setError] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<CompareOrderDetailsOutput | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const searchParams = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const raw = searchParams.get('so_name');
    if (raw) {
      setSalesOrderName(decodeURIComponent(raw));
    }
  }, [searchParams, setSalesOrderName]);

  useEffect(() => {
    if (formState.error || formState.data) {
      setIsLoading(false); 
    }

    if (formState.error) {
      setError(formState.error);
      setComparisonResult(null);
      toast({
          variant: "destructive",
          title: "Comparison Failed",
          description: formState.error,
          duration: 9000,
      });
    }
    if (formState.data) {
      setComparisonResult(formState.data);
      setError(null);
      toast({
          title: "Comparison Complete",
          description: "The order documents have been compared successfully.",
      });
    }
  }, [formState, toast]);

  const handleFormSubmit = () => {
    setIsLoading(true);
    setError(null);
    setComparisonResult(null);
  };
  
  const getProductStatusIcon = (status: ProductLineItemComparison['status']) => {
    switch (status) {
      case 'MATCHED':
        return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case 'MISMATCH_QUANTITY':
      case 'MISMATCH_UNIT_PRICE':
      case 'MISMATCH_TOTAL_PRICE':
      case 'MISMATCH_DESCRIPTION':
      case 'PARTIAL_MATCH_DETAILS_DIFFER':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'PO_ONLY':
        return <MinusCircle className="h-4 w-4 text-orange-500" />;
      case 'SO_ONLY':
        return <PackagePlus className="h-4 w-4 text-accent" />;
      default:
        return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const isSalesOrderNameEmpty = salesOrderName.trim() === '';

  return (
    <TooltipProvider>
      <div className="min-h-screen p-3 md:p-6 bg-background">
        <div className="w-full flex justify-end px-4 pt-4 mb-2">
          <Image
            src="/eoxs_logo.png"
            alt="EOXS Logo"
            width={128}
            height={62} 
            className="object-contain"
            priority={true}
          />
        </div>
        <header className="mb-6 text-center">
          <div className="flex items-center justify-center mb-1">
            <Scale className="h-10 w-10 text-primary mr-2" />
            <h1 className="text-3xl font-semibold text-foreground">AI Comparator</h1>
          </div>
          <p className="text-muted-foreground text-md">
            AI-powered tool to compare purchase orders with sales orders fetched from ERP.
          </p>
        </header>

        <div className="w-full max-w-7xl mx-auto grid grid-cols-1 gap-6">
          <Accordion type="single" collapsible className="w-full shadow-md rounded-md bg-card" defaultValue="input-documents">
            <AccordionItem value="input-documents" className="border-b-0">
               <AccordionTrigger className="text-left hover:no-underline p-4 data-[state=open]:border-b">
                <div>
                  <h2 className="text-xl font-medium flex items-center">
                    <Search className="mr-2 h-6 w-6 text-primary" />
                    Input Sales Order Identifier
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Provide Sales Order name/sequence to fetch SO and linked PO(s) for comparison.
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                <Card className="shadow-none border-0 rounded-t-none">
                  <form action={formAction} onSubmit={handleFormSubmit}>
                    <CardContent className="space-y-4 pt-4">
                       <div className="space-y-1.5">
                        <Label htmlFor="salesOrderName" className="text-md font-medium">Sales Order Name/Sequence</Label>
                        <Input
                          id="salesOrderName"
                          name="salesOrderName" 
                          type="text"
                          placeholder="e.g., S00045 or SO/2024/0001"
                          value={salesOrderName}
                          onChange={(e) => setSalesOrderName(e.target.value)}
                          className="w-full focus:ring-primary focus:border-primary text-sm"
                          required
                        />
                         <p className="text-xs text-muted-foreground">Enter the Sales Order name. The system will attempt to fetch this SO's PDF and PDFs of Purchase Orders linked to it.</p>
                      </div>
                    </CardContent>
                    <CardFooter className="px-4 pb-4">
                       <SubmitButton isSalesOrderNameEmpty={isSalesOrderNameEmpty} />
                    </CardFooter>
                  </form>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Card className="shadow-md">
            <CardHeader className="p-4 border-b">
              <CardTitle className="text-xl font-medium">
                Comparison Report {comparisonResult && salesOrderName ? `for ${salesOrderName}` : ''}
              </CardTitle>
              <CardDescription className="text-xs">
                Review the AI-powered comparison between the Sales Order and linked Purchase Order(s).
              </CardDescription>
            </CardHeader>
            <CardContent id="reportContentArea" className="min-h-[250px] flex flex-col p-4 space-y-4">
              {isLoading && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-10">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
                  <p className="text-md">Fetching and comparing documents, please wait...</p>
                  <p className="text-xs">This may involve multiple calls to ERP and AI analysis.</p>
                </div>
              )}
              {error && !isLoading && (
                <Alert variant="destructive" className="mb-4">
                  <FileWarning className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              )}
              {!isLoading && !error && comparisonResult && (
                <Tabs defaultValue="line-items" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 md:grid-cols-2 mb-3 bg-secondary/70">
                    <TabsTrigger value="line-items" className="py-2 text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary">
                      <PackageSearch className="mr-1.5 h-4 w-4" /> Product Line Items
                    </TabsTrigger>
                    <TabsTrigger value="summary-fields" className="py-2 text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary">
                      <ListChecks className="mr-1.5 h-4 w-4" /> Summary & General Fields
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="line-items">
                    <Card className="border shadow-sm">
                      <CardHeader className="p-3 border-b">
                        <CardTitle className="text-lg font-medium flex items-center">
                           <PackageSearch className="mr-2 h-5 w-5 text-primary" /> Product Line Item Details
                        </CardTitle>
                        <CardDescription className="text-xs">Detailed comparison of product lines from SO and linked PO(s).</CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        {(comparisonResult.productLineItemComparisons && comparisonResult.productLineItemComparisons.length > 0) ? (
                          <div className="border-0 rounded-md overflow-hidden max-h-[350px] overflow-y-auto">
                            <Table className="text-xs">
                              <TableHeader className="bg-muted/40 sticky top-0 z-10">
                                <TableRow>
                                  <TableHead className="font-semibold py-2 px-2 w-[14%]">PO Product</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[6%] text-center">PO Qty</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[9%] text-right">PO Unit Price</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[9%] text-right">PO Total</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[14%]">SO Product</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[6%] text-center">SO Qty</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[9%] text-right">SO Unit Price</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[9%] text-right">SO Total</TableHead>
                                  <TableHead className="font-semibold py-2 px-2 w-[14%] text-center">Status / Notes</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {comparisonResult.productLineItemComparisons.map((item, index) => (
                                  <TableRow key={`prod-comp-${index}`} className={`text-xs ${index % 2 === 0 ? 'bg-transparent' : 'bg-secondary/30 hover:bg-secondary/50'}`}>
                                    <TableCell className="py-1.5 px-2">{item.poProductDescription || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-center">{item.poQuantity || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-right">{item.poUnitPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-right">{item.poTotalPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2">{item.soProductDescription || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-center">{item.soQuantity || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-right">{item.soUnitPrice || 'N/A'}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-right">{item.soTotalPrice || 'N/A'}</TableCell>
                                    <TableCell className="text-center py-1.5 px-2">
                                      <Tooltip delayDuration={100}>
                                        <TooltipTrigger asChild>
                                          <span className="inline-block cursor-help">{getProductStatusIcon(item.status)}</span>
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-popover text-popover-foreground p-1.5 rounded-md shadow-lg max-w-[200px] text-xs">
                                          <p className="font-semibold capitalize">{item.status.replace(/_/g, ' ').toLowerCase()}:</p>
                                          <p>{item.comparisonNotes || 'No specific notes.'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <Alert variant="default" className="mt-2 text-xs mx-3 mb-3">
                            <Info className="h-4 w-4" />
                            <AlertTitle className="text-sm">No Product Line Items Compared</AlertTitle>
                            <AlertDescription>The AI did not identify or compare specific product line items from the documents.</AlertDescription>
                          </Alert>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="summary-fields">
                    <div className="space-y-4">
                      <Card className="border shadow-sm">
                        <CardHeader className="p-3 border-b">
                          <CardTitle className="text-lg font-medium flex items-center">
                            <FileText className="mr-2 h-5 w-5 text-primary" /> AI Overall Summary
                          </CardTitle>
                          <CardDescription className="text-xs">Consolidated summary from the AI comparison.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-3">
                          <p className="text-xs text-foreground bg-secondary/50 p-2.5 rounded-md whitespace-pre-wrap">
                            {comparisonResult.summary || 'No summary provided.'}
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="border shadow-sm">
                        <CardHeader className="p-3 border-b">
                           <CardTitle className="text-lg font-medium flex items-center">
                             <FileKey2 className="mr-2 h-5 w-5 text-accent" /> General Matched Fields
                           </CardTitle>
                           <CardDescription className="text-xs">Fields matching between SO and linked PO(s).</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          {(comparisonResult.matchedItems && comparisonResult.matchedItems.length > 0) ? (
                            <div className="border-0 rounded-md overflow-hidden max-h-[250px] overflow-y-auto">
                              <Table className="text-xs">
                                <TableHeader className="bg-muted/40 sticky top-0 z-10">
                                  <TableRow>
                                    <TableHead className="font-semibold py-2 px-2 w-[40%]">Field</TableHead>
                                    <TableHead className="font-semibold py-2 px-2 w-[40%]">Matched Value</TableHead>
                                    <TableHead className="font-semibold py-2 px-2 w-[20%] text-center">Quality</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {comparisonResult.matchedItems.map((item, index) => (
                                    <TableRow key={`match-${index}-${item.field.replace(/\s+/g, '-')}`} className={`text-xs ${index % 2 === 0 ? 'bg-transparent' : 'bg-accent/5 hover:bg-accent/10'}`}>
                                      <TableCell className="font-medium py-1.5 px-2">{item.field}</TableCell>
                                      <TableCell className="py-1.5 px-2">{item.value}</TableCell>
                                      <TableCell className="text-center py-1.5 px-2">
                                        <span className="capitalize text-xs">{item.matchQuality || 'Exact'}</span>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <Alert variant="default" className="mt-2 text-xs mx-3 mb-3">
                              <Info className="h-4 w-4" />
                              <AlertTitle className="text-sm">No General Matched Fields</AlertTitle>
                              <AlertDescription>The AI did not find any general fields that match.</AlertDescription>
                            </Alert>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="border shadow-sm">
                        <CardHeader className="p-3 border-b">
                          <CardTitle className="text-lg font-medium flex items-center">
                             <AlertCircle className="mr-2 h-5 w-5 text-destructive" /> General Discrepancies
                          </CardTitle>
                          <CardDescription className="text-xs">Fields differing between SO and linked PO(s).</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          {(comparisonResult.discrepancies && comparisonResult.discrepancies.length > 0) ? (
                            <div className="border-0 rounded-md overflow-hidden max-h-[250px] overflow-y-auto">
                              <Table className="text-xs">
                                <TableHeader className="bg-muted/40 sticky top-0 z-10">
                                  <TableRow>
                                    <TableHead className="font-semibold py-2 px-2 w-[28%]">Field</TableHead>
                                    <TableHead className="font-semibold py-2 px-2 w-[25%]">PO Value</TableHead>
                                    <TableHead className="font-semibold py-2 px-2 w-[25%]">SO Value</TableHead>
                                    <TableHead className="font-semibold py-2 px-2 w-[22%] text-center">Reason / Notes</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {comparisonResult.discrepancies.map((d, index) => (
                                    <TableRow key={`disc-${index}-${d.field.replace(/\s+/g, '-')}`} className={`text-xs ${index % 2 === 0 ? 'bg-transparent' : 'bg-destructive/5 hover:bg-destructive/10'}`}>
                                      <TableCell className="font-medium py-1.5 px-2">{d.field}</TableCell>
                                      <TableCell className="py-1.5 px-2">{d.purchaseOrderValue}</TableCell>
                                      <TableCell className="py-1.5 px-2">{d.salesOrderValue}</TableCell>
                                      <TableCell className="text-center py-1.5 px-2">
                                        <Tooltip delayDuration={100}>
                                          <TooltipTrigger asChild>
                                            <AlertCircle className="h-4 w-4 text-destructive inline-block cursor-help" />
                                          </TooltipTrigger>
                                          <TooltipContent className="bg-destructive text-destructive-foreground p-1.5 rounded-md shadow-lg max-w-[200px] text-xs">
                                            <p className="font-semibold">Discrepancy Reason:</p>
                                            <p>{d.reason || 'No specific reason provided.'}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                             <Alert variant="default" className="mt-2 text-xs mx-3 mb-3">
                              <Info className="h-4 w-4" />
                              <AlertTitle className="text-sm">No General Discrepancies</AlertTitle>
                              <AlertDescription>The AI did not find any general discrepancies.</AlertDescription>
                            </Alert>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>
                </Tabs>
              )}
              {!isLoading && !error && !comparisonResult && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center py-10">
                  <Search className="h-12 w-12 text-gray-400 mb-3" />
                  <p className="text-md">Enter a Sales Order name to fetch and compare documents.</p>
                  <p className="text-xs">The system will retrieve the SO PDF and its linked PO PDF(s) for comparison.</p>
                </div>
              )}
            </CardContent>
            {comparisonResult && !isLoading && !error && (
              <CardFooter className="p-4 border-t">
                <ExportButton data={comparisonResult} reportId="reportContentArea" className="w-full text-md py-2.5" variant="secondary" />
              </CardFooter>
            )}
          </Card>
        </div>
        <footer className="mt-10 text-center text-xs text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} AI Comparator. Powered by Genkit and Gemini.</p>
        </footer>
      </div>
    </TooltipProvider>
  );
}

export default function OrderComparatorPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center min-h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /> <p className="ml-3 text-md">Loading page...</p></div>}>
      <OrderComparatorClientContent />
    </Suspense>
  );
}

