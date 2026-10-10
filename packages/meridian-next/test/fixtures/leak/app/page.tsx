'use client'

import { createServerClient } from '@gaussian-id/meridian-next'

export default function Page() {
  return <button onClick={() => void createServerClient().models.list()}>Leak</button>
}
