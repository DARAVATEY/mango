
export type MonthStatus = 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED';

export type TransactionType = 'EXPENSE' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  fromCategory?: string;
  toCategory?: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  allocatedAmount: number;
  transactions: Transaction[];
}

export interface MonthBudget {
  monthIndex: number; // 0-11
  year: number;
  status: MonthStatus;
  totalBudget: number;
  note?: string; // New: To store the source of the budget, e.g., "Salary"
  categories: Category[];
}

export interface BudgetYear {
  year: number;
  months: MonthBudget[];
}
