import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PermissionCard from './PermissionCard'
import { makePermission } from '../../test/factories'

const mocks = vi.hoisted(() => ({
  replyPermission: vi.fn<() => Promise<void>>(async () => undefined)
}))

vi.mock('../../chat/store', () => ({
  chatStore: { replyPermission: mocks.replyPermission }
}))

const request = makePermission({
  id: 'p1',
  action: 'write',
  resource: '/tmp/a.txt',
  toolName: 'write'
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.replyPermission.mockClear()
  mocks.replyPermission.mockResolvedValue(undefined)
})

describe('PermissionCard', () => {
  it('renders the action, tool and resource', () => {
    render(<PermissionCard request={request} />)

    expect(screen.getByText('Permission required')).toBeInTheDocument()
    expect(screen.getByText('Write file')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
    expect(screen.getByText('/tmp/a.txt')).toBeInTheDocument()
  })

  it('maps each decision to its reply', async () => {
    const user = userEvent.setup()
    render(<PermissionCard request={request} />)

    await user.click(screen.getByRole('button', { name: 'Allow' }))
    expect(mocks.replyPermission).toHaveBeenLastCalledWith('p1', 'once')

    await user.click(screen.getByRole('button', { name: 'Always allow' }))
    expect(mocks.replyPermission).toHaveBeenLastCalledWith('p1', 'always')

    await user.click(screen.getByRole('button', { name: 'Deny' }))
    expect(mocks.replyPermission).toHaveBeenLastCalledWith('p1', 'reject')
  })

  it('disables the buttons while a reply is pending', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    mocks.replyPermission.mockReturnValueOnce(pending.promise)
    render(<PermissionCard request={request} />)

    await user.click(screen.getByRole('button', { name: 'Allow' }))

    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()

    pending.resolve()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled())
  })

  it('shows the failure message', async () => {
    const user = userEvent.setup()
    mocks.replyPermission.mockRejectedValueOnce(new Error('permission backend down'))
    render(<PermissionCard request={request} />)

    await user.click(screen.getByRole('button', { name: 'Deny' }))

    expect(await screen.findByText('permission backend down')).toBeInTheDocument()
  })
})
