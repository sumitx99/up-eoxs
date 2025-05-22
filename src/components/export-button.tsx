// src/components/export-button.tsx
'use client';

import type { CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface ExportButtonProps {
  data: CompareOrderDetailsOutput | null;
  className?: string;
}

export function ExportButton({ data, className }: ExportButtonProps) {
  const handleExport = () => {
    if (!data) return;

    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'comparison_report.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Button onClick={handleExport} disabled={!data} className={className}>
      <Download className="mr-2 h-4 w-4" />
      Export Report
    </Button>
  );
}
