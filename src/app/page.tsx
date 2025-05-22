// src/app/page.tsx
'use client';

import { useState, type FormEvent, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Scale, FileWarning, FileCheck2, UploadCloud, FileText, FileImage, FileSpreadsheet, CheckCircle2, AlertCircle, BadgeHelp } from 'lucide-react';
import { compareOrdersAction } from './actions';
import type { CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import { ExportButton } from '@/components/export-button';
import { useToast } from '@/hooks/use-toast';

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
    if (file.type === "application/pdf") return <FileText className="h-4 w-4 mr-2 text-destructive" />;
    if (file.type === "text/csv" || file.name.endsWith(".csv")) return <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />;
    if (file.type.includes("excel") || file.type.includes("spreadsheetml") || file.name.endsWith(".xls") || file.name.endsWith(".xlsx")) return <FileSpreadsheet className="h-4 w-4 mr-2 text-green-700" />;
    return <FileText className="h-4 w-4 mr-2 text-gray-500" />;
  };


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, setFile: React.Dispatch<React.SetStateAction<File | null>>) => {
    const file = event.target.files?.[0];
    if (file) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      const isValidExtension = fileExtension && ['csv', 'xls', 'xlsx'].includes(fileExtension);
      if (ALLOWED_FILE_TYPES.includes(file.type) || isValidExtension) {
        setFile(file);
        setError(null); // Clear previous errors
      } else {
        toast({
          variant: "destructive",
          title: "Invalid File Type",
          description: `Please upload a supported file type: PDF, Image (JPEG, PNG, WebP), CSV, Excel (.xls, .xlsx). You provided: ${file.type || `.${fileExtension}` || 'unknown'}.`,
        });
        setFile(null);
        if (event.target) {
          event.target.value = ""; // Clear the input
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

  return (
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
            <CardDescription>
              Review the comparison summary, matched items, and detailed discrepancies.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-[300px] flex flex-col justify-center">
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
            {comparisonResult && !isLoading && !error && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-foreground flex items-center">
                     <BadgeHelp className="mr-2 h-6 w-6 text-primary" /> Summary
                  </h3>
                  <p className="text-sm text-muted-foreground bg-secondary p-3 rounded-md whitespace-pre-wrap">
                    {comparisonResult.summary || 'No summary provided.'}
                  </p>
                </div>

                {comparisonResult.matchedItems && comparisonResult.matchedItems.length > 0 && (
                  <div>
                    <h3 className="text-xl font-semibold mb-2 text-foreground flex items-center">
                      <CheckCircle2 className="mr-2 h-6 w-6 text-accent" /> Matched Items
                    </h3>
                    <div className="border rounded-md overflow-hidden max-h-80 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-muted/30 sticky top-0">
                          <TableRow>
                            <TableHead className="font-semibold">Field</TableHead>
                            <TableHead className="font-semibold">Matched Value</TableHead>
                            <TableHead className="font-semibold">Match Quality</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comparisonResult.matchedItems.map((item, index) => (
                            <TableRow key={`match-${index}`} className={`${index % 2 === 0 ? 'bg-transparent' : 'bg-accent/5'} hover:bg-accent/10`}>
                              <TableCell className="font-medium">{item.field}</TableCell>
                              <TableCell>{item.value}</TableCell>
                              <TableCell className="capitalize">{item.matchQuality || 'Exact'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
                
                {comparisonResult.discrepancies && comparisonResult.discrepancies.length > 0 && (
                  <div>
                    <h3 className="text-xl font-semibold mb-2 text-foreground flex items-center">
                      <AlertCircle className="mr-2 h-6 w-6 text-destructive" /> Discrepancies
                    </h3>
                    <div className="border rounded-md overflow-hidden max-h-80 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-muted/30 sticky top-0">
                          <TableRow>
                            <TableHead className="font-semibold">Field</TableHead>
                            <TableHead className="font-semibold">Purchase Order Value</TableHead>
                            <TableHead className="font-semibold">Sales Order Value</TableHead>
                            <TableHead className="font-semibold">Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comparisonResult.discrepancies.map((d, index) => (
                            <TableRow key={`disc-${index}`} className={`${index % 2 === 0 ? 'bg-transparent' : 'bg-destructive/5'} hover:bg-destructive/10`}>
                              <TableCell className="font-medium">{d.field}</TableCell>
                              <TableCell>{d.purchaseOrderValue}</TableCell>
                              <TableCell>{d.salesOrderValue}</TableCell>
                              <TableCell>{d.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {(!comparisonResult.matchedItems || comparisonResult.matchedItems.length === 0) && 
                 (!comparisonResult.discrepancies || comparisonResult.discrepancies.length === 0) && (
                     <Alert variant="default" className="bg-accent/20 border-accent/50">
                       <FileCheck2 className="h-5 w-5 text-accent-foreground" />
                       <AlertTitle className="text-accent-foreground">No Specific Differences or Matches Identified</AlertTitle>
                       <AlertDescription className="text-accent-foreground/80">
                         The AI could not identify specific itemized matches or discrepancies based on the provided documents, or the documents were identical in all comparable fields. Please check the summary for overall findings.
                       </AlertDescription>
                     </Alert>
                )}
              </div>
            )}
            {!isLoading && !error && !comparisonResult && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center">
                <UploadCloud className="h-16 w-16 text-gray-400 mb-4" />
                <p className="text-lg">Upload document versions (PDF, Image, CSV, Excel) of your purchase order and sales order.</p>
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
  );
}
