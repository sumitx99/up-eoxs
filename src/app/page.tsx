// src/app/page.tsx
'use client';

import React, { useState, type FormEvent, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Scale, FileWarning, FileCheck2, UploadCloud, FileText, FileImage, FileSpreadsheet, CheckCircle2, AlertCircle, BadgeHelp, Info } from 'lucide-react';
import { compareOrdersAction } from './actions';
import type { CompareOrderDetailsOutput, MatchedItem, Discrepancy } from '@/ai/flows/compare-order-details';
import { ExportButton } from '@/components/export-button';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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

interface DisplayItem {
  id: string;
  field: string;
  poValue: string;
  soValue: string;
  status: 'matched' | 'mismatched';
  reason?: string;
  matchQuality?: string;
  isMatched: boolean;
}

export default function OrderComparatorPage() {
  const [purchaseOrderFile, setPurchaseOrderFile] = useState<File | null>(null);
  const [salesOrderFile, setSalesOrderFile] = useState<File | null>(null);
  const [comparisonResult, setComparisonResult] = useState<CompareOrderDetailsOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'matches' | 'mismatches'>('all');

  const purchaseOrderRef = useRef<HTMLInputElement>(null);
  const salesOrderRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const getFileIcon = (file: File | null) => {
    if (!file) return <UploadCloud className="h-4 w-4 mr-2 text-muted-foreground" />;
    if (file.type.startsWith("image/")) return <FileImage className="h-4 w-4 mr-2 text-primary" />;
    if (file.type === "application/pdf") return <FileText className="h-4 w-4 mr-2 text-red-600" />; // Changed color to be more 'destructive' like
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
    setActiveTab('all'); // Reset tab on new submission

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

  const allDisplayItems = useMemo((): DisplayItem[] => {
    if (!comparisonResult) return [];
    const items: DisplayItem[] = [];

    (comparisonResult.matchedItems || []).forEach((item, index) => {
      items.push({
        id: `match-${index}-${item.field}`,
        field: item.field,
        poValue: item.value,
        soValue: item.value,
        status: 'matched',
        matchQuality: item.matchQuality || 'Exact',
        isMatched: true,
      });
    });

    (comparisonResult.discrepancies || []).forEach((d, index) => {
      items.push({
        id: `disc-${index}-${d.field}`,
        field: d.field,
        poValue: d.purchaseOrderValue,
        soValue: d.salesOrderValue,
        status: 'mismatched',
        reason: d.reason,
        isMatched: false,
      });
    });
    return items.sort((a, b) => a.field.localeCompare(b.field)); // Sort by field name for consistency
  }, [comparisonResult]);

  const filteredDisplayItems = useMemo(() => {
    if (activeTab === 'all') return allDisplayItems;
    if (activeTab === 'matches') return allDisplayItems.filter(item => item.isMatched);
    if (activeTab === 'mismatches') return allDisplayItems.filter(item => !item.isMatched);
    return [];
  }, [allDisplayItems, activeTab]);

  const matchedCount = useMemo(() => allDisplayItems.filter(item => item.isMatched).length, [allDisplayItems]);
  const mismatchedCount = useMemo(() => allDisplayItems.filter(item => !item.isMatched).length, [allDisplayItems]);
  const totalCount = allDisplayItems.length;

  const RenderComparisonTable = ({ items }: { items: DisplayItem[] }) => {
    if (items.length === 0) {
      let title = "No Items";
      let description = "No items to display for the current filter.";
      if (activeTab === 'all' && totalCount === 0 && !isLoading) title = "No Comparison Data";
      if (activeTab === 'all' && totalCount === 0 && !isLoading) description = "Upload documents and compare to see results.";
      else if (activeTab === 'matches') { title = "No Matches"; description = "No matching items were found."; }
      else if (activeTab === 'mismatches') { title = "No Mismatches"; description = "No discrepancies were found."; }
      
      return (
        <Alert variant="default" className="mt-4">
          <Info className="h-5 w-5" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
      );
    }
    return (
      <div className="border rounded-md overflow-hidden max-h-[450px] overflow-y-auto mt-4">
        <Table>
          <TableHeader className="bg-muted/50 sticky top-0 z-10">
            <TableRow>
              <TableHead className="font-semibold w-[30%]">Field</TableHead>
              <TableHead className="font-semibold w-[27%]">PO Value</TableHead>
              <TableHead className="font-semibold w-[27%]">SO Value</TableHead>
              <TableHead className="font-semibold w-[16%] text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow 
                key={item.id} 
                className={`${item.isMatched ? 'hover:bg-accent/10' : 'hover:bg-destructive/10'} 
                           ${item.isMatched && item.id.includes('match') ? (parseInt(item.id.split('-')[1]) % 2 === 0 ? 'bg-transparent' : 'bg-accent/5') : ''}
                           ${!item.isMatched && item.id.includes('disc') ? (parseInt(item.id.split('-')[1]) % 2 === 0 ? 'bg-transparent' : 'bg-destructive/5') : ''}
                          `}
              >
                <TableCell className="font-medium py-3 px-4">{item.field}</TableCell>
                <TableCell className="py-3 px-4">{item.poValue}</TableCell>
                <TableCell className="py-3 px-4">{item.soValue}</TableCell>
                <TableCell className="text-center py-3 px-4">
                  {item.isMatched ? (
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <CheckCircle2 className="h-5 w-5 text-accent inline-block" />
                      </TooltipTrigger>
                       <TooltipContent className="bg-accent text-accent-foreground p-2 rounded-md shadow-lg">
                        <p>Matched ({item.matchQuality || 'Exact'})</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <AlertCircle className="h-5 w-5 text-destructive inline-block cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="bg-destructive text-destructive-foreground p-2 rounded-md shadow-lg max-w-xs">
                        <p className="font-semibold">Discrepancy Reason:</p>
                        <p className="text-sm">{item.reason || 'No specific reason provided.'}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col items-center p-4 md:p-8 bg-background">
        <header className="mb-8 text-center">
          <div className="flex items-center justify-center mb-2">
            <Scale className="h-12 w-12 text-primary mr-3" />
            <h1 className="text-4xl font-bold text-foreground">Order Comparator</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            AI-powered tool to compare purchase and sales orders from various document types.
          </p>
        </header>

        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Input Order Documents</CardTitle>
              <CardDescription>
                Upload your purchase order and sales order documents (PDF, Image, CSV, Excel).
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="purchaseOrder" className="text-lg font-medium">Purchase Order Document</Label>
                  <div className="flex items-center space-x-2">
                      <Input
                        id="purchaseOrder"
                        type="file"
                        accept={ACCEPTED_EXTENSIONS_STRING}
                        ref={purchaseOrderRef}
                        onChange={(e) => handleFileChange(e, setPurchaseOrderFile)}
                        className="focus:ring-primary focus:border-primary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                        required
                        disabled={isLoading}
                      />
                  </div>
                  {purchaseOrderFile && (
                    <p className="text-sm text-muted-foreground flex items-center mt-2">
                      {getFileIcon(purchaseOrderFile)} Selected: {purchaseOrderFile.name} ({Math.round(purchaseOrderFile.size / 1024)} KB)
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salesOrder" className="text-lg font-medium">Sales Order Document</Label>
                  <div className="flex items-center space-x-2">
                      <Input
                        id="salesOrder"
                        type="file"
                        accept={ACCEPTED_EXTENSIONS_STRING}
                        ref={salesOrderRef}
                        onChange={(e) => handleFileChange(e, setSalesOrderFile)}
                        className="focus:ring-primary focus:border-primary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                        required
                        disabled={isLoading}
                      />
                  </div>
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

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Comparison Report</CardTitle>
               {/* Removed CardDescription here, will be handled by content below */}
            </CardHeader>
            <CardContent className="min-h-[300px] flex flex-col"> {/* Removed justify-center to allow natural flow */}
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
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold mb-2 text-foreground flex items-center">
                      <BadgeHelp className="mr-2 h-6 w-6 text-primary" /> AI Summary
                    </h3>
                    <p className="text-sm text-muted-foreground bg-secondary p-3 rounded-md whitespace-pre-wrap">
                      {comparisonResult.summary || 'No summary provided.'}
                    </p>
                  </div>

                  <div className="flex justify-end space-x-2 my-4">
                    <Badge variant="outline" className="text-sm py-1 px-3">Total: {totalCount}</Badge>
                    <Badge variant="default" className="bg-accent text-accent-foreground hover:bg-accent/90 text-sm py-1 px-3">Matches: {matchedCount}</Badge>
                    <Badge variant="destructive" className="text-sm py-1 px-3">Mismatches: {mismatchedCount}</Badge>
                  </div>

                  <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'all' | 'matches' | 'mismatches')} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-2">
                      <TabsTrigger value="all">All Items ({totalCount})</TabsTrigger>
                      <TabsTrigger value="matches">Matches ({matchedCount})</TabsTrigger>
                      <TabsTrigger value="mismatches">Mismatches ({mismatchedCount})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="all">
                      <RenderComparisonTable items={filteredDisplayItems} />
                    </TabsContent>
                    <TabsContent value="matches">
                       <RenderComparisonTable items={filteredDisplayItems} />
                    </TabsContent>
                    <TabsContent value="mismatches">
                       <RenderComparisonTable items={filteredDisplayItems} />
                    </TabsContent>
                  </Tabs>
                </div>
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
                <ExportButton data={comparisonResult} className="w-full text-lg py-3" />
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
