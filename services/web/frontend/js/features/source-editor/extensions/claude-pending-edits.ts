// Claude pending-edit decorations.
//
// The Claude rail fetches edit proposals from /project/:p/claude/edits.
// When that list changes, the rail dispatches a window CustomEvent with
// the edits payload; this extension picks it up, finds matching ranges
// in the open document, and renders:
//   * a red line-background on the lines containing old_text
//   * an inline widget below those lines that previews new_text and
//     exposes Apply / Skip buttons
//
// The widget's buttons hit the same /apply and /skip endpoints the rail
// uses, so the UI stays consistent regardless of where the user acts.

import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import {
  EditorState,
  Range,
  StateEffect,
  StateField,
} from '@codemirror/state'

type Edit = {
  id: string
  thread_id?: string
  file_path: string
  old_text: string
  new_text: string
  rationale?: string
  status: 'pending' | 'applied' | 'skipped'
}

type Context = {
  projectId: string | null
  // The file path of the doc currently in the editor, normalised to start
  // with "/" the same way ProjectEntityHandler emits paths.
  currentDocPath: string | null
  edits: Edit[]
}

const setContextEffect = StateEffect.define<Context>()

const claudePendingState = StateField.define<Context>({
  create() {
    return { projectId: null, currentDocPath: null, edits: [] }
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setContextEffect)) {
        return effect.value
      }
    }
    return value
  },
})

class ClaudeNewTextWidget extends WidgetType {
  constructor(
    readonly edit: Edit,
    readonly projectId: string,
    readonly csrf: string
  ) {
    super()
  }
  eq(other: ClaudeNewTextWidget) {
    return other.edit.id === this.edit.id
  }
  toDOM() {
    const root = document.createElement('div')
    root.className = 'claude-inline-edit'

    const header = document.createElement('div')
    header.className = 'claude-inline-edit__header'
    const badge = document.createElement('span')
    badge.className = 'claude-inline-edit__badge'
    badge.textContent = 'Claude proposal'
    header.appendChild(badge)
    if (this.edit.rationale) {
      const why = document.createElement('span')
      why.className = 'claude-inline-edit__rationale'
      why.textContent = ` — ${this.edit.rationale}`
      header.appendChild(why)
    }
    root.appendChild(header)

    const newText = document.createElement('pre')
    newText.className = 'claude-inline-edit__new-text'
    newText.textContent = this.edit.new_text
    root.appendChild(newText)

    const actions = document.createElement('div')
    actions.className = 'claude-inline-edit__actions'

    const apply = document.createElement('button')
    apply.type = 'button'
    apply.className = 'claude-btn claude-btn--primary'
    apply.textContent = 'Apply'
    apply.addEventListener('click', e => {
      e.preventDefault()
      this.send('apply')
    })
    actions.appendChild(apply)

    const skip = document.createElement('button')
    skip.type = 'button'
    skip.className = 'claude-btn claude-btn--ghost'
    skip.textContent = 'Skip'
    skip.addEventListener('click', e => {
      e.preventDefault()
      this.send('skip')
    })
    actions.appendChild(skip)

    root.appendChild(actions)
    return root
  }

  ignoreEvent() {
    // Let mouse events reach the buttons.
    return false
  }

  send(action: 'apply' | 'skip') {
    fetch(
      `/project/${this.projectId}/claude/edits/${this.edit.id}/${action}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        },
        body: '{}',
      }
    ).catch(() => {
      // The Claude rail will surface errors; ignore here.
    })
  }
}

function getCsrfToken(): string {
  const meta = document.querySelector(
    'meta[name="ol-csrfToken"]'
  ) as HTMLMetaElement | null
  return meta?.content || ''
}

function locateOldText(state: EditorState, oldText: string) {
  if (!oldText) return null
  const text = state.doc.toString()
  const idx = text.indexOf(oldText)
  if (idx === -1) return null
  if (text.indexOf(oldText, idx + oldText.length) !== -1) {
    // ambiguous — refuse to decorate to avoid pointing at the wrong place
    return null
  }
  return { from: idx, to: idx + oldText.length }
}

function buildDecorations(state: EditorState): DecorationSet {
  const ctx = state.field(claudePendingState, false)
  if (!ctx || !ctx.projectId || !ctx.currentDocPath) return Decoration.none
  const ranges: Range<Decoration>[] = []
  const csrf = getCsrfToken()
  for (const edit of ctx.edits) {
    if (edit.status !== 'pending') continue
    if (edit.file_path !== ctx.currentDocPath) continue
    const span = locateOldText(state, edit.old_text)
    if (!span) continue
    const fromLine = state.doc.lineAt(span.from)
    const toLine = state.doc.lineAt(span.to)
    for (let lineNum = fromLine.number; lineNum <= toLine.number; lineNum++) {
      const line = state.doc.line(lineNum)
      ranges.push(
        Decoration.line({ class: 'claude-inline-edit-del-line' }).range(
          line.from
        )
      )
    }
    ranges.push(
      Decoration.mark({ class: 'claude-inline-edit-del' }).range(
        span.from,
        span.to
      )
    )
    ranges.push(
      Decoration.widget({
        widget: new ClaudeNewTextWidget(edit, ctx.projectId, csrf),
        side: 1,
        block: true,
      }).range(toLine.to)
    )
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to)
  return Decoration.set(ranges, true)
}

const decorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state)
  },
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.effects.some(e => e.is(setContextEffect))
    ) {
      return buildDecorations(tr.state)
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

// External lifecycle hook used by the React layer to push fresh state into
// the editor. We listen for a window CustomEvent so a single source can
// update all editor instances at once (we have at most one in CE today).
function listenForUpdates(view: EditorView) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail || {}
    view.dispatch({
      effects: setContextEffect.of({
        projectId: detail.projectId ?? null,
        currentDocPath: detail.currentDocPath ?? null,
        edits: Array.isArray(detail.edits) ? detail.edits : [],
      }),
    })
  }
  window.addEventListener('claude:pending-edits', handler)
  return () => window.removeEventListener('claude:pending-edits', handler)
}

export function claudePendingEdits() {
  return [
    claudePendingState,
    decorationsField,
    EditorView.domEventHandlers({
      // Force a redraw on document switch — the React side dispatches its
      // own event but defensive update on focus keeps things in sync.
      focus(_event, view) {
        // Trigger a no-op transaction so buildDecorations re-evaluates.
        view.dispatch({})
        return false
      },
    }),
    EditorView.theme({}),
    EditorView.updateListener.of(update => {
      // Wire up the global event listener exactly once per view. CodeMirror
      // calls updateListeners for every transaction; we only need to attach
      // the global listener on first run.
      const view = update.view as EditorView & {
        __claudeListener?: () => void
      }
      if (!view.__claudeListener) {
        view.__claudeListener = listenForUpdates(view)
      }
    }),
  ]
}
