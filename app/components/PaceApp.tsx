'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from './Icon';
import { Toast } from './shared';
import HomeScreen from './HomeScreen';
import StatsScreen from './StatsScreen';
import SettingsScreen from './SettingsScreen';
import AddSheet from './AddSheet';
import { useStore } from './StoreProvider';
import { Transaction } from '../lib/data';

function BottomNav() {
  const { tab, setTab } = useStore();
  const items = [
    { k: 'stats',    icon: 'stats',    label: 'Stats'    },
    { k: 'home',     icon: 'home',     label: 'Home'     },
    { k: 'settings', icon: 'settings', label: 'Settings' },
  ] as const;
  return (
    <nav className="navbar">
      {items.map(it => (
        <button key={it.k} className={'navbtn' + (tab === it.k ? ' active' : '')} onClick={() => setTab(it.k)}>
          <span className="navdot" />
          <Icon name={it.icon} size={24} sw={tab === it.k ? 2.3 : 2} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function PaceApp() {
  const { tab, setTab, txns } = useStore();
  const [sheet, setSheet] = useState(false);
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [toast, setToast] = useState({ show: false, text: '', icon: 'check' });
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab]);

  const showToast = useCallback((text: string, icon = 'check') => {
    setToast({ show: true, text, icon });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
  }, []);

  const onSaved = useCallback((mode: 'added' | 'updated', type: string, amt: number, cur: string) => {
    const label = type === 'expense' ? 'Expense' : type === 'income' ? 'Income' : 'Investment';
    const action = mode === 'added' ? 'added' : 'updated';
    showToast(`${label} ${action} · ${cur}${amt.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }, [showToast]);

  const onDeleted = useCallback(() => {
    showToast('Transaction deleted', 'trash');
  }, [showToast]);

  const openAdd = useCallback(() => {
    setEditingTxnId(null);
    setSheet(true);
  }, []);

  const openEdit = useCallback((txn: Transaction) => {
    setEditingTxnId(txn.id);
    setSheet(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(false);
    setEditingTxnId(null);
  }, []);

  const editingTxn = editingTxnId
    ? txns.find(txn => txn.id === editingTxnId) || null
    : null;

  return (
    <div className="app-shell">
      <main ref={scrollRef} className="app-content">
        {tab === 'home' && (
          <HomeScreen
            onOpenAdd={openAdd}
            onSignalTap={() => setTab('stats')}
            goStats={() => setTab('stats')}
            onEdit={openEdit}
          />
        )}
        {tab === 'stats' && <StatsScreen onEdit={openEdit} />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      <button
        className={'fab' + (sheet ? ' sheet-open' : '')}
        onClick={() => {
          if (sheet) closeSheet();
          else openAdd();
        }}
        aria-label="Add transaction"
      >
        <span style={{ color: '#fff', display: 'flex' }}>
          <Icon name="plus" size={28} sw={2.6} />
        </span>
      </button>

      <BottomNav />
      <Toast show={toast.show} text={toast.text} icon={toast.icon} />
      <AddSheet
        open={sheet}
        transaction={editingTxn}
        onClose={closeSheet}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  );
}
