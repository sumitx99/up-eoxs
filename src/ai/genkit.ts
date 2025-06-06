
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

// Ensure GOOGLE_API_KEY is being used for Genkit initialization.
// The googleAI() plugin will look for GEMINI_API_KEY or GOOGLE_API_KEY
// in the environment if no apiKey is explicitly passed.
// Making it explicit here for clarity, though not strictly necessary for default behavior.
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey && process.env.NODE_ENV !== 'development') { // Stricter check for non-dev environments
  // In development, dotenv might load it later, but for production/deployment, it must be set.
  // However, Genkit's googleAI() plugin handles the error if key is missing, so this is more for emphasis.
  console.warn(
    'GOOGLE_API_KEY or GEMINI_API_KEY is not set. Genkit will likely fail to initialize Google AI plugin unless it finds one.'
  );
}

export const ai = genkit({
  plugins: [googleAI({ apiKey })], // Explicitly passing the apiKey
  model: 'googleai/gemini-1.5-flash-latest', // Reverted to Gemini 1.5 Flash
});
