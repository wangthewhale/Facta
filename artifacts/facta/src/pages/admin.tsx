import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/layout';
import { isAdmin } from '@/lib/session';
import { 
  useAdminListPending, 
  useAdminVerifySubmission, 
  useAdminRejectSubmission 
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import { Check, X, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    setAuthed(isAdmin());
  }, []);

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    if (authInput === 'admin') {
      localStorage.setItem('facta_admin', 'true');
      setAuthed(true);
    } else {
      toast({ title: 'Invalid admin code', variant: 'destructive' });
    }
  };

  const { data: pending, refetch } = useAdminListPending({ limit: 50 }, {
    query: { enabled: authed }
  });

  const verifyMut = useAdminVerifySubmission();
  const rejectMut = useAdminRejectSubmission();

  const handleVerify = async (id: number) => {
    try {
      await verifyMut.mutateAsync({ id, data: { reviewedBy: 'admin' } });
      toast({ title: 'Approved' });
      refetch();
    } catch (e) {
      toast({ title: 'Error', variant: 'destructive' });
    }
  };

  const handleReject = async (id: number) => {
    const note = prompt("Rejection reason?");
    if (note === null) return;
    try {
      await rejectMut.mutateAsync({ id, data: { reviewedBy: 'admin', note } });
      toast({ title: 'Rejected' });
      refetch();
    } catch (e) {
      toast({ title: 'Error', variant: 'destructive' });
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <form onSubmit={login} className="w-full max-w-sm bg-white p-8">
          <h1 className="text-2xl font-bold text-black mb-6">Admin Access</h1>
          <input 
            type="password" 
            value={authInput}
            onChange={e => setAuthInput(e.target.value)}
            className="w-full p-4 border-2 border-black bg-transparent text-black outline-none font-mono"
            placeholder="Passcode"
          />
          <button type="submit" className="w-full mt-4 p-4 bg-black text-white font-bold uppercase tracking-widest">
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col p-6 max-w-4xl mx-auto">
      <header className="flex justify-between items-center mb-8 border-b border-border pb-4">
        <h1 className="text-3xl font-bold">FACTA Admin</h1>
        <button 
          onClick={() => { localStorage.removeItem('facta_admin'); setAuthed(false); }}
          className="text-xs font-mono uppercase underline"
        >
          Logout
        </button>
      </header>

      <div>
        <h2 className="text-xl font-bold mb-4">Pending Submissions</h2>
        <div className="flex flex-col gap-4">
          {!pending ? (
            <p>Loading...</p>
          ) : pending.length === 0 ? (
            <p className="text-muted-foreground border border-dashed border-border p-8 text-center">Queue is empty</p>
          ) : (
            pending.map(sub => (
              <div key={sub.id} className="border border-border p-4 flex flex-col gap-4 bg-card">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg">{sub.productName}</h3>
                    <p className="text-sm text-muted-foreground">{sub.brandName} • {sub.barcode}</p>
                    <p className="text-xs font-mono mt-1 text-muted-foreground">
                      Submitted: {format(new Date(sub.createdAt), 'yyyy-MM-dd HH:mm')}
                    </p>
                  </div>
                  <span className="px-2 py-1 bg-yellow-500/20 text-yellow-700 text-xs font-bold uppercase tracking-widest">
                    {sub.status}
                  </span>
                </div>
                
                {sub.extractedIngredients && (
                  <div className="bg-background p-3 text-sm font-mono border border-border">
                    <span className="text-xs opacity-50 block mb-1">OCR Ingredients:</span>
                    {sub.extractedIngredients}
                  </div>
                )}

                <div className="flex gap-2 mt-2">
                  <button 
                    onClick={() => handleVerify(sub.id)}
                    className="flex-1 py-2 bg-primary text-primary-foreground font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" /> Approve
                  </button>
                  <button 
                    onClick={() => handleReject(sub.id)}
                    className="flex-1 py-2 border border-destructive text-destructive font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}