
import { GoogleGenAI } from "@google/genai";
import { MonthBudget } from "../types";

export const getBudgetInsights = async (monthBudget: MonthBudget): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const categoriesSummary = monthBudget.categories.map(c => {
    const spent = c.transactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((acc, curr) => acc + curr.amount, 0);
    return `${c.name}: Allocated $${c.allocatedAmount.toFixed(2)}, Spent $${spent.toFixed(2)}`;
  }).join('\n');

  const prompt = `
    As a professional financial analyst for the "mango" budget application, provide a formal analysis of the following monthly expenditure data.
    The report must be strictly plain text without any special formatting. 
    Do not use bold text. 
    Do not use italicized text. 
    Do not use emojis. 
    Do not use bullet points, asterisks, or dashes. 
    Do not use any Markdown or decorative symbols. 
    Use only standard, normal sentences and paragraphs.
    The response should be structured as a concise executive summary followed by several professional observations regarding category management and resource allocation.
    
    Financial Data:
    Total Budget Allocation: $${monthBudget.totalBudget.toFixed(2)}
    Reporting Period: Month ${monthBudget.monthIndex + 1}, ${monthBudget.year}
    Category Summaries:
    ${categoriesSummary}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.1, // Minimal variation for maximum consistency
      }
    });
    // Final check to strip any lingering markdown symbols just in case
    return (response.text || "Financial analysis is currently unavailable.").replace(/[*_#`~]/g, '');
  } catch (error) {
    console.error("Gemini Error:", error);
    return "An error occurred while generating the professional summary. Please ensure your budget data is complete.";
  }
};
