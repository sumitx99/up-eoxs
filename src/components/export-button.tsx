// src/components/export-button.tsx
'use client';

import type { CompareOrderDetailsOutput } from '@/ai/flows/compare-order-details';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface ExportButtonProps {
  data: CompareOrderDetailsOutput | null;
  reportId: string; // ID of the HTML element to capture
  className?: string;
}

export function ExportButton({ data, reportId, className }: ExportButtonProps) {
  const handleExport = async () => {
    if (!data) return;

    const reportElement = document.getElementById(reportId);
    if (!reportElement) {
      console.error('Report element not found for PDF export.');
      alert('Could not find report content to export.');
      return;
    }

    // Temporarily set background to white for canvas capture for better PDF output
    const originalBackgroundColor = reportElement.style.backgroundColor;
    reportElement.style.backgroundColor = 'white';
    
    // Add a small delay for any final rendering tweaks if necessary
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const canvas = await html2canvas(reportElement, {
        scale: 2, // Increase scale for better resolution
        useCORS: true, // If there are external images
        backgroundColor: '#ffffff', // Ensure canvas background is white
        onclone: (document) => {
          // This function is called when html2canvas clones the document
          // You can make temporary style changes here that only affect the canvas rendering
          const clonedReportElement = document.getElementById(reportId);
          if (clonedReportElement) {
            // Ensure text is selectable and visible in the PDF
            clonedReportElement.style.color = 'black'; // Example: force black text
          }
        }
      });
      
      reportElement.style.backgroundColor = originalBackgroundColor; // Restore original background

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4'); // A4 size page of PDF (portrait)
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const ratio = canvasWidth / canvasHeight;
      
      let imgWidth = pdfWidth;
      let imgHeight = pdfWidth / ratio;

      // If image height is greater than page height, scale by height
      if (imgHeight > pdfHeight) {
        imgHeight = pdfHeight;
        imgWidth = pdfHeight * ratio;
      }

      let position = 0;
      pdf.addImage(imgData, 'PNG', (pdfWidth - imgWidth)/2, position, imgWidth, imgHeight);
      let heightLeft = imgHeight;

      // Logic for multi-page PDF if content overflows
      // This basic version might need refinement for very long reports
      heightLeft -= pdfHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight; // Recalculate position for next page
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', (pdfWidth - imgWidth)/2, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      pdf.save('comparison_report.pdf');

    } catch (error) {
      console.error("Error generating PDF: ", error);
      alert("Failed to generate PDF report.");
      reportElement.style.backgroundColor = originalBackgroundColor; // Restore original background on error
    }
  };

  return (
    <Button onClick={handleExport} disabled={!data} className={className}>
      <Download className="mr-2 h-4 w-4" />
      Export Report as PDF
    </Button>
  );
}