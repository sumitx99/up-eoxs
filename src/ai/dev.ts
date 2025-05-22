import { config } from 'dotenv';
config();

import '@/ai/flows/extract-order-details.ts';
import '@/ai/flows/summarize-discrepancies.ts';
import '@/ai/flows/compare-order-details.ts';