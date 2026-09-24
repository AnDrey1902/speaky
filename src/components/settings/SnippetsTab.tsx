import React, { useState } from 'react';
import { TextSnippet, UILanguage } from '../../types';
import { Plus, Trash2, BookmarkCheck, Pencil, Check, X } from 'lucide-react';
import { getTranslations } from '../../utils/i18n';
import { Button, EmptyState, Input, TabHeader, Textarea } from '../common/ui';

interface SnippetsTabProps {
  snippets: TextSnippet[];
  onSave: (snippets: TextSnippet[]) => void;
  uiLanguage?: UILanguage;
}

export const SnippetsTab: React.FC<SnippetsTabProps> = ({ snippets, onSave, uiLanguage }) => {
  const t = getTranslations(uiLanguage);
  const [trigger, setTrigger] = useState('');
  const [replacement, setReplacement] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ trigger: string; replacement: string; description: string }>({
    trigger: '',
    replacement: '',
    description: ''
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trigger.trim() || !replacement.trim()) return;

    const updated = [
      ...snippets,
      {
        id: Date.now().toString(),
        trigger: trigger.trim().toLowerCase(),
        replacement: replacement.trim(),
        description: description.trim() || undefined
      }
    ];
    onSave(updated);
    setTrigger('');
    setReplacement('');
    setDescription('');
  };

  const handleDelete = (id: string) => {
    if (editingId === id) setEditingId(null);
    onSave(snippets.filter((s) => s.id !== id));
  };

  const startEdit = (s: TextSnippet) => {
    setEditingId(s.id);
    setEditDraft({
      trigger: s.trigger,
      replacement: s.replacement,
      description: s.description || ''
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = (id: string) => {
    const trg = editDraft.trigger.trim().toLowerCase();
    const rep = editDraft.replacement.trim();
    if (!trg || !rep) return;
    onSave(
      snippets.map((s) =>
        s.id === id
          ? { ...s, trigger: trg, replacement: rep, description: editDraft.description.trim() || undefined }
          : s
      )
    );
    setEditingId(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <TabHeader title={t.snippetsTitle} subtitle={t.snippetsSubtitle} />

      {/* Add snippet form */}
      <form onSubmit={handleAdd} className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/70 space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">{t.triggerLabel}</label>
            <Input
              type="text"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder={t.triggerPlaceholder}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">{t.descLabel}</label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.descPlaceholder}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">{t.replacementLabel}</label>
          <Textarea
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={t.replacementPlaceholder}
            rows={2}
            className="font-mono"
          />
        </div>

        <Button type="submit" variant="primary" disabled={!trigger.trim() || !replacement.trim()}>
          <Plus className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> {t.addSnippet}
        </Button>
      </form>

      {/* Snippets list */}
      <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
        {snippets.length === 0 ? (
          <EmptyState icon={BookmarkCheck}>{t.snippetsEmptyDesc}</EmptyState>
        ) : (
          snippets.map((s) =>
            editingId === s.id ? (
              <div
                key={s.id}
                className="p-4 rounded-xl border border-indigo-500/70 ring-1 ring-indigo-500/40 bg-zinc-900 space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">{t.triggerLabel}</label>
                    <Input
                      type="text"
                      value={editDraft.trigger}
                      onChange={(e) => setEditDraft({ ...editDraft, trigger: e.target.value })}
                      placeholder={t.triggerPlaceholder}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">{t.descLabel}</label>
                    <Input
                      type="text"
                      value={editDraft.description}
                      onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                      placeholder={t.descPlaceholder}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">{t.replacementLabel}</label>
                  <Textarea
                    value={editDraft.replacement}
                    onChange={(e) => setEditDraft({ ...editDraft, replacement: e.target.value })}
                    placeholder={t.replacementPlaceholder}
                    rows={2}
                    className="font-mono"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" onClick={cancelEdit}>
                    <X className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> {t.cancelEdit}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => saveEdit(s.id)}
                    disabled={!editDraft.trigger.trim() || !editDraft.replacement.trim()}
                  >
                    <Check className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> {t.saveChanges}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={s.id}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/70 flex items-start justify-between group hover:border-zinc-700 transition-all"
              >
                <div className="space-y-1.5 flex-1 mr-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 font-mono text-xs text-indigo-300 font-semibold">
                      «{s.trigger}»
                    </span>
                    <span className="text-xs text-zinc-600">→</span>
                    {s.description && <span className="text-xs text-zinc-500">{s.description}</span>}
                  </div>
                  <div className="text-xs text-zinc-300 font-mono pl-3 border-l-2 border-indigo-500 bg-zinc-800/60 p-2.5 rounded-r-lg break-words">
                    {s.replacement}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(s)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-500 hover:text-indigo-300 hover:bg-zinc-800 transition-all cursor-pointer"
                    title={t.editSnippet}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-all cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
};
