import { el, setText } from './dom.ts'

export type ConfirmOptions = {
  title: string
  meta: string
  command: string
  warning: string
  confirmLabel: string
  returnFocus: HTMLElement | null
}

export type ConfirmDialog = {
  element: HTMLDialogElement
  isOpen(): boolean
  confirm(options: ConfirmOptions): Promise<boolean>
}

export function createConfirmDialog(): ConfirmDialog {
  const title = el('h2', { className: 'vt-dialog-title', attrs: { id: 'vt-dialog-title' } })
  const meta = el('p', { className: 'vt-dialog-text' })
  const command = el('code', { className: 'vt-command' })
  const warning = el('p', { className: 'vt-dialog-text' })
  const cancel = el('button', {
    className: 'vt-button vt-dialog-button',
    text: 'Cancel',
    attrs: { type: 'button', value: 'cancel' }
  })
  const accept = el('button', {
    className: 'vt-button vt-dialog-button vt-danger-fill',
    attrs: { type: 'button', value: 'confirm' }
  })
  const element = el(
    'dialog',
    { className: 'vt-dialog', attrs: { 'aria-labelledby': 'vt-dialog-title' } },
    [
      title,
      el('div', { className: 'vt-dialog-body' }, [meta, command, warning]),
      el('div', { className: 'vt-dialog-actions' }, [cancel, accept])
    ]
  )
  let settle: ((confirmed: boolean) => void) | null = null
  let returnFocus: HTMLElement | null = null

  cancel.addEventListener('click', () => element.close('cancel'))
  accept.addEventListener('click', () => element.close('confirm'))
  element.addEventListener('close', () => {
    const done = settle
    settle = null
    if (returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus()
    done?.(element.returnValue === 'confirm')
  })

  return {
    element,
    isOpen: () => element.open,
    confirm(options) {
      if (element.open) element.close('cancel')
      setText(title, options.title)
      setText(meta, options.meta)
      setText(command, options.command)
      command.hidden = options.command === ''
      setText(warning, options.warning)
      setText(accept, options.confirmLabel)
      returnFocus = options.returnFocus
      element.returnValue = ''
      if (!element.isConnected) document.body.append(element)
      if (returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus()
      return new Promise<boolean>((resolve) => {
        settle = resolve
        element.showModal()
        cancel.focus()
      })
    }
  }
}
