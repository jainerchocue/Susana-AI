import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its children and responds to clicks', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Ingresar</Button>)

    const button = screen.getByRole('button', { name: 'Ingresar' })
    await userEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables interaction while isLoading', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} isLoading>
        Ingresar
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Ingresar' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
