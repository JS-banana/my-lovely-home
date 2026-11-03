/** 控件和 Portal 的键盘事件不能继续驱动画布或抢走全局焦点。 */
export function isControlTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="menu"], [role="slider"], [role="switch"], [role="checkbox"], [data-ui-control]',
      ),
    )
  )
}

/** Shared ownership gate for search commands, not for controls inside a 3D scene. */
export function searchKeyBlocked(event: KeyboardEvent) {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229
}

export function sceneKeyBlocked(event: Event) {
  return (
    event.defaultPrevented ||
    isControlTarget(event.target) ||
    Boolean(document.querySelector('[data-ui-layer]'))
  )
}
