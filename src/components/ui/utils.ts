import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// 对应 globals.css 的 --text-*；自定义字号不能被当成文字颜色合并掉。
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['label', 'micro', 'meta', 'ui', 'table', 'lead', 'h3', 'h2', 'h1', 'display'],
    },
  },
})

/** 合并组件默认类名与调用方覆盖，避免 Tailwind 冲突类同时生效。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
