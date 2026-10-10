'use client'

import { createServerClient } from '@gaussian/meridian-next'

export default function Page() {
  return <button onClick={() => void createServerClient().models.list()}>Leak</button>
}
