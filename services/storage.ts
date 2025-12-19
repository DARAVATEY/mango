
import { BudgetYear } from '../types';
import { supabase } from './supabase';

const STORAGE_KEY = 'mango_budget_data';

export const saveLocalYearData = (data: BudgetYear) => {
  localStorage.setItem(`${STORAGE_KEY}_${data.year}`, JSON.stringify(data));
};

export const loadLocalYearData = (year: number): BudgetYear => {
  const specificKey = `${STORAGE_KEY}_${year}`;
  const stored = localStorage.getItem(specificKey);
  
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error("Local storage parse error:", e);
    }
  }

  return {
    year,
    months: Array.from({ length: 12 }, (_, i) => ({
      monthIndex: i,
      year,
      status: 'NOT_STARTED',
      totalBudget: 0,
      categories: []
    }))
  };
};

export const syncWithSupabase = async (
  userName: string, 
  localData: BudgetYear, 
  isLoad: boolean = false
): Promise<BudgetYear> => {
  const identifier = userName.toLowerCase().trim();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return localData;

  if (isLoad) {
    const { data, error } = await supabase
      .from('budgets')
      .select('data')
      .eq('identifier', identifier)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error("Cloud fetch error:", error);
      return localData;
    }

    return data?.data || localData;
  } else {
    const { error } = await supabase
      .from('budgets')
      .upsert({
        identifier,
        data: localData,
        user_id: session.user.id,
        email: session.user.email?.toLowerCase().trim(),
        last_updated: new Date().toISOString()
      }, { onConflict: 'identifier' });

    if (error) console.error("Cloud sync error:", error);
    return localData;
  }
};
