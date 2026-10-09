'use client'

import { createServerClient } from 'meridian-next'

export default function Page() {
  return <button onClick={() => void createServerClient().models.list()}>Leak</button>
}
