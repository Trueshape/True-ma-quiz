'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, Check, AlertCircle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { parseQuizText, IMPORT_FORMAT_EXAMPLE, type ParsedQuiz } from '@/lib/quiz-import';
import { cn } from '@/lib/utils';

export function ImportQuizDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (quiz: ParsedQuiz) => Promise<void>;
}) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleParse = (): ParsedQuiz | null => {
    const result = parseQuizText(text);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setError(null);
    return result.quiz;
  };

  const handlePreview = () => {
    const quiz = handleParse();
    if (quiz) {
      toast({
        title: 'Preview ready',
        description: `"${quiz.title}" — ${quiz.questions.length} question${quiz.questions.length === 1 ? '' : 's'}`,
      });
    }
  };

  const handleImport = async () => {
    const quiz = handleParse();
    if (!quiz) return;
    setImporting(true);
    try {
      await onImport(quiz);
      setText('');
      setError(null);
      onOpenChange(false);
    } catch {
      // error toast handled by caller
    } finally {
      setImporting(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result || ''));
      setError(null);
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setText(''); setError(null); setShowFormat(false); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import quiz from text</DialogTitle>
          <DialogDescription>
            Paste a quiz in text format or upload a .txt file. Questions are created automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.text"
              onChange={handleFile}
              className="hidden"
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
              <Upload className="w-3.5 h-3.5" /> Upload file
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowFormat((s) => !s)} className="gap-1.5">
              <Eye className="w-3.5 h-3.5" /> {showFormat ? 'Hide' : 'Show'} format guide
            </Button>
          </div>

          {showFormat && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Format guide
              </p>
              <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
                {IMPORT_FORMAT_EXAMPLE}
              </pre>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1.5 block">Quiz text</label>
            <Textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null); }}
              placeholder={IMPORT_FORMAT_EXAMPLE}
              className="font-mono text-xs min-h-[240px] resize-y"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handlePreview} disabled={!text.trim()}>
            Preview
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={!text.trim() || importing}
            className="gap-2"
          >
            {importing ? (
              <>Importing...</>
            ) : (
              <><Check className="w-4 h-4" /> Import quiz</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
