
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { BudgetYear, MonthBudget, Category, Transaction, MonthStatus } from './types';
import { loadLocalYearData, saveLocalYearData, syncWithSupabase } from './services/storage';
import { MONTH_NAMES } from './constants';
import Modal from './components/Modal';
import { getBudgetInsights } from './services/gemini';
import { supabase } from './services/supabase';

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const ProgressBar = ({ current, total }: { current: number; total: number }) => {
  const percentage = total <= 0 ? 0 : Math.min(Math.max((current / total) * 100, 0), 100);
  const color = percentage >= 100 ? 'bg-red-500' : percentage > 85 ? 'bg-orange-400' : 'bg-[#FFA500]';
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div 
        className={`h-full transition-all duration-500 ${color}`} 
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

const App: React.FC = () => {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [yearData, setYearData] = useState<BudgetYear>(loadLocalYearData(currentYear));
  const [activeView, setActiveView] = useState<'YEARLY' | 'DETAIL' | 'REPORT'>('YEARLY');
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(new Date().getMonth());
  
  // Auth State
  const [session, setSession] = useState<any>(null);
  const [authView, setAuthView] = useState<'LANDING' | 'SIGNUP' | 'LOGIN'>('LANDING');
  const [authLoading, setAuthLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Auth Forms
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  // Modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false); 
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [isEditTotalModalOpen, setIsEditTotalModalOpen] = useState(false);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  // Forms
  const [expenseForm, setExpenseForm] = useState({ amount: '', note: '', date: new Date().toISOString().split('T')[0] });
  const [transferForm, setTransferForm] = useState({ amount: '', fromCategoryId: '', note: '' });
  const [topUpForm, setTopUpForm] = useState({ amount: '', note: '' });
  const [editTotalValue, setEditTotalValue] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatAmount, setNewCatAmount] = useState('');
  
  const [setupNote, setSetupNote] = useState<string>('');
  const [setupCategories, setSetupCategories] = useState<{name: string, amount: string}[]>([]);
  const computedSetupTotal = useMemo(() => setupCategories.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0), [setupCategories]);

  const [insights, setInsights] = useState<string | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  // Initialize Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) handlePostLoginSync(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) handlePostLoginSync(session.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handlePostLoginSync = async (user: any) => {
    setSyncing(true);
    try {
      const name = user.user_metadata?.full_name;
      if (name) {
        const cloudData = await syncWithSupabase(name, yearData, true);
        setYearData(cloudData);
      }
    } catch (e) {
      console.error("Initial sync error", e);
    } finally {
      setSyncing(false);
    }
  };

  const performSync = useCallback(async (data: BudgetYear) => {
    if (!session) return;
    setSyncing(true);
    try {
      const name = session.user.user_metadata?.full_name;
      await syncWithSupabase(name, data, false);
    } catch (e) {
      console.error("Sync error:", e);
    } finally {
      setSyncing(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      saveLocalYearData(yearData);
      const timeout = setTimeout(() => performSync(yearData), 1500);
      return () => clearTimeout(timeout);
    }
  }, [yearData, performSync, session]);

  // Auth Handlers
  const handleSignUp = async () => {
    if (!nameInput || !emailInput || !passwordInput) return alert("Please fill all fields.");
    setAuthLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: emailInput.toLowerCase().trim(),
        password: passwordInput,
        options: { data: { full_name: nameInput.trim() } }
      });
      if (error) throw error;
      
      if (data.user) {
        // Link Name to Email for resolution
        await supabase.from('budgets').upsert({
          identifier: nameInput.trim().toLowerCase(),
          email: emailInput.toLowerCase().trim(),
          user_id: data.user.id,
          data: yearData
        }, { onConflict: 'identifier' });

        if (data.session) {
          setSession(data.session);
        } else {
          alert("Success! You can now log in with your Name and Password.");
          setAuthView('LOGIN');
        }
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!nameInput || !passwordInput) return alert("Enter name and password.");
    setAuthLoading(true);
    try {
      const { data, error: lookupError } = await supabase
        .from('budgets')
        .select('email')
        .eq('identifier', nameInput.trim().toLowerCase())
        .single();
      
      if (lookupError || !data?.email) {
        throw new Error("Name not found. Did you register?");
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: passwordInput
      });
      if (loginError) throw loginError;
      
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setAuthView('LANDING');
    setNameInput('');
    setEmailInput('');
    setPasswordInput('');
  };

  // Logic Handlers
  const currentMonth = yearData.months[selectedMonthIndex];

  const handleYearChange = (newYear: number) => {
    setCurrentYear(newYear);
    const data = loadLocalYearData(newYear);
    setYearData(data);
  };

  const handleCopyPlan = () => {
    const nextMonthIndex = selectedMonthIndex + 1;
    if (nextMonthIndex > 11) {
      alert("Plan copying across years is not yet implemented.");
      return;
    }
    const nextMonth = yearData.months[nextMonthIndex];
    if (nextMonth.status !== 'NOT_STARTED' && !window.confirm("Overwrite next month's setup?")) return;
    const copiedCategories: Category[] = currentMonth.categories.map(c => ({
      ...c,
      id: Math.random().toString(36).substr(2, 9),
      transactions: []
    }));
    const newMonths = [...yearData.months];
    newMonths[nextMonthIndex] = {
      ...nextMonth,
      status: 'ACTIVE',
      totalBudget: currentMonth.totalBudget,
      note: currentMonth.note,
      categories: copiedCategories
    };
    const updated = { ...yearData, months: newMonths };
    setYearData(updated);
    setSelectedMonthIndex(nextMonthIndex);
    setActiveView('DETAIL');
  };

  const updateMonth = useCallback((updatedMonth: MonthBudget) => {
    setYearData(prev => ({
      ...prev,
      months: prev.months.map((m, i) => i === selectedMonthIndex ? updatedMonth : m)
    }));
  }, [selectedMonthIndex]);

  const handleSetBudget = (mIndex: number) => {
    setSelectedMonthIndex(mIndex);
    setSetupNote('');
    setSetupCategories([{ name: '', amount: '' }]);
    setIsSetupModalOpen(true);
  };

  const finalizeSetup = () => {
    const validCategories = setupCategories.filter(sc => sc.name.trim() !== '' && (parseFloat(sc.amount) || 0) > 0);
    if (validCategories.length === 0) return;
    const newCategories: Category[] = validCategories.map(sc => ({
      id: Math.random().toString(36).substr(2, 9),
      name: sc.name.trim(),
      icon: sc.name.trim(),
      allocatedAmount: parseFloat(sc.amount) || 0,
      transactions: []
    }));
    updateMonth({
      ...currentMonth,
      status: 'ACTIVE',
      totalBudget: computedSetupTotal,
      note: setupNote.trim(),
      categories: newCategories
    });
    setIsSetupModalOpen(false);
    setActiveView('DETAIL');
  };

  const fetchInsights = useCallback(async (month: MonthBudget) => {
    setLoadingInsights(true);
    try {
      const result = await getBudgetInsights(month);
      setInsights(result);
    } catch (error) {
      setInsights("Insights currently unavailable.");
    } finally {
      setLoadingInsights(false);
    }
  }, []);

  const handleAddNewCategory = () => {
    const amount = parseFloat(newCatAmount) || 0;
    if (!newCatName.trim()) return;
    const newCat: Category = { id: Math.random().toString(36).substr(2, 9), name: newCatName.trim(), icon: newCatName.trim(), allocatedAmount: amount, transactions: [] };
    updateMonth({ ...currentMonth, categories: [...currentMonth.categories, newCat], totalBudget: currentMonth.totalBudget + amount });
    setIsAddCategoryModalOpen(false);
    setNewCatName('');
    setNewCatAmount('');
  };

  const deleteCategory = (id: string) => {
    if (!window.confirm("Delete envelope?")) return;
    const cat = currentMonth.categories.find(c => c.id === id);
    if (!cat) return;
    updateMonth({ ...currentMonth, categories: currentMonth.categories.filter(c => c.id !== id), totalBudget: currentMonth.totalBudget - cat.allocatedAmount });
  };

  const moveCategory = (id: string, direction: 'UP' | 'DOWN') => {
    const index = currentMonth.categories.findIndex(c => c.id === id);
    if (index < 0) return;
    const newCategories = [...currentMonth.categories];
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newCategories.length) return;
    const [removed] = newCategories.splice(index, 1);
    newCategories.splice(targetIndex, 0, removed);
    updateMonth({ ...currentMonth, categories: newCategories });
  };

  const addExpense = () => {
    if (!selectedCategory || !expenseForm.amount) return;
    const amount = parseFloat(expenseForm.amount);
    const newTransaction: Transaction = { id: Math.random().toString(36).substr(2, 9), date: expenseForm.date, description: expenseForm.note.trim() || 'Expense', amount, type: 'EXPENSE' };
    const updatedCategories = currentMonth.categories.map(c => c.id === selectedCategory.id ? { ...c, transactions: [...c.transactions, newTransaction] } : c );
    updateMonth({ ...currentMonth, categories: updatedCategories });
    setIsExpenseModalOpen(false);
    setExpenseForm({ amount: '', note: '', date: new Date().toISOString().split('T')[0] });
  };

  const handleTopUp = () => {
    if (!selectedCategory || !topUpForm.amount) return;
    const amount = parseFloat(topUpForm.amount);
    const inTrans: Transaction = { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString().split('T')[0], description: topUpForm.note.trim() || `Add +$${amount}`, amount, type: 'TRANSFER_IN' };
    const updatedCategories = currentMonth.categories.map(c => c.id === selectedCategory.id ? { ...c, allocatedAmount: c.allocatedAmount + amount, transactions: [...c.transactions, inTrans] } : c );
    updateMonth({ ...currentMonth, categories: updatedCategories, totalBudget: currentMonth.totalBudget + amount });
    setIsTopUpModalOpen(false);
    setTopUpForm({ amount: '', note: '' });
  };

  const handleTransfer = () => {
    if (!selectedCategory || !transferForm.amount || !transferForm.fromCategoryId) return;
    const amount = parseFloat(transferForm.amount);
    const fromCat = currentMonth.categories.find(c => c.id === transferForm.fromCategoryId);
    if (!fromCat) return;
    const note = transferForm.note.trim();
    const outTrans: Transaction = { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString().split('T')[0], description: note ? `Out: ${note}` : `To ${selectedCategory.name}`, amount, type: 'TRANSFER_OUT' };
    const inTrans: Transaction = { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString().split('T')[0], description: note ? `In: ${note}` : `From ${fromCat.name}`, amount, type: 'TRANSFER_IN' };
    const updatedCategories = currentMonth.categories.map(c => {
      if (c.id === fromCat.id) return { ...c, allocatedAmount: c.allocatedAmount - amount, transactions: [...c.transactions, outTrans] };
      if (c.id === selectedCategory.id) return { ...c, allocatedAmount: c.allocatedAmount + amount, transactions: [...c.transactions, inTrans] };
      return c;
    });
    updateMonth({ ...currentMonth, categories: updatedCategories });
    setIsTransferModalOpen(false);
    setTransferForm({ amount: '', fromCategoryId: '', note: '' });
  };

  const getTotalSpent = (month: MonthBudget) => month.categories.reduce((acc, cat) => acc + cat.transactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0), 0);
  const getCategorySpent = (cat: Category) => cat.transactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);

  const chartData = currentMonth.categories.map(c => ({ name: c.name, value: getCategorySpent(c) || 0.0001 }));
  const COLORS = ['#FFA500', '#FF8C00', '#FF7F50', '#FF6347', '#FF4500', '#CD853F', '#D2691E'];

  // SCREEN: AUTH
  if (!session) {
    if (authView === 'SIGNUP') {
      return (
        <div className="app-container bg-white p-8 flex flex-col animate-in slide-in-from-bottom duration-500">
          <button onClick={() => setAuthView('LANDING')} className="self-start text-xs font-bold text-gray-400 uppercase mb-8 tracking-widest">Back</button>
          <h2 className="text-4xl font-bold text-gray-900 tracking-tighter mb-2">Create Account</h2>
          <p className="text-gray-400 font-medium mb-10 text-sm">Secure your budget with mango.</p>
          <div className="space-y-4 flex-1">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Your Full Name</label>
              <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="e.g. Alex" className="w-full p-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-bold" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Email Address</label>
              <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="hello@mango.com" className="w-full p-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-bold" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Secure Password</label>
              <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="••••••••" className="w-full p-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-bold" />
            </div>
          </div>
          <div className="pt-8 space-y-4">
            <button disabled={authLoading} onClick={handleSignUp} className="w-full py-5 bg-[#FFA500] text-white rounded-[2rem] font-bold text-lg shadow-xl active:scale-95 transition-all">
              {authLoading ? 'Registering...' : 'Register'}
            </button>
            <button onClick={() => setAuthView('LOGIN')} className="w-full py-2 text-[11px] font-bold text-orange-500 uppercase tracking-[0.2em]">Have an account? Log In</button>
          </div>
        </div>
      );
    }

    if (authView === 'LOGIN') {
      return (
        <div className="app-container bg-white p-8 flex flex-col animate-in slide-in-from-bottom duration-500">
          <button onClick={() => setAuthView('LANDING')} className="self-start text-xs font-bold text-gray-400 uppercase mb-8 tracking-widest">Back</button>
          <h2 className="text-4xl font-bold text-gray-900 tracking-tighter mb-2">Welcome Back</h2>
          <p className="text-gray-400 font-medium mb-10 text-sm">Log in with your name and password.</p>
          <div className="space-y-4 flex-1">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Your Name</label>
              <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Name used at signup" className="w-full p-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-bold" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Password</label>
              <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="••••••••" className="w-full p-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-bold" />
            </div>
          </div>
          <div className="pt-8 space-y-4">
            <button disabled={authLoading} onClick={handleLogin} className="w-full py-5 bg-[#FFA500] text-white rounded-[2rem] font-bold text-lg shadow-xl active:scale-95 transition-all">
              {authLoading ? 'Verifying...' : 'Log In'}
            </button>
            <button onClick={() => setAuthView('SIGNUP')} className="w-full py-2 text-[11px] font-bold text-orange-500 uppercase tracking-[0.2em]">New here? Register</button>
          </div>
        </div>
      );
    }

    return (
      <div className="app-container bg-[#FFA500] flex flex-col items-center justify-center p-12 text-center text-white">
        <h1 className="text-8xl font-bold tracking-tighter mb-4">mango</h1>
        <p className="text-white/80 font-medium text-lg leading-relaxed mb-16 px-4">
          Simple envelope budgeting.
        </p>
        <div className="w-full space-y-4 animate-in slide-in-from-bottom duration-700">
          <button onClick={() => setAuthView('SIGNUP')} className="w-full py-5 bg-white text-[#FFA500] rounded-[2rem] font-bold text-xl shadow-2xl active:scale-95 transition-all">
            Get Started
          </button>
          <button onClick={() => setAuthView('LOGIN')} className="w-full py-4 bg-white/10 text-white rounded-[2rem] font-bold text-sm border border-white/20 active:bg-white/20 transition-all">Log In</button>
        </div>
      </div>
    );
  }

  // SCREEN: MAIN
  return (
    <div className="app-container animate-in fade-in duration-300">
      <header className="sticky top-0 z-40 bg-[#FFA500] text-white px-5 py-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          {activeView !== 'YEARLY' && (
            <button onClick={() => setActiveView('YEARLY')} className="text-xs font-bold uppercase tracking-widest hover:bg-white/10 px-2 py-1 rounded">Back</button>
          )}
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold cursor-pointer" onClick={() => setActiveView('YEARLY')}>mango</h1>
            {syncing && <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">Syncing</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full">
            <button onClick={() => handleYearChange(yearData.year - 1)} className="text-xs font-bold hover:bg-white/20 px-1 rounded">&lt;</button>
            <span className="text-xs font-bold">{yearData.year}</span>
            <button onClick={() => handleYearChange(yearData.year + 1)} className="text-xs font-bold hover:bg-white/20 px-1 rounded">&gt;</button>
          </div>
          <button onClick={handleSignOut} className="text-xs font-bold uppercase tracking-widest bg-white/10 px-3 py-2 rounded-full hover:bg-white/20">Logout</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-5 pt-4 pb-28">
        {activeView === 'YEARLY' && (
          <div className="space-y-6">
            <div className="px-1">
              <h2 className="text-2xl font-bold text-gray-900">Hello, {session.user.user_metadata?.full_name}</h2>
              <p className="text-gray-400 font-medium text-sm">Secure storage active.</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {yearData.months.map((m, idx) => {
                const spent = getTotalSpent(m);
                const isCurrent = idx === new Date().getMonth() && yearData.year === new Date().getFullYear();
                return (
                  <div key={idx} onClick={() => { setSelectedMonthIndex(idx); if (m.status !== 'NOT_STARTED') setActiveView('DETAIL'); else handleSetBudget(idx); }} className={`p-5 rounded-3xl border transition-all active:scale-[0.98] ${isCurrent ? 'border-[#FFA500] bg-orange-50/30' : 'border-gray-100 bg-white'} flex items-center justify-between shadow-sm cursor-pointer`}>
                    <div><h3 className="text-lg font-bold text-gray-800">{MONTH_NAMES[idx]}</h3><div className="text-sm font-medium text-gray-400 mt-1 uppercase tracking-widest text-[10px]">{m.status === 'NOT_STARTED' ? 'Not started' : m.status === 'ACTIVE' ? 'Ongoing' : 'Finished'}</div></div>
                    {m.status === 'NOT_STARTED' ? (
                      <button className="bg-[#FFA500] text-white px-5 py-2.5 rounded-2xl font-bold text-xs shadow-lg shadow-orange-200">Setup</button>
                    ) : (
                      <div className="text-right"><div className="text-sm font-bold text-gray-900">${spent.toFixed(0)}</div><div className="text-xs font-medium text-gray-400">of ${m.totalBudget.toFixed(0)}</div></div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeView === 'DETAIL' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center px-1">
              <div><h2 className="text-2xl font-bold text-gray-900">{MONTH_NAMES[selectedMonthIndex]}</h2><p className="text-gray-400 text-sm font-medium uppercase tracking-widest text-[10px]">Management</p></div>
              <button onClick={() => { const nextStatus: MonthStatus = currentMonth.status === 'COMPLETED' ? 'ACTIVE' : 'COMPLETED'; updateMonth({ ...currentMonth, status: nextStatus }); if (nextStatus === 'COMPLETED') { setActiveView('REPORT'); fetchInsights(currentMonth); } }} className={`px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-widest ${currentMonth.status === 'COMPLETED' ? 'bg-gray-100 text-gray-400' : 'bg-green-500 text-white'}`}>{currentMonth.status === 'COMPLETED' ? 'Unlock' : 'Finalize'}</button>
            </div>
            <div className="bg-gray-50 p-7 rounded-[2.5rem] border border-gray-100 relative overflow-hidden">
              <button onClick={() => { setEditTotalValue(currentMonth.totalBudget.toString()); setIsEditTotalModalOpen(true); }} className="absolute top-6 right-6 px-3 py-1 bg-white rounded-full shadow-sm text-gray-400 hover:text-[#FFA500] text-[10px] font-bold uppercase tracking-widest">Edit</button>
              <div className="flex flex-col mb-6">
                <span className="text-sm font-medium text-gray-400 mb-1 uppercase tracking-widest text-[10px]">Expenditure progress</span>
                <div className="flex items-baseline gap-2"><span className="text-4xl font-bold text-gray-900">${getTotalSpent(currentMonth).toFixed(2)}</span><span className="text-gray-300 font-bold text-lg">/ ${currentMonth.totalBudget.toFixed(0)}</span></div>
                {currentMonth.note && <div className="mt-2 text-sm text-gray-500 font-medium">Source: {currentMonth.note}</div>}
              </div>
              <ProgressBar current={getTotalSpent(currentMonth)} total={currentMonth.totalBudget} />
            </div>
            <div className="space-y-4">
              {currentMonth.categories.map((cat, index) => {
                const spent = getCategorySpent(cat);
                const remaining = cat.allocatedAmount - spent;
                return (
                  <div key={cat.id} className="bg-white border border-gray-100 p-5 rounded-[2rem] shadow-sm relative group">
                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => moveCategory(cat.id, 'UP')} className="px-2 py-1 bg-gray-50 text-gray-400 rounded-lg hover:text-[#FFA500] text-[9px] font-bold uppercase" disabled={index === 0}>Up</button>
                      <button onClick={() => moveCategory(cat.id, 'DOWN')} className="px-2 py-1 bg-gray-50 text-gray-400 rounded-lg hover:text-[#FFA500] text-[9px] font-bold uppercase" disabled={index === currentMonth.categories.length - 1}>Down</button>
                      <button onClick={() => deleteCategory(cat.id)} className="px-2 py-1 bg-gray-50 text-gray-300 rounded-lg hover:text-red-500 text-[9px] font-bold uppercase">Del</button>
                    </div>
                    <div className="flex items-center justify-between mb-4 cursor-pointer pr-16" onClick={() => { setSelectedCategory(cat); setIsHistoryModalOpen(true); }}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-orange-100 text-[#FFA500] rounded-2xl flex items-center justify-center font-bold text-lg">{cat.name.charAt(0).toUpperCase()}</div>
                        <div><div className="font-bold text-gray-800 text-sm tracking-tight">{cat.name}</div><div className="text-xs text-gray-400 font-medium">${cat.allocatedAmount.toFixed(0)} Allocated</div></div>
                      </div>
                      <div className="text-right"><div className={`text-lg font-bold ${remaining < 0 ? 'text-red-500' : 'text-gray-900'}`}>${remaining.toFixed(2)}</div><div className="text-xs text-gray-400 font-medium uppercase tracking-widest text-[10px]">Left</div></div>
                    </div>
                    <ProgressBar current={spent} total={cat.allocatedAmount} />
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => { setSelectedCategory(cat); setIsExpenseModalOpen(true); }} className="flex-1 py-2.5 bg-gray-50 rounded-xl text-[11px] font-bold text-gray-600 active:bg-orange-50 active:text-[#FFA500] uppercase tracking-widest">Expense</button>
                      <button onClick={() => { setSelectedCategory(cat); setIsTransferModalOpen(true); }} className="flex-1 py-2.5 bg-gray-50 rounded-xl text-[11px] font-bold text-gray-600 active:bg-blue-50 active:text-blue-600 uppercase tracking-widest">Transfer</button>
                      <button onClick={() => { setSelectedCategory(cat); setIsTopUpModalOpen(true); }} className="flex-1 py-2.5 bg-gray-50 rounded-xl text-[11px] font-bold text-gray-600 active:bg-green-50 active:text-green-600 uppercase tracking-widest">Add on</button>
                    </div>
                  </div>
                );
              })}
              <button onClick={() => setIsAddCategoryModalOpen(true)} className="w-full py-5 border-2 border-dashed border-gray-100 rounded-[2rem] flex items-center justify-center gap-3 text-gray-300 font-bold text-xs active:border-orange-200 active:text-orange-300 transition-colors uppercase tracking-widest">New envelope</button>
            </div>
            <button onClick={() => { setActiveView('REPORT'); fetchInsights(currentMonth); }} className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-bold text-sm shadow-2xl active:scale-[0.98] transition-all uppercase tracking-widest">Generate report</button>
          </div>
        )}

        {activeView === 'REPORT' && (
          <div className="space-y-8">
            <div className="text-center pt-4"><h2 className="text-3xl font-bold text-gray-900">Analysis</h2><p className="text-gray-400 font-medium text-xs mt-1 uppercase tracking-widest">{MONTH_NAMES[selectedMonthIndex]} {yearData.year}</p></div>
            <div className="bg-gray-50 p-8 rounded-[3rem] border border-gray-100">
              <h3 className="text-xs font-bold text-gray-400 uppercase mb-6 tracking-widest">Strategy notes</h3>
              {loadingInsights ? (<div className="animate-pulse space-y-3"><div className="h-4 bg-gray-200 rounded w-full"></div><div className="h-4 bg-gray-200 rounded w-5/6"></div><div className="h-4 bg-gray-200 rounded w-4/6"></div></div>) : (
                <div className="text-sm text-gray-700 leading-relaxed font-normal text-justify">{insights || "Analysis results will appear here."}</div>
              )}
            </div>
            <div className="h-64 w-full bg-white rounded-[2rem] border border-gray-100 p-6 shadow-sm">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartData} cx="50%" cy="50%" innerRadius={70} outerRadius={90} paddingAngle={4} dataKey="value">{chartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><RechartsTooltip /></PieChart></ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-4 px-1"><div className="bg-gray-50 p-5 rounded-3xl border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-widest">Allocated</div><div className="text-xl font-bold text-gray-900">${currentMonth.totalBudget.toFixed(2)}</div></div><div className="bg-gray-50 p-5 rounded-3xl border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-widest">Spent</div><div className="text-xl font-bold text-gray-900">${getTotalSpent(currentMonth).toFixed(2)}</div></div></div>
            <button onClick={handleCopyPlan} className="w-full py-5 border-2 border-[#FFA500]/20 text-[#FFA500] rounded-[2rem] font-bold text-xs flex items-center justify-center gap-3 active:bg-orange-50 uppercase tracking-widest">Copy to next month</button>
          </div>
        )}
      </main>

      {/* MODALS */}
      <Modal isOpen={isSetupModalOpen} onClose={() => setIsSetupModalOpen(false)} title={`Setup: ${MONTH_NAMES[selectedMonthIndex]}`}>
        <div className="space-y-8">
          <div className="bg-gray-50 p-8 rounded-[3rem] border border-gray-100 flex flex-col items-center">
            <div className="text-xs font-bold text-gray-400 uppercase mb-1 tracking-widest">Total Budget</div>
            <div className="text-5xl font-bold text-[#FFA500] tracking-tight">${computedSetupTotal.toFixed(2)}</div>
            <div className="mt-6 w-full"><label className="text-[10px] font-bold text-gray-400 uppercase mb-1.5 block ml-1 text-center tracking-widest">Source of budget</label><input type="text" placeholder="e.g. Monthly Salary" value={setupNote} onChange={(e) => setSetupNote(e.target.value)} className="w-full p-4 bg-white rounded-2xl text-sm font-bold border border-gray-100 outline-none focus:ring-2 focus:ring-[#FFA500] text-center" /></div>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center px-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Initial envelopes</label><button onClick={() => setSetupCategories([...setupCategories, { name: '', amount: '' }])} className="text-[#FFA500] font-bold text-[10px] uppercase tracking-widest">+ Add entry</button></div>
            <div className="max-h-72 overflow-y-auto space-y-3 pr-2 scrollbar-none">{setupCategories.map((sc, i) => (<div key={i} className="flex gap-2 items-center"><input type="text" placeholder="Name" value={sc.name} onChange={(e) => { const newCats = [...setupCategories]; newCats[i].name = e.target.value; setSetupCategories(newCats); }} className="flex-1 p-3.5 bg-gray-50 rounded-2xl text-xs font-bold border border-transparent focus:border-gray-200 outline-none" /><input type="number" placeholder="$" value={sc.amount} onChange={(e) => { const newCats = [...setupCategories]; newCats[i].amount = e.target.value; setSetupCategories(newCats); }} className="w-24 p-3.5 bg-gray-50 rounded-2xl text-xs font-bold text-right border border-transparent focus:border-gray-200 outline-none" /><button onClick={() => setSetupCategories(setupCategories.filter((_, idx) => idx !== i))} className="px-2 py-1 text-gray-300 hover:text-red-400 text-[10px] font-bold uppercase tracking-widest">Del</button></div>))}</div>
          </div>
          <button onClick={finalizeSetup} className="w-full py-5 bg-[#FFA500] text-white rounded-[2rem] font-bold text-sm shadow-2xl active:scale-95 transition-transform uppercase tracking-widest">Start Planning</button>
        </div>
      </Modal>

      <Modal isOpen={isTopUpModalOpen} onClose={() => setIsTopUpModalOpen(false)} title={`Add to ${selectedCategory?.name}`}>
        <div className="space-y-6">
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Additional Funds ($)</label><input type="number" autoFocus value={topUpForm.amount} onChange={(e) => setTopUpForm({ ...topUpForm, amount: e.target.value })} placeholder="0.00" className="w-full p-4 bg-gray-50 rounded-2xl text-3xl font-bold outline-none border border-transparent focus:border-orange-200" /></div>
          <button onClick={handleTopUp} className="w-full py-5 bg-[#FFA500] text-white rounded-[2rem] font-bold text-sm shadow-xl uppercase tracking-widest">Confirm add on</button>
        </div>
      </Modal>

      <Modal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} title="Record expense">
        <div className="space-y-6">
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Amount ($)</label><input type="number" autoFocus value={expenseForm.amount} onInput={(e: any) => setExpenseForm({...expenseForm, amount: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl text-3xl font-bold outline-none border border-transparent focus:border-orange-200" placeholder="0.00" /></div>
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Detail</label><textarea value={expenseForm.note} onChange={(e) => setExpenseForm({...expenseForm, note: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl text-sm font-medium h-28 resize-none outline-none border border-transparent focus:border-orange-200" placeholder="What was this for?" /></div>
          <button onClick={addExpense} className="w-full py-5 bg-[#FFA500] text-white rounded-[2rem] font-bold text-sm shadow-xl uppercase tracking-widest">Save record</button>
        </div>
      </Modal>

      <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title="Transfer funds">
        <div className="space-y-6">
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Amount ($)</label><input type="number" autoFocus value={transferForm.amount} onChange={(e) => setTransferForm({...transferForm, amount: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl text-3xl font-bold outline-none border border-transparent focus:border-orange-200" placeholder="0.00" /></div>
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Source envelope</label><select value={transferForm.fromCategoryId} onChange={(e) => setTransferForm({...transferForm, fromCategoryId: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl text-sm font-bold outline-none border border-transparent focus:border-orange-200 appearance-none"><option value="">Choose source...</option>{currentMonth.categories.filter(c => c.id !== selectedCategory?.id).map(c => (<option key={c.id} value={c.id}>{c.name} (${ (c.allocatedAmount - getCategorySpent(c)).toFixed(2) } free)</option>))}</select></div>
          <button onClick={handleTransfer} className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-bold text-sm shadow-xl uppercase tracking-widest">Complete transfer</button>
        </div>
      </Modal>

      <Modal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} title={selectedCategory?.name || 'History'}>
        <div className="space-y-6">
          <div className="flex justify-between items-center p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
            <div><div className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-widest">Budget</div><div className="text-xl font-bold text-gray-900">${selectedCategory?.allocatedAmount.toFixed(2)}</div></div>
            <div className="text-right"><div className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-widest">Spent</div><div className="text-xl font-bold text-gray-900">${selectedCategory ? getCategorySpent(selectedCategory).toFixed(2) : '0.00'}</div></div>
          </div>
          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase px-1 tracking-widest">History</h4>
            {selectedCategory?.transactions.length === 0 ? (<p className="text-center py-12 text-xs text-gray-300 italic">No entries</p>) : (
              selectedCategory?.transactions.slice().reverse().map(t => (
                <div key={t.id} className="p-4 border-b border-gray-50 flex justify-between items-start gap-4"><div><div className="text-sm font-bold text-gray-800 leading-tight">{t.description}</div><div className="text-[10px] text-gray-400 mt-1">{formatDate(t.date)}</div></div><div className={`text-sm font-bold ${t.type === 'EXPENSE' ? 'text-gray-900' : t.type === 'TRANSFER_IN' ? 'text-green-600' : 'text-blue-600'}`}>{t.type === 'EXPENSE' ? '-' : t.type === 'TRANSFER_IN' ? '+' : '-'}${t.amount.toFixed(2)}</div></div>
              ))
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={isAddCategoryModalOpen} onClose={() => setIsAddCategoryModalOpen(false)} title="New Envelope">
        <div className="space-y-6">
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Name</label><input type="text" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl text-sm font-bold border border-transparent focus:border-orange-200 outline-none" placeholder="e.g. Subscriptions" /></div>
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Amount ($)</label><input type="number" value={newCatAmount} onChange={(e) => setNewCatAmount(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl text-sm font-bold border border-transparent focus:border-orange-200 outline-none" placeholder="0.00" /></div>
          <button onClick={handleAddNewCategory} className="w-full py-5 bg-[#FFA500] text-white rounded-[2rem] font-bold text-sm shadow-xl uppercase tracking-widest">Create</button>
        </div>
      </Modal>

      <Modal isOpen={isEditTotalModalOpen} onClose={() => setIsEditTotalModalOpen(false)} title="Edit Budget">
        <div className="space-y-6">
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1 tracking-widest">Monthly Total ($)</label><input type="number" value={editTotalValue} onChange={(e) => setEditTotalValue(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl text-3xl font-bold border border-transparent focus:border-orange-200 outline-none" /></div>
          <button onClick={() => { updateMonth({ ...currentMonth, totalBudget: parseFloat(editTotalValue) || 0 }); setIsEditTotalModalOpen(false); }} className="w-full py-5 bg-[#FFA500] text-white rounded-[2rem] font-bold text-sm shadow-xl uppercase tracking-widest">Save Changes</button>
        </div>
      </Modal>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white border-t border-gray-100 px-8 py-5 flex justify-around items-center z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.03)] rounded-t-[2.5rem]">
        <button onClick={() => setActiveView('YEARLY')} className={`flex flex-col items-center gap-1.5 transition-all ${activeView === 'YEARLY' ? 'text-[#FFA500] scale-110' : 'text-gray-300'}`}><span className="text-[11px] font-bold uppercase tracking-widest">Months</span></button>
        <button onClick={() => { if (currentMonth.status !== 'NOT_STARTED') setActiveView('DETAIL'); else handleSetBudget(selectedMonthIndex); }} className={`flex flex-col items-center gap-1.5 transition-all ${activeView === 'DETAIL' ? 'text-[#FFA500] scale-110' : 'text-gray-300'}`}><span className="text-[11px] font-bold uppercase tracking-widest">Planning</span></button>
        <button onClick={() => { if (currentMonth.status !== 'NOT_STARTED') { setActiveView('REPORT'); fetchInsights(currentMonth); } }} className={`flex flex-col items-center gap-1.5 transition-all ${activeView === 'REPORT' ? 'text-[#FFA500] scale-110' : 'text-gray-300'}`}><span className="text-[11px] font-bold uppercase tracking-widest">Report</span></button>
      </nav>
    </div>
  );
};

export default App;
