'use client'

// Deliberately not wired up yet: Summarize/Reply/Translate/Extract Tasks/etc.
// all need a real backend action (an LLM call scoped to the open thread) that
// doesn't exist in this codebase yet. Shipping clickable buttons that silently
// do nothing would be worse than an honest "not built yet" panel, so this is
// a preview of the intended actions, not a working feature.
const PLANNED = ['Summarize', 'Reply', 'Translate', 'Extract Tasks', 'Find Attachments', 'Meeting Notes', 'Generate Invoice', 'Draft Contract']

export function AIPanel() {
  return (
    <div className="h-full overflow-y-auto p-5 flex flex-col gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-1">AI Assistant</div>
        <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">Not wired up yet — these need a real backend action per thread, so they're shown as the plan rather than as working buttons.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {PLANNED.map((label) => (
          <div key={label} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[color:var(--muted)] cursor-not-allowed" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }} title="Not built yet">
            <span className="opacity-50">✦</span>{label}
          </div>
        ))}
      </div>
    </div>
  )
}
