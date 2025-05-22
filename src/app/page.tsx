// src/app/page.tsx
'use client';

import { useState, type FormEvent, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input'; // Changed from Textarea
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Scale, FileWarning, FileCheck2, UploadCloud, FileText } from 'lucide-react';
import { compareOrdersAction } from './actions';
import type { CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import { ExportButton } from '@/components/export-button';
import { useToast } from '@/hooks/use-toast';

export default function OrderComparatorPage() {
  const [purchaseOrderFile, setPurchaseOrderFile] = useState<File | null>(null);
  const [salesOrderFile, setSalesOrderFile] = useState<File | null>(null);
  const [comparisonResult, setComparisonResult] = useState<CompareOrderDetailsOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const purchaseOrderRef = useRef<HTMLInputElement>(null);
  const salesOrderRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, setFile: React.Dispatch<React.SetStateAction<File | null>>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === "application/pdf") {
        setFile(file);
        setError(null); // Clear previous errors
      } else {
        toast({
          variant: "destructive",
          title: "Invalid File Type",
          description: "Please upload a PDF file.",
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
      setError("Please upload both purchase order and sales order PDF files.");
      setIsLoading(false);
      toast({
        variant: "destructive",
        title: "Missing Files",
        description: "Please upload both PDF files to compare.",
      });
      return;
    }

    const formData = new FormData();
    formData.append('purchaseOrder', purchaseOrderFile);
    formData.append('salesOrder', salesOrderFile);

    const result = await compareOrdersAction(formData);

    if (result.data) {
      setComparisonResult(result.data);
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
          AI-powered tool to compare purchase orders and sales orders from PDF files.
        </p>
      </header>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Input Order PDFs</CardTitle>
            <CardDescription>
              Upload your purchase order and sales order PDF files below.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="purchaseOrder" className="text-lg font-medium">Purchase Order PDF</Label>
                <div className="flex items-center space-x-2">
                    <Input
                      id="purchaseOrder"
                      type="file"
                      accept=".pdf"
                      ref={purchaseOrderRef}
                      onChange={(e) => handleFileChange(e, setPurchaseOrderFile)}
                      className="focus:ring-primary focus:border-primary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      required
                      disabled={isLoading}
                    />
                </div>
                 {purchaseOrderFile && (
                  <p className="text-sm text-muted-foreground flex items-center mt-2">
                    <FileText className="h-4 w-4 mr-2 text-green-500" /> Selected: {purchaseOrderFile.name}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="salesOrder" className="text-lg font-medium">Sales Order PDF</Label>
                 <div className="flex items-center space-x-2">
                    <Input
                      id="salesOrder"
                      type="file"
                      accept=".pdf"
                      ref={salesOrderRef}
                      onChange={(e) => handleFileChange(e, setSalesOrderFile)}
                      className="focus:ring-primary focus:border-primary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      required
                      disabled={isLoading}
                    />
                </div>
                {salesOrderFile && (
                  <p className="text-sm text-muted-foreground flex items-center mt-2">
                    <FileText className="h-4 w-4 mr-2 text-green-500" /> Selected: {salesOrderFile.name}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full text-lg py-3" disabled={isLoading || !purchaseOrderFile || !salesOrderFile}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Comparing PDFs...
                  </>
                ) : (
                  <>
                    <UploadCloud className="mr-2 h-5 w-5" />
                    Compare Order PDFs
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
              Review the comparison summary and detailed discrepancies from the PDFs.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-[300px] flex flex-col justify-center">
            {isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                <p className="text-lg">Comparing PDF orders, please wait...</p>
                <p className="text-sm">This may take a moment depending on PDF size and complexity.</p>
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
                  <h3 className="text-xl font-semibold mb-2 text-foreground">Summary</h3>
                  <p className="text-sm text-muted-foreground bg-secondary p-3 rounded-md whitespace-pre-wrap">
                    {comparisonResult.summary || 'No summary provided.'}
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-foreground">Discrepancies</h3>
                  {comparisonResult.discrepancies.length > 0 ? (
                    <div className="border rounded-md overflow-hidden max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-muted/50 sticky top-0">
                          <TableRow>
                            <TableHead className="font-semibold">Field</TableHead>
                            <TableHead className="font-semibold">Purchase Order Value</TableHead>
                            <TableHead className="font-semibold">Sales Order Value</TableHead>
                            <TableHead className="font-semibold">Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comparisonResult.discrepancies.map((d, index) => (
                            <TableRow key={index} className={`${index % 2 === 0 ? 'bg-transparent' : 'bg-destructive/5'} hover:bg-destructive/10`}>
                              <TableCell className="font-medium">{d.field}</TableCell>
                              <TableCell>{d.purchaseOrderValue}</TableCell>
                              <TableCell>{d.salesOrderValue}</TableCell>
                              <TableCell>{d.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                     <Alert variant="default" className="bg-accent/20 border-accent/50">
                       <FileCheck2 className="h-5 w-5 text-accent-foreground" />
                       <AlertTitle className="text-accent-foreground">No Discrepancies Found</AlertTitle>
                       <AlertDescription className="text-accent-foreground/80">
                         The AI found no discrepancies between the provided PDF orders.
                       </AlertDescription>
                     </Alert>
                  )}
                </div>
              </div>
            )}
            {!isLoading && !error && !comparisonResult && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center">
                <UploadCloud className="h-16 w-16 text-gray-400 mb-4" />
                <p className="text-lg">Upload PDF versions of your purchase order and sales order.</p>
                <p className="text-sm">The AI will analyze their content to find discrepancies.</p>
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
