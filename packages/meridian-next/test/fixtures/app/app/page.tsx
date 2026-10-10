'use client'

import { createBrowserClient } from '@gaussian/meridian-next/browser'

const meridian = createBrowserClient()

export default function Page() {
  return (
    <button onClick={() => void meridian.chat.create({ messages: [{ role: 'user', content: 'hi' }] })}>Send</button>
  )
}
