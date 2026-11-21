'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** The recovery code, big and copyable. */
export function RecoveryCodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3">
      <KeyRound className="w-5 h-5 text-primary shrink-0" />
      <code className="flex-1 text-lg font-mono font-bold tracking-widest select-all" data-testid="recovery-code">{code}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Copy the code"
        onClick={() => {
          navigator.clipboard?.writeText(code);
          setCopied(true);
        }}
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

/** Shown once after sign up: the user confirms they saved the code before going on. */
export function RecoveryCodeDialog({ code, onDone }: { code: string | null; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Dialog open={!!code} onOpenChange={(open) => !open && saved && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save your recovery code</DialogTitle>
          <DialogDescription>
            If you forget your password, this code and your nickname let you choose a new one. It is shown only now; you can make a new one from your profile.
          </DialogDescription>
        </DialogHeader>
        {code && <RecoveryCodeBox code={code} />}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="accent-primary w-4 h-4" />
          I saved it somewhere safe
        </label>
        <DialogFooter>
          <Button onClick={onDone} disabled={!saved}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
