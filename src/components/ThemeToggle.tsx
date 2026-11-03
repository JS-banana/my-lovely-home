'use client'

/** 主题切换：跟随系统 → 手动浅色 → 手动深色，三态循环，写入 localStorage。 */
import { useEffect, useRef, useState } from 'react'

import Icon from './Icon'
import { IconButton } from './ui/button'

type Mode = 'system' | 'light' | 'dark'
const KEY = 'mh-theme'

function apply(mode: Mode) {
  const resolved =
    mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : mode
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themeMode = mode
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system')
  const [mounted, setMounted] = useState(false)
  const currentMode = useRef<Mode>('system')

  useEffect(() => {
    let saved: Mode = 'system'
    try {
      const value = localStorage.getItem(KEY)
      if (value === 'light' || value === 'dark') saved = value
    } catch {
      // 无法保存偏好时，仍可在本次打开期间切换主题。
    }
    currentMode.current = saved
    setMode(saved)
    apply(saved)
    setMounted(true)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (currentMode.current === 'system') apply('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const cycle = () => {
    const next: Mode = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system'
    setMode(next)
    currentMode.current = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // 存储失败不阻止视觉切换。
    }
    apply(next)
  }

  const label = mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'
  const icon = !mounted ? 'sun' : mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'eye'

  return (
    <IconButton
      label={`主题：${label}`}
      onClick={cycle}
      title={`主题：${label}（点击切换）`}
      aria-label={`主题：${label}`}
    >
      <Icon name={icon} size={16} />
    </IconButton>
  )
}
