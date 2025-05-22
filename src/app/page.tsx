// src/app/page.tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Scale, FileWarning, FileCheck2 } from 'lucide-react';
import { compareOrdersAction } from './actions';
import type { CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import { ExportButton } from '@/components/export-button';

export default function OrderComparatorPage() {
  const [purchaseOrderText, setPurchaseOrderText] = useState('');
  const [salesOrderText, setSalesOrderText] = useState('');
  const [comparisonResult, setComparisonResult] = useState<CompareOrderDetailsOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setComparisonResult(null);

    const formData = new FormData();
    formData.append('purchaseOrder', purchaseOrderText);
    formData.append('salesOrder', salesOrderText);

    const result = await compareOrdersAction(formData);

    if (result.data) {
      setComparisonResult(result.data);
    } else if (result.error) {
      setError(result.error);
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
          AI-powered tool to compare purchase orders and sales orders efficiently.
        </p>
      </header>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Input Order Data</CardTitle>
            <CardDescription>
              Paste the text content of your purchase order and sales order below.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="purchaseOrder" className="text-lg font-medium">Purchase Order</Label>
                <Textarea
                  id="purchaseOrder"
                  value={purchaseOrderText}
                  onChange={(e) => setPurchaseOrderText(e.target.value)}
                  placeholder="Paste purchase order text here..."
                  className="min-h-[150px] text-sm focus:ring-primary focus:border-primary"
                  required
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="salesOrder" className="text-lg font-medium">Sales Order</Label>
                <Textarea
                  id="salesOrder"
                  value={salesOrderText}
                  onChange={(e) => setSalesOrderText(e.target.value)}
                  placeholder="Paste sales order text here..."
                  className="min-h-[150px] text-sm focus:ring-primary focus:border-primary"
                  required
                  disabled={isLoading}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full text-lg py-3" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Comparing...
                  </>
                ) : (
                  'Compare Orders'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Comparison Report</CardTitle>
            <CardDescription>
              Review the comparison summary and detailed discrepancies.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-[300px]">
            {isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                <p className="text-lg">Comparing orders, please wait...</p>
              </div>
            )}
            {error && (
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
                  <p className="text-sm text-muted-foreground bg-secondary p-3 rounded-md">
                    {comparisonResult.summary || 'No summary provided.'}
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-foreground">Discrepancies</h3>
                  {comparisonResult.discrepancies.length > 0 ? (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="font-semibold">Field</TableHead>
                            <TableHead className="font-semibold">Purchase Order Value</TableHead>
                            <TableHead className="font-semibold">Sales Order Value</TableHead>
                            <TableHead className="font-semibold">Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comparisonResult.discrepancies.map((d, index) => (
                            <TableRow key={index} className="bg-destructive/10 hover:bg-destructive/20">
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
                         The AI found no discrepancies between the provided orders.
                       </AlertDescription>
                     </Alert>
                  )}
                </div>
              </div>
            )}
            {!isLoading && !error && !comparisonResult && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <p className="text-lg">Enter order data and click "Compare Orders" to see the results.</p>
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
