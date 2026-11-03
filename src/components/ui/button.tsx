'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from './utils'

const buttonVariants = cva(
  [
    'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-ui border-2',
    'px-[var(--space-4)] py-[var(--space-2)] font-ui text-ui font-semibold',
    'outline-none transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-out',
    'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      variant: {
        primary: [
          'border-sun-ink bg-sun text-sun-ink shadow-ui-md',
          'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-ui-sm',
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none',
        ],
        secondary: [
          'border-edge bg-surface text-ink-2 shadow-ui-sm',
          'hover:border-line-strong hover:bg-surface-2 hover:text-ink',
          'active:translate-x-px active:translate-y-px active:shadow-none',
          'aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-ink',
        ],
        ghost: [
          'border-transparent bg-transparent text-ink-2',
          'hover:border-line hover:bg-surface-2 hover:text-ink',
          'active:bg-surface-3',
          'aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-ink',
        ],
        outline: [
          'border-edge bg-transparent text-ink',
          'hover:border-accent hover:bg-accent-soft hover:text-accent-ink',
          'active:bg-accent-soft',
          'aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-ink',
        ],
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** 使用 Radix Slot，把按钮外观和行为附着到 Link 等单一子元素。 */
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      className,
      children,
      disabled,
      loading = false,
      variant,
      type,
      onClick,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    const isDisabled = Boolean(disabled || loading)

    return (
      <Comp
        {...props}
        type={asChild ? undefined : (type ?? 'button')}
        tabIndex={asChild && isDisabled ? -1 : props.tabIndex}
        onClick={(event) => {
          if (isDisabled) {
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
        ref={ref}
        className={cn(
          buttonVariants({ variant }),
          isDisabled && asChild && 'pointer-events-none',
          className,
        )}
        disabled={!asChild && isDisabled ? true : undefined}
        aria-disabled={asChild && isDisabled ? true : undefined}
        aria-busy={loading ? true : undefined}
        data-loading={loading ? true : undefined}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
              />
            )}
            {children}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  label: string
  children: React.ReactNode
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ children, label, type, variant = 'ghost', ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      type={type ?? 'button'}
      variant={variant}
      aria-label={label}
      className={cn('size-11 shrink-0 p-0', props.className)}
    >
      {children}
    </Button>
  ),
)
IconButton.displayName = 'IconButton'
